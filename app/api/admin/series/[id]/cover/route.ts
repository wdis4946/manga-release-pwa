import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const BUCKET_NAME = "series-covers";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

type RouteContext = {
  params: Promise<{ id: string }>;
};

function getImageExtension(file: File) {
  switch (file.type) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return null;
  }
}

function formatStorageTimestamp(date: Date) {
  const pad = (value: number, length = 2) =>
    value.toString().padStart(length, "0");

  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    pad(date.getUTCMilliseconds(), 3),
  ].join("");
}

function getPublicUrl(path: string) {
  return createSupabaseAdminClient().storage
    .from(BUCKET_NAME)
    .getPublicUrl(path).data.publicUrl;
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "Image file is required." }, { status: 400 });
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return Response.json(
      { error: "Only jpeg, png, webp, and gif images are supported." },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: "Image file must be 5MB or smaller." },
      { status: 400 },
    );
  }

  const extension = getImageExtension(file);

  if (!extension) {
    return Response.json({ error: "Unsupported image type." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: series, error: seriesError } = await supabase
    .from("series")
    .select("id, representative_image_path")
    .eq("id", id)
    .maybeSingle();

  if (seriesError) {
    return Response.json({ error: seriesError.message }, { status: 500 });
  }

  if (!series) {
    return Response.json({ error: "Series not found." }, { status: 404 });
  }

  const uploadedAt = new Date();
  const path = `series/${id}/${formatStorageTimestamp(uploadedAt)}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: "31536000",
    });

  if (uploadError) {
    return Response.json({ error: uploadError.message }, { status: 500 });
  }

  if (series.representative_image_path && series.representative_image_path !== path) {
    await supabase.storage
      .from(BUCKET_NAME)
      .remove([series.representative_image_path]);
  }

  const { data: updatedSeries, error: updateError } = await supabase
    .from("series")
    .update({
      representative_image_path: path,
      updated_at: uploadedAt.toISOString(),
    })
    .eq("id", id)
    .select("representative_image_path")
    .single();

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  return Response.json({
    representativeImagePath: updatedSeries.representative_image_path,
    representativeImageUrl: getPublicUrl(updatedSeries.representative_image_path),
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const supabase = createSupabaseAdminClient();
  const { data: series, error: seriesError } = await supabase
    .from("series")
    .select("id, representative_image_path")
    .eq("id", id)
    .maybeSingle();

  if (seriesError) {
    return Response.json({ error: seriesError.message }, { status: 500 });
  }

  if (!series) {
    return Response.json({ error: "Series not found." }, { status: 404 });
  }

  if (series.representative_image_path) {
    const { error: removeError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([series.representative_image_path]);

    if (removeError) {
      return Response.json({ error: removeError.message }, { status: 500 });
    }
  }

  const { error: updateError } = await supabase
    .from("series")
    .update({
      representative_image_path: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  return Response.json({
    representativeImagePath: null,
    representativeImageUrl: null,
  });
}
