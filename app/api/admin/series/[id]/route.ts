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
    .from("series")
    .select(
      "id, search_title, display_title, description, representative_image_path",
    )
    .eq("id", id)
    .maybeSingle();

  if (seriesError) {
    return Response.json({ error: seriesError.message }, { status: 500 });
  }

  if (!series) {
    return Response.json({ error: "Series not found." }, { status: 404 });
  }

  const representativeImageUrl = series.representative_image_path
    ? supabase.storage
        .from("series-covers")
        .getPublicUrl(series.representative_image_path).data.publicUrl
    : null;

  const { data: links, error: linksError } = await supabase
    .from("series_items")
    .select("isbn, match_method, matched_at, category_number, display_order")
    .eq("series_id", id)
    .order("category_number", { ascending: true })
    .order("display_order", { ascending: true })
    .order("isbn", { ascending: true });

  if (linksError) {
    return Response.json({ error: linksError.message }, { status: 500 });
  }

  const { data: categories, error: categoriesError } = await supabase
    .from("series_categories")
    .select("category_number, category_name")
    .eq("series_id", id)
    .order("category_number", { ascending: true });

  if (categoriesError) {
    return Response.json({ error: categoriesError.message }, { status: 500 });
  }

  const { data: genreLinks, error: genreLinksError } = await supabase
    .from("series_genres")
    .select("genre_id")
    .eq("series_id", id)
    .order("genre_id", { ascending: true });

  if (genreLinksError) {
    return Response.json({ error: genreLinksError.message }, { status: 500 });
  }

  const genreIds = (genreLinks ?? []).map((genre) => genre.genre_id);
  const genreNamesById = new Map<string, string>();

  if (genreIds.length > 0) {
    const { data: genreRows, error: genreRowsError } = await supabase
      .from("genres")
      .select("id, name")
      .in("id", genreIds);

    if (!genreRowsError) {
      for (const genre of genreRows ?? []) {
        genreNamesById.set(genre.id, genre.name);
      }
    }
  }

  const { data: publisherLinks, error: publisherLinksError } = await supabase
    .from("series_publishers")
    .select("publisher_id")
    .eq("series_id", id)
    .order("publisher_id", { ascending: true });

  if (publisherLinksError) {
    return Response.json(
      { error: publisherLinksError.message },
      { status: 500 },
    );
  }

  const publisherIds = (publisherLinks ?? []).map(
    (publisher) => publisher.publisher_id,
  );
  const publishersById = new Map<
    string,
    { id: string; imprint_name: string; publisher_name: string }
  >();

  if (publisherIds.length > 0) {
    const { data: publisherRows, error: publisherRowsError } = await supabase
      .from("publishers")
      .select("id, imprint_name, publisher_name")
      .in("id", publisherIds);

    if (publisherRowsError) {
      return Response.json(
        { error: publisherRowsError.message },
        { status: 500 },
      );
    }

    for (const publisher of publisherRows ?? []) {
      publishersById.set(publisher.id, publisher);
    }
  }

  const { data: seriesAgentLinks, error: seriesAgentLinksError } =
    await supabase
      .from("series_agents")
      .select("agent_id, sort_order")
      .eq("series_id", id)
      .order("sort_order", { ascending: true })
      .order("agent_id", { ascending: true });

  if (seriesAgentLinksError) {
    return Response.json(
      { error: seriesAgentLinksError.message },
      { status: 500 },
    );
  }

  const agentIds = (seriesAgentLinks ?? []).map((link) => link.agent_id);
  const { data: agents, error: agentsError } =
    agentIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("agents")
          .select("id, name, author_wiki_link")
          .in("id", agentIds);

  if (agentsError) {
    return Response.json({ error: agentsError.message }, { status: 500 });
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
  const agentsById = new Map((agents ?? []).map((agent) => [agent.id, agent]));
  const itemCountsByCategory = new Map<number, number>();
  for (const link of links ?? []) {
    itemCountsByCategory.set(
      link.category_number,
      (itemCountsByCategory.get(link.category_number) ?? 0) + 1,
    );
  }
  const categoryNamesByNumber = new Map(
    (categories ?? []).map((category) => [
      category.category_number,
      category.category_name,
    ]),
  );
  const responseCategories = (categories ?? []).map((category) => ({
    categoryNumber: category.category_number,
    categoryName: category.category_name,
    itemCount: itemCountsByCategory.get(category.category_number) ?? 0,
  }));
  const linkedItems = (links ?? [])
    .map((link) => {
      const item = itemsByIsbn.get(link.isbn);
      const openBdItem = openBdItemsByIsbn.get(link.isbn);
      const madbItem = madbItemsByIsbn.get(link.isbn);

      return {
        isbn: link.isbn,
        categoryNumber: link.category_number,
        categoryName:
          categoryNamesByNumber.get(link.category_number) ?? "default",
        displayOrder: link.display_order,
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
    .sort(
      (left, right) =>
        left.categoryNumber - right.categoryNumber ||
        left.displayOrder - right.displayOrder ||
        left.isbn.localeCompare(right.isbn),
    );
  const responseAgents = (seriesAgentLinks ?? []).map((link) => {
    const agent = agentsById.get(link.agent_id);

    return {
      agentId: link.agent_id,
      agentName: agent?.name ?? "作者名未設定",
      authorWikiLink: agent?.author_wiki_link ?? null,
      sortOrder: link.sort_order,
    };
  });

  return Response.json({
    series: {
      id: series.id,
      searchTitle: series.search_title,
      displayTitle: series.display_title,
      description: series.description,
      representativeImagePath: series.representative_image_path,
      representativeImageUrl,
      itemCount: linkedItems.length,
    },
    categories: responseCategories,
    genres: (genreLinks ?? []).map((genre) => ({
      genreId: genre.genre_id,
      genreName: genreNamesById.get(genre.genre_id) ?? null,
    })),
    publishers: (publisherLinks ?? [])
      .map((publisher) => {
        const publisherRow = publishersById.get(publisher.publisher_id);

        return publisherRow
          ? {
              publisherId: publisher.publisher_id,
              imprintName: publisherRow.imprint_name,
              publisherName: publisherRow.publisher_name,
            }
          : null;
      })
      .filter((publisher) => publisher !== null),
    agents: responseAgents,
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
    description?: string | null;
  };
  const displayTitle = body.displayTitle?.trim();
  const searchTitle = body.searchTitle?.trim();
  const description =
    body.description === undefined ? undefined : body.description?.trim() || null;
  const updates: {
    display_title?: string;
    search_title?: string;
    description?: string | null;
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

  if (displayTitle) {
    updates.display_title = displayTitle;
  }

  if (searchTitle) {
    updates.search_title = searchTitle;
  }

  if (body.description !== undefined) {
    updates.description = description;
  }

  if (
    !updates.display_title &&
    !updates.search_title &&
    body.description === undefined
  ) {
    return Response.json(
      { error: "Display title, search title, or description is required." },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("series")
    .update(updates)
    .eq("id", id)
    .select("id, search_title, display_title, description")
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
      description: data.description,
    },
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const { error } = await createSupabaseAdminClient()
    .from("series")
    .delete()
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
