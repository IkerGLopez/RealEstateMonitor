const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://inmobiliariaiparralde.com/';
const OUTPUT_JSON = path.join(__dirname, 'results.json');
const OUTPUT_TABLE = path.join(__dirname, 'results_table.md');
const OUTPUT_STEPS = path.join(__dirname, 'agent_browser_steps.log');
const AGENT_BROWSER_BIN = process.env.AGENT_BROWSER_BIN || 'agent-browser';

const engine = process.env.AGENT_BROWSER_ENGINE || 'lightpanda';
const lightpandaBin = process.env.LIGHTPANDA_BIN || process.env.AGENT_BROWSER_EXECUTABLE_PATH || '';
const allowChromeFallback = /^(1|true|yes)$/i.test(process.env.ALLOW_CHROME_FALLBACK || '');
const baseSession = process.env.AGENT_BROWSER_SESSION || `iparralde-${Date.now()}`;

const stepLog = [];

function shellQuote(value) {
  if (value == null) return "''";
  const s = String(value);
  if (/^[A-Za-z0-9_./:@-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function buildGlobalArgs(selectedEngine, sessionName) {
  const args = ['--session', sessionName, '--engine', selectedEngine, '--json'];
  if (selectedEngine === 'lightpanda' && lightpandaBin) {
    args.push('--executable-path', lightpandaBin);
  }
  return args;
}

function parseJsonOutput(stdout, commandString) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`No output returned by: ${commandString}`);
  }

  let payload;
  try {
    payload = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Could not parse JSON from: ${commandString}\nOutput:\n${trimmed}`);
  }

  if (!payload.success) {
    const message = payload.error || 'Unknown agent-browser error';
    throw new Error(`${commandString} failed: ${message}`);
  }

  return payload.data || {};
}

function runAgent(selectedEngine, sessionName, args) {
  const fullArgs = [...buildGlobalArgs(selectedEngine, sessionName), ...args];
  const commandString = `agent-browser ${fullArgs.map(shellQuote).join(' ')}`;
  stepLog.push(commandString);

  const result = spawnSync(AGENT_BROWSER_BIN, fullArgs, {
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });

  if (result.error) {
    throw new Error(`${commandString} failed.\n${String(result.error)}`.trim());
  }

  if (result.status !== 0) {
    const details = [String(result.stderr || '').trim(), String(result.stdout || '').trim()]
      .filter(Boolean)
      .join('\n');
    throw new Error(`${commandString} failed.\n${details}`.trim());
  }

  return parseJsonOutput(String(result.stdout || ''), commandString);
}

function evaluateJson(selectedEngine, sessionName, jsCode) {
  const data = runAgent(selectedEngine, sessionName, ['eval', jsCode]);
  const raw = data.result == null ? '' : String(data.result);
  if (!raw) return null;
  return JSON.parse(raw);
}

function deriveStableId(detailUrl) {
  const url = String(detailUrl || '').trim();
  const numeric = url.match(/\/(\d+)\/?$/);
  if (numeric) return numeric[1];
  if (!url) return '';
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function toMarkdownTable(rows) {
  const header = '| # | Title | Price | Location | Stable ID | Detail URL | Timestamp |';
  const sep = '|---:|---|---|---|---|---|---|';
  const body = rows.map((item, idx) => {
    return `| ${idx + 1} | ${escapeCell(item.title)} | ${escapeCell(item.price)} | ${escapeCell(item.location)} | ${escapeCell(item.stableId)} | ${escapeCell(item.detailUrl)} | ${escapeCell(item.scrapingTimestamp)} |`;
  });
  return [header, sep, ...body].join('\n');
}

function normalizeListing(item) {
  const title = String(item.title || '').trim();
  const price = String(item.price || '').trim();
  const location = String(item.location || '').trim();
  const detailUrl = String(item.detailUrl || '').trim();
  const scrapingTimestamp = String(item.scrapingTimestamp || '').trim() || new Date().toISOString();
  const stableId = deriveStableId(detailUrl);

  return { title, price, location, detailUrl, scrapingTimestamp, stableId };
}

function scrapeWithEngine(selectedEngine, sessionName) {
  runAgent(selectedEngine, sessionName, ['open', TARGET_URL]);
  runAgent(selectedEngine, sessionName, ['wait', '--load', 'networkidle']);

  runAgent(selectedEngine, sessionName, ['select', 'form.findus select[name="tipoInmueble[]"]', 'piso']);
  runAgent(selectedEngine, sessionName, ['select', 'form.findus select[name="municipio[]"]', 'Hendaye']);
  runAgent(selectedEngine, sessionName, ['click', 'form.findus button[type="submit"]']);

  runAgent(selectedEngine, sessionName, ['wait', '--load', 'networkidle']);
  runAgent(selectedEngine, sessionName, ['wait', '#easyPaginate-1 .property-list-list']);

  const scrapePageJs = `JSON.stringify((() => {
    const timestamp = new Date().toISOString();
    const cards = Array.from(document.querySelectorAll('#easyPaginate-1 .property-list-list'));
    return cards
      .filter((card) => {
        const style = window.getComputedStyle(card);
        return style.display !== 'none' && card.offsetParent !== null;
      })
      .map((card) => {
        const info = card.querySelector('.property-list-list-info');
        const detailUrl = card.querySelector('a.wi')?.href?.trim() || '';
        const title = card.querySelector('a.wi img')?.alt?.trim() || info?.querySelector('h3')?.textContent?.trim() || '';
        const price = info?.querySelector('.price')?.textContent?.trim() || '';
        const text = info?.textContent || '';
        const locMatch = text.match(/\\d{5}\\s+[^\\n,]+,\\s*(ES|FR)/i);
        const location = locMatch ? locMatch[0].trim() : '';
        return { title, price, location, detailUrl, scrapingTimestamp: timestamp };
      });
  })())`;

  const relsJs = `JSON.stringify(Array.from(document.querySelectorAll('.easyPaginateNav a.page'))
    .map((a) => a.getAttribute('rel'))
    .filter(Boolean))`;

  const seen = new Set();
  const results = [];

  const addRows = (rows) => {
    for (const row of rows || []) {
      const item = normalizeListing(row);
      const key = item.detailUrl || item.stableId;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      results.push(item);
    }
  };

  addRows(evaluateJson(selectedEngine, sessionName, scrapePageJs));

  const rels = evaluateJson(selectedEngine, sessionName, relsJs) || [];
  for (const rel of rels) {
    runAgent(selectedEngine, sessionName, ['click', `.easyPaginateNav a.page[rel="${rel}"]`]);
    runAgent(selectedEngine, sessionName, ['wait', '250']);
    addRows(evaluateJson(selectedEngine, sessionName, scrapePageJs));
  }

  return results;
}

function writeArtifacts(results) {
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_TABLE, `${toMarkdownTable(results)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_STEPS, `${stepLog.join('\n')}\n`, 'utf8');
}

function closeSession(selectedEngine, sessionName) {
  try {
    runAgent(selectedEngine, sessionName, ['close']);
  } catch (_error) {
    // Ignore close errors to preserve main failure details.
  }
}

function run() {
  let selectedEngine = engine;
  let selectedSession = baseSession;
  let results;

  try {
    results = scrapeWithEngine(selectedEngine, selectedSession);
  } catch (error) {
    const lightpandaFailed = selectedEngine === 'lightpanda';
    const canFallback = allowChromeFallback;

    if (!lightpandaFailed || !canFallback) {
      throw error;
    }

    selectedEngine = 'chrome';
    selectedSession = `${baseSession}-chrome`;
    stepLog.push(`# Lightpanda failed; retrying with engine=chrome because ALLOW_CHROME_FALLBACK=${process.env.ALLOW_CHROME_FALLBACK}`);
    results = scrapeWithEngine(selectedEngine, selectedSession);
  } finally {
    closeSession(selectedEngine, selectedSession);
  }

  writeArtifacts(results);

  const summary = {
    engineUsed: selectedEngine,
    lightpandaBin: lightpandaBin || null,
    count: results.length,
    outputJson: OUTPUT_JSON,
    outputTable: OUTPUT_TABLE,
    outputSteps: OUTPUT_STEPS,
  };

  if (process.stdout.isTTY) {
    console.log(`Scraped ${results.length} listings with engine=${selectedEngine}`);
    console.log(JSON.stringify(summary, null, 2));
  } else {
    process.stdout.write(JSON.stringify(results, null, 2));
  }
}

try {
  run();
} catch (error) {
  const message = error && error.stack ? error.stack : String(error);
  console.error(message);
  process.exit(1);
}