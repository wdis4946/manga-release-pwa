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
    case "run":
      await runRepeatedly(args);
      break;
    case "help":
    case undefined:
      printHelp();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function runRepeatedly(args) {
  const repeat = numberArg(args, "repeat", 1);
  const intervalMs = numberArg(args, "interval-ms", 0);

  for (let index = 0; index < repeat; index += 1) {
    const result = await callCoverJobsApi(
      "run",
      {
        limit: numberArg(args, "limit", 5),
        offset: numberArg(args, "offset", 0),
        dryRun: Boolean(args["dry-run"]),
        includeImageSet: Boolean(args["include-image-set"]),
      },
      args,
    );

    if (
      result.targetCount === 0 ||
      index === repeat - 1 ||
      intervalMs <= 0
    ) {
      continue;
    }

    await sleep(intervalMs);
  }
}

async function callCoverJobsApi(mode, body, args) {
  const baseUrl = String(args["base-url"] ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const cronSecret = requiredEnv("CRON_SECRET");
  const response = await fetch(
    `${baseUrl}/api/admin/series-cover-jobs?mode=${encodeURIComponent(mode)}`,
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

function parseArgs(values) {
  const args = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (!value.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = value.slice(2).split("=", 2);
    const nextValue = values[index + 1];

    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
    } else if (nextValue && !nextValue.startsWith("--")) {
      args[rawKey] = nextValue;
      index += 1;
    } else {
      args[rawKey] = true;
    }
  }

  return args;
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
  node scripts/series-cover-jobs.mjs run [--limit 5] [--offset 0] [--repeat 1] [--interval-ms 15000] [--dry-run]

Options:
  --base-url URL          Default: ${DEFAULT_BASE_URL}
  --limit N               Number of series to process per request. API max is 20.
  --offset N              Skip N target series.
  --repeat N              Repeat requests.
  --interval-ms N         Wait after a response before the next repeated request.
  --dry-run               Find cover candidates without uploading/updating DB.
  --include-image-set     Also process series that already have representative_image_path.

Environment:
  CRON_SECRET is loaded from .env.local or .env.
`);
}
