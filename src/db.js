const { createClient } = require("@libsql/client");
const dotenv = require("dotenv");

dotenv.config();

// Default to a local SQLite database if no Turso URL is provided in the environment
const dbUrl = process.env.TURSO_URL || "file:apartments.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

/**
 * Singleton client connection.
 * @type {import('@libsql/client').Client}
 */
const db = createClient({
  url: dbUrl,
  authToken: authToken,
});

/**
 * Set up the database schema for listings monitoring.
 */
async function setupDatabase() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS scrape_runs (
      run_id TEXT PRIMARY KEY,
      siteId TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      listings_found INTEGER,
      status TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS listings_current (
      id TEXT PRIMARY KEY,
      siteId TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      miss_count INTEGER DEFAULT 0,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS listings_snapshot (
      id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      title TEXT,
      location TEXT,
      price REAL,
      url TEXT,
      scrapedAt TEXT,
      PRIMARY KEY (id, run_id),
      FOREIGN KEY(run_id) REFERENCES scrape_runs(run_id)
    )`,
    `CREATE TABLE IF NOT EXISTS listing_changes (
      id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      diff_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES scrape_runs(run_id)
    )`
  ];

  for (const stmt of statements) {
    await db.execute(stmt);
  }
}

/**
 * Upsert a scraped listing into the database.
 * @param {import('./types.js').Listing} listing
 */
async function upsertListing(listing) {
  const now = new Date().toISOString();
  
  await db.execute({
    sql: `
      INSERT INTO apartments (id, siteId, title, location, price, url, scrapedAt, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        location = excluded.location,
        price = excluded.price,
        url = excluded.url,
        scrapedAt = excluded.scrapedAt,
        updatedAt = ?
    `,
    args: [
      listing.id,
      listing.siteId,
      listing.title,
      listing.location,
      listing.price,
      listing.url,
      now,
      now,
      now,
      now
    ]
  });
}

/**
 * Check and log the status of the database (e.g., connected db type and item counts).
 */
async function getDatabaseStatus() {
  const result = await db.execute(`SELECT siteId, COUNT(*) as count FROM apartments GROUP BY siteId`);
  
  console.log("--- Database Status ---");
  console.log(`Connected to: ${dbUrl}`);
  
  if (result.rows.length === 0) {
    console.log("Table 'apartments' is currently empty.");
  } else {
    for (const row of result.rows) {
      console.log(`Site '${row.siteId}': ${row.count} listings.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Dashboard Queries (Read-Only)
// ---------------------------------------------------------------------------

async function getDashboardStats() {
  try {
    const activeResult = await db.execute(`SELECT COUNT(*) as count FROM listings_current WHERE active = 1`);
    const activeCount = activeResult.rows[0]?.count || 0;

    const lastRunResult = await db.execute(`SELECT run_id FROM scrape_runs ORDER BY started_at DESC LIMIT 1`);
    let recentChangesCount = 0;
    
    if (lastRunResult.rows.length > 0) {
      const lastRunId = lastRunResult.rows[0].run_id;
      const changesResult = await db.execute({
        sql: `SELECT COUNT(*) as count FROM listing_changes WHERE run_id = ?`,
        args: [lastRunId]
      });
      recentChangesCount = changesResult.rows[0]?.count || 0;
    }

    return {
      activeListings: activeCount,
      recentChanges: recentChangesCount
    };
  } catch (err) {
    console.warn("Could not fetch dashboard stats (table possibly empty?):", err.message);
    return { activeListings: 0, recentChanges: 0 };
  }
}

async function getDashboardChanges(limit = 50) {
  try {
    const sql = `
      SELECT 
        c.id, 
        c.change_type, 
        c.diff_json, 
        c.created_at, 
        s.title, 
        s.url
      FROM listing_changes c
      LEFT JOIN listings_snapshot s ON c.id = s.id AND c.run_id = s.run_id
      ORDER BY c.created_at DESC 
      LIMIT ?
    `;
    const result = await db.execute({ sql, args: [limit] });
    return result.rows.map(row => ({
      id: row.id,
      changeType: row.change_type,
      diffJson: JSON.parse(row.diff_json || '{}'),
      createdAt: row.created_at,
      title: row.title,
      url: row.url
    }));
  } catch (err) {
    console.warn("Could not fetch dashboard changes:", err.message);
    return [];
  }
}

async function getDashboardListings() {
  try {
    const sql = `
      SELECT 
        c.id, 
        c.siteId,
        c.first_seen, 
        s.title, 
        s.location, 
        s.price, 
        s.url
      FROM listings_current c
      LEFT JOIN listings_snapshot s ON c.id = s.id
        AND s.run_id = (
            SELECT run_id FROM listings_snapshot 
            WHERE id = c.id 
            ORDER BY scrapedAt DESC 
            LIMIT 1
        )
      WHERE c.active = 1
      ORDER BY c.first_seen DESC
    `;
    const result = await db.execute(sql);
    return result.rows;
  } catch (err) {
    console.warn("Could not fetch dashboard listings:", err.message);
    return [];
  }
}

module.exports = {
  db,
  setupDatabase,
  upsertListing,
  getDatabaseStatus,
  getDashboardStats,
  getDashboardChanges,
  getDashboardListings
};