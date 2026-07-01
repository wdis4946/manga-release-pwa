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
    .select("id, search_title, display_title")
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
          .select(
            "isbn, title, author, publisher_name, sales_date, large_image_url, medium_image_url, item_url",
          )
          .in("isbn", isbns);

  if (itemsError) {
    return Response.json({ error: itemsError.message }, { status: 500 });
  }

  const { data: madbItems, error: madbItemsError } =
    isbns.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("madb_manga_items")
          .select("isbn, title, authors, publisher")
          .in("isbn", isbns);

  if (madbItemsError) {
    return Response.json({ error: madbItemsError.message }, { status: 500 });
  }

  const itemsByIsbn = new Map((items ?? []).map((item) => [item.isbn, item]));
  const madbItemsByIsbn = new Map(
    (madbItems ?? []).map((item) => [item.isbn, item]),
  );
  const linkedItems = (links ?? [])
    .map((link) => {
      const item = itemsByIsbn.get(link.isbn);
      const madbItem = madbItemsByIsbn.get(link.isbn);

      return {
        isbn: link.isbn,
        title: item?.title ?? madbItem?.title ?? "タイトル不明",
        author: item?.author ?? madbItem?.authors ?? null,
        publisherName:
          item?.publisher_name ?? madbItem?.publisher ?? null,
        salesDate: item?.sales_date ?? null,
        coverImageUrl:
          item?.large_image_url ?? item?.medium_image_url ?? null,
        itemUrl: item?.item_url ?? null,
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
      searchTitle: series.search_title,
      displayTitle: series.display_title,
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
  const body = (await request.json()) as { displayTitle?: string };
  const displayTitle = body.displayTitle?.trim();

  if (!displayTitle) {
    return Response.json(
      { error: "Display title is required." },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("manga_series")
    .update({
      display_title: displayTitle,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, search_title, display_title")
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({
    series: {
      id: data.id,
      searchTitle: data.search_title,
      displayTitle: data.display_title,
    },
  });
}
