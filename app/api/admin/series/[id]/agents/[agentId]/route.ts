import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string; agentId: string }>;
};

type SeriesAgentUpdateRequest = {
  agentId?: string;
  authorWikiLink?: string;
  sortOrder?: number;
};

async function resolveReplacementAgentId(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  body: SeriesAgentUpdateRequest,
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
    return undefined;
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

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, agentId: agentIdParam } = await context.params;
  const currentAgentId = decodeURIComponent(agentIdParam);
  const body = (await request.json().catch(() => ({}))) as SeriesAgentUpdateRequest;
  const supabase = createSupabaseAdminClient();
  const replacementAgentId = await resolveReplacementAgentId(supabase, body);
  const sortOrder = body.sortOrder;

  if (replacementAgentId === null) {
    return Response.json({ error: "Agent not found." }, { status: 404 });
  }

  if (
    sortOrder !== undefined &&
    (!Number.isInteger(sortOrder) || sortOrder < 0)
  ) {
    return Response.json(
      { error: "Sort order must be a non-negative integer." },
      { status: 400 },
    );
  }

  const { data: currentLink, error: currentLinkError } = await supabase
    .from("manga_series_agents")
    .select("agent_id, sort_order")
    .eq("series_id", id)
    .eq("agent_id", currentAgentId)
    .maybeSingle();

  if (currentLinkError) {
    return Response.json({ error: currentLinkError.message }, { status: 500 });
  }

  if (!currentLink) {
    return Response.json({ error: "Series agent not found." }, { status: 404 });
  }

  const nextAgentId = replacementAgentId ?? currentAgentId;
  const nextSortOrder = sortOrder ?? currentLink.sort_order;

  if (nextAgentId === currentAgentId) {
    const { data, error } = await supabase
      .from("manga_series_agents")
      .update({ sort_order: nextSortOrder })
      .eq("series_id", id)
      .eq("agent_id", currentAgentId)
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

  const { error: deleteError } = await supabase
    .from("manga_series_agents")
    .delete()
    .eq("series_id", id)
    .eq("agent_id", currentAgentId);

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("manga_series_agents")
    .upsert(
      {
        series_id: id,
        agent_id: nextAgentId,
        sort_order: nextSortOrder,
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

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, agentId: agentIdParam } = await context.params;
  const agentId = decodeURIComponent(agentIdParam);
  const { data, error } = await createSupabaseAdminClient()
    .from("manga_series_agents")
    .delete()
    .eq("series_id", id)
    .eq("agent_id", agentId)
    .select("agent_id")
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json({ error: "Series agent not found." }, { status: 404 });
  }

  return Response.json({ ok: true });
}
