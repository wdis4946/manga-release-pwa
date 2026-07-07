import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string; genreId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, genreId: genreIdParam } = await context.params;
  const genreId = decodeURIComponent(genreIdParam).trim();

  if (!genreId) {
    return Response.json({ error: "Genre ID is required." }, { status: 400 });
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("manga_series_genres")
    .delete()
    .eq("series_id", id)
    .eq("genre_id", genreId)
    .select("genre_id")
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json({ error: "Genre not found." }, { status: 404 });
  }

  return Response.json({ ok: true });
}
