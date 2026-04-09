# Exercise 4 - Lightpanda + agent-browser scraper

This folder contains a reusable script that automates:

1. Open `https://inmobiliariaiparralde.com/`
2. Select `tipo de inmueble = piso`
3. Select `municipio = Hendaye`
4. Click Search
5. Traverse pagination and extract all listings

Output fields for each listing:

- `title`
- `price`
- `location`
- `detailUrl`
- `scrapingTimestamp`
- `stableId` (derived from `detailUrl`)

## Remembered Lightpanda install folder

In this setup, Lightpanda is installed in:

- `/root/lightpanda/lightpanda` (inside WSL)

## 1) Install Lightpanda in WSL (Linux instructions)

```sh
mkdir -p /root/lightpanda
wget -O /root/lightpanda/lightpanda https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux
chmod a+x /root/lightpanda/lightpanda
```

## 2) Try it (expected fetch-style logs)

```sh
/root/lightpanda/lightpanda fetch --obey-robots --log-format pretty --log-level info https://demo-browser.lightpanda.io/campfire-commerce/
```

You should see request logs similar to your screenshot.

## 3) Run agent-browser help

```sh
agent-browser --help
```

## 4) Run scraper script

From this folder:

```sh
LIGHTPANDA_BIN=/root/lightpanda/lightpanda AGENT_BROWSER_ENGINE=lightpanda node scrape_iparralde_agent_browser_lightpanda.js
```

Generated files:

- `results.json` (array of JSON objects)
- `results_table.md` (markdown table)
- `agent_browser_steps.log` (executed `agent-browser` command sequence)

## Optional fallback in environments where Lightpanda cannot launch

If your current shell cannot execute the Lightpanda binary, you can still run the flow by allowing fallback:

```sh
ALLOW_CHROME_FALLBACK=true AGENT_BROWSER_ENGINE=lightpanda node scrape_iparralde_agent_browser_lightpanda.js
```

The script will first try Lightpanda, then retry with Chrome only when fallback is explicitly enabled.