-- Brewlog — Supabase schema (v2, with accounts)
--
-- Paste this into the Supabase SQL editor and run it. It is safe to run on a
-- fresh project or over the v1 schema; the migration block near the bottom
-- adopts any existing rows into your account.
--
-- Sign-in is a passwordless magic link, so there is nothing else to configure
-- beyond one setting: Authentication → URL Configuration → Redirect URLs must
-- include your app's address, e.g.
--     https://<you>.github.io/brewlog/
--
-- Every row belongs to exactly one account and is invisible to every other
-- account. Sharing a log between people is deliberately not supported here.

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

-- upgrading from v1, where these columns did not exist
alter table public.beans add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.cafes add column if not exists user_id uuid references auth.users (id) on delete cascade;

create index if not exists beans_user_updated_idx on public.beans (user_id, updated_at);
create index if not exists cafes_user_updated_idx on public.cafes (user_id, updated_at);

-- ------------------------------------------------------------- policies --

alter table public.beans enable row level security;
alter table public.cafes enable row level security;

-- drop the v1 shared-key policies if they are still there
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

-- -------------------------------------------------------------- storage --
-- Bag images live at bag-images/<user-id>/<bean-id>.jpg. The bucket is public
-- so the app can show images with a plain <img> tag, but only the owner can
-- write into their own folder. Anyone who guesses a full URL can view that
-- one image; if that bothers you, set public = false and switch
-- beanImageURL() over to signed URLs.

insert into storage.buckets (id, name, public)
values ('bag-images', 'bag-images', true)
on conflict (id) do update set public = true;

drop policy if exists "bag images read" on storage.objects;
create policy "bag images read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'bag-images');

drop policy if exists "bag images write" on storage.objects;
create policy "bag images write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'bag-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "bag images update" on storage.objects;
create policy "bag images update" on storage.objects
  for update to authenticated
  using (bucket_id = 'bag-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "bag images delete" on storage.objects;
create policy "bag images delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'bag-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------ migration --
-- Adopt rows created before accounts existed. Sign in through the app once so
-- your user exists, then run this. With exactly one user it needs no editing;
-- with several, replace the subquery with your own id.

do $$
declare
  target uuid;
  orphan_beans int;
  orphan_cafes int;
begin
  select count(*) into orphan_beans from public.beans where user_id is null;
  select count(*) into orphan_cafes from public.cafes where user_id is null;

  if orphan_beans = 0 and orphan_cafes = 0 then
    raise notice 'Nothing to migrate.';
    return;
  end if;

  if (select count(*) from auth.users) <> 1 then
    raise notice 'Found % orphan beans and % orphan cafes, but there is not exactly one user. '
                 'Set `target` to the right auth.users id by hand and re-run.',
                 orphan_beans, orphan_cafes;
    return;
  end if;

  select id into target from auth.users limit 1;
  update public.beans set user_id = target where user_id is null;
  update public.cafes set user_id = target where user_id is null;
  raise notice 'Adopted % beans and % cafes into %.', orphan_beans, orphan_cafes, target;
end $$;
