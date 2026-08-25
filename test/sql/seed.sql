-- Accounts that already exist when the admin/approval migration is run.
-- Order matters: the migration grandfathers in whoever is already here, so
-- these have to predate it, exactly as they would in a live project.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'normbottie@gmail.com'),
  ('00000000-0000-4000-8000-000000000002', 'member@example.com')
on conflict do nothing;
