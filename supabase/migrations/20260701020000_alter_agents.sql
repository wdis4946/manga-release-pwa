alter table if exists public.agents
  drop column if exists birth_year,
  drop column if exists birth_month,
  drop column if exists birth_day,
  drop column if exists birth_date_precision,
  drop column if exists birth_date_percision,
  add column if not exists author_wiki_link text,
  add column if not exists gender text;
