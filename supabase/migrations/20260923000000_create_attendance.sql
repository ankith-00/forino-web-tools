-- Attendance records for barcode scanner workflow
-- Each row = one verified attendance entry (hall ticket + QP + answer booklet)

create table if not exists public.attendance (
    id              uuid primary key default gen_random_uuid(),

    -- Student identity (from MongoDB hall ticket scan)
    uucms           text not null,
    student_name    text not null,
    college_code    text not null,
    college_name    text not null,
    program_name    text not null,
    semester        text not null,
    academic_year   text not null,

    -- Selected subject (chosen from timetable in step 1)
    course_code     text not null,
    course_name     text not null,
    exam_date       text not null,
    exam_time       text not null,
    qp_code_expected text not null,   -- from timetable
    centre_code     text not null,

    -- Scanned values (steps 2 & 3)
    qp_code_scanned       text not null,   -- scanned from QP barcode
    answer_booklet_code   text not null,   -- scanned from answer booklet barcode

    -- Meta
    marked_by       uuid references auth.users(id),
    marked_at       timestamptz not null default now(),

    -- Prevent duplicate attendance for same student + same exam
    unique (uucms, course_code, exam_date)
);

-- Index for lookups by student
create index if not exists attendance_uucms_idx on public.attendance (uucms);
create index if not exists attendance_exam_date_idx on public.attendance (exam_date);
create index if not exists attendance_marked_by_idx on public.attendance (marked_by);

-- RLS
alter table public.attendance enable row level security;

-- Authenticated users can insert and read attendance
create policy "authenticated users can insert attendance"
    on public.attendance for insert
    to authenticated
    with check (auth.uid() = marked_by);

create policy "authenticated users can read attendance"
    on public.attendance for select
    to authenticated
    using (true);
