import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

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
  const [displayResult, madbResult, normalizedResult] = await Promise.all([
    supabase
      .from("manga_series")
      .select(
        "id, madb_title, normalized_madb_title, display_title, description",
      )
      .ilike("display_title", `%${queryText}%`)
      .order("display_title")
      .limit(25),
    supabase
      .from("manga_series")
      .select(
        "id, madb_title, normalized_madb_title, display_title, description",
      )
      .ilike("madb_title", `%${queryText}%`)
      .order("display_title")
      .limit(25),
    supabase
      .from("manga_series")
      .select(
        "id, madb_title, normalized_madb_title, display_title, description",
      )
      .ilike("normalized_madb_title", `%${queryText}%`)
      .order("display_title")
      .limit(25),
  ]);

  if (displayResult.error || madbResult.error || normalizedResult.error) {
    console.error(
      "[Admin matching] Failed to search series.",
      displayResult.error ?? madbResult.error ?? normalizedResult.error,
    );
    return Response.json({ error: "Search failed." }, { status: 500 });
  }

  const uniqueSeries = new Map(
    [
      ...(displayResult.data ?? []),
      ...(madbResult.data ?? []),
      ...(normalizedResult.data ?? []),
    ].map((series) => [series.id, series]),
  );

  return Response.json({
    series: Array.from(uniqueSeries.values()).slice(0, 25).map((series) => ({
      id: series.id,
      madbTitle: series.madb_title,
      normalizedMadbTitle: series.normalized_madb_title,
      displayTitle: series.display_title,
      description: series.description,
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
    description?: string;
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
      madb_title: displayTitle,
      display_title: displayTitle,
      description: body.description?.trim() || null,
    })
    .select(
      "id, madb_title, normalized_madb_title, display_title, description",
    )
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({
    series: {
      id: data.id,
      madbTitle: data.madb_title,
      normalizedMadbTitle: data.normalized_madb_title,
      displayTitle: data.display_title,
      description: data.description,
    },
  });
}
