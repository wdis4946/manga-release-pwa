import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const status = searchParams.get("status") ?? "unresolved";
  const queryText = searchParams.get("q")?.trim();
  const from = (page - 1) * PAGE_SIZE;
  const supabase = createSupabaseAdminClient();

  let query = supabase
    .from("series_item_match_issues")
    .select(
      "isbn, normalized_title, issue_type, candidate_count, candidate_series_ids, is_resolved, detected_at",
      { count: "exact" },
    )
    .order("normalized_title", { ascending: true })
    .order("isbn", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  if (status === "resolved") {
    query = query.eq("is_resolved", true);
  } else if (status !== "all") {
    query = query.eq("is_resolved", false);
  }

  if (queryText) {
    query = query.or(
      `isbn.ilike.%${queryText}%,normalized_title.ilike.%${queryText}%`,
    );
  }

  const { data: issueRows, count, error } = await query;

  if (error) {
    console.error("[Admin matching] Failed to load issues.", error);
    return Response.json({ error: "Failed to load issues." }, { status: 500 });
  }

  const isbns = (issueRows ?? []).map((row) => row.isbn);
  const { data: itemRows, error: itemError } =
    isbns.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("rakuten_manga_items")
          .select(
            "isbn, title, normalized_title, author, publisher_name, sales_date, large_image_url, medium_image_url, item_url",
          )
          .in("isbn", isbns);

  if (itemError) {
    console.error("[Admin matching] Failed to load item details.", itemError);
    return Response.json(
      { error: "Failed to load item details." },
      { status: 500 },
    );
  }

  const { data: openBdItemRows, error: openBdItemError } =
    isbns.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("openbd_manga_items")
          .select(
            "isbn, title, normalized_title, author, publisher, publication_date, cover_url",
          )
          .in("isbn", isbns);

  if (openBdItemError) {
    console.error(
      "[Admin matching] Failed to load openBD item details.",
      openBdItemError,
    );
    return Response.json(
      { error: "Failed to load openBD item details." },
      { status: 500 },
    );
  }

  const { data: madbItemRows, error: madbItemError } =
    isbns.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("madb_manga_items")
          .select("isbn, title, normalized_title, authors, publisher")
          .in("isbn", isbns);

  if (madbItemError) {
    console.error(
      "[Admin matching] Failed to load MADB item details.",
      madbItemError,
    );
    return Response.json(
      { error: "Failed to load MADB item details." },
      { status: 500 },
    );
  }

  const itemsByIsbn = new Map(
    (itemRows ?? []).map((item) => [item.isbn, item]),
  );
  const openBdItemsByIsbn = new Map(
    (openBdItemRows ?? []).map((item) => [item.isbn, item]),
  );
  const madbItemsByIsbn = new Map(
    (madbItemRows ?? []).map((item) => [item.isbn, item]),
  );
  const issues = (issueRows ?? []).map((issue) => {
    const item = itemsByIsbn.get(issue.isbn);
    const openBdItem = openBdItemsByIsbn.get(issue.isbn);
    const madbItem = madbItemsByIsbn.get(issue.isbn);

    // Show the first available normalized title for this ISBN.
    const normalizedTitle =
      item?.normalized_title ??
      openBdItem?.normalized_title ??
      madbItem?.normalized_title ??
      issue.normalized_title;

    return {
      isbn: issue.isbn,
      normalizedTitle,
      issueType: issue.issue_type,
      candidateCount: issue.candidate_count,
      candidateSeriesIds: issue.candidate_series_ids,
      isResolved: issue.is_resolved,
      detectedAt: issue.detected_at,
      title:
        item?.title ?? openBdItem?.title ?? madbItem?.title ?? "タイトル不明",
      author: item?.author ?? openBdItem?.author ?? madbItem?.authors ?? null,
      publisherName:
        item?.publisher_name ?? openBdItem?.publisher ?? madbItem?.publisher ?? null,
      salesDate: item?.sales_date ?? openBdItem?.publication_date ?? null,
      coverImageUrl:
        item?.large_image_url ??
        item?.medium_image_url ??
        openBdItem?.cover_url ??
        null,
      itemUrl: item?.item_url ?? null,
    };
  });

  return Response.json({
    issues,
    page,
    pageSize: PAGE_SIZE,
    total: count ?? 0,
  });
}
