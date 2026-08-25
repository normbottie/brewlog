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

-- ------------------------------------------------------------- sharing --
-- A member may opt in to letting other members READ their log. Nobody is
-- visible by default, and shared entries stay read-only to everyone else.

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  share_log    boolean default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
alter table public.profiles enable row level security;

-- ------------------------------------------------- admins and approval --
-- Two flags, added in place so existing projects can run this file again.
-- Everyone already using the app is grandfathered in: approval only gates
-- accounts created from here on. Re-running must never revoke someone.

do $$
declare introducing boolean;
begin
  introducing := not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'approved');

  alter table public.profiles add column if not exists approved boolean not null default false;
  alter table public.profiles add column if not exists is_admin boolean not null default false;

  -- The grandfathering itself happens near the end of this file, once every
  -- account actually has a profile row to grandfather.
  perform set_config('brewlog.introducing', introducing::text, false);
end $$;

-- Asked by policies on profiles itself, so it must not be subject to those
-- policies or it would recurse. security definer runs it as the owner.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.user_id = auth.uid()), false);
$$;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.approved or p.is_admin from public.profiles p
                   where p.user_id = auth.uid()), false);
$$;

/* Without this, "you may update your own row" would also mean "you may set
   your own approved and is_admin", which is the whole gate. Non-admins get
   their attempted values silently replaced with the existing ones. */
create or replace function public.guard_profile_flags()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /* Only guard requests that arrive as a signed-in user. Running this file
     in the SQL editor, or anything acting as service_role, has no
     auth.uid() — and must not be blocked, or the migration below could
     never grant the first admin. */
  if auth.uid() is null then
    return new;
  end if;
  if not public.is_admin() then
    if tg_op = 'INSERT' then
      new.is_admin := false;
      new.approved := false;
    else
      new.is_admin := old.is_admin;
      new.approved := old.approved;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_flags on public.profiles;
create trigger profiles_guard_flags
  before insert or update on public.profiles
  for each row execute function public.guard_profile_flags();

-- every member can see who is sharing (name only, never the email)
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles
  for select to authenticated using (true);

drop policy if exists "own profile write" on public.profiles;
create policy "own profile write" on public.profiles
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update to authenticated
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

-- ------------------------------------------------------------- policies --

alter table public.beans enable row level security;
alter table public.cafes enable row level security;

-- remove the older shared-key policies if they are still present
drop policy if exists "anon full access" on public.beans;
drop policy if exists "anon full access" on public.cafes;

-- Read: your own rows, plus rows owned by members who opted into sharing.
-- Write: only ever your own. Split into separate policies on purpose — a
-- single FOR ALL policy would let the read condition authorise writes too.
drop policy if exists "own beans" on public.beans;
drop policy if exists "beans readable" on public.beans;
create policy "beans readable" on public.beans
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_admin()
    or (public.is_approved()
        and exists (select 1 from public.profiles p
                    where p.user_id = beans.user_id and p.share_log))
  );
drop policy if exists "beans insert own" on public.beans;
create policy "beans insert own" on public.beans
  for insert to authenticated
  with check (auth.uid() = user_id and public.is_approved());
drop policy if exists "beans update own" on public.beans;
create policy "beans update own" on public.beans
  for update to authenticated
  using ((auth.uid() = user_id and public.is_approved()) or public.is_admin())
  with check ((auth.uid() = user_id and public.is_approved()) or public.is_admin());
drop policy if exists "beans delete own" on public.beans;
create policy "beans delete own" on public.beans
  for delete to authenticated
  using ((auth.uid() = user_id and public.is_approved()) or public.is_admin());

drop policy if exists "own cafes" on public.cafes;
drop policy if exists "cafes readable" on public.cafes;
create policy "cafes readable" on public.cafes
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_admin()
    or (public.is_approved()
        and exists (select 1 from public.profiles p
                    where p.user_id = cafes.user_id and p.share_log))
  );
drop policy if exists "cafes insert own" on public.cafes;
create policy "cafes insert own" on public.cafes
  for insert to authenticated
  with check (auth.uid() = user_id and public.is_approved());
drop policy if exists "cafes update own" on public.cafes;
create policy "cafes update own" on public.cafes
  for update to authenticated
  using ((auth.uid() = user_id and public.is_approved()) or public.is_admin())
  with check ((auth.uid() = user_id and public.is_approved()) or public.is_admin());
drop policy if exists "cafes delete own" on public.cafes;
create policy "cafes delete own" on public.cafes
  for delete to authenticated
  using ((auth.uid() = user_id and public.is_approved()) or public.is_admin());

-- Per-account app settings (currently the image-API key), so a second
-- device picks them up after sign-in instead of asking again.
create table if not exists public.settings (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  data        jsonb default '{}'::jsonb,
  updated_at  timestamptz default now()
);
alter table public.settings enable row level security;
drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.beans to authenticated;
grant select, insert, update, delete on public.cafes to authenticated;
grant select, insert, update, delete on public.settings to authenticated;
grant select, insert, update on public.profiles to authenticated;

-- give every existing member a profile row (not sharing by default)
insert into public.profiles (user_id, display_name)
select id, coalesce(split_part(email, '@', 1), 'Member') from auth.users
on conflict (user_id) do nothing;

/* Someone has to be able to approve the first newcomer. Edit the address
   below if the owner's account is not this one; failing a match, the
   longest-standing account is made admin so the project is never left
   with nobody who can let anyone in. */
do $$
declare owner_email text := 'normbottie@gmail.com';
begin
  /* Everyone already using the app when approval was introduced keeps
     working. This runs here, not beside the ALTER above, because the
     backfill that gives each account a profile row happens just before it.
     Guarded so re-running never un-revokes someone. */
  if current_setting('brewlog.introducing', true) = 'true' then
    update public.profiles set approved = true;
  end if;

  update public.profiles p
     set is_admin = true, approved = true
    from auth.users u
   where u.id = p.user_id
     and lower(u.email) = lower(owner_email);

  if not exists (select 1 from public.profiles where is_admin) then
    update public.profiles
       set is_admin = true, approved = true
     where user_id = (select user_id from public.profiles
                      order by created_at nulls last, user_id limit 1);
  end if;
end $$;

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
  raise notice 'Done. Tables: beans, cafes, settings, profiles. Next: set the Site URL and Redirect URLs under Authentication -> URL Configuration, then sign in from the app.';
end $$;
