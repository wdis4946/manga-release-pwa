import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string; publisherId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, publisherId: publisherIdParam } = await context.params;
  const publisherId = decodeURIComponent(publisherIdParam).trim();

  if (!publisherId) {
    return Response.json(
      { error: "Publisher ID is required." },
      { status: 400 },
    );
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("series_publishers")
    .delete()
    .eq("series_id", id)
    .eq("publisher_id", publisherId)
    .select("publisher_id")
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json(
      { error: "Publisher link not found." },
      { status: 404 },
    );
  }

  return Response.json({ ok: true });
}
