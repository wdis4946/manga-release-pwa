import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const SERIES_COVERS_BUCKET = "series-covers";

const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24;

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export async function createSeriesCoverUrl(
  supabase: SupabaseAdminClient,
  path: string | null | undefined,
) {
  if (!path) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(SERIES_COVERS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRES_IN_SECONDS);

  if (error) {
    console.error("[Admin series] Failed to create series cover URL.", {
      path,
      error,
    });
    return null;
  }

  return data.signedUrl;
}
