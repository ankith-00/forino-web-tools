-- Attendance writes now go through POST /api/attendance, which verifies
-- scanner access server-side (live app_metadata + public-tool set) before
-- inserting with the service role. The table is therefore closed to direct
-- authenticated inserts/reads — any policy that let clients bypass the
-- tool-access model is dropped.

drop policy if exists "authenticated users can insert attendance" on public.attendance;
drop policy if exists "authenticated users can read attendance" on public.attendance;