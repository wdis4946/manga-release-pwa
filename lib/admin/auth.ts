import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getAdminUser(request: Request): Promise<User | null> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;

  if (!token) {
    return null;
  }

  const {
    data: { user },
    error,
  } = await createSupabaseServerClient().auth.getUser(token);

  if (error || !user?.email) {
    return null;
  }

  const allowedEmails = new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

  return allowedEmails.has(user.email.toLowerCase()) ? user : null;
}
