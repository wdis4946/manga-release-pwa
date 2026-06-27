import { NextResponse } from "next/server";
import {
  fetchRakutenBookPage,
  fetchRakutenBooksGenre,
} from "@/lib/rakuten/client";
import { toRakutenMangaItemRow } from "@/lib/rakuten/import";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COMIC_ROOT_GENRE_ID = "001001";
const GENRES_TO_DISCOVER_PER_RUN = 5;
const PAGES_PER_RUN = 5;
const REQUEST_INTERVAL_MS = 1200;

async function importRakutenManga(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[Rakuten import] CRON_SECRET is not configured.");
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const startedAt = performance.now();
  const supabase = createSupabaseAdminClient();

  try {
    const discoveredCount = await discoverGenreChildren(supabase);
    const { data: genre, error: genreError } = await supabase
      .from("rakuten_import_genres")
      .select("genre_id, genre_name, next_page")
      .not("children_discovered_at", "is", null)
      .is("completed_at", null)
      .neq("genre_id", COMIC_ROOT_GENRE_ID)
      // Leaf genres have narrower result sets, so they reach titles beyond the
      // global 3,000-item search window with far fewer duplicate ISBNs.
      .order("is_leaf", { ascending: false, nullsFirst: false })
      .order("genre_id")
      .limit(1)
      .maybeSingle();

    if (genreError) {
      throw genreError;
    }

    if (!genre) {
      console.info("[Rakuten import] Genre discovery progressed.", {
        discoveredCount,
        importableGenreFound: false,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return NextResponse.json({ ok: true });
    }

    let nextPage = genre.next_page;
    let fetchedCount = 0;
    let savedCount = 0;
    let completed = false;

    for (let index = 0; index < PAGES_PER_RUN; index += 1) {
      const result = await fetchRakutenBookPage({
        sort: "latest",
        page: nextPage,
        hits: 30,
        booksGenreId: genre.genre_id,
      });
      const fetchedAt = new Date().toISOString();
      const rowsByIsbn = new Map(
        result.items
          .map((item) => toRakutenMangaItemRow(item, fetchedAt))
          .filter((row) => row !== null)
          .map((row) => [row.isbn, row]),
      );
      const rows = Array.from(rowsByIsbn.values());

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from("rakuten_manga_items")
          .upsert(rows, { onConflict: "isbn" });

        if (upsertError) {
          throw upsertError;
        }
      }

      fetchedCount += result.items.length;
      savedCount += rows.length;
      completed = result.pageCount === 0 || nextPage >= result.pageCount;
      nextPage = completed ? nextPage : nextPage + 1;

      // Save after every page so retries continue from the last completed page.
      const { error: cursorError } = await supabase
        .from("rakuten_import_genres")
        .update({
          next_page: nextPage,
          completed_at: completed ? fetchedAt : null,
          updated_at: fetchedAt,
        })
        .eq("genre_id", genre.genre_id);

      if (cursorError) {
        throw cursorError;
      }

      console.info("[Rakuten import] Genre page imported.", {
        genreId: genre.genre_id,
        genreName: genre.genre_name,
        sourcePage: result.page,
        sourcePageCount: result.pageCount,
        fetchedCount: result.items.length,
        savedCount: rows.length,
        completed,
      });

      if (completed) {
        break;
      }

      if (index < PAGES_PER_RUN - 1) {
        await delay(REQUEST_INTERVAL_MS);
      }
    }

    console.info("[Rakuten import] Genre batch completed.", {
      discoveredCount,
      genreId: genre.genre_id,
      genreName: genre.genre_name,
      fetchedCount,
      savedCount,
      nextPage,
      completed,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Rakuten import] Import failed.", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

async function discoverGenreChildren(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
): Promise<number> {
  const { data: pendingGenres, error } = await supabase
    .from("rakuten_import_genres")
    .select("genre_id")
    .is("children_discovered_at", null)
    .order("genre_id")
    .limit(GENRES_TO_DISCOVER_PER_RUN);

  if (error) {
    throw error;
  }

  let discoveredCount = 0;

  for (const genre of pendingGenres ?? []) {
    const result = await fetchRakutenBooksGenre(genre.genre_id);
    const children = (result.children ?? []).filter(
      (child) => child.booksGenreId,
    );
    const discoveredAt = new Date().toISOString();

    if (children.length > 0) {
      const { error: childrenError } = await supabase
        .from("rakuten_import_genres")
        .upsert(
          children.map((child) => ({
            genre_id: child.booksGenreId,
            genre_name: child.booksGenreName ?? null,
            genre_level: child.genreLevel ?? null,
            parent_genre_id: genre.genre_id,
            item_count: toNullableInteger(child.itemCount),
            updated_at: discoveredAt,
          })),
          { onConflict: "genre_id", ignoreDuplicates: true },
        );

      if (childrenError) {
        throw childrenError;
      }
    }

    const { error: updateError } = await supabase
      .from("rakuten_import_genres")
      .update({
        genre_name: result.current?.booksGenreName ?? undefined,
        genre_level: result.current?.genreLevel ?? undefined,
        item_count: toNullableInteger(result.current?.itemCount),
        is_leaf: children.length === 0,
        children_discovered_at: discoveredAt,
        updated_at: discoveredAt,
      })
      .eq("genre_id", genre.genre_id);

    if (updateError) {
      throw updateError;
    }

    discoveredCount += children.length;
    await delay(REQUEST_INTERVAL_MS);
  }

  return discoveredCount;
}

function toNullableInteger(
  value: string | number | undefined,
): number | null {
  if (value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Vercel Cron invokes GET; POST remains available for authenticated manual runs.
export const GET = importRakutenManga;
export const POST = importRakutenManga;
