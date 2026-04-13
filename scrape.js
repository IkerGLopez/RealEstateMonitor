const fs = require('fs');
const mri = require('mri');
const adapters = require('./adapters/index.js');
const db = require('./src/db.js');
const monitoring = require('./src/monitoring.js');
const notifications = require('./src/notifications.js');
const scheduler = require('./src/scheduler.js');

async function main() {
  const argv = mri(process.argv.slice(2));

  // If `--status` flag is used, just show DB status and exit
  if (argv.status) {
    await db.setupDatabase();
    await db.getDatabaseStatus();
    process.exit(0);
  }

  if (argv.schedule) {
    // If it's a boolean (no value provided), pass undefined to use default env var
    const cronExpr = typeof argv.schedule === 'string' ? argv.schedule : undefined;
    scheduler.startScheduler(cronExpr);
    return; // Block process from exiting naturally because chron needs to run forever
  }

  if (argv.once) {
    await scheduler.runOnce();
    process.exit(0);
  }

  const siteId = argv.site || argv.s;

  if (!siteId) {
    console.error("Error: You must specify a site identifier using --site <siteId>");
    console.log(`Available sites: ${adapters.listAdapterIds().join(', ')}`);
    process.exit(1);
  }

  const adapter = adapters.getAdapter(siteId);

  if (!adapter) {
    console.error(`Error: Adapter for site '${siteId}' not found.`);
    process.exit(1);
  }

  // Parse filters from the CLI arguments (e.g., --filters.propertyType Piso)
  const filters = argv.filters || {};
  
  // Extract max pages (if any)
  const maxPages = argv['max-pages'] ? parseInt(argv['max-pages'], 10) : undefined;
  
  // Extract dry-run
  const dryRun = !!argv['dry-run'];

  console.log(`[Scraping] Starting scrape for site '${siteId}'...`);
  if (Object.keys(filters).length > 0) {
    console.log(`  Filters:`, filters);
  }
  if (maxPages) {
    console.log(`  Max Pages:`, maxPages);
  }
  if (dryRun) {
    console.log(`  Mode: DRY RUN (no DB commits will be made)`);
  }

  try {
    const rawListings = await adapter.list({ ...filters, headless: true });
    
    // Map adapter output to standard Listing shape
    const listings = rawListings.map(item => {
      // Very basic price parsing for Milestone 2 - numeric extract
      const priceStr = (item.price || "").toString();
      const numMatch = priceStr.replace(/[^\d,]/g, '').replace(',', '.');
      const priceNum = numMatch ? parseFloat(numMatch) : null;

      return {
        id: item.id,
        siteId: siteId,
        title: item.title,
        location: item.location,
        price: priceNum,
        url: item.detailUrl || item.url,
        scrapedAt: item.scrapingTimestamp || new Date().toISOString()
      };
    });

    console.log(`[Scraping] Completed. Found ${listings.length} listings.\n`);

    // Output strategy
    if (argv.out) {
      fs.writeFileSync(argv.out, JSON.stringify(listings, null, 2), "utf-8");
      console.log(`Saved output to ${argv.out}`);
    } 
    
    // Use monitoring integration for persistence (with dryRun flag handling)
    if (argv.persist || dryRun) {
      await db.setupDatabase();
      const changes = await monitoring.processScrapeRun(siteId, listings, { dryRun });
      
      // Notify changes via Telegram
      const listingsMap = new Map();
      for (const item of listings) {
        listingsMap.set(item.id, item);
      }
      // Pass { dryRun } to explicitly suppress execution during a dry run.
      await notifications.notifyChanges(changes, listingsMap, { dryRun });

      if (!dryRun) {
        console.log(`[Persistence] Audit trail correctly persisted to Turso/SQLite.`);
      }
    }

    if (!argv.out && !argv.persist && !dryRun) {
      // Default: print to stdout
      console.log(JSON.stringify(listings, null, 2));
    }
  } catch (error) {
    console.error("An error occurred during scraping or persistence:");
    console.error(error);
    process.exit(1);
  }
}

main();