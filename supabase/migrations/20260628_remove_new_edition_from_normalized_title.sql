create or replace function public.normalize_manga_title(
  input_title text,
  remove_volume_suffix boolean default false
)
returns text
language plpgsql
immutable
strict
as $$
declare
  normalized text;
  without_new_edition text;
  stripped text;
begin
  normalized := lower(
    btrim(
      regexp_replace(
        replace(normalize(input_title, NFKC), '　', ' '),
        '[[:space:]]+',
        ' ',
        'g'
      )
    )
  );

  if not remove_volume_suffix then
    return normalized;
  end if;

  -- Remove a trailing "新版" first so a preceding volume number becomes the
  -- new suffix and can be removed by the existing volume rule.
  without_new_edition := btrim(
    regexp_replace(normalized, '[[:space:]]*新版$', '', 'g')
  );
  without_new_edition := coalesce(
    nullif(without_new_edition, ''),
    normalized
  );

  stripped := btrim(
    regexp_replace(
      without_new_edition,
      '[[:space:]]*(第[[:space:]]*[0-9]+[[:space:]]*巻|[(][[:space:]]*[0-9]+[[:space:]]*[)]|vol[.]?[[:space:]]*[0-9]+|[0-9]+[[:space:]]*巻|[0-9]+)$',
      '',
      'i'
    )
  );

  return coalesce(nullif(stripped, ''), without_new_edition);
end;
$$;

-- Stored generated values do not change when their function definition
-- changes, so recreate the column to recalculate every existing item.
drop index if exists public.rakuten_manga_items_normalized_title_idx;

alter table public.rakuten_manga_items
  drop column if exists normalized_title;

alter table public.rakuten_manga_items
  add column normalized_title text
  generated always as (
    public.normalize_manga_title(title, true)
  ) stored;

create index rakuten_manga_items_normalized_title_idx
  on public.rakuten_manga_items(normalized_title);
