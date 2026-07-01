import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
export const runtime = "nodejs";

const CONFIRMATION = "REBUILD_PUBLIC_SCHEMA";
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 500 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  if (process.env.ALLOW_DATABASE_REBUILD !== "true") {
    return Response.json(
      { ok: false, error: "Database rebuild is disabled." },
      { status: 403 },
    );
  }

  if (request.headers.get("x-confirm-rebuild") !== CONFIRMATION) {
    return Response.json(
      { ok: false, error: "Rebuild confirmation is missing." },
      { status: 400 },
    );
  }

  const expectedSeriesCount = Number(
    request.headers.get("x-expected-series-count"),
  );

  if (!Number.isSafeInteger(expectedSeriesCount) || expectedSeriesCount <= 0) {
    return Response.json(
      { ok: false, error: "A positive expected series count is required." },
      { status: 400 },
    );
  }

  const connectionString = process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    return Response.json(
      { ok: false, error: "SUPABASE_DB_URL is not configured." },
      { status: 500 },
    );
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  let stage = "read-migration";

  try {
    const migrationSql = (
      await Promise.all([
        readFile(
          path.join(
            process.cwd(),
            "supabase/migrations/20260629020000_create_initial_schema.sql",
          ),
          "utf8",
        ),
        readFile(
          path.join(
            process.cwd(),
            "supabase/migrations/20260629030000_rename_madb_series_titles.sql",
          ),
          "utf8",
        ),
        readFile(
          path.join(
            process.cwd(),
            "supabase/migrations/20260630010000_merge_rakuten_manga_item_details.sql",
          ),
          "utf8",
        ),
        readFile(
          path.join(
            process.cwd(),
            "supabase/migrations/20260630020000_create_madb_manga_series.sql",
          ),
          "utf8",
        ),
        readFile(
          path.join(
            process.cwd(),
            "supabase/migrations/20260630030000_create_wiki_manga_series.sql",
          ),
          "utf8",
        ),
        readFile(
          path.join(
            process.cwd(),
            "supabase/migrations/20260630040000_rebuild_manga_series_for_search.sql",
          ),
          "utf8",
        ),
        readFile(
          path.join(
            process.cwd(),
            "supabase/migrations/20260701010000_create_madb_manga_items.sql",
          ),
          "utf8",
        ),
        readFile(
          path.join(
            process.cwd(),
            "supabase/migrations/20260701030000_link_wiki_manga_items.sql",
          ),
          "utf8",
        ),
      ])
    ).join("\n\n");

    stage = "connect";
    await client.connect();
    stage = "verify-backup-count";
    const countResult = await client.query<{ count: string }>(
      "select count(*)::text as count from public.manga_series",
    );
    const actualSeriesCount = Number(countResult.rows[0]?.count);

    if (actualSeriesCount !== expectedSeriesCount) {
      return Response.json(
        {
          ok: false,
          error: "The current series count does not match the CSV backup.",
          expectedSeriesCount,
          actualSeriesCount,
        },
        { status: 409 },
      );
    }

    stage = "begin-transaction";
    await client.query("begin");
    stage = "apply-schema";
    await client.query(migrationSql);

    stage = "verify-rebuilt-schema";
    const verification = await client.query<{
      series_count: string;
      genre_count: string;
      search_title_count: string;
    }>(`
      select
        (select count(*)::text from public.manga_series) as series_count,
        (
          select count(*)::text
          from public.rakuten_import_genres
          where genre_id = '001001'
        ) as genre_count,
        (
          select count(*)::text
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'manga_series'
            and column_name = 'search_title'
        ) as search_title_count
    `);
    const rebuiltState = verification.rows[0];

    if (
      rebuiltState?.series_count !== "0" ||
      rebuiltState?.genre_count !== "1" ||
      rebuiltState?.search_title_count !== "1"
    ) {
      throw new Error("Rebuilt schema verification failed.");
    }

    stage = "commit";
    await client.query("commit");

    return Response.json({
      ok: true,
      previousSeriesCount: actualSeriesCount,
      currentSeriesCount: 0,
      comicRootGenreCreated: true,
    });
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // The connection may have failed before a transaction was opened.
    }

    console.error("[Database rebuild] Failed.", error);
    const details = getErrorDetails(error);
    return Response.json(
      {
        ok: false,
        error: "Database rebuild failed.",
        stage,
        ...details,
      },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

function getErrorDetails(error: unknown): {
  code?: string;
  message: string;
} {
  if (!(error instanceof Error)) {
    return { message: "Unknown error." };
  }

  const code =
    "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;

  return {
    code,
    message: error.message,
  };
}
