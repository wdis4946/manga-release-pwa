# OpenAI Series Summary Batch

漫画シリーズのあらすじを OpenAI Batch API で生成するためのローカル実行手順です。

## 前提

`.env.local` に以下を設定します。

```env
OPENAI_API_KEY=sk-...
OPENAI_SUMMARY_MODEL=gpt-4.1
OPENAI_WEB_SEARCH_TOOL_TYPE=web_search_preview
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
```

`OPENAI_SUMMARY_MODEL` は必要に応じて変更できます。
Web検索ツール名でエラーになる場合は、利用中のAPI環境に合わせて `OPENAI_WEB_SEARCH_TOOL_TYPE` を変更してください。

## 1. まず50件だけ入力JSONLを作る

デフォルトでは `series.description` が `null` または空文字のシリーズだけを対象にします。

```powershell
npm run series-summary:batch -- create-input --limit 50
```

Default target filter:

- `series.description` is null or empty
- `series.representative_image_path` is null

生成先:

```text
data/openai-series-summary-batches/series-summary-input-YYYYMMDDHHmmss.jsonl
```

既にあらすじがあるシリーズも含めたい場合:

```powershell
npm run series-summary:batch -- create-input --limit 50 --include-described
```

To include series that already have `representative_image_path`:

```powershell
npm run series-summary:batch -- create-input --limit 50 --include-image-set
```

## 2. Batchを投入する

```powershell
npm run series-summary:batch -- submit --input data/openai-series-summary-batches/series-summary-input-YYYYMMDDHHmmss.jsonl
```

出力された `batchId` を控えます。

## 3. 状態確認

```powershell
npm run series-summary:batch -- status --batch batch_xxx
```

`status` が `completed` になったら結果を取得できます。

## 4. 結果をダウンロードする

```powershell
npm run series-summary:batch -- download --batch batch_xxx
```

生成先:

```text
data/openai-series-summary-batches/series-summary-output-batch_xxx-YYYYMMDDHHmmss.jsonl
data/openai-series-summary-batches/series-summary-errors-batch_xxx-YYYYMMDDHHmmss.jsonl
```

## 5. 結果を検証する

まずは `--apply` を付けずに dry-run します。

```powershell
npm run series-summary:batch -- import --input data/openai-series-summary-batches/series-summary-output-batch_xxx-YYYYMMDDHHmmss.jsonl
```

この時点ではDB更新しません。

出力:

```text
series-summary-accepted-YYYYMMDDHHmmss.jsonl
series-summary-review-YYYYMMDDHHmmss.csv
```

採用条件:

- JSONとして読める
- `id`, `title`, `summary`, `confidence`, `needs_review`, `notes`, `source_urls` がある
- `needs_review=false`
- `confidence` が `high` または `medium`
- `source_urls` が空でない
- `summary` が短すぎない

`low` も採用したい場合:

```powershell
npm run series-summary:batch -- import --input data/openai-series-summary-batches/series-summary-output-batch_xxx-YYYYMMDDHHmmss.jsonl --accept-low-confidence
```

## 6. DBへ反映する

検証結果に問題がなければ `--apply` を付けます。

```powershell
npm run series-summary:batch -- import --input data/openai-series-summary-batches/series-summary-output-batch_xxx-YYYYMMDDHHmmss.jsonl --apply
```

更新先:

```sql
public.series.description
```

## 7. 本番件数へ広げる

50件で品質を確認してから、500件、5000件へ広げます。

```powershell
npm run series-summary:batch -- create-input --limit 500 --offset 0
npm run series-summary:batch -- create-input --limit 500 --offset 500
```

## 注意

Web検索込みの生成は、通常のテキスト生成より時間・コスト・失敗率が上がります。
`review` CSVを必ず確認し、`needs_review=true` や `confidence=low` のものは自動反映しない運用を推奨します。

## サーバ側で実行する場合

ローカルからSupabase DBへ接続できない場合は、管理APIからサーバ側で実行できます。

前提:

- Vercel/サーバ環境変数に `OPENAI_API_KEY` を設定
- Vercel/サーバ環境変数に `CRON_SECRET` を設定
- Vercel/サーバ環境変数に `NEXT_PUBLIC_SUPABASE_URL` と `SUPABASE_SECRET_KEY` を設定

### Batch投入

```powershell
$body = @{
  limit = 50
  offset = 0
  includeDescribed = $false
  includeImageSet = $false
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://manga-release-pwa.vercel.app/api/admin/series-summary-batch?mode=submit" `
  -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } `
  -ContentType "application/json" `
  -Body $body
```

戻り値の `batchId` を控えます。

### 状態確認

```powershell
$body = @{ batchId = "batch_xxx" } | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://manga-release-pwa.vercel.app/api/admin/series-summary-batch?mode=status" `
  -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } `
  -ContentType "application/json" `
  -Body $body
```

### 結果検証だけ行う

`apply = $false` ならDB更新しません。

```powershell
$body = @{
  batchId = "batch_xxx"
  apply = $false
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://manga-release-pwa.vercel.app/api/admin/series-summary-batch?mode=import" `
  -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } `
  -ContentType "application/json" `
  -Body $body
```

### DBへ反映する

```powershell
$body = @{
  batchId = "batch_xxx"
  apply = $true
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://manga-release-pwa.vercel.app/api/admin/series-summary-batch?mode=import" `
  -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } `
  -ContentType "application/json" `
  -Body $body
```
