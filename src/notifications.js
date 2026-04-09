const dotenv = require('dotenv');

dotenv.config();

const ENABLE_NOTIFICATIONS = process.env.ENABLE_NOTIFICATIONS === 'true';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Sends a pre-formatted HTML message to Telegram.
 * @param {string} text The HTML formatted message
 */
async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("[Notifications] ⚠️ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env. Skipping message.");
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    
    if (!response.ok) {
      const err = await response.text();
      console.error("[Notifications] ❌ Telegram API error:", err);
    }
  } catch (error) {
    console.error("[Notifications] ❌ Network error when calling Telegram:", error.message);
  }
}

/**
 * Processes listing changes and dispatches them via Telegram.
 * @param {Array<{id: string, change_type: string, diff_json: Array}>} changes 
 * @param {Map<string, import('./types.js').Listing>} listingsMap
 * @param {Object} options 
 */
async function notifyChanges(changes, listingsMap, options = {}) {
  const { dryRun = false } = options;

  if (!changes || changes.length === 0) {
    return;
  }

  if (dryRun) {
    console.log(`\n[Notifications] 🛡️ DRY RUN: Suppressing ${changes.length} potential Telegram notifications.`);
    return; // Fast exit to enforce --dry-run rules!
  }

  if (!ENABLE_NOTIFICATIONS) {
    console.log(`\n[Notifications] 🔕 Notifications are disabled in .env (ENABLE_NOTIFICATIONS is not 'true'). Skipped ${changes.length} events.`);
    return;
  }

  console.log(`\n[Notifications] 🚀 Dispatching ${changes.length} notifications to Telegram...`);

  for (const change of changes) {
    // Attempt to enrich data from the active scrape session. 
    // If it's a `removed` event, and the listing map doesn't contain it, we fallback to defaults.
    const listing = listingsMap.get(change.id) || { title: `Unknown Title [${change.id}]`, url: '#' };
    
    let message = '';
    const diffs = typeof change.diff_json === 'string' ? JSON.parse(change.diff_json) : change.diff_json;

    switch (change.change_type) {
      case 'new':
        message = `🆕 <b>New Listing Found!</b>\n`;
        message += `<b>Title:</b> ${listing.title}\n`;
        if (listing.location) message += `<b>Location:</b> ${listing.location}\n`;
        message += `<b>Price:</b> ${listing.price ? listing.price + '€' : 'Consultar'}\n`;
        message += `<a href="${listing.url}">Ver Anuncio</a>`;
        break;
        
      case 'price_changed':
        message = `💰 <b>Price Changed!</b>\n`;
        message += `<b>Title:</b> ${listing.title}\n`;
        const diffPrice = diffs.find(d => d.field === 'price_num');
        if (diffPrice) {
          message += `<b>Old Price:</b> <s>${diffPrice.old ? diffPrice.old + '€' : 'N/A'}</s>\n`;
          message += `<b>New Price:</b> <b>${diffPrice.new ? diffPrice.new + '€' : 'N/A'}</b>\n`;
        }
        message += `<a href="${listing.url}">Ver Anuncio</a>`;
        break;
        
      case 'attributes_changed':
        message = `📝 <b>Attributes Changed</b>\n`;
        message += `<b>Title:</b> <a href="${listing.url}">${listing.title}</a>\n`;
        message += `<i>Changes detected:</i>\n`;
        diffs.forEach(d => {
          message += `- <b>${d.field}</b>: <s>${d.old}</s> ➡️ <b>${d.new}</b>\n`;
        });
        break;
        
      case 'removed':
        message = `❌ <b>Listing Removed</b>\n`;
        message += `<b>Title:</b> ${listing.title}\n`;
        message += `<i>This property has been missing for several iterations.</i>`;
        break;
    }

    if (message) {
      await sendTelegramMessage(message);
      // Brief delay to safeguard against hitting Telegram's 30 msg/sec strict limit
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  console.log(`[Notifications] ✅ Finished dispatching messages.`);
}

module.exports = {
  notifyChanges
};