# Exercise 6 - Adapter-based scraping framework

This folder provides a small scraping framework with a stable core pipeline and pluggable site adapters.

## CLI

Run one configured site adapter and print JSON to stdout:

```bash
node exercise6/scrape.js --site iparralde
```

Write the same JSON to a file while still printing it:

```bash
node exercise6/scrape.js --site iparralde --out exercise6/listings.json
```

Optional adapter params are passed as flags (examples):

```bash
node exercise6/scrape.js --site iparralde --propertyType piso --municipio Hendaye --headless true
```

## Adapter interface proposal

Each adapter should export this minimal interface:

```js
{
  siteId: string,
  list(params): Promise<Listing[]>
}
```

`Listing` objects should include at least:

- `id` (required, non-empty, stable across runs)
- `siteId`
- `title`
- `price`
- `location`
- `detailUrl`
- `scrapingTimestamp`

The core pipeline in `exercise6/core.js` validates these expectations and rejects empty ids.

## Current adapter

- `iparralde` in `exercise6/adapters/iparralde.js` (Playwright)

## Add a new website later

1. Create a new file in `exercise6/adapters/` exporting `{ siteId, list }`.
2. Register it in `exercise6/adapters/index.js`.
3. Reuse the same CLI and core pipeline without modifying scraping orchestration.
