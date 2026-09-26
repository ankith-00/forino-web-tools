-- Answer booklet upload records
-- Each row = one uploaded answer booklet with page images stored in the answer_booklet bucket
-- Links back to the attendance record via answer_booklet_code

create table if not exists public.answer_booklets (
    id                    uuid primary key default gen_random_uuid(),

    -- Candidate identity (from attendance lookup)
    answer_booklet_code   text not null,
    uucms                 text,
    student_name          text,
    college_code          text,
    college_name          text,
    program_name          text,
    semester              text,
    academic_year         text,
    course_code           text,
    course_name           text,
    exam_date             text,

    -- Uploaded booklet pages (public URL from answer_booklet bucket)
    booklet_url           text not null,

    -- Pages count for reference
    page_count            int not null default 0,

    -- Meta
    uploaded_by           uuid references auth.users(id),
    uploaded_at           timestamptz not null default now()
);

-- Indexes
create index if not exists answer_booklets_code_idx on public.answer_booklets (answer_booklet_code);
create index if not exists answer_booklets_uucms_idx on public.answer_booklets (uucms);
create index if not exists answer_booklets_uploaded_by_idx on public.answer_booklets (uploaded_by);

-- RLS
alter table public.answer_booklets enable row level security;

create policy "authenticated users can insert answer_booklets"
    on public.answer_booklets for insert
    to authenticated
    with check (auth.uid() = uploaded_by);

create policy "authenticated users can read answer_booklets"
    on public.answer_booklets for select
    to authenticated
    using (true);
