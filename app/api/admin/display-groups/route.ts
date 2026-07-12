import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type DisplayGroupRequest = {
  name?: string;
  description?: string | null;
  sortOrder?: number | null;
  isActive?: boolean;
};

type DisplayGroupRow = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function toNullableText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function toSortOrder(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (!Number.isInteger(value)) {
    throw new Error("Sort order must be an integer.");
  }

  return value;
}

function mapDisplayGroup(row: DisplayGroupRow, seriesCount = 0) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seriesCount,
  };
}

async function countSeriesByGroupId(groupIds: string[]) {
  const counts = new Map<string, number>();

  if (groupIds.length === 0) {
    return counts;
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("display_group_series")
    .select("display_group_id")
    .in("display_group_id", groupIds);

  if (error) {
    throw error;
  }

  for (const row of data ?? []) {
    counts.set(row.display_group_id, (counts.get(row.display_group_id) ?? 0) + 1);
  }

  return counts;
}

export async function GET(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("display_groups")
    .select("id, name, description, sort_order, is_active, created_at, updated_at")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as DisplayGroupRow[];
  const counts = await countSeriesByGroupId(rows.map((row) => row.id));

  return Response.json({
    displayGroups: rows.map((row) => mapDisplayGroup(row, counts.get(row.id) ?? 0)),
  });
}

export async function POST(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as DisplayGroupRequest;
  const name = body.name?.trim();

  if (!name) {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }

  let sortOrder: number;

  try {
    sortOrder = toSortOrder(body.sortOrder);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid sort order." },
      { status: 400 },
    );
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("display_groups")
    .insert({
      name,
      description: toNullableText(body.description),
      sort_order: sortOrder,
      is_active: body.isActive ?? true,
    })
    .select("id, name, description, sort_order, is_active, created_at, updated_at")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ displayGroup: mapDisplayGroup(data as DisplayGroupRow) });
}
