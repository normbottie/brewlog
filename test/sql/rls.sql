-- Does the approval gate actually hold? Run as the `authenticated` role
-- with auth.uid() switched between accounts, which is how PostgREST runs.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

-- The owner and the member were seeded before the migration ran, so they
-- are grandfathered in. This one signs up afterwards — the case approval
-- exists for.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000003', 'newcomer@example.com')
on conflict do nothing;

insert into public.profiles (user_id, display_name, share_log)
values ('00000000-0000-4000-8000-000000000002', 'Member', true)
on conflict (user_id) do update set share_log = true;

-- the member's bag, which they share
insert into public.beans (id, user_id, name)
values ('aaaaaaaa-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002', 'Shared Bag')
on conflict (id) do nothing;

create or replace function act_as(u text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u, false); $$;

create or replace function report(label text, got boolean, want boolean)
returns void language plpgsql as $$
begin
  raise notice '%  %', case when got = want then 'PASS' else 'FAIL' end, label;
  if got <> want then
    raise notice '      expected % got %', want, got;
  end if;
end $$;

set role authenticated;

-- ---- the newcomer is unapproved -------------------------------------
select act_as('00000000-0000-4000-8000-000000000003');

select report('newcomer cannot read a shared bag',
  exists(select 1 from public.beans where id = 'aaaaaaaa-0000-4000-8000-000000000001'), false);

select report('newcomer is not approved', public.is_approved(), false);
select report('newcomer is not admin', public.is_admin(), false);

-- the escalation that would defeat the whole gate
insert into public.profiles (user_id, display_name, approved, is_admin)
values ('00000000-0000-4000-8000-000000000003', 'Newcomer', true, true)
on conflict (user_id) do update set approved = true, is_admin = true;

select report('newcomer cannot approve themselves on insert', public.is_approved(), false);
select report('newcomer cannot make themselves admin', public.is_admin(), false);

update public.profiles set approved = true, is_admin = true
 where user_id = '00000000-0000-4000-8000-000000000003';
select report('newcomer cannot approve themselves on update', public.is_approved(), false);

select report('newcomer still cannot read a shared bag',
  exists(select 1 from public.beans where id = 'aaaaaaaa-0000-4000-8000-000000000001'), false);

-- but they can still write their own name, or onboarding would be impossible
update public.profiles set display_name = 'Newcomer' where user_id = auth.uid();
select report('newcomer can still set their own display name',
  exists(select 1 from public.profiles
         where user_id = auth.uid() and display_name = 'Newcomer'), true);

-- ---- the approved member --------------------------------------------
select act_as('00000000-0000-4000-8000-000000000002');
select report('member is approved', public.is_approved(), true);
select report('member reads their own bag',
  exists(select 1 from public.beans where id = 'aaaaaaaa-0000-4000-8000-000000000001'), true);

-- ---- the admin --------------------------------------------------------
select act_as('00000000-0000-4000-8000-000000000001');
select report('owner is admin', public.is_admin(), true);
select report('admin reads someone else''s bag',
  exists(select 1 from public.beans where id = 'aaaaaaaa-0000-4000-8000-000000000001'), true);

update public.beans set name = 'Edited By Admin'
 where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select report('admin can edit someone else''s bag',
  exists(select 1 from public.beans
         where id = 'aaaaaaaa-0000-4000-8000-000000000001' and name = 'Edited By Admin'), true);

update public.profiles set approved = true
 where user_id = '00000000-0000-4000-8000-000000000003';

select act_as('00000000-0000-4000-8000-000000000003');
select report('once approved, the newcomer reads shared bags',
  exists(select 1 from public.beans where id = 'aaaaaaaa-0000-4000-8000-000000000001'), true);
select report('approving does not also make them admin', public.is_admin(), false);

-- a member must not be able to edit someone else's bag
select act_as('00000000-0000-4000-8000-000000000002');
update public.beans set name = 'Member Overwrote It'
 where id = 'aaaaaaaa-0000-4000-8000-000000000001' and user_id <> auth.uid();
select report('a plain member cannot edit another member''s bag',
  exists(select 1 from public.beans where name = 'Member Overwrote It'), false);

reset role;
