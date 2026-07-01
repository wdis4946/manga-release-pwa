import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const PAGE_SIZE = 1000;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[Manga series export] CRON_SECRET is not configured.");
    return Response.json({ ok: false }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const rows: Record<string, unknown>[] = [];
    let lastId: string | undefined;

    while (true) {
      let query = supabase
        .from("manga_series")
        .select("*")
        .order("id")
        .limit(PAGE_SIZE);

      if (lastId) {
        query = query.gt("id", lastId);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      rows.push(...(data ?? []));

      if (!data || data.length < PAGE_SIZE) {
        break;
      }

      lastId = data.at(-1)?.id;

      if (!lastId) {
        break;
      }
    }

    const columns = collectColumns(rows);
    const csvLines = [
      columns.map(escapeCsvValue).join(","),
      ...rows.map((row) =>
        columns.map((column) => escapeCsvValue(row[column])).join(","),
      ),
    ];
    const csv = `\uFEFF${csvLines.join("\r\n")}\r\n`;

    console.info("[Manga series export] CSV generated.", {
      rowCount: rows.length,
      columnCount: columns.length,
    });

    return new Response(csv, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="manga-series.csv"',
        "Content-Type": "text/csv; charset=utf-8",
        "X-Exported-Row-Count": String(rows.length),
      },
    });
  } catch (error) {
    console.error("[Manga series export] Export failed.", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  const columns = new Set([
    "id",
    "search_title",
    "display_title",
    "created_at",
    "updated_at",
  ]);

  for (const row of rows) {
    for (const column of Object.keys(row)) {
      columns.add(column);
    }
  }

  return Array.from(columns);
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = typeof value === "object" ? JSON.stringify(value) : String(value);

  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}
