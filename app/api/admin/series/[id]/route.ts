import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const supabase = createSupabaseAdminClient();
  const { data: series, error: seriesError } = await supabase
    .from("manga_series")
    .select("id, title, normalized_title, description")
    .eq("id", id)
    .maybeSingle();

  if (seriesError) {
    return Response.json({ error: seriesError.message }, { status: 500 });
  }

  if (!series) {
    return Response.json({ error: "Series not found." }, { status: 404 });
  }

  const { data: links, error: linksError } = await supabase
    .from("manga_series_items")
    .select("isbn, match_method, matched_at")
    .eq("series_id", id)
    .order("isbn", { ascending: true });

  if (linksError) {
    return Response.json({ error: linksError.message }, { status: 500 });
  }

  const isbns = (links ?? []).map((link) => link.isbn);
  const { data: items, error: itemsError } =
    isbns.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("rakuten_manga_items")
          .select("isbn, title")
          .in("isbn", isbns);

  if (itemsError) {
    return Response.json({ error: itemsError.message }, { status: 500 });
  }

  const { data: details, error: detailsError } =
    isbns.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("rakuten_manga_item_details")
          .select(
            "isbn, author, publisher_name, sales_date, large_image_url, medium_image_url, item_url",
          )
          .in("isbn", isbns);

  if (detailsError) {
    return Response.json({ error: detailsError.message }, { status: 500 });
  }

  const itemsByIsbn = new Map((items ?? []).map((item) => [item.isbn, item]));
  const detailsByIsbn = new Map(
    (details ?? []).map((detail) => [detail.isbn, detail]),
  );
  const linkedItems = (links ?? [])
    .map((link) => {
      const item = itemsByIsbn.get(link.isbn);
      const detail = detailsByIsbn.get(link.isbn);

      return {
        isbn: link.isbn,
        title: item?.title ?? "タイトル不明",
        author: detail?.author ?? null,
        publisherName: detail?.publisher_name ?? null,
        salesDate: detail?.sales_date ?? null,
        coverImageUrl:
          detail?.large_image_url ?? detail?.medium_image_url ?? null,
        itemUrl: detail?.item_url ?? null,
        matchMethod: link.match_method,
        matchedAt: link.matched_at,
      };
    })
    .sort((left, right) =>
      left.title.localeCompare(right.title, "ja", { numeric: true }),
    );

  return Response.json({
    series: {
      id: series.id,
      title: series.title,
      normalizedTitle: series.normalized_title,
      description: series.description,
      itemCount: linkedItems.length,
    },
    items: linkedItems,
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as { title?: string };
  const title = body.title?.trim();

  if (!title) {
    return Response.json({ error: "Title is required." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("manga_series")
    .update({
      title,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, title, normalized_title, description")
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({
    series: {
      id: data.id,
      title: data.title,
      normalizedTitle: data.normalized_title,
      description: data.description,
    },
  });
}
