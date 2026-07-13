import { getAdminUser } from "@/lib/admin/auth";
import { createSeriesCoverUrl } from "@/lib/admin/series-cover-url";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

type AdminSeriesListRow = {
  id: string;
  search_title: string;
  display_title: string;
  description: string | null;
  representative_image_path: string | null;
};

type CreateSeriesRequest = {
  displayTitle?: string;
  searchTitle?: string;
  description?: string | null;
};

async function toSeriesResponse(
  row: AdminSeriesListRow,
  itemCount: number,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
) {
  const representativeImageUrl = await createSeriesCoverUrl(
    supabase,
    row.representative_image_path,
  );

  return {
    id: row.id,
    searchTitle: row.search_title,
    displayTitle: row.display_title,
    description: row.description,
    representativeImagePath: row.representative_image_path,
    representativeImageUrl,
    itemCount,
  };
}

export async function GET(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const queryText = searchParams.get("q")?.trim();
  const isbnText = searchParams.get("isbn")?.trim();
  const imprintText = searchParams.get("imprint")?.trim();
  const publisherText = searchParams.get("publisher")?.trim();
  const agentText = searchParams.get("agent")?.trim();
  const from = (page - 1) * PAGE_SIZE;
  const supabase = createSupabaseAdminClient();
  const hasRelationFilter = Boolean(imprintText || publisherText || agentText);

  if (isbnText) {
    try {
      const seriesIds = await resolveSeriesIdsByIsbn(supabase, isbnText);

      if (seriesIds.length === 0) {
        return Response.json({
          series: [],
          page,
          pageSize: PAGE_SIZE,
          total: 0,
        });
      }

      const rows = await fetchSeriesRowsByIds({ supabase, seriesIds });
      const itemCounts = await countItemsBySeriesId(supabase, rows);
      const responseSeries = await Promise.all(
        rows.map((row) =>
          toSeriesResponse(row, itemCounts.get(row.id) ?? 0, supabase),
        ),
      );

      return Response.json({
        series: responseSeries,
        page,
        pageSize: PAGE_SIZE,
        total: responseSeries.length,
      });
    } catch (error) {
      console.error("[Admin series] Failed to search series by ISBN.", error);
      return Response.json(
        { error: "Failed to search series by ISBN." },
        { status: 500 },
      );
    }
  }

  if (hasRelationFilter) {
    try {
      const filteredSeriesIds = await resolveFilteredSeriesIds({
        supabase,
        imprintText,
        publisherText,
        agentText,
      });

      if (filteredSeriesIds.length === 0) {
        return Response.json({
          series: [],
          page,
          pageSize: PAGE_SIZE,
          total: 0,
        });
      }

      const seriesRows = await fetchSeriesRowsByIds({
        supabase,
        seriesIds: filteredSeriesIds,
        queryText,
      });
      const sortedRows = seriesRows.sort(
        (left, right) =>
          left.display_title.localeCompare(right.display_title, "ja") ||
          left.id.localeCompare(right.id),
      );
      const pageRows = sortedRows.slice(from, from + PAGE_SIZE);
      const itemCounts = await countItemsBySeriesId(supabase, pageRows);

      const responseSeries = await Promise.all(
        pageRows.map((row) =>
          toSeriesResponse(row, itemCounts.get(row.id) ?? 0, supabase),
        ),
      );

      return Response.json({
        series: responseSeries,
        page,
        pageSize: PAGE_SIZE,
        total: sortedRows.length,
      });
    } catch (error) {
      console.error("[Admin series] Failed to filter series.", error);
      return Response.json(
        { error: "Failed to filter series." },
        { status: 500 },
      );
    }
  }

  let query = supabase
    .from("series")
    .select(
      "id, search_title, display_title, description, representative_image_path",
      { count: "exact" },
    )
    .order("display_title", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  if (queryText) {
    query = query.ilike("display_title", `%${queryText}%`);
  }

  const { data: seriesRows, count, error } = await query;

  if (error) {
    console.error("[Admin series] Failed to load series.", error);
    return Response.json({ error: "Failed to load series." }, { status: 500 });
  }

  const rows = (seriesRows ?? []) as unknown as AdminSeriesListRow[];
  let itemCounts: Map<string, number>;

  try {
    itemCounts = await countItemsBySeriesId(supabase, rows);
  } catch (error) {
    console.error("[Admin series] Failed to count linked items.", error);
    return Response.json(
      { error: "Failed to count linked items." },
      { status: 500 },
    );
  }

  const responseSeries = await Promise.all(
    rows.map((row) =>
      toSeriesResponse(row, itemCounts.get(row.id) ?? 0, supabase),
    ),
  );

  return Response.json({
    series: responseSeries,
    page,
    pageSize: PAGE_SIZE,
    total: count ?? 0,
  });
}

export async function POST(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as CreateSeriesRequest;
  const displayTitle = body.displayTitle?.trim();
  const searchTitle = body.searchTitle?.trim() || displayTitle;
  const description = body.description?.trim() || null;

  if (!displayTitle || !searchTitle) {
    return Response.json(
      { error: "Display title is required." },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("series")
    .insert({
      display_title: displayTitle,
      search_title: searchTitle,
      description,
    })
    .select(
      "id, search_title, display_title, description, representative_image_path",
    )
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return Response.json({ error: error.message }, { status });
  }

  const { error: categoryError } = await supabase
    .from("series_categories")
    .insert({
      series_id: data.id,
      category_number: 0,
      category_name: "単行本",
    });

  if (categoryError && categoryError.code !== "23505") {
    console.error("[Admin series] Failed to create default category.", {
      seriesId: data.id,
      error: categoryError,
    });
  }

  return Response.json({
    series: await toSeriesResponse(data as AdminSeriesListRow, 0, supabase),
  });
}

async function resolveFilteredSeriesIds({
  supabase,
  imprintText,
  publisherText,
  agentText,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  imprintText?: string;
  publisherText?: string;
  agentText?: string;
}) {
  const idSets: Set<string>[] = [];

  if (imprintText || publisherText) {
    let publisherQuery = supabase.from("publishers").select("id");

    if (imprintText) {
      publisherQuery = publisherQuery.ilike("imprint_name", `%${imprintText}%`);
    }

    if (publisherText) {
      publisherQuery = publisherQuery.ilike(
        "publisher_name",
        `%${publisherText}%`,
      );
    }

    const { data: publishers, error: publishersError } = await publisherQuery;

    if (publishersError) {
      throw publishersError;
    }

    const publisherIds = (publishers ?? []).map((publisher) => publisher.id);

    if (publisherIds.length === 0) {
      return [];
    }

    const seriesIds = await fetchSeriesIdsFromLinks({
      supabase,
      tableName: "series_publishers",
      filterColumn: "publisher_id",
      filterValues: publisherIds,
    });

    idSets.push(new Set(seriesIds));
  }

  if (agentText) {
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select("id")
      .ilike("name", `%${agentText}%`);

    if (agentsError) {
      throw agentsError;
    }

    const agentIds = (agents ?? []).map((agent) => agent.id);

    if (agentIds.length === 0) {
      return [];
    }

    const seriesIds = await fetchSeriesIdsFromLinks({
      supabase,
      tableName: "series_agents",
      filterColumn: "agent_id",
      filterValues: agentIds,
    });

    idSets.push(new Set(seriesIds));
  }

  if (idSets.length === 0) {
    return [];
  }

  return Array.from(idSets[0]).filter((seriesId) =>
    idSets.every((idSet) => idSet.has(seriesId)),
  );
}

async function fetchSeriesIdsFromLinks({
  supabase,
  tableName,
  filterColumn,
  filterValues,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  tableName: "series_publishers" | "series_agents";
  filterColumn: "publisher_id" | "agent_id";
  filterValues: string[];
}) {
  const seriesIds = new Set<string>();

  for (let index = 0; index < filterValues.length; index += 200) {
    const chunk = filterValues.slice(index, index + 200);
    const { data, error } = await supabase
      .from(tableName)
      .select("series_id")
      .in(filterColumn, chunk);

    if (error) {
      throw error;
    }

    for (const row of data ?? []) {
      seriesIds.add(row.series_id);
    }
  }

  return Array.from(seriesIds);
}

async function resolveSeriesIdsByIsbn(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  isbnText: string,
) {
  const normalizedIsbn = isbnText.replace(/\D/g, "");
  const isbnCandidates = [
    ...new Set([isbnText.trim(), normalizedIsbn].filter(Boolean)),
  ];
  const { data, error } = await supabase
    .from("series_items")
    .select("series_id")
    .in("isbn", isbnCandidates);

  if (error) {
    throw error;
  }

  return [
    ...new Set(
      (data ?? [])
        .map((row) => row.series_id as string | null)
        .filter((seriesId): seriesId is string => Boolean(seriesId)),
    ),
  ];
}

async function fetchSeriesRowsByIds({
  supabase,
  seriesIds,
  queryText,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  seriesIds: string[];
  queryText?: string;
}) {
  const rows: AdminSeriesListRow[] = [];

  for (let index = 0; index < seriesIds.length; index += 200) {
    const chunk = seriesIds.slice(index, index + 200);
    let query = supabase
      .from("series")
      .select(
        "id, search_title, display_title, description, representative_image_path",
      )
      .in("id", chunk);

    if (queryText) {
      query = query.ilike("display_title", `%${queryText}%`);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    rows.push(...((data ?? []) as AdminSeriesListRow[]));
  }

  return rows;
}

async function countItemsBySeriesId(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: AdminSeriesListRow[],
) {
  const itemCounts = new Map<string, number>();
  const seriesIds = rows.map((series) => series.id);

  if (seriesIds.length === 0) {
    return itemCounts;
  }

  const { data: linkRows, error: linkError } = await supabase
    .from("series_items")
    .select("series_id")
    .in("series_id", seriesIds);

  if (linkError) {
    throw linkError;
  }

  for (const link of linkRows ?? []) {
    itemCounts.set(link.series_id, (itemCounts.get(link.series_id) ?? 0) + 1);
  }

  return itemCounts;
}
