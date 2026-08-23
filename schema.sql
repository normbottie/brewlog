-- Brewlog — Supabase schema (v3, with accounts)
--
-- Paste this into the Supabase SQL editor and run it. Safe on a fresh project
-- or over an older Brewlog schema, and safe to run more than once.
--
-- Also set Authentication → URL Configuration → Site URL and Redirect URLs to
-- your app's address, e.g. https://<you>.github.io/brewlog/
--
-- Every row belongs to exactly one account and is invisible to every other
-- account.
--
-- NOTE: the storage section at the bottom is wrapped in exception handlers on
-- purpose. On many projects `storage.objects` is owned by another role, so
-- creating policies on it raises "42501: must be owner of table objects". The
-- SQL editor runs this whole file as ONE transaction, so an unhandled error
-- there would roll back the tables above it and leave you with nothing. If the
-- storage part is skipped, the app still syncs — only bag image upload is
-- affected, and the notices tell you how to finish it in the dashboard.

-- ---------------------------------------------------------------- tables --

create table if not exists public.beans (
  id            uuid primary key,
  user_id       uuid references auth.users (id) on delete cascade,
  name          text,
  roaster       text,
  origin        text,
  region        text,
  process       text,
  varietal      text,
  roast_level   text,
  roast_date    text,
  price         text,
  weight_g      text,
  brew_method   text,
  grind         text,
  flavor_notes  jsonb default '[]'::jsonb,
  ratings       jsonb default '{}'::jsonb,
  overall       int  default 0,
  notes         text,
  image_url     text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  deleted       boolean default false
);

create table if not exists public.cafes (
  id          uuid primary key,
  user_id     uuid references auth.users (id) on delete cascade,
  name        text,
  address     text,
  lat         double precision,
  lng         double precision,
  rating      int default 0,
  notes       text,
  visited_on  text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  deleted     boolean default false
);

-- upgrading from a version without accounts
alter table public.beans add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.cafes add column if not exists user_id uuid references auth.users (id) on delete cascade;

create index if not exists beans_user_updated_idx on public.beans (user_id, updated_at);
create index if not exists cafes_user_updated_idx on public.cafes (user_id, updated_at);

-- ------------------------------------------------------------- policies --

alter table public.beans enable row level security;
alter table public.cafes enable row level security;

-- remove the older shared-key policies if they are still present
drop policy if exists "anon full access" on public.beans;
drop policy if exists "anon full access" on public.cafes;

drop policy if exists "own beans" on public.beans;
create policy "own beans" on public.beans
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own cafes" on public.cafes;
create policy "own cafes" on public.cafes
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.beans to authenticated;
grant select, insert, update, delete on public.cafes to authenticated;

-- ------------------------------------------------------------ migration --
-- Adopt rows created before accounts existed. Sign in through the app once so
-- your account exists, then run this file again.

do $$
declare
  target uuid;
  orphan_beans int;
  orphan_cafes int;
begin
  select count(*) into orphan_beans from public.beans where user_id is null;
  select count(*) into orphan_cafes from public.cafes where user_id is null;

  if orphan_beans = 0 and orphan_cafes = 0 then
    raise notice 'Migration: nothing to adopt.';
    return;
  end if;

  if (select count(*) from auth.users) <> 1 then
    raise notice 'Migration: % orphan beans and % orphan cafes found, but there is not exactly one user. Set target to the right auth.users id by hand and re-run.',
                 orphan_beans, orphan_cafes;
    return;
  end if;

  select id into target from auth.users limit 1;
  update public.beans set user_id = target where user_id is null;
  update public.cafes set user_id = target where user_id is null;
  raise notice 'Migration: adopted % beans and % cafes.', orphan_beans, orphan_cafes;
end $$;

-- -------------------------------------------------------------- storage --
-- Bag images live at bag-images/<user-id>/<bean-id>.jpg.
--
-- Everything below is best-effort. If your project does not let you touch
-- storage from SQL, nothing here aborts the script — read the notices and
-- finish those bits in the dashboard instead.

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('bag-images', 'bag-images', true)
  on conflict (id) do update set public = true;
  raise notice 'Storage: bucket bag-images ready.';
exception when others then
  raise notice 'Storage: could not create the bucket (%). Create it by hand: Storage -> New bucket -> name it bag-images -> tick Public.', sqlerrm;
end $$;

do $$
declare
  stmt text;
begin
  foreach stmt in array array[
    $p$drop policy if exists "bag images read" on storage.objects$p$,
    $p$create policy "bag images read" on storage.objects
        for select to anon, authenticated
        using (bucket_id = 'bag-images')$p$,
    $p$drop policy if exists "bag images write" on storage.objects$p$,
    $p$create policy "bag images write" on storage.objects
        for insert to authenticated
        with check (bucket_id = 'bag-images'
                    and (storage.foldername(name))[1] = auth.uid()::text)$p$,
    $p$drop policy if exists "bag images update" on storage.objects$p$,
    $p$create policy "bag images update" on storage.objects
        for update to authenticated
        using (bucket_id = 'bag-images'
               and (storage.foldername(name))[1] = auth.uid()::text)$p$,
    $p$drop policy if exists "bag images delete" on storage.objects$p$,
    $p$create policy "bag images delete" on storage.objects
        for delete to authenticated
        using (bucket_id = 'bag-images'
               and (storage.foldername(name))[1] = auth.uid()::text)$p$
  ]
  loop
    execute stmt;
  end loop;
  raise notice 'Storage: image policies installed.';
exception when others then
  raise notice 'Storage: could not set image policies (%). Sync still works; bag photos just stay on each device. To fix, add the policies under Storage -> Policies in the dashboard.', sqlerrm;
end $$;

-- --------------------------------------------------------- schema cache --
-- PostgREST caches the list of tables. Without this, a brand-new table can
-- 404 for a minute or two even though it exists.

notify pgrst, 'reload schema';

do $$
begin
  raise notice 'Done. Tables: beans, cafes. Next: set the Site URL and Redirect URLs under Authentication -> URL Configuration, then sign in from the app.';
end $$;
