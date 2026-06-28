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
  const [titleResult, normalizedResult] = await Promise.all([
    supabase
      .from("manga_series")
      .select("id, title, normalized_title, description")
      .ilike("title", `%${queryText}%`)
      .order("title")
      .limit(25),
    supabase
      .from("manga_series")
      .select("id, title, normalized_title, description")
      .ilike("normalized_title", `%${queryText}%`)
      .order("title")
      .limit(25),
  ]);

  if (titleResult.error || normalizedResult.error) {
    console.error(
      "[Admin matching] Failed to search series.",
      titleResult.error ?? normalizedResult.error,
    );
    return Response.json({ error: "Search failed." }, { status: 500 });
  }

  const uniqueSeries = new Map(
    [...(titleResult.data ?? []), ...(normalizedResult.data ?? [])].map(
      (series) => [series.id, series],
    ),
  );

  return Response.json({
    series: Array.from(uniqueSeries.values()).slice(0, 25).map((series) => ({
      id: series.id,
      title: series.title,
      normalizedTitle: series.normalized_title,
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
    title?: string;
    description?: string;
  };
  const title = body.title?.trim();

  if (!title) {
    return Response.json({ error: "Title is required." }, { status: 400 });
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("manga_series")
    .insert({
      title,
      description: body.description?.trim() || null,
    })
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
