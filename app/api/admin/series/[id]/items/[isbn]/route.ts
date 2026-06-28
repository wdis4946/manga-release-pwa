import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string; isbn: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, isbn } = await context.params;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("manual_unlink_manga_item", {
    p_isbn: decodeURIComponent(isbn),
    p_series_id: id,
    p_user_id: user.id,
  });

  if (error) {
    console.error("[Admin series] Failed to unlink item.", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json({ error: "Link not found." }, { status: 404 });
  }

  return Response.json({ ok: true });
}
