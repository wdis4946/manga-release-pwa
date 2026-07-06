import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const ISSUE_PAGE_SIZE = 1000;
const ISBN_LOOKUP_SIZE = 200;

type IssueRow = {
  isbn: string;
  normalized_title: string | null;
};

type NormalizedTitleRow = {
  isbn: string;
  normalized_title: string | null;
};

type ExportRow = {
  isbn: string;
  issueNormalizedTitle: string;
  rakutenNormalizedTitle: string;
  openBdNormalizedTitle: string;
  madbNormalizedTitle: string;
};

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error(
      "[Unresolved match issue export] CRON_SECRET is not configured.",
    );
    return Response.json({ ok: false }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const rows: ExportRow[] = [];
    let lastIsbn: string | undefined;

    while (true) {
      let issueQuery = supabase
        .from("manga_series_item_match_issues")
        .select("isbn, normalized_title")
        .eq("is_resolved", false)
        .order("isbn")
        .limit(ISSUE_PAGE_SIZE);

      if (lastIsbn) {
        issueQuery = issueQuery.gt("isbn", lastIsbn);
      }

      const { data: issues, error: issueError } = await issueQuery;

      if (issueError) {
        throw issueError;
      }

      if (!issues || issues.length === 0) {
        break;
      }

      const issueRows = issues as IssueRow[];
      const isbns = issueRows.map((issue) => issue.isbn);
      const [rakutenTitles, openBdTitles, madbTitles] = await Promise.all([
        fetchNormalizedTitles("rakuten_manga_items", isbns),
        fetchNormalizedTitles("openbd_manga_items", isbns),
        fetchNormalizedTitles("madb_manga_items", isbns),
      ]);

      for (const issue of issueRows) {
        rows.push({
          isbn: issue.isbn,
          issueNormalizedTitle: issue.normalized_title ?? "",
          rakutenNormalizedTitle: rakutenTitles.get(issue.isbn) ?? "",
          openBdNormalizedTitle: openBdTitles.get(issue.isbn) ?? "",
          madbNormalizedTitle: madbTitles.get(issue.isbn) ?? "",
        });
      }

      if (issueRows.length < ISSUE_PAGE_SIZE) {
        break;
      }

      lastIsbn = issueRows.at(-1)?.isbn;

      if (!lastIsbn) {
        break;
      }
    }

    const csvLines = [
      [
        "isbn",
        "issue_normalized_title",
        "rakuten_normalized_title",
        "openbd_normalized_title",
        "madb_normalized_title",
      ].join(","),
      ...rows.map((row) =>
        [
          row.isbn,
          row.issueNormalizedTitle,
          row.rakutenNormalizedTitle,
          row.openBdNormalizedTitle,
          row.madbNormalizedTitle,
        ]
          .map(escapeCsvValue)
          .join(","),
      ),
    ];
    const csv = `\uFEFF${csvLines.join("\r\n")}\r\n`;

    console.info("[Unresolved match issue export] CSV generated.", {
      rowCount: rows.length,
    });

    return new Response(csv, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition":
          'attachment; filename="unresolved-match-issues.csv"',
        "Content-Type": "text/csv; charset=utf-8",
        "X-Exported-Row-Count": String(rows.length),
      },
    });
  } catch (error) {
    console.error("[Unresolved match issue export] Export failed.", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}

async function fetchNormalizedTitles(
  tableName: "rakuten_manga_items" | "openbd_manga_items" | "madb_manga_items",
  isbns: string[],
): Promise<Map<string, string>> {
  const supabase = createSupabaseAdminClient();
  const titles = new Map<string, string>();

  for (let index = 0; index < isbns.length; index += ISBN_LOOKUP_SIZE) {
    const isbnChunk = isbns.slice(index, index + ISBN_LOOKUP_SIZE);
    const { data, error } = await supabase
      .from(tableName)
      .select("isbn, normalized_title")
      .in("isbn", isbnChunk);

    if (error) {
      throw error;
    }

    for (const row of (data ?? []) as NormalizedTitleRow[]) {
      titles.set(row.isbn, row.normalized_title ?? "");
    }
  }

  return titles;
}

function escapeCsvValue(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}
