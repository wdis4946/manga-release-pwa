import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type SeriesGenreRequest = {
  genreName?: string;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as SeriesGenreRequest;
  const genreName = body.genreName?.trim();

  if (!genreName) {
    return Response.json({ error: "Genre name is required." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: existingGenres, error: existingGenresError } = await supabase
    .from("manga_series_genres")
    .select("sort_order")
    .eq("series_id", id)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (existingGenresError) {
    return Response.json(
      { error: existingGenresError.message },
      { status: 500 },
    );
  }

  const sortOrder = (existingGenres?.[0]?.sort_order ?? -1) + 1;
  const { data, error } = await supabase
    .from("manga_series_genres")
    .insert({
      series_id: id,
      genre_name: genreName,
      sort_order: sortOrder,
    })
    .select("genre_name, sort_order")
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({
    genre: {
      genreName: data.genre_name,
      sortOrder: data.sort_order,
    },
  });
}
