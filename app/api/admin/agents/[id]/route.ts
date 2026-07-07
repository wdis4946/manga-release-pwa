import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type AgentUpdateRequest = {
  name?: string;
  birthDate?: string | null;
  activeStartYear?: number | null;
  activeEndYear?: number | null;
  birthPlace?: string | null;
  authorWikiLink?: string | null;
  gender?: string | null;
};

function toNullableText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function toNullableYear(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isInteger(value)) {
    throw new Error("Year must be an integer.");
  }

  return value;
}

function mapAgent(row: {
  id: string;
  name: string;
  birth_date: string | null;
  active_start_year: number | null;
  active_end_year: number | null;
  birth_place: string | null;
  author_wiki_link: string | null;
  gender: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    name: row.name,
    birthDate: row.birth_date,
    activeStartYear: row.active_start_year,
    activeEndYear: row.active_end_year,
    birthPlace: row.birth_place,
    authorWikiLink: row.author_wiki_link,
    gender: row.gender,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as AgentUpdateRequest;
  const name = body.name?.trim();

  if (body.name !== undefined && !name) {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }

  let activeStartYear: number | null | undefined;
  let activeEndYear: number | null | undefined;

  try {
    activeStartYear =
      body.activeStartYear === undefined
        ? undefined
        : toNullableYear(body.activeStartYear);
    activeEndYear =
      body.activeEndYear === undefined
        ? undefined
        : toNullableYear(body.activeEndYear);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid year." },
      { status: 400 },
    );
  }

  const updates: {
    name?: string;
    birth_date?: string | null;
    active_start_year?: number | null;
    active_end_year?: number | null;
    birth_place?: string | null;
    author_wiki_link?: string | null;
    gender?: string | null;
    updated_at: string;
  } = {
    updated_at: new Date().toISOString(),
  };

  if (name) updates.name = name;
  if (body.birthDate !== undefined) {
    updates.birth_date = toNullableText(body.birthDate);
  }
  if (activeStartYear !== undefined) {
    updates.active_start_year = activeStartYear;
  }
  if (activeEndYear !== undefined) {
    updates.active_end_year = activeEndYear;
  }
  if (body.birthPlace !== undefined) {
    updates.birth_place = toNullableText(body.birthPlace);
  }
  if (body.authorWikiLink !== undefined) {
    updates.author_wiki_link = toNullableText(body.authorWikiLink);
  }
  if (body.gender !== undefined) {
    updates.gender = toNullableText(body.gender);
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("agents")
    .update(updates)
    .eq("id", id)
    .select(
      "id, name, birth_date, active_start_year, active_end_year, birth_place, author_wiki_link, gender, created_at, updated_at",
    )
    .maybeSingle();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return Response.json({ error: error.message }, { status });
  }

  if (!data) {
    return Response.json({ error: "Agent not found." }, { status: 404 });
  }

  return Response.json({ agent: mapAgent(data) });
}
