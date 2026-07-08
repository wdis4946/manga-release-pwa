import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

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
    .from("publishers")
    .select("id, imprint_name, publisher_name", { count: "exact" })
    .order("publisher_name", { ascending: true })
    .order("imprint_name", { ascending: true })
    .range(from, from + pageSize - 1);

  if (queryText) {
    query = query.or(
      `imprint_name.ilike.%${queryText}%,publisher_name.ilike.%${queryText}%`,
    );
  }

  const { data, count, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    publishers: (data ?? []).map((publisher) => ({
      publisherId: publisher.id,
      imprintName: publisher.imprint_name,
      publisherName: publisher.publisher_name,
    })),
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

  const body = (await request.json().catch(() => ({}))) as {
    imprintName?: string;
    publisherName?: string;
  };
  const imprintName = body.imprintName?.trim();
  const publisherName = body.publisherName?.trim();

  if (!imprintName || !publisherName) {
    return Response.json(
      { error: "Imprint name and publisher name are required." },
      { status: 400 },
    );
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("publishers")
    .insert({
      imprint_name: imprintName,
      publisher_name: publisherName,
    })
    .select("id, imprint_name, publisher_name")
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({
    publisher: {
      publisherId: data.id,
      imprintName: data.imprint_name,
      publisherName: data.publisher_name,
    },
  });
}
