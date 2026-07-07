import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

type AgentRequest = {
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

export async function GET(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.max(
    1,
    Math.min(Number(searchParams.get("pageSize")) || PAGE_SIZE, 100),
  );
  const queryText = searchParams.get("q")?.trim();
  const from = (page - 1) * pageSize;
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("agents")
    .select(
      "id, name, birth_date, active_start_year, active_end_year, birth_place, author_wiki_link, gender, created_at, updated_at",
      { count: "exact" },
    )
    .order("name", { ascending: true })
    .range(from, from + pageSize - 1);

  if (queryText) {
    query = query.ilike("name", `%${queryText}%`);
  }

  const { data, count, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    agents: (data ?? []).map(mapAgent),
    page,
    pageSize,
    total: count ?? 0,
  });
}

export async function POST(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as AgentRequest;
  const name = body.name?.trim();

  if (!name) {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }

  let activeStartYear: number | null;
  let activeEndYear: number | null;

  try {
    activeStartYear = toNullableYear(body.activeStartYear);
    activeEndYear = toNullableYear(body.activeEndYear);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid year." },
      { status: 400 },
    );
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("agents")
    .insert({
      name,
      birth_date: toNullableText(body.birthDate),
      active_start_year: activeStartYear,
      active_end_year: activeEndYear,
      birth_place: toNullableText(body.birthPlace),
      author_wiki_link: toNullableText(body.authorWikiLink),
      gender: toNullableText(body.gender),
    })
    .select(
      "id, name, birth_date, active_start_year, active_end_year, birth_place, author_wiki_link, gender, created_at, updated_at",
    )
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({ agent: mapAgent(data) });
}
