"use client";

import { FormEvent, useMemo, useState } from "react";

type Suggestion = {
  id: string;
  name: string;
};

type SearchHeaderProps = {
  tags: Suggestion[];
  authors: Suggestion[];
};

const MAX_VISIBLE_SUGGESTIONS = 6;

export function SearchHeader({ tags, authors }: SearchHeaderProps) {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleTags = useMemo(
    () => filterSuggestions(tags, normalizedQuery),
    [normalizedQuery, tags],
  );
  const visibleAuthors = useMemo(
    () => filterSuggestions(authors, normalizedQuery),
    [authors, normalizedQuery],
  );
  const shouldShowSuggestions =
    isFocused && (visibleTags.length > 0 || visibleAuthors.length > 0);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    const trimmedQuery = query.trim();

    if (trimmedQuery) {
      params.set("q", trimmedQuery);
    }

    window.location.href = params.toString() ? `/?${params.toString()}` : "/";
  }

  return (
    <div className="relative mx-auto w-full max-w-2xl">
      <form onSubmit={handleSubmit}>
        <input
          aria-label="漫画を検索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => window.setTimeout(() => setIsFocused(false), 120)}
          placeholder="漫画を検索"
          className="h-[50px] w-full rounded-full border border-white/10 bg-gradient-to-b from-white/10 to-white/5 px-5 text-base font-medium text-white shadow-[0_14px_40px_rgba(0,0,0,0.24)] outline-none transition placeholder:text-[#93a0ca] focus:border-[#7db5ff]/70 focus:bg-white/10 focus:ring-4 focus:ring-[#7db5ff]/15"
        />
      </form>

      {shouldShowSuggestions ? (
        <div className="absolute left-0 right-0 top-14 z-30 overflow-hidden rounded-2xl border border-white/10 bg-[#111622]/95 shadow-[0_24px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <SuggestionGroup
            label="タグ"
            paramName="tag"
            suggestions={visibleTags}
          />
          <SuggestionGroup
            label="作者"
            paramName="author"
            suggestions={visibleAuthors}
          />
        </div>
      ) : null}
    </div>
  );
}

function SuggestionGroup({
  label,
  paramName,
  suggestions,
}: {
  label: string;
  paramName: "tag" | "author";
  suggestions: Suggestion[];
}) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-white/8 last:border-b-0">
      <p className="px-4 pt-3 text-base font-bold text-[#8d98bd]">{label}</p>
      <div className="py-2">
        {suggestions.map((suggestion) => (
          <a
            key={`${paramName}-${suggestion.id}`}
            href={`/?${paramName}=${encodeURIComponent(suggestion.name)}`}
            className="block px-4 py-2 text-base font-semibold text-white/85 transition hover:bg-white/8 hover:text-white"
          >
            {suggestion.name}
          </a>
        ))}
      </div>
    </div>
  );
}

function filterSuggestions(suggestions: Suggestion[], normalizedQuery: string) {
  const filtered = normalizedQuery
    ? suggestions.filter((suggestion) =>
        suggestion.name.toLowerCase().includes(normalizedQuery),
      )
    : suggestions;

  return filtered.slice(0, MAX_VISIBLE_SUGGESTIONS);
}
