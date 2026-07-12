import { getPublicSearchSuggestions } from "@/lib/manga/service";
import { SearchHeader } from "./SearchHeader";

export async function Header() {
  const suggestions = await getSearchSuggestionsSafely();

  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/95 px-3 py-3 backdrop-blur sm:px-5">
      <SearchHeader tags={suggestions.tags} authors={suggestions.authors} />
    </header>
  );
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
