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
    seriesId?: string;
    applyToGroup?: boolean;
  };
  const selectedIsbns = Array.from(
    new Set(
      (body.isbns?.length ? body.isbns : body.isbn ? [body.isbn] : [])
        .map((isbn) => isbn.trim())
        .filter(Boolean),
    ),
  );

  if (selectedIsbns.length === 0 || !body.seriesId) {
    return Response.json(
      { error: "At least one ISBN and seriesId are required." },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data: series, error: seriesError } = await supabase
    .from("series")
    .select("id")
    .eq("id", body.seriesId)
    .maybeSingle();

  if (seriesError || !series) {
    return Response.json({ error: "Series not found." }, { status: 404 });
  }

  let targetIsbns = selectedIsbns;

  if (body.applyToGroup && selectedIsbns.length === 1) {
    const { data: issue, error: issueError } = await supabase
      .from("series_item_match_issues")
      .select("normalized_title")
      .eq("isbn", selectedIsbns[0])
      .single();

    if (issueError) {
      return Response.json({ error: issueError.message }, { status: 500 });
    }

    const { data: groupIssues, error: groupError } = await supabase
      .from("series_item_match_issues")
      .select("isbn")
      .eq("normalized_title", issue.normalized_title)
      .eq("is_resolved", false);

    if (groupError) {
      return Response.json({ error: groupError.message }, { status: 500 });
    }

    targetIsbns = (groupIssues ?? []).map((row) => row.isbn);
  }

  const { error: categoryError } = await supabase
    .from("series_categories")
    .upsert(
      {
        series_id: body.seriesId,
        category_number: 0,
        category_name: "単行本",
      },
      {
        ignoreDuplicates: true,
        onConflict: "series_id,category_number",
      },
    );

  if (categoryError) {
    console.error("[Admin matching] Failed to ensure default category.", {
      seriesId: body.seriesId,
      error: categoryError,
    });

    return Response.json({ error: categoryError.message }, { status: 500 });
  }

  const { data: lastItem, error: lastItemError } = await supabase
    .from("series_items")
    .select("display_order")
    .eq("series_id", body.seriesId)
    .eq("category_number", 0)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastItemError) {
    return Response.json({ error: lastItemError.message }, { status: 500 });
  }

  const matchedAt = new Date().toISOString();
  const firstDisplayOrder = (lastItem?.display_order ?? -1) + 1;
  const rows = targetIsbns.map((isbn, index) => ({
    isbn,
    series_id: body.seriesId,
    match_method: "manual",
    matched_by: user.id,
    matched_at: matchedAt,
    category_number: 0,
    display_order: firstDisplayOrder + index,
    updated_at: matchedAt,
  }));

  const { data: linkedItems, error: linkError } = await supabase
    .from("series_items")
    .upsert(rows, { onConflict: "isbn" })
    .select("isbn");

  if (linkError) {
    console.error("[Admin matching] Failed to link items.", {
      seriesId: body.seriesId,
      isbns: targetIsbns,
      error: linkError,
    });

    return Response.json({ error: linkError.message }, { status: 500 });
  }

  const linkedIsbns = (linkedItems ?? []).map((item) => item.isbn);

  if (linkedIsbns.length > 0) {
    const { error: issueError } = await supabase
      .from("series_item_match_issues")
      .update({
        is_resolved: true,
        resolved_by: user.id,
        resolved_at: matchedAt,
        resolution_type: "linked",
        updated_at: matchedAt,
      })
      .in("isbn", linkedIsbns);

    if (issueError) {
      console.error("[Admin matching] Failed to resolve linked issues.", {
        seriesId: body.seriesId,
        isbns: linkedIsbns,
        error: issueError,
      });
    }
  }

  return Response.json({ ok: true, linkedCount: linkedIsbns.length });
}
