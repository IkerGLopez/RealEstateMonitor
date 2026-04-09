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

module.exports = {
  db,
  setupDatabase,
  upsertListing,
  getDatabaseStatus
};