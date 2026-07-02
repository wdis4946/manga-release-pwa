import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type SimilarSeriesRow = {
  id: string;
  search_title: string;
  display_title: string;
  similarity_score: number;
};

export async function GET(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const queryText = new URL(request.url).searchParams.get("q")?.trim();

  if (!queryText) {
    return Response.json({ series: [] });
  }

  const supabase = createSupabaseAdminClient();
  const [displayResult, searchResult, similarResult] = await Promise.all([
    supabase
      .from("manga_series")
      .select("id, search_title, display_title")
      .ilike("display_title", `%${queryText}%`)
      .order("display_title")
      .limit(25),
    supabase
      .from("manga_series")
      .select("id, search_title, display_title")
      .ilike("search_title", `%${queryText}%`)
      .order("display_title")
      .limit(25),
    supabase.rpc("find_similar_manga_series", {
      p_normalized_title: queryText,
      p_limit: 3,
    }),
  ]);

  if (displayResult.error || searchResult.error) {
    console.error(
      "[Admin matching] Failed to search series.",
      displayResult.error ?? searchResult.error,
    );
    return Response.json({ error: "Search failed." }, { status: 500 });
  }

  if (similarResult.error) {
    console.error(
      "[Admin matching] Similar series search failed.",
      similarResult.error,
    );
  }

  const similarRows = (similarResult.data ?? []) as SimilarSeriesRow[];
  const similarityScores = new Map(
    similarRows.map((series) => [
      series.id,
      series.similarity_score,
    ]),
  );
  const uniqueSeries = new Map(
    [
      ...similarRows,
      ...(displayResult.data ?? []),
      ...(searchResult.data ?? []),
    ].map((series) => [series.id, series]),
  );

  return Response.json({
    series: Array.from(uniqueSeries.values()).slice(0, 25).map((series) => ({
      id: series.id,
      searchTitle: series.search_title,
      displayTitle: series.display_title,
      similarityScore: similarityScores.get(series.id),
    })),
  });
}

export async function POST(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    displayTitle?: string;
  };
  const displayTitle = body.displayTitle?.trim();

  if (!displayTitle) {
    return Response.json(
      { error: "Display title is required." },
      { status: 400 },
    );
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("manga_series")
    .insert({
      search_title: displayTitle,
      display_title: displayTitle,
    })
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
