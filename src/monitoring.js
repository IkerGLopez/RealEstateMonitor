const crypto = require('crypto');
const { db } = require('./db.js');

const MAX_MISS_COUNT = 3;

/**
 * Normalizes price to a numeric integer
 * @param {number|string|null} price
 * @returns {number|null}
 */
function normalizePrice(price) {
  if (price == null) return null;
  const str = String(price).replace(/[^\d.,]/g, '').replace(',', '.');
  const num = parseFloat(str);
  return isNaN(num) ? null : Math.round(num);
}

/**
 * Normalizes text fields to avoid false positive diffs
 * @param {string|null} text
 * @returns {string|null}
 */
function normalizeText(text) {
  if (text == null) return null;
  return String(text).trim().replace(/\s+/g, ' ');
}

/**
 * Compare scraped listings with the database and generate audit records.
 */
async function processScrapeRun(siteId, scrapedListings, options = {}) {
  const dryRun = options.dryRun || false;
  const run_id = crypto.randomUUID();
  const started_at = new Date().toISOString();

  console.log(`\n[Monitoring] Starting run ${run_id} for site '${siteId}' (Dry run: ${dryRun})`);

  // Fetch current known state
  const currentResult = await db.execute({
    sql: 'SELECT id, active, miss_count, first_seen FROM listings_current WHERE siteId = ?',
    args: [siteId]
  });
  
  const currentMap = new Map();
  currentResult.rows.forEach(row => {
    currentMap.set(row.id, { active: row.active, miss_count: row.miss_count, first_seen: row.first_seen });
  });

  const seenIds = new Set();
  const events = [];
  const dbOperations = []; // Queue of operations to perform if not dryRun

  // 1. Process scraped items
  for (const listing of scrapedListings) {
    const id = listing.id;
    seenIds.add(id);

    const normPrice = normalizePrice(listing.price);
    const normTitle = normalizeText(listing.title);
    const normLoc = normalizeText(listing.location);

    const isNew = !currentMap.has(id);
    const wasRemoved = currentMap.has(id) && currentMap.get(id).active === 0;

    let changeType = null;
    let diffJson = [];

    if (isNew || wasRemoved) {
      changeType = 'new';
      
      if (wasRemoved) {
        diffJson.push({ field: 'active', old: 0, new: 1 });
        dbOperations.push({
          sql: `UPDATE listings_current SET active = 1, miss_count = 0, last_seen = ? WHERE id = ?`,
          args: [started_at, id]
        });
      } else {
        dbOperations.push({
          sql: `INSERT INTO listings_current (id, siteId, active, miss_count, first_seen, last_seen) VALUES (?, ?, 1, 0, ?, ?)`,
          args: [id, siteId, started_at, started_at]
        });
      }
    } else {
      // Get last snapshot to compare
      const snapResult = await db.execute({
        sql: 'SELECT title, location, price FROM listings_snapshot WHERE id = ? ORDER BY run_id DESC LIMIT 1',
        args: [id]
      });

      if (snapResult.rows.length > 0) {
        const snap = snapResult.rows[0];
        const oldPrice = normalizePrice(snap.price);
        const oldTitle = normalizeText(snap.title);
        const oldLoc = normalizeText(snap.location);

        if (oldPrice !== normPrice) {
          diffJson.push({ field: 'price_num', old: oldPrice, new: normPrice });
        }
        if (oldTitle !== normTitle) {
          diffJson.push({ field: 'title', old: oldTitle, new: normTitle });
        }
        if (oldLoc !== normLoc) {
          diffJson.push({ field: 'location', old: oldLoc, new: normLoc });
        }

        if (diffJson.length > 0) {
          // If price is only changed field or one of the changed fields..
          const changedAttrs = diffJson.some(d => d.field !== 'price_num');
          const changedPrc = diffJson.some(d => d.field === 'price_num');
          
          if (changedAttrs) changeType = 'attributes_changed';
          else if (changedPrc) changeType = 'price_changed';
        }
      }

      dbOperations.push({
        sql: `UPDATE listings_current SET last_seen = ?, miss_count = 0 WHERE id = ?`,
        args: [started_at, id]
      });
    }

    if (changeType) {
      events.push({ id, changeType, diffJson });
      dbOperations.push({
        sql: `INSERT INTO listing_changes (id, run_id, change_type, diff_json, created_at) VALUES (?, ?, ?, ?, ?)`,
        args: [id, run_id, changeType, JSON.stringify(diffJson), started_at]
      });
    }

    // Always snapshot the current observed state
    dbOperations.push({
      sql: `INSERT INTO listings_snapshot (id, run_id, title, location, price, url, scrapedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, run_id, listing.title, listing.location, listing.price, listing.url, started_at]
    });
  }

  // 2. Process missing items
  for (const [id, state] of currentMap.entries()) {
    if (!seenIds.has(id) && state.active === 1) {
      const newMissCount = state.miss_count + 1;
      
      if (newMissCount > MAX_MISS_COUNT) {
        events.push({
          id,
          changeType: 'removed',
          diffJson: [{ field: 'active', old: 1, new: 0 }]
        });
        
        dbOperations.push({
          sql: `UPDATE listings_current SET active = 0, miss_count = ? WHERE id = ?`,
          args: [newMissCount, id]
        });
        dbOperations.push({
          sql: `INSERT INTO listing_changes (id, run_id, change_type, diff_json, created_at) VALUES (?, ?, ?, ?, ?)`,
          args: [id, run_id, 'removed', JSON.stringify([{ field: 'active', old: 1, new: 0 }]), started_at]
        });
      } else {
        dbOperations.push({
          sql: `UPDATE listings_current SET miss_count = ? WHERE id = ?`,
          args: [newMissCount, id]
        });
      }
    }
  }

  const finished_at = new Date().toISOString();

  // Print summary
  if (dryRun) {
    dbOperations.unshift({
       sql: "INSERT ... scrape_runs"
    });
    console.log(`[Dry Run] Database would safely run ${dbOperations.length} operations. Detected ${events.length} change events.`);
    for (const e of events) {
      console.log(`  - [${e.id}] ${e.changeType}: ${JSON.stringify(e.diffJson)}`);
    }
    return;
  }

  // Execute DB changes dynamically
  dbOperations.unshift({
    sql: `INSERT INTO scrape_runs (run_id, siteId, started_at, finished_at, listings_found, status) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [run_id, siteId, started_at, finished_at, scrapedListings.length, 'success']
  });

  console.log(`[Persistence] Committing ${dbOperations.length} operations to database...`);
  
  for (const op of dbOperations) {
    try {
      await db.execute(op);
    } catch(e) {
      console.error(`Failed executing DB op: ${op.sql} with args ${op.args}`);
      throw e;
    }
  }
  
  console.log(`[Monitoring] Successfully committed run ${run_id}. Detected ${events.length} change events.`);
  for (const e of events) {
    if (e.changeType) {
        console.log(`  - [${e.id}] ${e.changeType}: ${JSON.stringify(e.diffJson)}`);
    }
  }
}

module.exports = {
  MAX_MISS_COUNT,
  normalizePrice,
  normalizeText,
  processScrapeRun
};
