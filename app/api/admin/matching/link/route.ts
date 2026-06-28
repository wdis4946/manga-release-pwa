import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    isbn?: string;
    seriesId?: string;
    applyToGroup?: boolean;
  };

  if (!body.isbn || !body.seriesId) {
    return Response.json(
      { error: "ISBN and seriesId are required." },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data: series, error: seriesError } = await supabase
    .from("manga_series")
    .select("id")
    .eq("id", body.seriesId)
    .maybeSingle();

  if (seriesError || !series) {
    return Response.json({ error: "Series not found." }, { status: 404 });
  }

  let targetIsbns = [body.isbn];

  if (body.applyToGroup) {
    const { data: issue, error: issueError } = await supabase
      .from("manga_series_item_match_issues")
      .select("normalized_title")
      .eq("isbn", body.isbn)
      .single();

    if (issueError) {
      return Response.json({ error: issueError.message }, { status: 500 });
    }

    const { data: groupIssues, error: groupError } = await supabase
      .from("manga_series_item_match_issues")
      .select("isbn")
      .eq("normalized_title", issue.normalized_title)
      .eq("is_resolved", false);

    if (groupError) {
      return Response.json({ error: groupError.message }, { status: 500 });
    }

    targetIsbns = (groupIssues ?? []).map((row) => row.isbn);
  }

  const { data: linkedCount, error: linkError } = await supabase.rpc(
    "manual_link_manga_items",
    {
      p_isbns: targetIsbns,
      p_series_id: body.seriesId,
      p_user_id: user.id,
    },
  );

  if (linkError) {
    return Response.json({ error: linkError.message }, { status: 500 });
  }

  return Response.json({ ok: true, linkedCount: linkedCount ?? 0 });
}
