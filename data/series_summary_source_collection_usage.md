# Series Summary Source Collection

OpenAIのWeb検索に毎回任せず、先に情報ソースをDBへ保存してから、保存済みソースだけを使ってあらすじを生成する運用です。

## 必要なDBマイグレーション

Supabase SQL Editorで以下を適用します。

```text
supabase/migrations/20260710020000_create_series_summary_sources.sql
```

## 必要な環境変数

既存のジョブ実行に必要なもの:

```env
CRON_SECRET=...
OPENAI_API_KEY=...
OPENAI_SUMMARY_MODEL=gpt-5.5
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
```

自前クロールで候補URLも自動収集する場合:

```env
SOURCE_SEARCH_PROVIDER=crawler
```

`crawler` は検索APIを使わず、`series_items` のISBNと出版社サイトの既知URL規則、出版社サイト内検索ページから公式・出版社URLを探します。

Google Custom Searchで候補URLを自動収集する旧方式:

```env
SOURCE_SEARCH_PROVIDER=google
GOOGLE_SEARCH_API_KEY=...
GOOGLE_SEARCH_ENGINE_ID=...
```

検索・クロールを行わず、すでにDBへ取り込まれているURLだけをfetchする場合:

```env
SOURCE_SEARCH_PROVIDER=none
```

## 1. 既存source_urlsを取り込む

Supabaseから出した `series_id` と `source_urls` を含むCSVを使います。

```powershell
node scripts/series-summary-jobs.mjs import-source-urls `
  --input "data/Supabase Snippet Untitled query.csv"
```

取り込みと同時に本文取得まで行う場合:

```powershell
node scripts/series-summary-jobs.mjs import-source-urls `
  --input "data/Supabase Snippet Untitled query.csv" `
  --fetch
```

## 2. ソース本文を収集する

CSVから取り込んだURLだけをfetchする場合:

```powershell
node scripts/series-summary-jobs.mjs collect-sources --limit 20 --no-search
```

自前クロールで候補URLを増やす場合:

```powershell
node scripts/series-summary-jobs.mjs collect-sources --limit 20
```

Google Custom Searchを使う場合は、`SOURCE_SEARCH_PROVIDER=google` と `GOOGLE_SEARCH_API_KEY` / `GOOGLE_SEARCH_ENGINE_ID` を設定します。

再取得したい場合:

```powershell
node scripts/series-summary-jobs.mjs collect-sources --limit 20 --refetch
```

## 3. あらすじ生成

対象シリーズをジョブへ積みます。`completed` は履歴として残し、`completed` 以外のジョブ数が `--limit` 件になるように不足分だけ追加します。

```powershell
node scripts/series-summary-jobs.mjs enqueue --limit 100
```

デフォルトでは保存済みソースだけを使い、OpenAIのWeb検索は使いません。

```powershell
node scripts/series-summary-jobs.mjs run --limit 1
```

保存済みソースがない場合だけOpenAI Web検索へ逃がしたい場合:

```powershell
node scripts/series-summary-jobs.mjs run --limit 1 --allow-web-search-fallback
```

## 保存先

収集したソース:

```text
public.series_summary_sources
```

生成結果:

```text
public.series_summary_jobs
public.series.description
```
