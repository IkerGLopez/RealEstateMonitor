# Project Specifications: Multi-Site Real Estate Monitor

## Project Summary
Development of a Node.js web scraper/monitor that extracts real estate listings, persists the information in both a local SQLite database and in the cloud (Turso), monitors changes over time (price variations, new listings, removals), sends automated notifications via Telegram, runs on an automated schedule, and provides a web dashboard. The final phase includes a full production deployment to an Azure Ubuntu VM with Nginx, HTTPS (Let's Encrypt), and a custom `.eus` domain.

## Tech Stack & Tools
- **Runtime:** Node.js
- **Package Manager:** **pnpm** (Strictly required. Do not use npm or yarn).
- **Database:** SQLite (local) / Turso (cloud).
- **Deployment & Infrastructure:** Azure (Ubuntu 24.04 VM), Nginx (Reverse Proxy), Systemd, Cron, Certbot (Let's Encrypt).

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
- `src/scheduler.js`: Cron job logic.
- `public/` or `views/`: Static assets or templates for the dashboard.
- `adapters/index.js`: Adapter registry.
- `adapters/iparralde.js`: Inmobiliaria Iparralde adapter.

---

## Milestone 2: Data Persistence (SQLite and Turso)
**Objective:** Store scraped listings in a SQLite DB to maintain state between runs.

### Technical Requirements:
1. **Local Database:** Create a SQLite database file (e.g., `apartments.db`).
2. **Basic Schema (`apartments`):** Must include `id` (PRIMARY KEY), `siteId`, `title`, `location`, `price`, `url`, `scrapedAt`, `createdAt`, `updatedAt`.
3. **Insertion Logic:** "Upsert" by `id` to avoid duplicates.
4. **Cloud Database:** Integration with Turso (`libsql`).
5. **Supported CLI Commands in `scrape.js`:** `--site`, `--out`, `--persist`, `--status`, `--filters.*`, `--max-pages`.

### Acceptance Checks:
- Running scrape + persist twice keeps the row count stable (no duplicates).
- The `--status` command shows the correct total listing count.

---

## Milestone 3: Monitoring and Audit Trail
**Objective:** On each run, compute what changed since the last run and store a full audit trail.

### Technical Requirements (4-table schema):
1. `scrape_runs`: One row per scrape execution.
2. `listings_current`: Latest known state per listing (`active`, `miss_count`, `first_seen`, `last_seen`).
3. `listings_snapshot`: Immutable copy of each listing as seen in each run.
4. `listing_changes`: Change events with `change_type` and a structured `diff_json`.

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
2. **Configuration:** Read default cron expression from `.env` (`SCRAPE_CRON`).
3. **CLI Mode:** Add `--schedule "* * * * *"` and `--once` flags.

### Acceptance Checks:
- Starting with `--schedule "*/15 * * * *"` triggers scrapes appropriately.
- Stopping the process (Ctrl+C) shuts down cleanly.
- If one adapter throws an error, the scheduler logs it and continues.

---

## Milestone 6: Web Dashboard
**Objective:** A small web UI to browse listings, review changes, and understand market trends at a glance.

### Technical Requirements:
1. **Server Setup:** Build a lightweight web server (Express or Fastify) reading read-only from Turso.
2. **Required Views:** Current listings table, Change log, Summary stats.
3. **CLI Mode:** Add `--dashboard` flag or `dashboard.js` entry point.

### Acceptance Checks:
- Dashboard loads correctly on `http://localhost:3000` even if DB is empty.
- Displays listings, logs, and clickable URLs.

---

## Milestone 7: Create an Azure Cloud VM
**Objective:** Deploy an Ubuntu 24.04 virtual machine in Azure and prepare it for the codebase.

### Technical Requirements:
1. **VM Specs:** Ubuntu Server 24.04 LTS, Standard_B1s size, SSH authentication.
2. **Networking:** Inbound ports open for SSH (22), HTTP (80), and HTTPS (443).
3. **AI Assistant:** Install Qwen Code as a terminal-based AI assistant on the server.

### Acceptance Checks:
- Can successfully connect to the Azure VM via SSH using the `.pem` key.
- Running `qwen` on the server successfully launches the AI agent.

---

## Milestone 8: Provision the Server
**Objective:** Set up a secure environment, clone the codebase, and install dependencies.

### Technical Requirements:
1. **Dedicated User:** Create a non-root user named `deploy` with passwordless sudo permissions.
2. **GitHub Access:** Generate an SSH key (`ed25519`) for the `deploy` user and add it to GitHub.
3. **Project Setup:** Clone the repository, run `pnpm install`, and install Playwright system dependencies.
4. **Environment:** Create and populate the `.env` file on the server.

### Acceptance Checks:
- The codebase is cloned in `/home/deploy/real-estate-monitor`.
- Running `node scrape.js --once` completes successfully on the server.
- The dashboard responds locally on port 3000 on the server.

---

## Milestone 9: Register a Free .eus Domain
**Objective:** Point a custom domain to the Azure VM.

### Technical Requirements:
1. Register a free `.eus` domain using the GitHub Student Developer Pack promotion.
2. Configure DNS `A` records (root and `www`) to point to the Azure VM's public IP address.

### Acceptance Checks:
- Running `dig yourdomain.eus +short` returns the correct Azure public IP.

---

## Milestone 10: Deploy Services, Reverse Proxy & HTTPS
**Objective:** Make the dashboard publicly accessible securely and run the scraper autonomously.

### Technical Requirements:
1. **Systemd Service:** Create `/etc/systemd/system/real-estate-dashboard.service` to keep the dashboard running permanently and restart on failure.
2. **Scheduled Scraping:** Setup a crontab entry for the `deploy` user to run the scraper every 30 minutes (`*/30 * * * * cd /home/deploy/real-estate-monitor && /usr/bin/node scrape.js --once`).
3. **Nginx Reverse Proxy:** Install Nginx and configure it to proxy traffic from port 80 to `http://127.0.0.1:3000`.
4. **HTTPS / Certbot:** Install `certbot` and `python3-certbot-nginx` to obtain a Let's Encrypt TLS certificate and configure automatic HTTP to HTTPS redirection.

### Acceptance Checks:
- `sudo systemctl status real-estate-dashboard` shows active/running.
- Scrapes execute automatically based on the cron schedule.
- Visiting `http://yourdomain.eus` automatically redirects to `https://yourdomain.eus` with a valid lock icon.
- The system survives a server reboot (`sudo reboot`).

---

## Milestone Final: Update README & Submit
**Objective:** Document the project deployment and architecture.

### Technical Requirements:
1. Update `README.md` to include:
   - A prominent link to the live dashboard.
   - Deployment architecture description (Azure VM, Nginx, Certbot, Turso, Cron/Systemd).
   - Any extra features implemented.
   - Screenshots and lessons learned.