#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const OPENAI_API_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4.1";
const DEFAULT_WEB_SEARCH_TOOL_TYPE = "web_search_preview";
const DEFAULT_OUTPUT_DIR = "data/openai-series-summary-batches";
const MIN_SUMMARY_LENGTH = 300;
const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
    needs_review: { type: "boolean" },
    notes: { type: "string" },
    source_urls: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "id",
    "title",
    "summary",
    "confidence",
    "needs_review",
    "notes",
    "source_urls",
  ],
  additionalProperties: false,
};

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
    case "create-input":
      await createInput(args);
      break;
    case "submit":
      await submitBatch(args);
      break;
    case "status":
      await showBatchStatus(args);
      break;
    case "download":
      await downloadBatch(args);
      break;
    case "import":
      await importResults(args);
      break;
    case "help":
    case undefined:
      printHelp();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function createInput(args) {
  const limit = Number(args.limit ?? 50);
  const offset = Number(args.offset ?? 0);
  const includeDescribed = Boolean(args["include-described"]);
  const includeImageSet = Boolean(args["include-image-set"]);
  const model = String(
    args.model ?? process.env.OPENAI_SUMMARY_MODEL ?? DEFAULT_MODEL,
  );
  const webSearchToolType = String(
    args.webSearchToolType ??
      process.env.OPENAI_WEB_SEARCH_TOOL_TYPE ??
      DEFAULT_WEB_SEARCH_TOOL_TYPE,
  );
  const outputDir = String(args.outDir ?? DEFAULT_OUTPUT_DIR);
  const now = formatTimestamp(new Date());
  const outputPath = resolve(outputDir, `series-summary-input-${now}.jsonl`);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("--limit must be a positive integer.");
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("--offset must be a non-negative integer.");
  }

  const supabase = createSupabaseAdminClient();
  const seriesRows = await fetchTargetSeries({
    supabase,
    limit,
    offset,
    includeDescribed,
    includeImageSet,
  });
  const context = await fetchSeriesContext(
    supabase,
    seriesRows.map((row) => row.id),
  );
  const lines = seriesRows.map((series) =>
    JSON.stringify(
      createBatchRequest(series, context.get(series.id), {
        model,
        webSearchToolType,
      }),
    ),
  );

  await ensureDir(dirname(outputPath));
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "create-input",
        model,
        webSearchToolType,
        count: lines.length,
        includeDescribed,
        includeImageSet,
        outputPath,
      },
      null,
      2,
    ),
  );
}

async function submitBatch(args) {
  const inputPath = requiredArg(args, "input");
  const inputFile = await uploadOpenAIFile(inputPath);
  const batch = await openAIRequest("/batches", {
    method: "POST",
    json: {
      input_file_id: inputFile.id,
      endpoint: "/v1/responses",
      completion_window: "24h",
      metadata: {
        job: "series-summary-web-search",
        input_file: basename(inputPath),
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "submit",
        inputFileId: inputFile.id,
        batchId: batch.id,
        status: batch.status,
      },
      null,
      2,
    ),
  );
}

async function showBatchStatus(args) {
  const batchId = requiredArg(args, "batch");
  const batch = await openAIRequest(`/batches/${encodeURIComponent(batchId)}`);

  console.log(JSON.stringify(batch, null, 2));
}

async function downloadBatch(args) {
  const batchId = requiredArg(args, "batch");
  const outputDir = String(args.outDir ?? DEFAULT_OUTPUT_DIR);
  const batch = await openAIRequest(`/batches/${encodeURIComponent(batchId)}`);
  const now = formatTimestamp(new Date());

  await ensureDir(outputDir);

  const downloaded = {
    ok: true,
    mode: "download",
    batchId,
    status: batch.status,
    outputPath: null,
    errorPath: null,
  };

  if (batch.output_file_id) {
    const output = await downloadOpenAIFile(batch.output_file_id);
    downloaded.outputPath = resolve(
      outputDir,
      `series-summary-output-${batchId}-${now}.jsonl`,
    );
    await writeFile(downloaded.outputPath, output, "utf8");
  }

  if (batch.error_file_id) {
    const errors = await downloadOpenAIFile(batch.error_file_id);
    downloaded.errorPath = resolve(
      outputDir,
      `series-summary-errors-${batchId}-${now}.jsonl`,
    );
    await writeFile(downloaded.errorPath, errors, "utf8");
  }

  console.log(JSON.stringify(downloaded, null, 2));
}

async function importResults(args) {
  const inputPath = requiredArg(args, "input");
  const apply = Boolean(args.apply);
  const acceptLowConfidence = Boolean(args["accept-low-confidence"]);
  const outputDir = String(args.outDir ?? DEFAULT_OUTPUT_DIR);
  const now = formatTimestamp(new Date());
  const reviewPath = resolve(outputDir, `series-summary-review-${now}.csv`);
  const acceptedPath = resolve(
    outputDir,
    `series-summary-accepted-${now}.jsonl`,
  );
  const text = await readFile(inputPath, "utf8");
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseBatchOutputLine(line, index + 1));

  const accepted = [];
  const review = [];

  for (const row of rows) {
    if (row.error) {
      review.push({
        custom_id: row.customId,
        id: "",
        title: "",
        reason: row.error,
        confidence: "",
        needs_review: "",
        notes: "",
      });
      continue;
    }

    const validationError = validateSummary(row.summary, acceptLowConfidence);

    if (validationError) {
      review.push({
        custom_id: row.customId,
        id: row.summary?.id ?? "",
        title: row.summary?.title ?? "",
        reason: validationError,
        confidence: row.summary?.confidence ?? "",
        needs_review: String(row.summary?.needs_review ?? ""),
        notes: row.summary?.notes ?? "",
      });
      continue;
    }

    accepted.push(row.summary);
  }

  await ensureDir(outputDir);
  await writeFile(
    acceptedPath,
    `${accepted.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  await writeFile(reviewPath, toCsv(review), "utf8");

  let updatedCount = 0;

  if (apply && accepted.length > 0) {
    const supabase = createSupabaseAdminClient();

    for (const summary of accepted) {
      const { error } = await supabase
        .from("series")
        .update({
          description: summary.summary,
          updated_at: new Date().toISOString(),
        })
        .eq("id", summary.id);

      if (error) {
        review.push({
          custom_id: `series:${summary.id}`,
          id: summary.id,
          title: summary.title,
          reason: error.message,
          confidence: summary.confidence,
          needs_review: String(summary.needs_review),
          notes: summary.notes,
        });
      } else {
        updatedCount += 1;
      }
    }

    await writeFile(reviewPath, toCsv(review), "utf8");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "import",
        apply,
        total: rows.length,
        acceptedCount: accepted.length,
        reviewCount: review.length,
        updatedCount,
        acceptedPath,
        reviewPath,
      },
      null,
      2,
    ),
  );
}

async function fetchTargetSeries({
  supabase,
  limit,
  offset,
  includeDescribed,
  includeImageSet,
}) {
  let query = supabase
    .from("series")
    .select("id, display_title, search_title, description, representative_image_path")
    .order("display_title", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (!includeDescribed) {
    query = query.or("description.is.null,description.eq.");
  }

  if (!includeImageSet) {
    query = query.is("representative_image_path", null);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function fetchSeriesContext(supabase, seriesIds) {
  const context = new Map(
    seriesIds.map((seriesId) => [
      seriesId,
      {
        authors: [],
        publishers: [],
        imprints: [],
        genres: [],
      },
    ]),
  );

  if (seriesIds.length === 0) {
    return context;
  }

  for (const chunk of chunks(seriesIds, 200)) {
    const [agentResult, publisherResult, genreResult] = await Promise.all([
      supabase
        .from("series_agents")
        .select("series_id, sort_order, agents(name, author_wiki_link)")
        .in("series_id", chunk)
        .order("sort_order", { ascending: true }),
      supabase
        .from("series_publishers")
        .select("series_id, publishers(imprint_name, publisher_name)")
        .in("series_id", chunk),
      supabase
        .from("series_genres")
        .select("series_id, genres(name)")
        .in("series_id", chunk),
    ]);

    if (agentResult.error) {
      throw agentResult.error;
    }

    if (publisherResult.error) {
      throw publisherResult.error;
    }

    if (genreResult.error) {
      throw genreResult.error;
    }

    for (const row of agentResult.data ?? []) {
      const entry = context.get(row.series_id);
      const agent = firstRelation(row.agents);

      if (entry && agent?.name && !entry.authors.includes(agent.name)) {
        entry.authors.push(agent.name);
      }
    }

    for (const row of publisherResult.data ?? []) {
      const entry = context.get(row.series_id);
      const publisher = firstRelation(row.publishers);

      if (!entry || !publisher) {
        continue;
      }

      if (
        publisher.publisher_name &&
        !entry.publishers.includes(publisher.publisher_name)
      ) {
        entry.publishers.push(publisher.publisher_name);
      }

      if (
        publisher.imprint_name &&
        !entry.imprints.includes(publisher.imprint_name)
      ) {
        entry.imprints.push(publisher.imprint_name);
      }
    }

    for (const row of genreResult.data ?? []) {
      const entry = context.get(row.series_id);
      const genre = firstRelation(row.genres);

      if (entry && genre?.name && !entry.genres.includes(genre.name)) {
        entry.genres.push(genre.name);
      }
    }
  }

  return context;
}

function createBatchRequest(series, context, { model, webSearchToolType }) {
  const input = [
    {
      role: "system",
      content: [
        "あなたは漫画紹介文を作る編集者です。",
        "必要に応じてWeb検索を使い、作品情報を確認してください。",
        "作品紹介ページに掲載できるような自然なあらすじを作成してください。",
        "日本語で作成してください。",
        "400字程度で作成してください。",
        "3〜4段落に分け、適度に改行を入れてください。",
        "作品名、作者、ジャンル感、主人公、舞台、導入、見どころを自然に含めてください。",
        "結末や重大なネタバレは避けてください。",
        "参考情報にない設定や固有名詞を勝手に追加しないでください。",
        "参考情報をそのままコピーせず、必ず言い換えて再構成してください。",
        "文体は漫画紹介文らしく、少しドラマチックにしてください。",
        "ただし煽りすぎず、落ち着いた紹介文にしてください。",
        "文末を「だ」「である」で終わらせないでください。",
        "体言止めを多用しすぎないでください。",
        "「〜していく」「〜となる」「〜へ向かう」「〜が描かれる」「〜に巻き込まれていく」などを自然に使ってください。",
        "最後の段落は、その作品の魅力やジャンル感をまとめる締めにしてください。",
        "不明な情報は補完しないでください。",
        "同名作品などで特定できない場合や情報不足の場合は needs_review=true にしてください。",
        "確認に使った主要なURLを source_urls に入れてください。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `id: ${series.id}`,
        `title: ${series.display_title}`,
        `search_title: ${series.search_title}`,
        `authors: ${formatList(context?.authors)}`,
        `publishers: ${formatList(context?.publishers)}`,
        `imprints: ${formatList(context?.imprints)}`,
        `genres: ${formatList(context?.genres)}`,
      ].join("\n"),
    },
  ];

  return {
    custom_id: `series:${series.id}`,
    method: "POST",
    url: "/v1/responses",
    body: {
      model,
      tools: [{ type: webSearchToolType }],
      input,
      text: {
        format: {
          type: "json_schema",
          name: "manga_summary",
          strict: true,
          schema: SUMMARY_SCHEMA,
        },
      },
    },
  };
}

function parseBatchOutputLine(line, lineNumber) {
  let parsed;

  try {
    parsed = JSON.parse(line);
  } catch (error) {
    return {
      customId: "",
      error: `Line ${lineNumber}: invalid JSON: ${error.message}`,
      summary: null,
    };
  }

  const customId = parsed.custom_id ?? "";

  if (parsed.error) {
    return {
      customId,
      error: parsed.error.message ?? JSON.stringify(parsed.error),
      summary: null,
    };
  }

  const statusCode = parsed.response?.status_code;

  if (statusCode && (statusCode < 200 || statusCode >= 300)) {
    return {
      customId,
      error:
        parsed.response?.body?.error?.message ??
        `OpenAI response status ${statusCode}`,
      summary: null,
    };
  }

  const outputText = extractOutputText(parsed.response?.body);

  if (!outputText) {
    return {
      customId,
      error: "No output text found.",
      summary: null,
    };
  }

  try {
    return {
      customId,
      error: null,
      summary: JSON.parse(outputText),
    };
  } catch (error) {
    return {
      customId,
      error: `Invalid summary JSON: ${error.message}`,
      summary: null,
    };
  }
}

function extractOutputText(body) {
  if (!body) {
    return null;
  }

  if (typeof body.output_text === "string") {
    return body.output_text;
  }

  for (const output of body.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return null;
}

function validateSummary(summary, acceptLowConfidence) {
  if (!summary || typeof summary !== "object") {
    return "summary is missing";
  }

  for (const key of SUMMARY_SCHEMA.required) {
    if (!(key in summary)) {
      return `${key} is missing`;
    }
  }

  if (!summary.id || !summary.title || !summary.summary) {
    return "id, title, or summary is empty";
  }

  if (!["high", "medium", "low"].includes(summary.confidence)) {
    return "confidence is invalid";
  }

  if (summary.needs_review) {
    return "needs_review is true";
  }

  if (!acceptLowConfidence && summary.confidence === "low") {
    return "confidence is low";
  }

  if (!Array.isArray(summary.source_urls) || summary.source_urls.length === 0) {
    return "source_urls is empty";
  }

  if (summary.summary.length < MIN_SUMMARY_LENGTH) {
    return "summary is too short";
  }

  return null;
}

async function uploadOpenAIFile(inputPath) {
  const apiKey = requiredEnv("OPENAI_API_KEY");
  const bytes = await readFile(inputPath);
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: "application/jsonl" }),
    basename(inputPath),
  );
  form.append("purpose", "batch");

  const response = await fetch(`${OPENAI_API_BASE}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(await formatOpenAIError(response));
  }

  return response.json();
}

async function downloadOpenAIFile(fileId) {
  const apiKey = requiredEnv("OPENAI_API_KEY");
  const response = await fetch(
    `${OPENAI_API_BASE}/files/${encodeURIComponent(fileId)}/content`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await formatOpenAIError(response));
  }

  return response.text();
}

async function openAIRequest(path, options = {}) {
  const apiKey = requiredEnv("OPENAI_API_KEY");
  const response = await fetch(`${OPENAI_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: options.json ? JSON.stringify(options.json) : undefined,
  });

  if (!response.ok) {
    throw new Error(await formatOpenAIError(response));
  }

  return response.json();
}

async function formatOpenAIError(response) {
  const text = await response.text();

  try {
    const body = JSON.parse(text);
    return `${response.status} ${response.statusText}: ${
      body.error?.message ?? text
    }`;
  } catch {
    return `${response.status} ${response.statusText}: ${text}`;
  }
}

function createSupabaseAdminClient() {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error(
      "Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
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

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

function chunks(values, size) {
  const result = [];

  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }

  return result;
}

function firstRelation(value) {
  return Array.isArray(value) ? value[0] : value;
}

function formatList(values = []) {
  return values.length ? values.join(", ") : "不明";
}

function formatTimestamp(date) {
  const pad = (value, length = 2) => String(value).padStart(length, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function toCsv(rows) {
  const headers = [
    "custom_id",
    "id",
    "title",
    "reason",
    "confidence",
    "needs_review",
    "notes",
  ];

  return [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header] ?? "")).join(","),
    ),
  ].join("\n");
}

function csvEscape(value) {
  const text = String(value);

  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

function printHelp() {
  console.log(`Usage:
  node scripts/openai-series-summaries.mjs create-input [--limit 50] [--offset 0] [--include-described] [--include-image-set] [--model MODEL]
  node scripts/openai-series-summaries.mjs submit --input path/to/input.jsonl
  node scripts/openai-series-summaries.mjs status --batch batch_id
  node scripts/openai-series-summaries.mjs download --batch batch_id
  node scripts/openai-series-summaries.mjs import --input path/to/output.jsonl [--apply] [--accept-low-confidence]

Environment:
  OPENAI_API_KEY
  OPENAI_SUMMARY_MODEL optional, default: ${DEFAULT_MODEL}
  OPENAI_WEB_SEARCH_TOOL_TYPE optional, default: ${DEFAULT_WEB_SEARCH_TOOL_TYPE}
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY
`);
}
