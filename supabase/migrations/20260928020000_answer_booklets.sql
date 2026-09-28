-- Scanned answer booklets, one row per booklet uploaded by the Booklet Scanner.
--
-- Separate from `attendance` on purpose: attendance says a candidate was in the
-- hall, this says their booklet was actually scanned and uploaded. A candidate
-- can be marked present and never scanned (absent, or the exam was missed), and
-- the two lists are read separately on the records page.
--
-- The student/course columns are denormalised copies of the attendance row the
-- scanner looked up by booklet code. They are copied rather than joined so the
-- records page can list booklets with the same single-pass filter the attendance
-- table uses, and so a booklet stays readable even if the attendance row is later
-- corrected or removed.
--
-- !! This table already exists on the live database, with a different shape !!
--
-- It was created by `20260926000000_create_answer_booklets.sql`, added in c15694e
-- and deleted in 179e644 when tool access moved to the RBAC model. Dropping a
-- migration file does not drop the schema it created, so the table and its
-- storage bucket outlived their migration. The live table therefore:
--
--   * has no `qp_code_scanned` column  -> the QP Code column on the Booklets tab
--                                         had nothing to read and rendered "—"
--   * stores a public URL in `booklet_url` instead of a path in `file_path`
--   * has no unique constraint on `answer_booklet_code`, which the upload route's
--     upsert needs as a conflict target
--   * carries two permissive RLS policies from the old model, which let any
--     signed-in user read every booklet row and insert rows for themselves,
--     bypassing the server-side tool access check entirely
--
-- So the create below is only for databases that never had the old table (fresh
-- projects, local dev). Everything after it brings an existing table into line,
-- preserving the rows and files already in it.

create table if not exists public.answer_booklets (
    id                    uuid primary key default gen_random_uuid(),

    -- Booklet identity
    answer_booklet_code   text not null,
    uucms                 text,
    student_name          text,

    -- Copied from the attendance row this booklet was scanned against
    college_code          text,
    college_name          text,
    program_name          text,
    semester              text,
    academic_year         text,
    course_code           text,
    course_name           text,
    exam_date             text,
    -- Kept so the QP code filter on the records page means the same thing on both
    -- tabs, and so a booklet can be traced back to the paper it was marked against.
    qp_code_scanned       text,

    -- The compiled scan, as a storage path. The bucket is private, so this is
    -- resolved to a short-lived signed URL per view, never handed out stored.
    page_count            integer,
    file_path             text,

    -- Meta
    uploaded_by           uuid references auth.users(id),
    uploaded_at           timestamptz not null default now(),

    -- One row per booklet: a re-scan replaces the earlier row rather than listing
    -- twice, which is what the uploader expects after a retry.
    unique (answer_booklet_code)
);

-- Bring a pre-existing table in line. `add column if not exists` is a no-op on a
-- fresh database and the ALTERs below are guarded, so this file is safe to run
-- against both shapes.
alter table public.answer_booklets add column if not exists qp_code_scanned text;
alter table public.answer_booklets add column if not exists file_path text;

-- The old table required a URL that the current upload route does not produce
-- (and could not honestly produce: a stored signed URL expires). Relax it to
-- nullable and keep it only as a record of how pre-existing rows were linked.
-- Guarded, because on a fresh database the column does not exist at all.
do $$
begin
    if exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'answer_booklets'
           and column_name = 'booklet_url'
    ) then
        alter table public.answer_booklets alter column booklet_url drop not null;
    end if;
    -- The old table also forced page_count; the default of 0 already covers a
    -- scanner that could not count pages.
    if exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'answer_booklets'
           and column_name = 'page_count' and is_nullable = 'NO'
    ) then
        alter table public.answer_booklets alter column page_count drop not null;
    end if;
end $$;

-- Recover the storage path for rows uploaded against the old public URL, so the
-- signed-URL route can serve them. The bucket name and object layout are
-- unchanged, so the path is recoverable from the URL without touching storage.
update public.answer_booklets
   set file_path = regexp_replace(
           split_part(booklet_url, '?', 1),
           '^.*/storage/v1/object/(public|sign)/[^/]+/', '')
 where file_path is null
   and booklet_url is not null
   and booklet_url <> ''
   and booklet_url like '%/storage/v1/object/%/%'
   and regexp_replace(
           split_part(booklet_url, '?', 1),
           '^.*/storage/v1/object/(public|sign)/[^/]+/', '') <> '';

-- Backfill the QP code from the attendance row the booklet was scanned against.
-- This is what makes the Booklets tab's QP Code column render for booklets that
-- predate the column, rather than showing a dash for ever.
update public.answer_booklets b
   set qp_code_scanned = a.qp_code_scanned
  from public.attendance a
 where a.answer_booklet_code = b.answer_booklet_code
   and coalesce(b.qp_code_scanned, '') = ''
   and coalesce(a.qp_code_scanned, '') <> '';

-- The upload route upserts on the booklet code, which needs a unique constraint
-- to name as a conflict target. Collapse any pre-existing duplicates first, one
-- row per code, keeping the most recent scan, so the constraint can be added
-- without failing on data that predates it.
delete from public.answer_booklets a
 using public.answer_booklets b
 where a.answer_booklet_code = b.answer_booklet_code
   and (a.uploaded_at, a.id) < (b.uploaded_at, b.id);

do $$
begin
    if not exists (
        select 1 from pg_constraint
         where conrelid = 'public.answer_booklets'::regclass
           and conname = 'answer_booklets_code_key'
    ) then
        alter table public.answer_booklets
            add constraint answer_booklets_code_key unique (answer_booklet_code);
    end if;
end $$;

-- The unique constraint brings its own index, so the old plain index on the same
-- column is now redundant.
drop index if exists public.answer_booklets_code_idx;

create index if not exists answer_booklets_uucms_idx
    on public.answer_booklets (uucms);
create index if not exists answer_booklets_qp_code_idx
    on public.answer_booklets (qp_code_scanned);
create index if not exists answer_booklets_uploaded_by_idx
    on public.answer_booklets (uploaded_by);

-- RLS, matching the attendance model: reads and writes go through the service
-- role in the API routes, which check tool access server-side first. Enabling
-- RLS with no policy is what closes the table to direct client access, so no
-- policy is created here — see 20260925000002_attendance_rls.sql for the
-- reasoning. The two policies below are dropped explicitly: they were written
-- for the pre-RBAC model and granted every signed-in user full read access plus
-- self-attributed inserts, which is the access check this route layer exists to
-- enforce. They would otherwise survive this migration untouched and quietly
-- undo it.
alter table public.answer_booklets enable row level security;
drop policy if exists "authenticated users can insert answer_booklets"
    on public.answer_booklets;
drop policy if exists "authenticated users can read answer_booklets"
    on public.answer_booklets;

-- The compiled PDFs. Deliberately not public: a booklet is a candidate's marked
-- answers. Nothing is served straight from here either — the file route mints a
-- short-lived signed URL after its own access check.
--
-- Created private for databases that do not have the bucket yet. NOTE: the live
-- bucket `answer_booklets` predates this migration and is currently public, so
-- this insert is a no-op there and does NOT make it private. Tightening it is a
-- separate, deliberate step.
insert into storage.buckets (id, name, public)
values ('answer_booklets', 'answer_booklets', false)
on conflict (id) do nothing;
