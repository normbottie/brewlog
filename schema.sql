-- Brewlog — Supabase schema
-- Paste this into the Supabase SQL editor and run it once.
--
-- NOTE ON SECURITY: the policies below allow anyone holding the project's
-- anon key to read and write these tables. That is fine for a private
-- personal app whose URL you do not share, and it is what lets the PWA sync
-- with no login screen. If you ever share the app or the key, switch to
-- Supabase Auth and replace the `using (true)` policies with
-- `using (auth.uid() = user_id)`.

create table if not exists public.beans (
  id            uuid primary key,
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

create index if not exists beans_updated_at_idx on public.beans (updated_at);
create index if not exists cafes_updated_at_idx on public.cafes (updated_at);

alter table public.beans enable row level security;
alter table public.cafes enable row level security;

drop policy if exists "anon full access" on public.beans;
create policy "anon full access" on public.beans
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "anon full access" on public.cafes;
create policy "anon full access" on public.cafes
  for all to anon, authenticated using (true) with check (true);

-- Storage bucket for the studio bag shots -------------------------------
insert into storage.buckets (id, name, public)
values ('bag-images', 'bag-images', true)
on conflict (id) do nothing;

drop policy if exists "bag images read" on storage.objects;
create policy "bag images read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'bag-images');

drop policy if exists "bag images write" on storage.objects;
create policy "bag images write" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'bag-images');

drop policy if exists "bag images update" on storage.objects;
create policy "bag images update" on storage.objects
  for update to anon, authenticated using (bucket_id = 'bag-images');
