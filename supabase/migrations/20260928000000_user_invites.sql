-- Admin-issued user invitations.
--
-- One row per invitation. The emailed link carries a raw 32-byte random token;
-- only its SHA-256 hash is stored here, so a database leak cannot be replayed
-- into accounts. Tokens are single-use (`status` flips to 'accepted') and expire.
--
-- A row is deliberately NOT created at invite time for the auth user itself:
-- the Supabase account is only created when the invitee opens the link and sets
-- a password (see src/lib/invites.ts). That keeps a bounced or ignored invite
-- from littering auth.users, and lets the same address be re-invited.
--
-- Access is service-role only. RLS is enabled with no policies, so the anon and
-- authenticated roles see nothing -- only the admin helpers in src/lib/invites.ts,
-- which use the service-role key, can read or write. The public /invite/accept
-- page therefore cannot enumerate invitations even though it is unauthenticated.

create table if not exists public.user_invites (
    id uuid primary key default gen_random_uuid(),
    -- Stored lowercased: Supabase treats emails case-insensitively, so an invite
    -- to Ada@x.com must not be re-invited as ada@x.com.
    email text not null,
    display_name text,
    token_hash text not null unique,
    status text not null default 'pending',
    invited_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    accepted_at timestamptz
);

alter table public.user_invites enable row level security;

-- Constrain status in the database too: a stray 'pendign' from a future refactor
-- would otherwise silently read as pending.
alter table public.user_invites
    drop constraint if exists user_invites_status_check;
alter table public.user_invites
    add constraint user_invites_status_check
    check (status in ('pending', 'accepted', 'revoked'));

-- Re-inviting an address supersedes its earlier pending rows; the accept lookup
-- is by token hash, but this keeps "who is still waiting" cheap to answer.
create index if not exists user_invites_email_idx on public.user_invites (email);
create index if not exists user_invites_pending_idx
    on public.user_invites (status, expires_at)
    where status = 'pending';

-- No policies: service role only. The invitation link is the capability, and
-- anybody who can read this table could mint themselves an invitation.
