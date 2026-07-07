import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type SeriesGenreRequest = {
  genreId?: string;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as SeriesGenreRequest;
  const genreId = body.genreId?.trim();

  if (!genreId) {
    return Response.json({ error: "Genre ID is required." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("series_genres")
    .insert({
      series_id: id,
      genre_id: genreId,
    })
    .select("genre_id")
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({
    genre: {
      genreId: data.genre_id,
      genreName: null,
    },
  });
}
