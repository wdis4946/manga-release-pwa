import { getPublicSearchSuggestions } from "@/lib/manga/service";
import { AutoHideHeader } from "./AutoHideHeader";

export async function Header() {
  const suggestions = await getSearchSuggestionsSafely();

  return <AutoHideHeader tags={suggestions.tags} authors={suggestions.authors} />;
}

async function getSearchSuggestionsSafely() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    return { tags: [], authors: [] };
  }

  try {
    return await getPublicSearchSuggestions();
  } catch (error) {
    console.error("[Public manga] Failed to render search suggestions.", error);
    return { tags: [], authors: [] };
  }
}
