import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type SeriesPublisherRequest = {
  publisherId?: string;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as SeriesPublisherRequest;
  const publisherId = body.publisherId?.trim();

  if (!publisherId) {
    return Response.json(
      { error: "Publisher ID is required." },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data: publisher, error: publisherError } = await supabase
    .from("publishers")
    .select("id")
    .eq("id", publisherId)
    .maybeSingle();

  if (publisherError) {
    return Response.json({ error: publisherError.message }, { status: 500 });
  }

  if (!publisher) {
    return Response.json({ error: "Publisher not found." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("series_publishers")
    .insert({
      series_id: id,
      publisher_id: publisherId,
    })
    .select("publisher_id")
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({
    publisher: {
      publisherId: data.publisher_id,
    },
  });
}
