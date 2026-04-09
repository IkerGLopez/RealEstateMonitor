const { db } = require('./db.js');
const crypto = require('crypto');

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

async function processScrapeRun(siteId, listings, options = {}) {
  const { dryRun = false } = options;
  const run_id = crypto.randomUUID();
  const started_at = new Date().toISOString();
  
  if (dryRun) console.log(`\n[Dry Run] Starting processing for run ${run_id}`);
  
  // Transform listings into normalized map
  const currentScraped = new Map();
  for (const item of listings) {
    currentScraped.set(item.id, {
      id: item.id,
      title: normalizeText(item.title),
      location: normalizeText(item.location),
      price_num: normalizePrice(item.price),
      url: item.url || item.detailUrl,
      scrapedAt: item.scrapedAt || started_at
    });
  }

  // Fetch known active listings for this site
  const activeListingsResult = await db.execute({
    sql: `SELECT id, active, miss_count, first_seen, last_seen FROM listings_current WHERE siteId = ?`,
    args: [siteId]
  });
  
  const knownActive = new Map();
  for (const row of activeListingsResult.rows) {
    knownActive.set(row.id, row);
  }

  let changes = [];
  let stmts = [];

  // Scrape run entry
  stmts.push({
    sql: `INSERT INTO scrape_runs (run_id, siteId, started_at, listings_found, status) VALUES (?, ?, ?, ?, ?)`,
    args: [run_id, siteId, started_at, listings.length, 'success']
  });

  // Evaluate scraped listings
  for (const [id, listing] of currentScraped) {
    const known = knownActive.get(id);

    if (!known || known.active === 0 || known.active === false) {
      // New or reappeared listing
      changes.push({ id, change_type: 'new', diff_json: [] });

      stmts.push({
        sql: `
          INSERT INTO listings_current (id, siteId, active, miss_count, first_seen, last_seen)
          VALUES (?, ?, 1, 0, ?, ?)
          ON CONFLICT(id) DO UPDATE SET active = 1, miss_count = 0, last_seen = ?
        `,
        args: [id, siteId, started_at, started_at, started_at]
      });

      stmts.push({
        sql: `INSERT INTO listings_snapshot (id, run_id, title, location, price, url, scrapedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [id, run_id, listing.title, listing.location, listing.price_num, listing.url, listing.scrapedAt]
      });
    } else {
      // Existing active listing - load last snapshot to compare
      const snapResult = await db.execute({
        sql: `SELECT title, location, price, url FROM listings_snapshot WHERE id = ? ORDER BY run_id DESC LIMIT 1`,
        args: [id]
      });

      if (snapResult.rows.length > 0) {
        const lastSnap = snapResult.rows[0];
        let diffs = [];

        if (lastSnap.price !== listing.price_num) {
          diffs.push({ field: 'price_num', old: lastSnap.price, new: listing.price_num });
        }
        if (lastSnap.title !== listing.title) {
          diffs.push({ field: 'title', old: lastSnap.title, new: listing.title });
        }
        if (lastSnap.location !== listing.location) {
          diffs.push({ field: 'location', old: lastSnap.location, new: listing.location });
        }

        if (diffs.length > 0) {
          const hasPriceChange = diffs.some(d => d.field === 'price_num');
          const hasAttrChange = diffs.some(d => d.field !== 'price_num');

          if (hasPriceChange) {
            changes.push({ id, change_type: 'price_changed', diff_json: diffs.filter(d => d.field === 'price_num') });
          }
          if (hasAttrChange) {
            changes.push({ id, change_type: 'attributes_changed', diff_json: diffs.filter(d => d.field !== 'price_num') });
          }

          // Need a new snapshot since it changed
          stmts.push({
            sql: `INSERT INTO listings_snapshot (id, run_id, title, location, price, url, scrapedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [id, run_id, listing.title, listing.location, listing.price_num, listing.url, listing.scrapedAt]
          });
        }
      }

      // Update last_seen and reset miss_count
      stmts.push({
        sql: `UPDATE listings_current SET last_seen = ?, miss_count = 0 WHERE id = ?`,
        args: [started_at, id]
      });
    }
    
    // Remove from knownActive so we know what's missing
    knownActive.delete(id);
  }

  // Evaluate missing listings
  for (const [id, known] of knownActive) {
    if (known.active) {
      const newMissCount = known.miss_count + 1;
      
      if (newMissCount > MAX_MISS_COUNT) {
        changes.push({ id, change_type: 'removed', diff_json: [] });
        stmts.push({
          sql: `UPDATE listings_current SET active = 0, miss_count = ? WHERE id = ?`,
          args: [newMissCount, id]
        });
      } else {
        stmts.push({
          sql: `UPDATE listings_current SET miss_count = ? WHERE id = ?`,
          args: [newMissCount, id]
        });
      }
    }
  }

  // Generate logs and DB statements for changes
  for (const c of changes) {
    let diffStr = JSON.stringify(c.diff_json);
    if (dryRun) {
      console.log(`[Dry Run] CHANGE DETECTED: [${c.change_type}] on ${c.id} -> ${diffStr}`);
    }
    
    stmts.push({
      sql: `INSERT INTO listing_changes (id, run_id, change_type, diff_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      args: [c.id, run_id, c.change_type, diffStr, started_at]
    });
  }

  stmts.push({
    sql: `UPDATE scrape_runs SET finished_at = ? WHERE run_id = ?`,
    args: [new Date().toISOString(), run_id]
  });

  if (dryRun) {
    console.log(`[Dry Run] Finished evaluating. ${changes.length} changes detected. Database was NOT modified.\n`);
  } else {
    // Write everything to DB
    for (const stmt of stmts) {
      await db.execute(stmt);
    }
    console.log(`[Monitoring] Committed ${changes.length} changes for run ${run_id}.`);
  }

  return changes;
}

module.exports = {
  MAX_MISS_COUNT,
  normalizePrice,
  normalizeText,
  processScrapeRun
};