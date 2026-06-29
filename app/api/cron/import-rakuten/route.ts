import { NextResponse } from "next/server";
import {
  fetchRakutenBookPage,
  fetchRakutenBooksGenre,
} from "@/lib/rakuten/client";
import {
  toRakutenMangaItemDetailRow,
  toRakutenMangaItemRow,
} from "@/lib/rakuten/import";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const COMIC_ROOT_GENRE_ID = "001001";
const GENRES_TO_DISCOVER_PER_RUN = 10;
const PAGES_PER_RUN = 20;
const REQUEST_INTERVAL_MS = 1200;
const DAILY_EMPTY_PAGE_LIMIT = 3;
const IMPORT_LOCK_NAME = "rakuten-manga-import";
const IMPORT_LOCK_TTL_SECONDS = maxDuration + 30;

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type InitialImportGenre = {
  genre_id: string;
  genre_name: string | null;
  next_page: number;
};

type DailyImportGenre = {
  genre_id: string;
  genre_name: string | null;
  daily_cycle_date: string | null;
  daily_next_page: number;
  daily_empty_page_count: number;
};

type PageSaveResult = {
  fetchedCount: number;
  savedCount: number;
  newIsbnCount: number;
};

type ImportMode = "auto" | "initial" | "daily";

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
  const requestedMode = normalizeImportMode(
    new URL(request.url).searchParams.get("mode"),
  );
  const acquired = await acquireImportLock(supabase);

  if (!acquired) {
    return NextResponse.json(
      { ok: false, error: "Rakuten import is already running." },
      { status: 409 },
    );
  }

  try {
    const discoveredCount = await discoverGenreChildren(supabase);
    const initialGenre = await findInitialImportGenre(supabase);

    if (initialGenre) {
      if (requestedMode === "daily") {
        return NextResponse.json(
          {
            ok: false,
            error: "Initial import has not completed.",
          },
          { status: 409 },
        );
      }

      const result = await importInitialGenre(supabase, initialGenre);
      return NextResponse.json({
        ok: true,
        mode: "initial",
        initialCompleted: false,
        discoveredCount,
        ...result,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }

    if (await hasPendingGenreDiscovery(supabase)) {
      if (requestedMode === "daily") {
        return NextResponse.json(
          {
            ok: false,
            error: "Genre discovery has not completed.",
          },
          { status: 409 },
        );
      }

      return NextResponse.json({
        ok: true,
        mode: "genre-discovery",
        discoveredCount,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }

    if (requestedMode === "initial") {
      return NextResponse.json({
        ok: true,
        mode: "initial",
        initialCompleted: true,
        discoveredCount,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }

    const cycleDate = new Date().toISOString().slice(0, 10);
    const dailyGenre = await findDailyImportGenre(
      supabase,
      cycleDate,
      new Date(`${cycleDate}T00:00:00.000Z`).toISOString(),
    );

    if (!dailyGenre) {
      return NextResponse.json({
        ok: true,
        mode: "daily",
        completed: true,
        discoveredCount,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }

    const result = await importDailyGenre(supabase, dailyGenre, cycleDate);
    return NextResponse.json({
      ok: true,
      mode: "daily",
      discoveredCount,
      ...result,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    console.error("[Rakuten import] Import failed.", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  } finally {
    await releaseImportLock(supabase);
  }
}

function normalizeImportMode(value: string | null): ImportMode {
  if (value === "initial" || value === "daily") {
    return value;
  }

  return "auto";
}

async function findInitialImportGenre(
  supabase: SupabaseAdminClient,
): Promise<InitialImportGenre | null> {
  const { data, error } = await supabase
    .from("rakuten_import_genres")
    .select("genre_id, genre_name, next_page")
    .eq("is_leaf", true)
    .is("completed_at", null)
    .neq("genre_id", COMIC_ROOT_GENRE_ID)
    .order("genre_id")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function findDailyImportGenre(
  supabase: SupabaseAdminClient,
  cycleDate: string,
  cycleStartedAt: string,
): Promise<DailyImportGenre | null> {
  const { data, error } = await supabase
    .from("rakuten_import_genres")
    .select(
      "genre_id, genre_name, daily_cycle_date, daily_next_page, daily_empty_page_count",
    )
    .eq("is_leaf", true)
    .or(
      `last_daily_completed_at.is.null,last_daily_completed_at.lt.${cycleStartedAt}`,
    )
    .order("genre_id")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data || data.daily_cycle_date === cycleDate) {
    return data;
  }

  return {
    ...data,
    daily_cycle_date: cycleDate,
    daily_next_page: 1,
    daily_empty_page_count: 0,
  };
}

async function hasPendingGenreDiscovery(
  supabase: SupabaseAdminClient,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("rakuten_import_genres")
    .select("genre_id")
    .is("children_discovered_at", null)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

async function importInitialGenre(
  supabase: SupabaseAdminClient,
  genre: InitialImportGenre,
) {
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
      includeSize: false,
    });
    const saved = await savePage(supabase, result.items, false);
    fetchedCount += saved.fetchedCount;
    savedCount += saved.savedCount;
    completed = result.pageCount === 0 || nextPage >= result.pageCount;
    nextPage = completed ? nextPage : nextPage + 1;
    const fetchedAt = new Date().toISOString();

    const { error } = await supabase
      .from("rakuten_import_genres")
      .update({
        next_page: nextPage,
        completed_at: completed ? fetchedAt : null,
        updated_at: fetchedAt,
      })
      .eq("genre_id", genre.genre_id);

    if (error) {
      throw error;
    }

    if (completed) {
      break;
    }

    if (index < PAGES_PER_RUN - 1) {
      await delay(REQUEST_INTERVAL_MS);
    }
  }

  console.info("[Rakuten import] Initial genre batch completed.", {
    genreId: genre.genre_id,
    genreName: genre.genre_name,
    fetchedCount,
    savedCount,
    nextPage,
    completed,
  });

  return {
    genreId: genre.genre_id,
    fetchedCount,
    savedCount,
    nextPage,
    completed,
  };
}

async function importDailyGenre(
  supabase: SupabaseAdminClient,
  genre: DailyImportGenre,
  cycleDate: string,
) {
  let nextPage = genre.daily_next_page;
  let emptyPageCount = genre.daily_empty_page_count;
  let fetchedCount = 0;
  let savedCount = 0;
  let newIsbnCount = 0;
  let completed = false;

  for (let index = 0; index < PAGES_PER_RUN; index += 1) {
    const result = await fetchRakutenBookPage({
      sort: "latest",
      page: nextPage,
      hits: 30,
      booksGenreId: genre.genre_id,
      includeSize: false,
    });
    const saved = await savePage(supabase, result.items, true);
    fetchedCount += saved.fetchedCount;
    savedCount += saved.savedCount;
    newIsbnCount += saved.newIsbnCount;
    emptyPageCount =
      saved.newIsbnCount === 0 ? emptyPageCount + 1 : 0;

    const reachedLastPage =
      result.pageCount === 0 || nextPage >= result.pageCount;
    const reachedEmptyLimit = emptyPageCount >= DAILY_EMPTY_PAGE_LIMIT;
    completed = reachedLastPage || reachedEmptyLimit;
    nextPage = completed ? 1 : nextPage + 1;
    const fetchedAt = new Date().toISOString();

    const { error } = await supabase
      .from("rakuten_import_genres")
      .update({
        daily_cycle_date: cycleDate,
        daily_next_page: nextPage,
        daily_empty_page_count: completed ? 0 : emptyPageCount,
        last_daily_completed_at: completed ? fetchedAt : null,
        updated_at: fetchedAt,
      })
      .eq("genre_id", genre.genre_id);

    if (error) {
      throw error;
    }

    if (completed) {
      break;
    }

    if (index < PAGES_PER_RUN - 1) {
      await delay(REQUEST_INTERVAL_MS);
    }
  }

  console.info("[Rakuten import] Daily genre batch completed.", {
    genreId: genre.genre_id,
    genreName: genre.genre_name,
    fetchedCount,
    savedCount,
    newIsbnCount,
    nextPage,
    emptyPageCount,
    completed,
  });

  return {
    genreId: genre.genre_id,
    fetchedCount,
    savedCount,
    newIsbnCount,
    nextPage,
    emptyPageCount,
    completed,
  };
}

async function savePage(
  supabase: SupabaseAdminClient,
  items: Parameters<typeof toRakutenMangaItemRow>[0][],
  detectNewIsbns: boolean,
): Promise<PageSaveResult> {
  const fetchedAt = new Date().toISOString();
  const itemRows = Array.from(
    new Map(
      items
        .map((item) => toRakutenMangaItemRow(item, fetchedAt))
        .filter((row) => row !== null)
        .map((row) => [row.isbn, row]),
    ).values(),
  );
  const detailRows = Array.from(
    new Map(
      items
        .map((item) => toRakutenMangaItemDetailRow(item, fetchedAt))
        .filter((row) => row !== null)
        .map((row) => [row.isbn, row]),
    ).values(),
  );

  let newIsbnCount = 0;

  if (detectNewIsbns && itemRows.length > 0) {
    const { data, error } = await supabase
      .from("rakuten_manga_items")
      .select("isbn")
      .in(
        "isbn",
        itemRows.map((row) => row.isbn),
      );

    if (error) {
      throw error;
    }

    newIsbnCount = itemRows.length - (data?.length ?? 0);
  }

  if (itemRows.length > 0) {
    const { error } = await supabase
      .from("rakuten_manga_items")
      .upsert(itemRows, { onConflict: "isbn" });

    if (error) {
      throw error;
    }
  }

  if (detailRows.length > 0) {
    const { error } = await supabase
      .from("rakuten_manga_item_details")
      .upsert(detailRows, { onConflict: "isbn" });

    if (error) {
      throw error;
    }
  }

  return {
    fetchedCount: items.length,
    savedCount: itemRows.length,
    newIsbnCount,
  };
}

async function discoverGenreChildren(
  supabase: SupabaseAdminClient,
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

async function acquireImportLock(
  supabase: SupabaseAdminClient,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("acquire_rakuten_import_lock", {
    p_lock_name: IMPORT_LOCK_NAME,
    p_ttl_seconds: IMPORT_LOCK_TTL_SECONDS,
  });

  if (error) {
    throw error;
  }

  return data === true;
}

async function releaseImportLock(
  supabase: SupabaseAdminClient,
): Promise<void> {
  const { error } = await supabase.rpc("release_rakuten_import_lock", {
    p_lock_name: IMPORT_LOCK_NAME,
  });

  if (error) {
    console.error("[Rakuten import] Failed to release import lock.", error);
  }
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
