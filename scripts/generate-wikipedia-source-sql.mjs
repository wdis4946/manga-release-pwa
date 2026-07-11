#!/usr/bin/env node

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_OUTPUT_DIR = "data/wiki_summary_source_chunks";
const DEFAULT_CHUNK_SIZE = 25;
const DEFAULT_MAX_TEXT_LENGTH = 12000;

main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = args.dir;

  if (!inputDir || inputDir === true) {
    printHelp();
    throw new Error("--dir is required.");
  }

  const outputDir = String(args["output-dir"] ?? DEFAULT_OUTPUT_DIR);
  const chunkSize = numberArg(args, "chunk-size", DEFAULT_CHUNK_SIZE);
  const maxTextLength = numberArg(args, "max-text-length", DEFAULT_MAX_TEXT_LENGTH);
  const files = findHtmlFiles(inputDir).sort((left, right) =>
    left.localeCompare(right, "ja"),
  );

  if (files.length === 0) {
    throw new Error(`No html files found in ${inputDir}.`);
  }

  const rows = files
    .map((fileName) => {
      const filePath = path.join(inputDir, fileName);
      const title = path.basename(fileName, path.extname(fileName));
      const html = readFileSync(filePath, "utf8");
      const extractedText = truncateText(extractWikipediaText(html), maxTextLength);

      if (!extractedText) {
        return null;
      }

      return {
        title,
        url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(
          title.replace(/\s+/g, "_"),
        )}`,
        extractedText,
      };
    })
    .filter(Boolean);

  if (rows.length === 0) {
    throw new Error("No usable wikipedia text was extracted.");
  }

  mkdirSync(outputDir, { recursive: true });

  const chunkCount = Math.ceil(rows.length / chunkSize);
  const writtenFiles = [];

  for (let index = 0; index < chunkCount; index += 1) {
    const chunkRows = rows.slice(index * chunkSize, (index + 1) * chunkSize);
    const fileName = `import_wikipedia_summary_sources_${String(index + 1).padStart(
      3,
      "0",
    )}.sql`;
    const outputPath = path.join(outputDir, fileName);

    writeFileSync(
      outputPath,
      buildSql({
        chunkNumber: index + 1,
        chunkCount,
        rows: chunkRows,
      }),
      "utf8",
    );
    writtenFiles.push(outputPath);
  }

  writeFileSync(
    path.join(outputDir, "verify_wikipedia_summary_sources.sql"),
    buildVerifySql(),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        inputDir,
        outputDir,
        inputFileCount: files.length,
        extractedCount: rows.length,
        skippedEmptyCount: files.length - rows.length,
        chunkSize,
        chunkCount,
        writtenFiles,
      },
      null,
      2,
    ),
  );
}

function buildSql({
  chunkNumber,
  chunkCount,
  rows,
}) {
  const values = rows
    .map(
      (row) =>
        `    (${sqlString(row.title)}, ${sqlString(row.url)}, ${sqlString(
          row.extractedText,
        )})`,
    )
    .join(",\n");

  return `-- ローカルWikipedia HTMLから抽出した本文を series_summary_sources に取り込むSQL。
-- chunk ${chunkNumber} / ${chunkCount}
-- Supabase SQL Editorで1ファイルずつ実行してください。

begin;

with local_sources(wiki_title, source_url, extracted_text) as (
  values
${values}
),
matched_sources as (
  select
    wiki.id as series_id,
    wiki.title,
    local_sources.source_url,
    local_sources.extracted_text
  from local_sources
  join public.wiki_manga_series as wiki
    on wiki.title = local_sources.wiki_title
  join public.series as series
    on series.id = wiki.id
),
upserted as (
  insert into public.series_summary_sources (
    series_id,
    url,
    domain,
    source_type,
    title,
    description,
    extracted_text,
    score,
    status,
    error_message,
    fetched_at,
    updated_at
  )
  select
    matched_sources.series_id,
    matched_sources.source_url,
    'ja.wikipedia.org',
    'reference_database',
    matched_sources.title,
    null,
    matched_sources.extracted_text,
    80,
    'fetched',
    null,
    now(),
    now()
  from matched_sources
  on conflict (series_id, url) do update
  set
    domain = excluded.domain,
    source_type = excluded.source_type,
    title = excluded.title,
    description = excluded.description,
    extracted_text = excluded.extracted_text,
    score = greatest(public.series_summary_sources.score, excluded.score),
    status = 'fetched',
    error_message = null,
    fetched_at = now(),
    updated_at = now()
  returning series_id, url
)
select
  (select count(*) from local_sources) as input_count,
  (select count(*) from matched_sources) as matched_count,
  (select count(*) from upserted) as upserted_count,
  (
    select count(*)
    from local_sources
    where not exists (
      select 1
      from public.wiki_manga_series as wiki
      join public.series as series
        on series.id = wiki.id
      where wiki.title = local_sources.wiki_title
    )
  ) as missing_series_count;

commit;
`;
}

function buildVerifySql() {
  return `-- Wikipedia由来のあらすじ生成ソース登録状況を確認するSQL。

select
  count(*) as wikipedia_source_count,
  count(distinct series_id) as series_count,
  min(fetched_at) as oldest_fetched_at,
  max(fetched_at) as newest_fetched_at
from public.series_summary_sources
where domain = 'ja.wikipedia.org'
  and source_type = 'reference_database'
  and status = 'fetched';

select
  series.display_title,
  source.url,
  length(source.extracted_text) as extracted_text_length,
  source.fetched_at
from public.series_summary_sources as source
join public.series as series
  on series.id = source.series_id
where source.domain = 'ja.wikipedia.org'
  and source.source_type = 'reference_database'
  and source.status = 'fetched'
order by source.fetched_at desc nulls last, series.display_title
limit 50;
`;
}

function findHtmlFiles(dir, baseDir = dir) {
  const files = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...findHtmlFiles(entryPath, baseDir));
      continue;
    }

    if (
      entry.isFile() &&
      [".html", ".htm"].includes(path.extname(entry.name).toLowerCase())
    ) {
      files.push(path.relative(baseDir, entryPath));
    }
  }

  return files;
}

function extractWikipediaText(html) {
  const contentHtml = extractWikipediaContentHtml(html);

  return decodeHtmlEntities(
    contentHtml
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(?:p|div|section|h[1-6]|li|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\r/g, "\n")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function extractWikipediaContentHtml(html) {
  const contentStartPatterns = [
    'id="mw-content-text"',
    "id='mw-content-text'",
    'id="content"',
    "id='content'",
  ];
  const endPatterns = [
    'id="catlinks"',
    "id='catlinks'",
    'class="printfooter"',
    "class='printfooter'",
    'id="footer"',
    "id='footer'",
  ];
  let start = -1;

  for (const pattern of contentStartPatterns) {
    start = html.indexOf(pattern);

    if (start !== -1) {
      start = Math.max(0, html.lastIndexOf("<", start));
      break;
    }
  }

  if (start === -1) {
    start = 0;
  }

  let end = html.length;

  for (const pattern of endPatterns) {
    const index = html.indexOf(pattern, start + 1);

    if (index !== -1) {
      end = Math.min(end, Math.max(start, html.lastIndexOf("<", index)));
    }
  }

  return html.slice(start, end);
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength).trim();
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
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

function numberArg(args, name, defaultValue) {
  const value = args[name];

  if (value === undefined || value === true) {
    return defaultValue;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`--${name} must be a positive number.`);
  }

  return Math.floor(number);
}

function printHelp() {
  console.log(`Usage:
  node scripts/generate-wikipedia-source-sql.mjs --dir "C:\\path\\to\\wiki-html"

Options:
  --output-dir <dir>       Output directory. Default: ${DEFAULT_OUTPUT_DIR}
  --chunk-size <number>    Rows per SQL file. Default: ${DEFAULT_CHUNK_SIZE}
  --max-text-length <n>    Max extracted text characters per page. Default: ${DEFAULT_MAX_TEXT_LENGTH}
`);
}
