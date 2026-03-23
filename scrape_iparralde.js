const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://inmobiliariaiparralde.com/", {
    waitUntil: "networkidle",
  });

  await page.selectOption('form.findus select[name="tipoInmueble[]"]', "piso");
  await page.selectOption('form.findus select[name="municipio[]"]', "Hendaye");

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    page.click('form.findus button[type="submit"]'),
  ]);

  const parseCurrentPage = async () => {
    const timestamp = new Date().toISOString();
    return await page.$$eval(
      "#easyPaginate-1 .property-list-list",
      (entries, timestamp) => {
        return entries
          .filter((entry) => {
            const style = window.getComputedStyle(entry);
            return style.display !== "none" && entry.offsetParent !== null;
          })
          .map((entry) => {
            const info = entry.querySelector(".property-list-list-info");
            const link = entry.querySelector("a.wi")?.href?.trim() || "";
            const title =
              entry.querySelector("a.wi img")?.alt?.trim() ||
              info?.querySelector("h3")?.textContent?.trim() ||
              "";
            const price =
              info?.querySelector(".price")?.textContent?.trim() || "";
            const raw = info?.textContent || "";
            let location = "";
            const locMatch = raw.match(/\d{5}\s+[^\n,]+,\s*(ES|FR)/i);
            if (locMatch) location = locMatch[0].trim();
            const stableId = (link.match(/(\d+)\/?$/) || [])[1] || "";
            return {
              title,
              price,
              location,
              detailUrl: link,
              stableId,
              scrapingTimestamp: timestamp,
            };
          });
      },
      timestamp,
    );
  };

  const results = [];
  const pageRelList = await page.$$eval(".easyPaginateNav a.page", (anchors) =>
    anchors.map((a) => a.getAttribute("rel")).filter(Boolean),
  );

  for (const rel of pageRelList) {
    await page.click(`.easyPaginateNav a.page[rel="${rel}"]`);
    await page.waitForTimeout(700);
    const pageItems = await parseCurrentPage();
    for (const item of pageItems) {
      if (!results.some((existing) => existing.detailUrl === item.detailUrl)) {
        results.push(item);
      }
    }
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
