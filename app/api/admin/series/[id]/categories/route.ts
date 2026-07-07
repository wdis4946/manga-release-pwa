import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type CategoryRequest = {
  categoryNumber?: number;
  categoryName?: string;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as CategoryRequest;
  const categoryNumber = body.categoryNumber;
  const categoryName = body.categoryName?.trim();

  if (
    typeof categoryNumber !== "number" ||
    !Number.isInteger(categoryNumber) ||
    categoryNumber < 0
  ) {
    return Response.json(
      { error: "Category number must be a non-negative integer." },
      { status: 400 },
    );
  }

  if (!categoryName) {
    return Response.json(
      { error: "Category name is required." },
      { status: 400 },
    );
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("series_categories")
    .insert({
      series_id: id,
      category_number: categoryNumber,
      category_name: categoryName,
    })
    .select("category_number, category_name")
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({
    category: {
      categoryNumber: data.category_number,
      categoryName: data.category_name,
      itemCount: 0,
    },
  });
}
