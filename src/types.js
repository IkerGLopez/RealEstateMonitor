/**
 * @typedef {Object} Listing
 * @property {string} id - Unique identifier from the site (e.g. "iparralde-xxx")
 * @property {string} siteId - Identifier for the scraped site (e.g. "iparralde")
 * @property {string} title - Property title
 * @property {string} location - Municipality / Neighborhood
 * @property {number|null} price - Property price in EUR (parsed to numeric)
 * @property {string} url - Valid HTTP URL to the listing page
 * @property {string} [scrapedAt] - ISO Date of when the scrape ran
 * @property {string} [createdAt] - ISO Date of insertion in DB
 * @property {string} [updatedAt] - ISO Date of last update in DB
 */
