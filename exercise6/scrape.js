#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { runPipeline } = require('./core');
const { listAdapterIds } = require('./adapters');

function parseValue(value) {
  if (value == null) return true;

  const text = String(value).trim();
  if (!text) return '';

  if (/^(true|false)$/i.test(text)) return /^true$/i.test(text);
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);

  return text;
}

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2).trim();
    if (!key) continue;

    const next = argv[i + 1];
    const hasInline = key.includes('=');

    if (hasInline) {
      const [inlineKey, inlineValue] = key.split('=');
      args[inlineKey] = parseValue(inlineValue);
      continue;
    }

    if (next == null || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = parseValue(next);
    i += 1;
  }

  return args;
}

function printUsageAndExit(exitCode) {
  const adapters = listAdapterIds();
  const usage = [
    'Usage:',
    '  node exercise6/scrape.js --site <siteId> [--out <file>] [--param value ...]',
    '',
    'Example:',
    '  node exercise6/scrape.js --site iparralde --out exercise6/listings.json',
    '',
    `Available sites: ${adapters.join(', ')}`,
  ].join('\n');

  process.stderr.write(`${usage}\n`);
  process.exit(exitCode);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    printUsageAndExit(0);
  }

  const siteId = String(args.site || '').trim();
  if (!siteId) {
    printUsageAndExit(1);
  }

  const outputPath = args.out ? String(args.out) : '';

  const params = { ...args };
  delete params.site;
  delete params.out;
  delete params.help;
  delete params.h;

  const listings = await runPipeline({ siteId, params });
  const payload = `${JSON.stringify(listings, null, 2)}\n`;

  if (outputPath) {
    const absoluteOut = path.resolve(process.cwd(), outputPath);
    fs.mkdirSync(path.dirname(absoluteOut), { recursive: true });
    fs.writeFileSync(absoluteOut, payload, 'utf8');
  }

  process.stdout.write(payload);
}

main().catch((error) => {
  const message = error && error.stack ? error.stack : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
