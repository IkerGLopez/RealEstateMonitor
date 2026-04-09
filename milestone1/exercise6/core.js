const { getAdapter, listAdapterIds } = require('./adapters');

function assertAdapter(siteId, adapter) {
  if (!adapter) {
    const available = listAdapterIds();
    throw new Error(
      `Unknown site "${siteId}". Available adapters: ${available.length ? available.join(', ') : '(none)'}`,
    );
  }

  if (typeof adapter.siteId !== 'string' || !adapter.siteId.trim()) {
    throw new Error(`Adapter for "${siteId}" is missing a valid siteId string.`);
  }

  if (typeof adapter.list !== 'function') {
    throw new Error(`Adapter "${adapter.siteId}" must implement list(params) => Promise<Listing[]>.`);
  }
}

function normalizeListing(raw, fallbackSiteId) {
  const listing = raw && typeof raw === 'object' ? raw : {};

  return {
    id: String(listing.id || '').trim(),
    siteId: String(listing.siteId || fallbackSiteId || '').trim(),
    title: String(listing.title || '').trim(),
    price: String(listing.price || '').trim(),
    location: String(listing.location || '').trim(),
    detailUrl: String(listing.detailUrl || '').trim(),
    scrapingTimestamp: String(listing.scrapingTimestamp || '').trim(),
  };
}

async function runPipeline({ siteId, params = {} }) {
  if (!siteId || !String(siteId).trim()) {
    throw new Error('Missing required parameter: siteId');
  }

  const adapter = getAdapter(String(siteId).trim());
  assertAdapter(siteId, adapter);

  const rows = await adapter.list(params);
  if (!Array.isArray(rows)) {
    throw new Error(`Adapter "${adapter.siteId}" must return an array.`);
  }

  const byId = new Map();

  rows.forEach((row, index) => {
    const listing = normalizeListing(row, adapter.siteId);
    if (!listing.id) {
      throw new Error(`Listing at index ${index} from "${adapter.siteId}" has an empty id.`);
    }

    if (!byId.has(listing.id)) {
      byId.set(listing.id, listing);
    }
  });

  return Array.from(byId.values());
}

module.exports = {
  runPipeline,
};
