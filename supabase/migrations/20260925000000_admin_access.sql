-- Admin/access labels stored directly on the auth user's app_metadata.
-- app_metadata is client-READ-only; only the server (service role) can write it,
-- so users cannot self-promote to admin or grant themselves tool access.

-- 1) Trigger: give every new signup a default label
create or replace function public.set_default_access_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    new.raw_app_meta_data :=
        coalesce(new.raw_app_meta_data, '{}'::jsonb)
        || '{"role":"user","tool_access":[]}'::jsonb;
    return new;
end;
$$;

create or replace trigger on_auth_user_created
    before insert on auth.users
    for each row
    execute procedure public.set_default_access_metadata();

-- 2) Bootstrap the first admin (run once from the SQL editor, replacing the email):
--   update auth.users
--   set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
--   where email = 'you@example.com';