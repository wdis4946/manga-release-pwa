import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string; categoryNumber: string }>;
};

type CategoryUpdateRequest = {
  categoryNumber?: number;
  categoryName?: string;
};

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, categoryNumber: categoryNumberParam } = await context.params;
  const currentCategoryNumber = Number(decodeURIComponent(categoryNumberParam));
  const body = (await request.json()) as CategoryUpdateRequest;
  const nextCategoryNumber =
    body.categoryNumber ?? currentCategoryNumber;
  const categoryName = body.categoryName?.trim();

  if (
    !Number.isInteger(currentCategoryNumber) ||
    currentCategoryNumber < 0 ||
    !Number.isInteger(nextCategoryNumber) ||
    nextCategoryNumber < 0
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

  const { data, error } = await createSupabaseAdminClient().rpc(
    "update_manga_series_category",
    {
      p_series_id: id,
      p_category_number: currentCategoryNumber,
      p_new_category_number: nextCategoryNumber,
      p_category_name: categoryName,
    },
  );

  if (error) {
    const status = error.message.includes("already exists") ? 409 : 500;
    return Response.json({ error: error.message }, { status });
  }

  if (!data) {
    return Response.json({ error: "Category not found." }, { status: 404 });
  }

  return Response.json({
    category: {
      categoryNumber: nextCategoryNumber,
      categoryName,
    },
  });
}
