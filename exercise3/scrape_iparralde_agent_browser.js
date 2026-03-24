const { chromium } = require('playwright');
const fs = require('fs');

const normalize = (value) => {
  if (!value || typeof value !== 'string') return value;

  // Basic mojibake and garbled text fixes for this site
  let cleaned = value
    .replace(/\u0013/g, ' - ')
    .replace(/ÔÇô/g, ' - ')
    .replace(/├¡/g, 'á')
    .replace(/┐¢/g, 'é')
    .replace(/┬í/g, 'í')

    // common mojibake good-faith fallbacks
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

  // Keep safe by using the same string if nothing obvious changed.
  if (cleaned === value) return value;
  return cleaned;
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 1) Go to the site
  await page.goto('https://inmobiliariaiparralde.com/', { waitUntil: 'networkidle' });

  // 2) Select tipo de inmueble = piso and municipio = Hendaye
  await page.selectOption('form.findus select[name="tipoInmueble[]"]', 'piso');
  await page.selectOption('form.findus select[name="municipio[]"]', 'Hendaye');

  // 3) Click Search
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('form.findus button[type="submit"]'),
  ]);

  const parsePage = async () => {
    const timestamp = new Date().toISOString();
    const entries = await page.$$eval('#easyPaginate-1 .property-list-list', (cards, timestamp) => {
      return cards
        .filter((card) => {
          const style = window.getComputedStyle(card);
          return style.display !== 'none' && card.offsetParent !== null;
        })
        .map((card) => {
          const info = card.querySelector('.property-list-list-info');
          const link = card.querySelector('a.wi')?.href?.trim() || '';
          const title = card.querySelector('a.wi img')?.alt?.trim() || info?.querySelector('h3')?.textContent?.trim() || '';
          const price = info?.querySelector('.price')?.textContent?.trim() || '';
          const raw = info?.textContent || '';
          let location = '';
          const locMatch = raw.match(/\d{5}\s+[^\n,]+,\s*(ES|FR)/i);
          if (locMatch) location = locMatch[0].trim();
          const stableId = (link.match(/(\d+)\/?$/) || [])[1] || '';

          return { title, price, location, detailUrl: link, stableId, scrapingTimestamp: timestamp };
        });
    }, timestamp);

    return entries.map((item) => ({
      title: normalize(item.title),
      price: normalize(item.price),
      location: normalize(item.location),
      detailUrl: item.detailUrl,
      stableId: item.stableId,
      scrapingTimestamp: item.scrapingTimestamp,
    }));
  };

  const results = [];
  results.push(...(await parsePage()));

  const pageRelList = await page.$$eval('.easyPaginateNav a.page', (anchors) =>
    anchors.map((a) => a.getAttribute('rel')).filter(Boolean),
  );

  for (const rel of pageRelList) {
    await Promise.all([
      page.click(`.easyPaginateNav a.page[rel="${rel}"]`),
      page.waitForSelector('#easyPaginate-1 .property-list-list', { state: 'visible' }),
    ]);
    const pageItems = await parsePage();
    for (const item of pageItems) {
      if (!results.some((existing) => existing.detailUrl === item.detailUrl)) {
        results.push(item);
      }
    }
  }

  const jsonOutput = JSON.stringify(results, null, 2);

  if (process.stdout.isTTY) {
    fs.writeFileSync('results.json', jsonOutput, 'utf8');
    console.log(`Wrote ${results.length} items to results.json`);
  } else {
    // When redirected (e.g. node script > results.json), avoid EBUSY by not writing file again
    process.stdout.write(jsonOutput);
  }

  await browser.close();
})();
