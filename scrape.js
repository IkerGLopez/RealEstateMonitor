const fs = require('fs');
const mri = require('mri');
const adapters = require('./adapters/index.js');
const db = require('./src/db.js');
const { processScrapeRun } = require('./src/monitoring.js');

async function main() {
  const argv = mri(process.argv.slice(2));

  // If `--status` flag is used, just show DB status and exit
  if (argv.status) {
    await db.setupDatabase();
    await db.getDatabaseStatus();
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

  console.log(`[Scraping] Starting scrape for site '${siteId}'...`);
  if (Object.keys(filters).length > 0) {
    console.log(`  Filters:`, filters);
  }
  if (maxPages) {
    console.log(`  Max Pages:`, maxPages);
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

    // Handle max-pages limitation if implemented in the adapter, or just slice here:
    if (maxPages) {
       // Since the adapter currently doesn't handle maxPages natively in milestone 1, 
       // we just note it here. We'll leave the array untouched for now, or you can 
       // implement native pagination skipping in the adapter later.
    }

    console.log(`[Scraping] Completed. Found ${listings.length} listings.\n`);

    // Output strategy
    if (argv.out) {
      fs.writeFileSync(argv.out, JSON.stringify(listings, null, 2), "utf-8");
      console.log(`Saved output to ${argv.out}`);
    } 
    
    // In Milestone 3, we orchestrate via monitoring even if it is dryRun 
    // to show expected change events
    if (argv.persist || argv['dry-run']) {
      await db.setupDatabase();
      const dryRun = !!argv['dry-run'];
      await processScrapeRun(siteId, listings, { dryRun });
    }

    if (!argv.out && !argv.persist && !argv['dry-run']) {
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