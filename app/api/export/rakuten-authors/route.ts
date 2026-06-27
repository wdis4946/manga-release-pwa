import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const PAGE_SIZE = 1000;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[Rakuten author export] CRON_SECRET is not configured.");
    return Response.json({ ok: false }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const authors = new Set<string>();
    let offset = 0;
    let scannedRowCount = 0;

    while (true) {
      const { data, error } = await supabase
        .from("rakuten_manga_items")
        .select("isbn, author")
        .not("author", "is", null)
        .order("author")
        .order("isbn")
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      scannedRowCount += data?.length ?? 0;

      for (const row of data ?? []) {
        const author = row.author?.trim();

        if (author) {
          authors.add(author);
        }
      }

      if (!data || data.length < PAGE_SIZE) {
        break;
      }

      offset += PAGE_SIZE;
    }

    const rows = Array.from(authors)
      .sort((left, right) => left.localeCompare(right, "ja"))
      .map(escapeCsvValue);
    const csv = `author\r\n${rows.join("\r\n")}\r\n`;

    console.info("[Rakuten author export] CSV generated.", {
      authorCount: authors.size,
      scannedRowCount,
    });

    return new Response(`\uFEFF${csv}`, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition":
          'attachment; filename="rakuten-manga-authors.csv"',
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("[Rakuten author export] Export failed.", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}

function escapeCsvValue(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}
