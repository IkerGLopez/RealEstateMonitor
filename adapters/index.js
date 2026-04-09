const iparralde = require('./iparralde');

const ADAPTERS = new Map([[iparralde.siteId, iparralde]]);

function listAdapterIds() {
  return Array.from(ADAPTERS.keys());
}

function getAdapter(siteId) {
  return ADAPTERS.get(siteId);
}

module.exports = {
  listAdapterIds,
  getAdapter,
};
