import { NextResponse } from "next/server";
import {
  PUBLIC_GALLERY_PAGE_SIZE,
  getPublicMangaSeriesGallery,
} from "@/lib/manga/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? PUBLIC_GALLERY_PAGE_SIZE);
  const excludeIds = searchParams
    .get("exclude")
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const result = await getPublicMangaSeriesGallery({
    query: searchParams.get("q") ?? undefined,
    tag: searchParams.get("tag") ?? undefined,
    author: searchParams.get("author") ?? undefined,
    limit,
    excludeIds,
  });

  return NextResponse.json(result);
}
