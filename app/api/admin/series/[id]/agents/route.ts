import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type SeriesAgentRequest = {
  agentId?: string;
  authorWikiLink?: string;
  sortOrder?: number;
};

type SeriesAgentOrderRequest = {
  agents?: Array<{
    agentId?: string;
    sortOrder?: number;
  }>;
};

async function resolveAgentId(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  body: SeriesAgentRequest,
) {
  const agentId = body.agentId?.trim();

  if (agentId) {
    const { data, error } = await supabase
      .from("agents")
      .select("id")
      .eq("id", agentId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data?.id ?? null;
  }

  const authorWikiLink = body.authorWikiLink?.trim();

  if (!authorWikiLink) {
    return null;
  }

  const { data, error } = await supabase
    .from("agents")
    .select("id")
    .eq("author_wiki_link", authorWikiLink)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.id ?? null;
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as SeriesAgentRequest;
  const supabase = createSupabaseAdminClient();
  const agentId = await resolveAgentId(supabase, body);

  if (!agentId) {
    return Response.json({ error: "Agent not found." }, { status: 404 });
  }

  let sortOrder = body.sortOrder;

  if (
    sortOrder !== undefined &&
    (!Number.isInteger(sortOrder) || sortOrder < 0)
  ) {
    return Response.json(
      { error: "Sort order must be a non-negative integer." },
      { status: 400 },
    );
  }

  if (sortOrder === undefined) {
    const { data: existingLinks, error: existingLinksError } = await supabase
      .from("series_agents")
      .select("sort_order")
      .eq("series_id", id)
      .order("sort_order", { ascending: false })
      .limit(1);

    if (existingLinksError) {
      return Response.json(
        { error: existingLinksError.message },
        { status: 500 },
      );
    }

    sortOrder = (existingLinks?.[0]?.sort_order ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from("series_agents")
    .upsert(
      {
        series_id: id,
        agent_id: agentId,
        sort_order: sortOrder,
      },
      { onConflict: "series_id,agent_id" },
    )
    .select("agent_id, sort_order")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("name, author_wiki_link")
    .eq("id", data.agent_id)
    .maybeSingle();

  return Response.json({
    agent: {
      agentId: data.agent_id,
      agentName: agent?.name ?? "作者名未設定",
      authorWikiLink: agent?.author_wiki_link ?? null,
      sortOrder: data.sort_order,
    },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as SeriesAgentOrderRequest;
  const agentOrders = (body.agents ?? [])
    .map((agent) => ({
      agentId: agent.agentId?.trim() ?? "",
      sortOrder: agent.sortOrder,
    }))
    .filter((agent) => agent.agentId.length > 0);

  if (agentOrders.length === 0) {
    return Response.json({ error: "No agents were provided." }, { status: 400 });
  }

  if (
    agentOrders.some(
      (agent) =>
        typeof agent.sortOrder !== "number" ||
        !Number.isInteger(agent.sortOrder) ||
        agent.sortOrder < 0,
    )
  ) {
    return Response.json(
      { error: "Sort order must be a non-negative integer." },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  let updatedCount = 0;

  for (const agent of agentOrders) {
    const { error } = await supabase
      .from("series_agents")
      .update({ sort_order: agent.sortOrder })
      .eq("series_id", id)
      .eq("agent_id", agent.agentId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    updatedCount += 1;
  }

  return Response.json({ ok: true, updatedCount });
}
