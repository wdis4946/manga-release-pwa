# OpenAI Series Summary Batch

漫画シリーズのあらすじを OpenAI Batch API で生成するためのローカル実行手順です。

## 前提

`.env.local` に以下を設定します。

```env
OPENAI_API_KEY=sk-...
OPENAI_SUMMARY_MODEL=gpt-5.5
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

## Server Queue Worker

Web search付きのあらすじ生成はBatchではなく、DBの `series_summary_jobs` にジョブを積んで、サーバAPIを手動で繰り返し叩く方式を推奨します。

### 1. マイグレーションを適用

`supabase/migrations/20260710010000_create_series_summary_jobs.sql` をSupabaseに適用します。

### 2. 対象シリーズをジョブに積む

デフォルトでは、代表画像が未設定かつdescriptionが入っているシリーズを対象にします。

```powershell
npm run series-summary:jobs -- enqueue --limit 5000
```

意味:

- デフォルト: `series.description` が入っているシリーズだけ対象にする
- デフォルト: `series.representative_image_path` が入っているシリーズは除外する
- `--include-undescribed`: descriptionが未設定のシリーズも含める
- `--include-image-set`: 代表画像が設定済みのシリーズも含める

積み直したい場合、未処理/処理中ジョブだけ削除:

```powershell
npm run series-summary:jobs -- clear
```

完了済みやレビュー対象も含めて全削除:

```powershell
npm run series-summary:jobs -- clear --all
```

### 3. 手動で少しずつ処理する

生成されるあらすじは400字程度を目安に、3〜4段落で以下の流れになるようにしています。

- 冒頭に作品全体の要約
- 物語の始まり
- 今後の展開を想像させる内容
- 作品の魅力のまとめ

1回で1件だけ処理:

```powershell
npm run series-summary:jobs -- run --limit 1
```

1分おきに10回実行:

```powershell
npm run series-summary:jobs -- run --limit 1 --repeat 10 --interval-ms 60000
```

DB反映せず、ジョブ結果だけ確認したい場合:

```powershell
npm run series-summary:jobs -- run --limit 1 --dry-run
```

### 4. 進捗確認

```powershell
npm run series-summary:jobs -- status
```

`completed` は `series.description` への反映まで終わった件数です。`needs_review` と `failed` は `series_summary_jobs` の `error_message` を確認してください。

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
