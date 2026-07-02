import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type BulkUnlinkRequest = {
  isbns?: string[];
};

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as BulkUnlinkRequest;
  const isbns = Array.from(
    new Set(
      (body.isbns ?? [])
        .map((isbn) => isbn.trim())
        .filter((isbn) => isbn.length > 0),
    ),
  );

  if (isbns.length === 0) {
    return Response.json({ error: "No ISBNs were provided." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const missingIsbns: string[] = [];
  let unlinkedCount = 0;

  // Keep each unlink inside the existing DB function so logs and issue restoration
  // stay consistent with the single-item unlink flow.
  for (const isbn of isbns) {
    const { data, error } = await supabase.rpc("manual_unlink_manga_item", {
      p_isbn: isbn,
      p_series_id: id,
      p_user_id: user.id,
    });

    if (error) {
      console.error("[Admin series] Failed to bulk unlink item.", {
        isbn,
        error,
      });
      return Response.json(
        { error: error.message, failedIsbn: isbn },
        { status: 500 },
      );
    }

    if (data) {
      unlinkedCount += 1;
    } else {
      missingIsbns.push(isbn);
    }
  }

  return Response.json({
    ok: true,
    requestedCount: isbns.length,
    unlinkedCount,
    missingIsbns,
  });
}
