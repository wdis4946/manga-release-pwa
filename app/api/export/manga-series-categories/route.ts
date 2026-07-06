import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const PAGE_SIZE = 1000;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error(
      "[Manga series categories export] CRON_SECRET is not configured.",
    );
    return Response.json({ ok: false }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const rows: Record<string, unknown>[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("manga_series_categories")
        .select("*")
        .order("series_id")
        .order("category_number")
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      rows.push(...(data ?? []));

      if (!data || data.length < PAGE_SIZE) {
        break;
      }

      from += PAGE_SIZE;
    }

    const columns = collectColumns(rows);
    const csvLines = [
      columns.map(escapeCsvValue).join(","),
      ...rows.map((row) =>
        columns.map((column) => escapeCsvValue(row[column])).join(","),
      ),
    ];
    const csv = `\uFEFF${csvLines.join("\r\n")}\r\n`;

    console.info("[Manga series categories export] CSV generated.", {
      rowCount: rows.length,
      columnCount: columns.length,
    });

    return new Response(csv, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition":
          'attachment; filename="manga-series-categories.csv"',
        "Content-Type": "text/csv; charset=utf-8",
        "X-Exported-Row-Count": String(rows.length),
      },
    });
  } catch (error) {
    console.error("[Manga series categories export] Export failed.", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  const columns = new Set([
    "series_id",
    "category_number",
    "category_name",
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
