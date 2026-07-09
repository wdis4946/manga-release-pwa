import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type BulkUnlinkRequest = {
  isbns?: string[];
};

type MoveItemsRequest = {
  isbns?: string[];
  categoryNumber?: number;
  itemOrders?: Array<{
    isbn?: string;
    categoryNumber?: number;
    displayOrder?: number;
  }>;
};

function parseIsbns(isbns: string[] | undefined) {
  return Array.from(
    new Set(
      (isbns ?? [])
        .map((isbn) => isbn.trim())
        .filter((isbn) => isbn.length > 0),
    ),
  );
}

function getRpcMutationErrorStatus(message: string) {
  if (
    message.includes("Category was not found") ||
    message.includes("Item was not found")
  ) {
    return 409;
  }

  return 500;
}

function rpcMutationErrorResponse(error: {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}) {
  return Response.json(
    {
      error: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    },
    { status: getRpcMutationErrorStatus(error.message) },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    isbn?: string;
    isbns?: string[];
  };
  const isbns = Array.from(
    new Set(
      parseIsbns([
        ...(body.isbns ?? []),
        ...(body.isbn ? [body.isbn] : []),
      ])
        .map((isbn) => isbn.replace(/[-\s]/g, ""))
        .filter((isbn) => isbn.length > 0),
    ),
  );

  if (isbns.length === 0) {
    return Response.json({ error: "No ISBNs were provided." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: series, error: seriesError } = await supabase
    .from("series")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (seriesError) {
    return Response.json({ error: seriesError.message }, { status: 500 });
  }

  if (!series) {
    return Response.json({ error: "Series not found." }, { status: 404 });
  }

  const { error: categoryError } = await supabase
    .from("series_categories")
    .upsert(
      {
        series_id: id,
        category_number: 0,
        category_name: "default",
      },
      {
        ignoreDuplicates: true,
        onConflict: "series_id,category_number",
      },
    );

  if (categoryError) {
    console.error("[Admin series] Failed to ensure default category.", {
      seriesId: id,
      error: categoryError,
    });

    return Response.json({ error: categoryError.message }, { status: 500 });
  }

  const { data: lastItem, error: lastItemError } = await supabase
    .from("series_items")
    .select("display_order")
    .eq("series_id", id)
    .eq("category_number", 0)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastItemError) {
    return Response.json({ error: lastItemError.message }, { status: 500 });
  }

  const matchedAt = new Date().toISOString();
  const firstDisplayOrder = (lastItem?.display_order ?? -1) + 1;
  const rows = isbns.map((isbn, index) => ({
    isbn,
    series_id: id,
    match_method: "manual",
    matched_by: user.id,
    matched_at: matchedAt,
    category_number: 0,
    display_order: firstDisplayOrder + index,
    updated_at: matchedAt,
  }));

  const { data, error } = await supabase
    .from("series_items")
    .upsert(rows, { onConflict: "isbn" })
    .select("isbn");

  if (error) {
    console.error("[Admin series] Failed to link item.", {
      seriesId: id,
      isbns,
      error,
    });

    return Response.json({ error: error.message }, { status: 500 });
  }

  const linkedIsbns = (data ?? []).map((item) => item.isbn);

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
      console.error("[Admin series] Failed to resolve linked item issues.", {
        seriesId: id,
        isbns: linkedIsbns,
        error: issueError,
      });
    }
  }

  return Response.json({
    ok: true,
    requestedCount: isbns.length,
    linkedCount: linkedIsbns.length,
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as BulkUnlinkRequest;
  const isbns = parseIsbns(body.isbns);

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

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as MoveItemsRequest;
  const itemOrders = (body.itemOrders ?? [])
    .map((item) => ({
      isbn: item.isbn?.trim() ?? "",
      categoryNumber: item.categoryNumber,
      displayOrder: item.displayOrder,
    }))
    .filter((item) => item.isbn.length > 0);

  if (itemOrders.length > 0) {
    if (
      itemOrders.some(
        (item) =>
          typeof item.categoryNumber !== "number" ||
          !Number.isInteger(item.categoryNumber) ||
          item.categoryNumber < 0 ||
          typeof item.displayOrder !== "number" ||
          !Number.isInteger(item.displayOrder) ||
          item.displayOrder < 0,
      )
    ) {
      return Response.json(
        {
          error:
            "Each item order must include a non-negative category number and display order.",
        },
        { status: 400 },
      );
    }

    const { data, error } = await createSupabaseAdminClient().rpc(
      "update_series_item_display_orders",
      {
        p_series_id: id,
        p_item_orders: itemOrders.map((item) => ({
          isbn: item.isbn,
          category_number: item.categoryNumber,
          display_order: item.displayOrder,
        })),
      },
    );

    if (error) {
      console.error("[Admin series] Failed to update item display order.", {
        seriesId: id,
        itemOrders,
        error,
      });
      return rpcMutationErrorResponse(error);
    }

    return Response.json({
      ok: true,
      requestedCount: itemOrders.length,
      updatedCount: data ?? 0,
    });
  }

  const isbns = parseIsbns(body.isbns);
  const categoryNumber = body.categoryNumber;

  if (isbns.length === 0) {
    return Response.json({ error: "No ISBNs were provided." }, { status: 400 });
  }

  if (
    typeof categoryNumber !== "number" ||
    !Number.isInteger(categoryNumber) ||
    categoryNumber < 0
  ) {
    return Response.json(
      { error: "Category number must be a non-negative integer." },
      { status: 400 },
    );
  }

  const { data, error } = await createSupabaseAdminClient().rpc(
    "move_series_items_to_category",
    {
      p_series_id: id,
      p_isbns: isbns,
      p_category_number: categoryNumber,
    },
  );

  if (error) {
    console.error("[Admin series] Failed to move items to category.", {
      seriesId: id,
      isbns,
      categoryNumber,
      error,
    });
    return rpcMutationErrorResponse(error);
  }

  return Response.json({
    ok: true,
    requestedCount: isbns.length,
    movedCount: data ?? 0,
  });
}
