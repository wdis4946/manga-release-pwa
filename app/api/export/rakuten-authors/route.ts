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
    const authors = new Map<string, string>();
    let lastIsbn: string | undefined;
    let scannedRowCount = 0;

    while (true) {
      let query = supabase
        .from("rakuten_manga_item_details")
        .select("isbn, author, author_kana")
        .order("isbn")
        .limit(PAGE_SIZE);

      // Keyset pagination uses the indexed ISBN primary key and avoids the
      // increasingly expensive OFFSET and full author sort on every page.
      if (lastIsbn) {
        query = query.gt("isbn", lastIsbn);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      scannedRowCount += data?.length ?? 0;

      for (const row of data ?? []) {
        const author = row.author?.trim();
        const authorKana = row.author_kana?.trim() ?? "";

        if (author) {
          const currentKana = authors.get(author);

          if (currentKana === undefined || (!currentKana && authorKana)) {
            authors.set(author, authorKana);
          }
        }
      }

      if (!data || data.length < PAGE_SIZE) {
        break;
      }

      lastIsbn = data.at(-1)?.isbn;

      if (!lastIsbn) {
        break;
      }
    }

    const rows = Array.from(authors)
      .sort(([left], [right]) => left.localeCompare(right, "ja"))
      .map(
        ([author, authorKana]) =>
          `${escapeCsvValue(author)},${escapeCsvValue(authorKana)}`,
      );
    const csv = `author,author_kana\r\n${rows.join("\r\n")}\r\n`;

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
