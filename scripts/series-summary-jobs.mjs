#!/usr/bin/env node

import { readFileSync } from "node:fs";

const DEFAULT_BASE_URL = "https://manga-release-pwa.vercel.app";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (command) {
    case "enqueue":
      await enqueueRepeatedly(args);
      break;
    case "run":
      await runRepeatedly(args);
      break;
    case "batch-submit":
      await callJobsApi("batch-submit", {
        limit: numberArg(args, "limit", 100),
        offset: numberArg(args, "offset", 0),
        model: stringArg(args, "model"),
      }, args);
      break;
    case "batch-status":
      await callJobsApi("batch-status", {
        batchId: requiredArg(args, "batch"),
      }, args);
      break;
    case "batch-apply":
      await applyBatchRepeatedly(args);
      break;
    case "collect-sources":
      await callJobsApi("collect-sources", {
        limit: numberArg(args, "limit", 10),
        offset: numberArg(args, "offset", 0),
        includeUndescribed: Boolean(args["include-undescribed"]),
        includeImageSet: Boolean(args["include-image-set"]),
        search: !Boolean(args["no-search"]),
        refetch: Boolean(args.refetch),
      }, args);
      break;
    case "import-source-urls":
      await importSourceUrls(args);
      break;
    case "status":
      await callJobsApi("status", {}, args);
      break;
    case "clear":
      await callJobsApi(
        "clear",
        {
          all: Boolean(args.all),
          statuses: parseCsvArg(args.statuses),
        },
        args,
      );
      break;
    case "help":
    case undefined:
      printHelp();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function enqueueRepeatedly(args) {
  const desiredLimit = numberArg(args, "limit", 100);
  const batchSize = numberArg(args, "batch-size", desiredLimit);
  const repeat = numberArg(args, "repeat", 1);
  const intervalMs = numberArg(args, "interval-ms", 0);

  for (let index = 0; index < repeat; index += 1) {
    const result = await callJobsApi(
      "enqueue",
      {
        limit: Math.min(desiredLimit, batchSize * (index + 1)),
        offset: numberArg(args, "offset", 0),
        includeUndescribed: Boolean(args["include-undescribed"]),
        includeImageSet: Boolean(args["include-image-set"]),
        maxAttempts: numberArg(args, "max-attempts", 3),
      },
      args,
    );

    if (
      result.remainingCapacity === 0 ||
      result.insertedCount === 0 ||
      index === repeat - 1 ||
      intervalMs <= 0
    ) {
      continue;
    }

    await sleep(intervalMs);
  }
}

async function runRepeatedly(args) {
  const repeat = numberArg(args, "repeat", 1);
  const intervalMs = numberArg(args, "interval-ms", 0);

  for (let index = 0; index < repeat; index += 1) {
    const result = await callJobsApi(
      "run",
      {
        limit: numberArg(args, "limit", 1),
        staleAfterMinutes: numberArg(args, "stale-after-minutes", 30),
        apply: !Boolean(args["dry-run"]),
        acceptLowConfidence: Boolean(args["accept-low-confidence"]),
        allowWebSearchFallback: Boolean(args["allow-web-search-fallback"]),
      },
      args,
    );

    if (
      result.claimedCount === 0 ||
      index === repeat - 1 ||
      intervalMs <= 0
    ) {
      continue;
    }

    await sleep(intervalMs);
  }
}

async function applyBatchRepeatedly(args) {
  const repeat = numberArg(args, "repeat", 1);
  const intervalMs = numberArg(args, "interval-ms", 0);

  for (let index = 0; index < repeat; index += 1) {
    const result = await callJobsApi("batch-apply", {
      batchId: requiredArg(args, "batch"),
      limit: optionalNumberArg(args, "limit"),
      offset: numberArg(args, "offset", 0),
      apply: !Boolean(args["dry-run"]),
      acceptLowConfidence: Boolean(args["accept-low-confidence"]),
      reprocess: Boolean(args.reprocess),
    }, args);

    if (
      result.processedCount === 0 ||
      result.remainingBeforeApply <= result.processedCount ||
      index === repeat - 1 ||
      intervalMs <= 0
    ) {
      continue;
    }

    await sleep(intervalMs);
  }
}

async function callJobsApi(mode, body, args) {
  const baseUrl = String(args["base-url"] ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const cronSecret = requiredEnv("CRON_SECRET");
  const response = await fetch(
    `${baseUrl}/api/admin/series-summary-jobs?mode=${encodeURIComponent(mode)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}: ${JSON.stringify(parsed)}`,
    );
  }

  console.log(JSON.stringify(parsed, null, 2));

  return parsed;
}

async function importSourceUrls(args) {
  const input = args.input;

  if (!input || input === true) {
    throw new Error("--input is required.");
  }

  const groups = readSourceUrlCsv(String(input));

  await callJobsApi(
    "import-source-urls",
    {
      sources: groups,
      fetch: Boolean(args.fetch),
    },
    args,
  );
}

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);

    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }

    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function readSourceUrlCsv(path) {
  const text = readFileSync(path, "utf8");
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine);
  const seriesIdIndex = headers.indexOf("series_id");
  const urlsIndex = headers.indexOf("source_urls");

  if (seriesIdIndex === -1 || urlsIndex === -1) {
    throw new Error("CSV must include series_id and source_urls columns.");
  }

  const groups = [];

  for (const line of lines) {
    const columns = parseCsvLine(line);
    const seriesId = columns[seriesIdIndex];
    const sourceUrls = columns[urlsIndex];

    if (!seriesId || !sourceUrls) {
      continue;
    }

    let urls;

    try {
      urls = JSON.parse(sourceUrls);
    } catch {
      continue;
    }

    if (Array.isArray(urls) && urls.length > 0) {
      groups.push({ seriesId, urls });
    }
  }

  return groups;
}

function parseCsvLine(line) {
  const columns = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      columns.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  columns.push(current);
  return columns;
}

function numberArg(args, name, defaultValue) {
  const value = args[name];

  if (value === undefined || value === true) {
    return defaultValue;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new Error(`--${name} must be a number.`);
  }

  return numberValue;
}

function optionalNumberArg(args, name) {
  const value = args[name];

  if (value === undefined || value === true) {
    return undefined;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new Error(`--${name} must be a number.`);
  }

  return numberValue;
}

function parseCsvArg(value) {
  if (!value || value === true) {
    return undefined;
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringArg(args, name) {
  const value = args[name];

  if (!value || value === true) {
    return undefined;
  }

  return String(value);
}

function requiredArg(args, name) {
  const value = args[name];

  if (!value || value === true) {
    throw new Error(`--${name} is required.`);
  }

  return String(value);
}

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function loadEnvFile(path) {
  let text;

  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage:
  node scripts/series-summary-jobs.mjs enqueue [--limit 100] [--batch-size 100] [--repeat 1] [--interval-ms 15000] [--offset 0]
  node scripts/series-summary-jobs.mjs import-source-urls --input data/source-urls.csv [--fetch]
  node scripts/series-summary-jobs.mjs collect-sources [--limit 10] [--offset 0] [--no-search] [--refetch]
  node scripts/series-summary-jobs.mjs run [--limit 1] [--repeat 1] [--interval-ms 60000] [--dry-run]
  node scripts/series-summary-jobs.mjs batch-submit [--limit 100] [--offset 0] [--model MODEL]
  node scripts/series-summary-jobs.mjs batch-status --batch batch_id
  node scripts/series-summary-jobs.mjs batch-apply --batch batch_id [--limit 100] [--repeat 1] [--interval-ms 15000] [--dry-run] [--accept-low-confidence]
  node scripts/series-summary-jobs.mjs status
  node scripts/series-summary-jobs.mjs clear [--statuses pending,processing] [--all]

Options:
  --base-url URL              Default: ${DEFAULT_BASE_URL}
  --batch-size N              enqueue grows the desired queue size by N per request.
  --repeat N                  Repeat enqueue/run requests.
  --interval-ms N             Wait after a response before the next repeated request.
  --include-undescribed       Also enqueue series without description.
  --include-image-set         Enqueue series that already have representative_image_path.
  --accept-low-confidence     Accept low confidence summaries.
  --reprocess                 Re-apply rows even if the job is already completed/needs_review/failed.
  --allow-web-search-fallback Use OpenAI web search only when stored sources are missing.
  --no-search                 collect-sources uses only stored pending URLs.
  --refetch                   Fetch stored source URLs again.
  --fetch                     import-source-urls fetches imported URLs immediately.
  --dry-run                   Store job result without updating series.description.
  --all                       Clear all summary jobs, including completed history.

Environment:
  CRON_SECRET is loaded from .env.local or .env.
  GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID enable source collection search.
`);
}
