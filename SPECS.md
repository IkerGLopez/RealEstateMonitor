# Project Specifications: Multi-Site Real Estate Monitor

## Project Summary
Development of a Node.js web scraper/monitor that extracts real estate listings, persists the information in both a local SQLite database and in the cloud (Turso), monitors changes over time (price variations, new listings, removals), sends automated notifications via Telegram, runs on an automated schedule, and provides a web dashboard to visualize the data and market trends.

## Tech Stack & Tools
- **Runtime:** Node.js
- **Package Manager:** **pnpm** (Strictly required. Do not use npm or yarn).
- **Database:** SQLite (local) / Turso (cloud).

## Expected File Structure
The project should be organized as follows:
- `scrape.js`: CLI entry point (scrape + persist + schedule).
- `dashboard.js`: CLI entry point for the web server (Milestone 6).
- `package.json` & `pnpm-lock.yaml`: Dependency manifests.
- `.env`: Turso + Telegram credentials + cron expressions (gitignored).
- `.env.example`: Example `.env` template.
- `src/types.js`: JSDoc type definitions.
- `src/db.js`: Turso (libsql) persistence module.
- `src/monitoring.js`: Change detection & audit trail.
- `src/notifications.js`: Telegram notifications.
- `src/scheduler.js`: Cron job logic (Milestone 5).
- `public/` or `views/`: Static assets or templates for the dashboard (Milestone 6).
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
1. `scrape_runs`: One row per scrape execution.
2. `listings_current`: Latest known state per listing (`active`, `miss_count`, `first_seen`, `last_seen`).
3. `listings_snapshot`: Immutable copy of each listing as seen in each run.
4. `listing_changes`: Change events with `change_type` and a structured `diff_json`.

### Change Detection and Normalization Rules:
- **Change types:** `new`, `price_changed`, `attributes_changed`, `removed`.
- **Normalization:** Strip currency symbols and whitespace formatting noise.
- **`last_seen` Semantics:** Update in `listings_current` every time the listing appears.

### Acceptance Checks:
- First ever run produces `new` change events.
- Re-running immediately produces no new changes.
- Listing absent > `MAX_MISS_COUNT` marked as `removed`.
- `--dry-run` flag prints detected changes without DB write.

---

## Milestone 4: Notifications (Telegram)
**Objective:** Send a Telegram message when changes happen.

### Technical Requirements:
1. Add `.env` support: `ENABLE_NOTIFICATIONS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
2. Send messages using `parse_mode: "HTML"`.

### Acceptance Checks:
- With notifications enabled, changes trigger a message.
- `--dry-run` forces notifications off.

---

## Milestone 5: Scheduling
**Objective:** Run your scraper automatically on a schedule without manual intervention.

### Technical Requirements:
1. **Scheduler Integration:** Use `node-cron` (or a similar lightweight scheduler).
2. **Configuration:** Read the default cron expression from the `.env` variable `SCRAPE_CRON`.
3. **CLI Mode:** Add a flag `--schedule "* * * * *"` to start the scheduler as a long-running process, which can override the `.env` default.
4. **Execution Flow:** On each tick, run the full pipeline: scrape → persist → detect changes → notify.
5. **Resilience:** If one site's adapter fails, log the error and continue with the remaining sites. Do NOT crash the process.
6. **OS-Level Alternative:** Support a `--once` flag that runs all configured sites immediately and exits (code 0), useful for external cron jobs.

### Acceptance Checks:
- Starting with `--schedule "*/15 * * * *"` triggers scrapes appropriately (avoid intervals < 15 mins to prevent IP blocks).
- Stopping the process (Ctrl+C) shuts down cleanly without leaving zombie browser instances.
- If one adapter throws an error, the scheduler logs it and runs the next adapter on the following tick.

---

## Milestone 6: Web Dashboard
**Objective:** A small web UI to browse listings, review changes, and understand market trends at a glance.

### Technical Requirements:
1. **Server Setup:** Build a lightweight web server (Express or Fastify).
2. **Data Source:** Read directly from the Turso database (Read-Only).
3. **Required Views:**
   - **Current listings table:** All active listings with sortable columns (price, location, date first seen) and a link to the original detail page.
   - **Change log:** A reverse-chronological feed of change events showing the diff for each event.
   - **Summary stats:** Total active listings, number of changes since last run, and a simple chart/histogram.
4. **Frontend Stack:** Static HTML + JS, or server-rendered templates (EJS, Handlebars, etc.).
5. **CLI Mode:** Add `--dashboard` flag or a separate entry point (`node dashboard.js` / `node scrape.js --dashboard --port 3000`).

### Acceptance Checks:
- Opening `http://localhost:3000` shows the table populated from the DB.
- The change log displays events with human-readable diffs.
- Clicking a listing's detail URL opens the original page.
- The dashboard loads correctly even when the database is completely empty.