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
    .from("manga_series_item_match_issues")
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
          .select("isbn, title")
          .in("isbn", isbns);

  if (itemError) {
    console.error("[Admin matching] Failed to load item details.", itemError);
    return Response.json(
      { error: "Failed to load item details." },
      { status: 500 },
    );
  }

  const { data: detailRows, error: detailError } =
    isbns.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("rakuten_manga_item_details")
          .select(
            "isbn, author, publisher_name, sales_date, large_image_url, medium_image_url, item_url",
          )
          .in("isbn", isbns);

  if (detailError) {
    console.error("[Admin matching] Failed to load item details.", detailError);
    return Response.json(
      { error: "Failed to load item details." },
      { status: 500 },
    );
  }

  const itemsByIsbn = new Map(
    (itemRows ?? []).map((item) => [item.isbn, item]),
  );
  const detailsByIsbn = new Map(
    (detailRows ?? []).map((detail) => [detail.isbn, detail]),
  );
  const issues = (issueRows ?? []).map((issue) => {
    const item = itemsByIsbn.get(issue.isbn);
    const detail = detailsByIsbn.get(issue.isbn);

    return {
      isbn: issue.isbn,
      normalizedTitle: issue.normalized_title,
      issueType: issue.issue_type,
      candidateCount: issue.candidate_count,
      candidateSeriesIds: issue.candidate_series_ids,
      isResolved: issue.is_resolved,
      detectedAt: issue.detected_at,
      // Keep the original Rakuten title separate from the normalized matching key.
      title: item?.title ?? "タイトル不明",
      author: detail?.author ?? null,
      publisherName: detail?.publisher_name ?? null,
      salesDate: detail?.sales_date ?? null,
      coverImageUrl:
        detail?.large_image_url ?? detail?.medium_image_url ?? null,
      itemUrl: detail?.item_url ?? null,
    };
  });

  return Response.json({
    issues,
    page,
    pageSize: PAGE_SIZE,
    total: count ?? 0,
  });
}
