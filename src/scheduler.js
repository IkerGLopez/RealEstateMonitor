const cron = require('node-cron');
const db = require('./db.js');
const monitoring = require('./monitoring.js');
const notifications = require('./notifications.js');
const adapters = require('../adapters/index.js');
require('dotenv').config();

let isRunInProgress = false;
let isShutDown = false;

/**
 * Runs the complete pipeline (scrape, persist, compute changes, notify) for a single site.
 * @param {string} siteId The identifier of the site to process.
 */
async function processSite(siteId) {
  const adapter = adapters.getAdapter(siteId);
  if (!adapter) {
    console.warn(`[Scheduler] Adapter for site '${siteId}' not found. Skipping.`);
    return;
  }

  console.log(`\n[Scheduler] Starting pipeline for site: ${siteId}`);
  
  try {
    // 1. Scrape
    const rawListings = await adapter.list({ headless: true });
    
    // Map adapter output to standard Listing shape
    const listings = rawListings.map(item => {
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
    console.log(`[Scheduler] [${siteId}] Scrape completed: found ${listings.length} listings.`);

    if (isShutDown) {
      console.log(`[Scheduler] Shutdown requested. Aborting persistence for ${siteId}.`);
      return;
    }

    // 2 & 3. Persist and Detect Changes
    await db.setupDatabase();
    const changesEvents = await monitoring.processScrapeRun(siteId, listings, { dryRun: false });

    if (isShutDown) {
      console.log(`[Scheduler] Shutdown requested. Aborting notifications for ${siteId}.`);
      return;
    }

    // 4. Notifications
    const listingsMap = new Map();
    for (const item of listings) {
      listingsMap.set(item.id, item);
    }
    
    // Notify using actual environment defaults
    await notifications.notifyChanges(changesEvents, listingsMap, { dryRun: false });

    console.log(`[Scheduler] [${siteId}] Pipeline finished successfully.`);
  } catch (err) {
    console.error(`[Scheduler] Error processing site ${siteId}:`, err);
  }
}

/**
 * Iterates through all adapters to process them sequentially.
 */
async function runAllSites() {
  if (isRunInProgress) {
    console.warn("[Scheduler] A scrape run is already in progress. Skipping this tick.");
    return;
  }
  
  if (isShutDown) return;

  isRunInProgress = true;
  console.log(`\n[Scheduler] --- Starting scheduled run over all sites at ${new Date().toISOString()} ---`);
  
  const siteIds = adapters.listAdapterIds();
  
  for (const siteId of siteIds) {
    if (isShutDown) break;
    // Sequential execution to naturally pace requests
    await processSite(siteId);
  }
  
  console.log(`[Scheduler] --- Finished scheduled run over all sites ---`);
  isRunInProgress = false;
}

/**
 * Initializes the node-cron scheduler.
 * @param {string} customCron Optional cron expression from the CLI.
 */
function startScheduler(customCron) {
  const cronExpression = customCron || process.env.SCRAPE_CRON || "0 * * * *";
  
  if (!cron.validate(cronExpression)) {
    console.error(`[Scheduler] Invalid cron expression: "${cronExpression}"`);
    process.exit(1);
  }

  // Hook graceful shutdown
  const shutdown = async () => {
    if (isShutDown) return;
    console.log("\n[Scheduler] Caught shutdown signal (SIGINT). Cleaning up...");
    isShutDown = true;
    
    // Attempt adapter cleanups (e.g. closing Playwright browsers)
    const siteIds = adapters.listAdapterIds();
    for (const siteId of siteIds) {
      const adapter = adapters.getAdapter(siteId);
      if (typeof adapter.cleanup === 'function') {
        try {
          await adapter.cleanup();
          console.log(`[Scheduler] Cleaned up adapter: ${siteId}`);
        } catch(e) {
          console.error(`[Scheduler] Cleanup error for ${siteId}:`, e);
        }
      }
    }
    
    console.log("[Scheduler] Shut down completely.");
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`[Scheduler] Starting cron job with expression: "${cronExpression}"`);
  cron.schedule(cronExpression, () => {
    runAllSites();
  });
  
  // Good practice: also run immediately on start if we want (optional, but node-cron strictly waits)
  // Let's print info to standard out so user knows it's waiting
  console.log(`[Scheduler] Scheduler is now running in the background. Waiting for the first tick.`);
}

/**
 * Run once logic (called from `--once`)
 */
async function runOnce() {
  console.log("[Scheduler] Running locally --once flag detected.");
  await runAllSites();
}

module.exports = {
  startScheduler,
  runOnce
};
