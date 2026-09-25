-- Public tool visibility flags. A tool row here means the tool is PUBLIC:
-- available to every authenticated user without an individual grant.
-- Writes are service-role only; reads are allowed for any authenticated user
-- so that the app, proxy, and client can resolve access.

create table if not exists public.tool_settings (
    slug text primary key,
    is_public boolean not null default true,
    updated_at timestamptz not null default now()
);

alter table public.tool_settings enable row level security;

-- Any signed-in user may read the public set (used by pages, proxy, and client).
create policy "tool_settings_select_auth" on public.tool_settings
    for select to authenticated
    using (true);

-- Only the service role (admin helpers) may write.