-- Make the scanned-booklet bucket private.
--
-- It was created public by 20260926000000_create_answer_booklets.sql, whose
-- migration file was deleted in 179e644 while the schema it created lived on. A
-- booklet is a candidate's marked answer sheet, and a public bucket means the
-- object URL alone is enough to read it: confirmed with an unauthenticated GET
-- returning 200 for a real scan. The 20260928020000 migration could not fix this,
-- because its `insert ... on conflict do nothing` is a no-op against a bucket
-- that already exists.
--
-- Access model after this change:
--
--   * No policy on storage.objects for this bucket, so no client — anonymous or
--     authenticated — can read an object through the Storage API.
--   * The service role is the only reader, and only via the two API routes, which
--     check tool access server-side first and then mint a short-lived signed URL:
--       POST /api/answer-booklet/upload  (requires webcam-scanner)
--       GET  /api/answer-booklet/file   (requires webcam-scanner or
--                                         attendance-records)
--
-- This is deliberately stricter than a `to authenticated` select policy. Such a
-- policy would hand every signed-in account read access to every candidate's
-- booklet, including accounts that were never granted either tool, which is the
-- gap the RBAC work in 179e644 closed. Tool access is enforced at the route, so
-- the storage layer needs no policy of its own.
--
-- Reversible: `update storage.buckets set public = true where id = ...`. Note
-- that doing so would also un-break the legacy `booklet_url` values, which are
-- plain public object URLs and are the reason this bucket was reachable at all.
--
-- Consequence for existing links: the one stored `booklet_url` stops resolving,
-- because it is a public URL. The records page does not use it — the file route
-- looks the row up by id and recovers the storage path from that URL as a
-- fallback — so the Booklets tab keeps working.

update storage.buckets
   set public = false
 where id = 'answer_booklets';

-- Belt and braces: drop any policy on storage.objects that referenced this bucket
-- by name, so "private with no client read path" is the enforced state rather
-- than merely the current one. Matching on the policy text is the only way to find
-- these, since the bucket is named inside the expression rather than as a
-- column. Policies for other buckets (pdf-engine) do not mention it and are left
-- alone.
do $$
declare
    p record;
begin
    for p in
        select policyname
          from pg_policies
         where schemaname = 'storage'
           and tablename = 'objects'
           and (coalesce(qual, '') like '%answer_booklets%'
                or coalesce(with_check, '') like '%answer_booklets%')
    loop
        execute format('drop policy if exists %I on storage.objects', p.policyname);
    end loop;
end $$;
