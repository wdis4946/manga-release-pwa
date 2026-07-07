import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.max(
    1,
    Math.min(Number(searchParams.get("pageSize")) || PAGE_SIZE, 100),
  );
  const queryText = searchParams.get("q")?.trim();
  const from = (page - 1) * pageSize;
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("genres")
    .select("id, name", { count: "exact" })
    .order("name", { ascending: true })
    .range(from, from + pageSize - 1);

  if (queryText) {
    query = query.ilike("name", `%${queryText}%`);
  }

  const { data, count, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    genres: (data ?? []).map((genre) => ({
      genreId: genre.id,
      genreName: genre.name,
    })),
    page,
    pageSize,
    total: count ?? 0,
  });
}
