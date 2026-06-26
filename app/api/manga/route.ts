import { NextResponse } from "next/server";
import { getMangaForList, normalizeSort } from "@/lib/manga/service";
import type { MangaSort } from "@/lib/manga/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sort = normalizeSort(searchParams.get("sort") as MangaSort | undefined);
  const genre = searchParams.get("genre") ?? undefined;
  const author = searchParams.get("author") ?? undefined;

  const result = await getMangaForList({ sort, genre, author });

  return NextResponse.json(result);
}
