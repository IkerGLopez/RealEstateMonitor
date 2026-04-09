const crypto = require('crypto');
const { chromium } = require('playwright');

const siteId = 'iparralde';
const DEFAULT_URL = 'https://inmobiliariaiparralde.com/';

function normalize(value) {
  if (value == null) return '';
  const text = String(value).trim();
  if (!text) return '';

  return text
    .replace(/\u0013/g, ' - ')
    .replace(/ÔÇô/g, ' - ')
    .replace(/├¡/g, 'á')
    .replace(/┐¢/g, 'é')
    .replace(/┬í/g, 'í')
    .replace(/Ã¡/g, 'á')
    .replace(/Ã©/g, 'é')
    .replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ãº/g, 'ú')
    .replace(/Ã±/g, 'ñ')
    .replace(/Ã/g, 'Á')
    .replace(/Ã‰/g, 'É')
    .replace(/Ã�/g, 'Í')
    .replace(/Ã“/g, 'Ó')
    .replace(/Ãš/g, 'Ú')
    .replace(/Ôé¼/g, '€')
    .replace(/\uFFFD/g, '');
}

function shortHash(input) {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function deriveListingId(listing) {
  const detailUrl = normalize(listing.detailUrl);
  const numeric = detailUrl.match(/\/(\d+)\/?$/);
  if (numeric) return `${siteId}-${numeric[1]}`;

  if (detailUrl) return `${siteId}-${shortHash(detailUrl.toLowerCase())}`;

  const fingerprint = [normalize(listing.title), normalize(listing.location)]
    .filter(Boolean)
    .join('|')
    .toLowerCase();

  if (fingerprint) return `${siteId}-${shortHash(fingerprint)}`;

  return `${siteId}-${shortHash(JSON.stringify(listing))}`;
}

function toBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  const s = String(value).trim().toLowerCase();
  if (!s) return fallback;
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return fallback;
}

async function scrapeCurrentPage(page) {
  const timestamp = new Date().toISOString();
  return page.$$eval(
    '#easyPaginate-1 .property-list-list',
    (cards, timestampFromNode) => {
      return cards
        .filter((card) => {
          const style = window.getComputedStyle(card);
          return style.display !== 'none' && card.offsetParent !== null;
        })
        .map((card) => {
          const info = card.querySelector('.property-list-list-info');
          const detailUrl = card.querySelector('a.wi')?.href?.trim() || '';
          const title =
            card.querySelector('a.wi img')?.alt?.trim() ||
            info?.querySelector('h3')?.textContent?.trim() ||
            '';
          const price = info?.querySelector('.price')?.textContent?.trim() || '';
          const text = info?.textContent || '';
          const locMatch = text.match(/\d{5}\s+[^\n,]+,\s*(ES|FR)/i);
          const location = locMatch ? locMatch[0].trim() : '';

          return {
            title,
            price,
            location,
            detailUrl,
            scrapingTimestamp: timestampFromNode,
          };
        });
    },
    timestamp,
  );
}

async function list(params = {}) {
  const targetUrl = normalize(params.url) || DEFAULT_URL;
  const propertyType = normalize(params.propertyType) || normalize(params.tipo) || 'piso';
  const municipio = normalize(params.municipio) || 'Hendaye';
  const headless = toBoolean(params.headless, true);

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    await page.selectOption('form.findus select[name="tipoInmueble[]"]', propertyType);
    await page.selectOption('form.findus select[name="municipio[]"]', municipio);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('form.findus button[type="submit"]'),
    ]);

    await page.waitForSelector('#easyPaginate-1 .property-list-list', { state: 'visible' });

    const byKey = new Map();
    const appendRows = (rows) => {
      for (const row of rows) {
        const normalized = {
          siteId,
          title: normalize(row.title),
          price: normalize(row.price),
          location: normalize(row.location),
          detailUrl: normalize(row.detailUrl),
          scrapingTimestamp: normalize(row.scrapingTimestamp) || new Date().toISOString(),
        };

        normalized.id = deriveListingId(normalized);
        if (!normalized.id) continue;

        const dedupeKey = normalized.detailUrl || normalized.id;
        if (!byKey.has(dedupeKey)) {
          byKey.set(dedupeKey, normalized);
        }
      }
    };

    appendRows(await scrapeCurrentPage(page));

    const rels = await page.$$eval('.easyPaginateNav a.page', (anchors) =>
      anchors.map((anchor) => anchor.getAttribute('rel')).filter(Boolean),
    );

    for (const rel of rels) {
      await Promise.all([
        page.click(`.easyPaginateNav a.page[rel="${rel}"]`),
        page.waitForTimeout(350),
      ]);
      appendRows(await scrapeCurrentPage(page));
    }

    return Array.from(byKey.values());
  } finally {
    await browser.close();
  }
}

module.exports = {
  siteId,
  list,
};
