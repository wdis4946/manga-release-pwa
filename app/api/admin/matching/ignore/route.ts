import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    isbn?: string;
    isbns?: string[];
    note?: string;
  };
  const isbns = Array.from(
    new Set(
      (body.isbns?.length ? body.isbns : body.isbn ? [body.isbn] : [])
        .map((isbn) => isbn.trim())
        .filter(Boolean),
    ),
  );

  if (isbns.length === 0) {
    return Response.json({ error: "At least one ISBN is required." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await createSupabaseAdminClient()
    .from("manga_series_item_match_issues")
    .update({
      is_resolved: true,
      resolved_by: user.id,
      resolved_at: now,
      resolution_type: "ignored",
      resolution_note: body.note?.trim() || null,
      updated_at: now,
    })
    .in("isbn", isbns);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, ignoredCount: isbns.length });
}
