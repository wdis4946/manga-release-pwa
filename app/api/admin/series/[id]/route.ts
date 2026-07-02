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
    .select("id, search_title, display_title, category_number, category_name")
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
            "isbn, title, normalized_title, author, publisher_name, sales_date, large_image_url, medium_image_url, item_url",
          )
          .in("isbn", isbns);

  if (itemsError) {
    return Response.json({ error: itemsError.message }, { status: 500 });
  }

  const { data: openBdItems, error: openBdItemsError } =
    isbns.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("openbd_manga_items")
          .select(
            "isbn, title, normalized_title, author, publisher, publication_date, cover_url",
          )
          .in("isbn", isbns);

  if (openBdItemsError) {
    return Response.json({ error: openBdItemsError.message }, { status: 500 });
  }

  const { data: madbItems, error: madbItemsError } =
    isbns.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("madb_manga_items")
          .select("isbn, title, normalized_title, authors, publisher")
          .in("isbn", isbns);

  if (madbItemsError) {
    return Response.json({ error: madbItemsError.message }, { status: 500 });
  }

  const itemsByIsbn = new Map((items ?? []).map((item) => [item.isbn, item]));
  const openBdItemsByIsbn = new Map(
    (openBdItems ?? []).map((item) => [item.isbn, item]),
  );
  const madbItemsByIsbn = new Map(
    (madbItems ?? []).map((item) => [item.isbn, item]),
  );
  const linkedItems = (links ?? [])
    .map((link) => {
      const item = itemsByIsbn.get(link.isbn);
      const openBdItem = openBdItemsByIsbn.get(link.isbn);
      const madbItem = madbItemsByIsbn.get(link.isbn);

      return {
        isbn: link.isbn,
        title:
          item?.title ??
          openBdItem?.title ??
          madbItem?.title ??
          "タイトル不明",
        normalizedTitle:
          item?.normalized_title ??
          openBdItem?.normalized_title ??
          madbItem?.normalized_title ??
          null,
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
        matchMethod: link.match_method,
        matchedAt: link.matched_at,
      };
    })
    .sort((left, right) => left.isbn.localeCompare(right.isbn));

  return Response.json({
    series: {
      id: series.id,
      searchTitle: series.search_title,
      displayTitle: series.display_title,
      categoryNumber: series.category_number,
      categoryName: series.category_name,
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
  const body = (await request.json()) as {
    displayTitle?: string;
    searchTitle?: string;
    categoryNumber?: number;
    categoryName?: string;
  };
  const displayTitle = body.displayTitle?.trim();
  const searchTitle = body.searchTitle?.trim();
  const categoryName = body.categoryName?.trim();
  const updates: {
    display_title?: string;
    search_title?: string;
    category_number?: number;
    category_name?: string;
    updated_at: string;
  } = {
    updated_at: new Date().toISOString(),
  };

  if (body.displayTitle !== undefined && !displayTitle) {
    return Response.json(
      { error: "Display title is required." },
      { status: 400 },
    );
  }

  if (body.searchTitle !== undefined && !searchTitle) {
    return Response.json(
      { error: "Search title is required." },
      { status: 400 },
    );
  }

  if (
    body.categoryNumber !== undefined &&
    (!Number.isInteger(body.categoryNumber) || body.categoryNumber < 0)
  ) {
    return Response.json(
      { error: "Category number must be a non-negative integer." },
      { status: 400 },
    );
  }

  if (body.categoryName !== undefined && !categoryName) {
    return Response.json(
      { error: "Category name is required." },
      { status: 400 },
    );
  }

  if (displayTitle) {
    updates.display_title = displayTitle;
  }

  if (searchTitle) {
    updates.search_title = searchTitle;
  }

  if (body.categoryNumber !== undefined) {
    updates.category_number = body.categoryNumber;
  }

  if (categoryName) {
    updates.category_name = categoryName;
  }

  if (
    !updates.display_title &&
    !updates.search_title &&
    updates.category_number === undefined &&
    !updates.category_name
  ) {
    return Response.json(
      { error: "At least one series field is required." },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("manga_series")
    .update(updates)
    .eq("id", id)
    .select("id, search_title, display_title, category_number, category_name")
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
      categoryNumber: data.category_number,
      categoryName: data.category_name,
    },
  });
}
