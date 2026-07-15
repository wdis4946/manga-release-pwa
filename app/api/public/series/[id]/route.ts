import { NextResponse } from "next/server";
import { getPublicSeriesDetail } from "@/lib/manga/service";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const series = await getPublicSeriesDetail(id);

  if (!series) {
    return NextResponse.json(
      { error: "Series was not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ series });
}
