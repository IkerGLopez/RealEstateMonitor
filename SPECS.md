# Project Specifications: Multi-Site Real Estate Monitor

## Project Summary
Development of a Node.js web scraper/monitor that extracts real estate listings, persists the information in both a local SQLite database and in the cloud (Turso), monitors changes over time (price variations, new listings, removals), and sends automated notifications via Telegram. Use `pnpm` exclusively for package management.

## Expected File Structure
The project should be organized as follows:
- `scrape.js`: CLI entry point (scrape + persist).
- `.env`: Turso + Telegram credentials (gitignored).
- `.env.example`: Example `.env` template.
- `src/types.js`: JSDoc type definitions.
- `src/db.js`: Turso (libsql) persistence module.
- `src/monitoring.js`: Change detection & audit trail (Milestone 3).
- `src/notifications.js`: Telegram notifications (Milestone 4).
- `adapters/index.js`: Adapter registry.
- `adapters/iparralde.js`: Inmobiliaria Iparralde adapter.

---

## Milestone 2: Data Persistence (SQLite and Turso)
**Objective:** Store scraped listings in a SQLite DB to maintain state between runs.

### Technical Requirements:
1. **Local Database:** Create a SQLite database file (e.g., `apartments.db`).
2. **Basic Schema (`apartments`):** Must include `id` (PRIMARY KEY), `siteId`, `title`, `location`, `price`, `url`, `scrapedAt`, `createdAt`, `updatedAt`.
3. **Insertion Logic:** "Upsert" by `id` to avoid duplicates.
4. **Cloud Database:** Integration with Turso (`libsql`). Configure the connection by reading the tokens from a `.env` file.
5. **Supported CLI Commands in `scrape.js`:**
   - Output JSON to stdout: `node scrape.js --site iparralde`.
   - Save to file: `node scrape.js --site iparralde --out listings.json`.
   - Persist to DB: `node scrape.js --site iparralde --persist`.
   - Check database status: `node scrape.js --status`.
   - Custom filters: `node scrape.js --site iparralde --filters.propertyType Piso --filters.municipality Hendaye`.
   - Limit pagination: `node scrape.js --site iparralde --max-pages 2`.

### Acceptance Checks:
- Running scrape + persist twice keeps the row count stable (no duplicates).
- The `--status` command shows the correct total listing count, broken down by site, and differentiates between the local DB and Turso.

---

## Milestone 3: Monitoring and Audit Trail
**Objective:** On each run, compute what changed since the last run and store a full audit trail.

### Technical Requirements (4-table schema):
1. `scrape_runs`: One row per scrape execution (columns: `run_id`, `siteId`, `started_at`, `finished_at`, `listings_found`, `status`).
2. `listings_current`: Latest known state per listing (`active`, `miss_count`, `first_seen`, `last_seen`).
3. `listings_snapshot`: Immutable copy of each listing as seen in each run (references `run_id`).
4. `listing_changes`: Change events with `change_type` and a structured `diff_json` (e.g., `[{"field": "price_num", "old": 195000, "new": 189000 }]`).

### Change Detection and Normalization Rules:
- **Change types:** `new` (id not seen before), `price_changed` (normalized numeric price differs), `attributes_changed` (title, location, size, rooms, etc. changed), `removed` (absent for `MAX_MISS_COUNT` consecutive runs).
- **Normalization:**
  - Normalize price by stripping currency symbols and thousand separators, then parsing to an integer (`price_num`).
  - Normalize text fields (`title`, `location`) by trimming whitespace and collapsing multiple spaces before comparison.
- **`last_seen` Semantics:** Update `last_seen` in `listings_current` every time the listing appears in a scrape, regardless of whether anything changed.

### Acceptance Checks:
- First ever run produces `new` change events for all scraped listings.
- Re-running immediately with no site changes produces no new `price_changed` or `attributes_changed` events (only `last_seen` is updated).
- A listing missing from one run is not immediately marked `removed`; it must exceed `MAX_MISS_COUNT` consecutive misses.
- A `removed` listing that reappears in a later run generates a `new` event and resets `miss_count` to 0.
- An optional `--dry-run` flag prints detected changes without writing them to the DB.

---

## Milestone 4: Notifications (Telegram)
**Objective:** Send a Telegram message when changes happen.

### Technical Requirements:
1. Add `.env` support with at least: `ENABLE_NOTIFICATIONS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
2. Send Telegram messages using `parse_mode: "HTML"`.
3. Integrate logic to react to the events generated in Milestone 3.

### Acceptance Checks:
- With notifications enabled, a new listing triggers a message.
- Include a `--dry-run` mode that forces notifications off, ensuring no messages are sent.