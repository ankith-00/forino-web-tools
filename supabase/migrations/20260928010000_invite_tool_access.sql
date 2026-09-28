-- Tool access chosen by the admin at invite time.
--
-- The admin picks what the invitee gets when they send the invitation, and the
-- choice is applied to the auth account at accept time (src/app/invite/accept/actions.ts).
-- It lives on the invite rather than on a user row because no user exists yet: the
-- Supabase account is only created when the invitee opens the link and sets a
-- password.
--
-- Two lists, not one, because the platform already has a default for public tools:
-- `mergeToolAccess` hands every user the public set, and a block overrides both
-- that and any individual grant. So:
--
--   granted_tools -- PRIVATE tools to grant individually. Public tools must never
--                    be listed here (see the stale-grant trap documented on
--                    unbanUserWithTools in manage-users/actions.ts).
--   blocked_tools -- PUBLIC tools the admin switched off for this person.
--
-- Splitting them keeps the stored intent unambiguous even if a tool is flipped
-- between public and private later: a grant stays a grant, a block stays a block.

alter table public.user_invites
    add column if not exists granted_tools text[] not null default '{}',
    add column if not exists blocked_tools text[] not null default '{}';

-- Invitations created before this migration get the empty arrays from the default,
-- which is exactly right: nobody chose anything, so the account comes up on the
-- public set alone, same as it did before.
