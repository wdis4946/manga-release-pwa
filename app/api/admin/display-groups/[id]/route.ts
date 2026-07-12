import { getAdminUser } from "@/lib/admin/auth";
import { createSeriesCoverUrl } from "@/lib/admin/series-cover-url";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type DisplayGroupUpdateRequest = {
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

type DisplayGroupSeriesRow = {
  series_id: string;
  sort_order: number;
};

type SeriesRow = {
  id: string;
  display_title: string;
  search_title: string;
  representative_image_path: string | null;
};

function toNullableText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
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

async function loadLinkedSeries(groupId: string) {
  const supabase = createSupabaseAdminClient();
  const { data: links, error: linksError } = await supabase
    .from("display_group_series")
    .select("series_id, sort_order")
    .eq("display_group_id", groupId)
    .order("sort_order", { ascending: true })
    .order("series_id", { ascending: true });

  if (linksError) {
    throw linksError;
  }

  const linkRows = (links ?? []) as DisplayGroupSeriesRow[];
  const seriesIds = linkRows.map((link) => link.series_id);

  if (seriesIds.length === 0) {
    return [];
  }

  const { data: seriesRows, error: seriesError } = await supabase
    .from("series")
    .select("id, display_title, search_title, representative_image_path")
    .in("id", seriesIds);

  if (seriesError) {
    throw seriesError;
  }

  const seriesById = new Map(
    ((seriesRows ?? []) as SeriesRow[]).map((series) => [series.id, series]),
  );

  return Promise.all(
    linkRows.flatMap((link) => {
      const series = seriesById.get(link.series_id);

      if (!series) {
        return [];
      }

      return [
        createSeriesCoverUrl(supabase, series.representative_image_path).then(
          (representativeImageUrl) => ({
            id: series.id,
            displayTitle: series.display_title,
            searchTitle: series.search_title,
            representativeImagePath: series.representative_image_path,
            representativeImageUrl,
            sortOrder: link.sort_order,
          }),
        ),
      ];
    }),
  );
}

export async function GET(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("display_groups")
    .select("id, name, description, sort_order, is_active, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json({ error: "Display group not found." }, { status: 404 });
  }

  const series = await loadLinkedSeries(id);

  return Response.json({
    displayGroup: mapDisplayGroup(data as DisplayGroupRow, series.length),
    series,
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as DisplayGroupUpdateRequest;
  const name = body.name?.trim();

  if (body.name !== undefined && !name) {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }

  const updates: {
    name?: string;
    description?: string | null;
    sort_order?: number;
    is_active?: boolean;
    updated_at: string;
  } = {
    updated_at: new Date().toISOString(),
  };

  if (name) updates.name = name;
  if (body.description !== undefined) {
    updates.description = toNullableText(body.description);
  }
  if (body.sortOrder !== undefined && body.sortOrder !== null) {
    if (!Number.isInteger(body.sortOrder)) {
      return Response.json(
        { error: "Sort order must be an integer." },
        { status: 400 },
      );
    }
    updates.sort_order = body.sortOrder;
  }
  if (body.isActive !== undefined) updates.is_active = body.isActive;

  const { data, error } = await createSupabaseAdminClient()
    .from("display_groups")
    .update(updates)
    .eq("id", id)
    .select("id, name, description, sort_order, is_active, created_at, updated_at")
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json({ error: "Display group not found." }, { status: 404 });
  }

  return Response.json({ displayGroup: mapDisplayGroup(data as DisplayGroupRow) });
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const { error } = await createSupabaseAdminClient()
    .from("display_groups")
    .delete()
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
