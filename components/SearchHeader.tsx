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
          className="h-12 w-full rounded-full border border-stone-200 bg-stone-100 px-5 text-base font-medium text-stone-950 outline-none transition placeholder:text-stone-500 focus:border-stone-300 focus:bg-white focus:ring-4 focus:ring-stone-200"
        />
      </form>

      {shouldShowSuggestions ? (
        <div className="absolute left-0 right-0 top-14 z-30 overflow-hidden rounded-md border border-stone-200 bg-white shadow-lg">
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
    <div className="border-b border-stone-100 last:border-b-0">
      <p className="px-4 pt-3 text-xs font-bold text-stone-400">{label}</p>
      <div className="py-2">
        {suggestions.map((suggestion) => (
          <a
            key={`${paramName}-${suggestion.id}`}
            href={`/?${paramName}=${encodeURIComponent(suggestion.name)}`}
            className="block px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
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
