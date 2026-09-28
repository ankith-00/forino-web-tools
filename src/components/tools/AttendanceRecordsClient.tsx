"use client";

import React, { useMemo, useState } from "react";
import { format } from "date-fns";
import {
    LuUsers,
    LuRefreshCw,
    LuSearch,
    LuFilter,
    LuChevronLeft,
    LuChevronRight,
} from "react-icons/lu";
import { LiaExternalLinkAltSolid } from "react-icons/lia";

/** Rows per page. Small on purpose: these are wide records and a page of ten is
 *  already taller than most laptop viewports. */
const PAGE_SIZE = 10;

export interface AttendanceRecord {
    id: string;
    uucms: string;
    student_name: string;
    college_code: string;
    college_name: string;
    program_name: string;
    semester: string;
    academic_year: string;
    course_code: string;
    course_name: string;
    exam_date: string;
    exam_time: string;
    qp_code_scanned: string;
    answer_booklet_code: string;
    marked_by: string;
    marked_at: string;
}

/** A row of `answer_booklets`: one scanned booklet, uploaded by the Booklet
 *  Scanner. Mirrors the migration rather than the scanner's upload payload, which
 *  sends a flat bag of strings with blanks for anything it did not have. */
export interface AnswerBooklet {
    id: string;
    answer_booklet_code: string;
    uucms: string | null;
    student_name: string | null;
    college_code: string | null;
    college_name: string | null;
    program_name: string | null;
    semester: string | null;
    academic_year: string | null;
    course_code: string | null;
    course_name: string | null;
    exam_date: string | null;
    qp_code_scanned: string | null;
    page_count: number | null;
    /** Storage path. Null on rows uploaded before this column existed, which the
     *  file route handles by falling back to the legacy `booklet_url`. */
    file_path: string | null;
    uploaded_by: string | null;
    uploaded_at: string;
}

type Tab = "attendance" | "booklets";

interface AttendanceRecordsClientProps {
    attendance: AttendanceRecord[];
    booklets: AnswerBooklet[];
    /** Set when the booklets table could not be read, e.g. migration not applied. */
    bookletLoadError: string | null;
    /** Auth user uuid to display name, for `marked_by` and `uploaded_by`. */
    userNames: Record<string, string>;
}

/** Per-tab wording. The heading and the search hint change with the tab because
 *  the two lists answer different questions; the QP filter does not, since both
 *  tables carry `qp_code_scanned`. */
const TAB_COPY: Record<Tab, { heading: string; search: string; countLabel: string }> = {
    attendance: {
        heading: "Attendance Records",
        search: "Search student",
        countLabel: "attendance records",
    },
    booklets: {
        heading: "Scanned Booklets",
        search: "Search booklet",
        countLabel: "scanned booklets",
    },
};

function formatDateSafe(dateStr?: string | null, formatStr: string = "MMM d, yyyy HH:mm") {
    if (!dateStr) return "—";
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return format(d, formatStr);
    } catch {
        return dateStr;
    }
}

interface Page<T> {
    rows: T[];
    currentPage: number;
    totalPages: number;
    firstRow: number;
    lastRow: number;
}

/**
 * Clamped rather than trusted: a search or filter that narrows a list can leave
 * the viewer on a page that no longer exists, and rendering nothing with no way
 * back would be a dead end.
 */
function paginate<T>(rows: T[], requestedPage: number): Page<T> {
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
    return {
        rows: rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
        currentPage,
        totalPages,
        firstRow: rows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1,
        lastRow: Math.min(currentPage * PAGE_SIZE, rows.length),
    };
}

export function AttendanceRecordsClient({
    attendance,
    booklets,
    bookletLoadError,
    userNames,
}: AttendanceRecordsClientProps) {
    const [tab, setTab] = useState<Tab>("attendance");
    const [searchQuery, setSearchQuery] = useState("");
    const [refreshing, setRefreshing] = useState(false);
    const [filterOpen, setFilterOpen] = useState(false);
    /** Applied QP code selection and the draft being ticked in the modal. Kept
     *  apart so the list only refilters on Done, matching the admin tool filter. */
    const [qpFilters, setQpFilters] = useState<string[]>([]);
    const [qpDraft, setQpDraft] = useState<string[]>([]);
    // A page per tab, so moving between them does not throw away where you were.
    const [page, setPage] = useState(1);
    const [bookletPage, setBookletPage] = useState(1);

    const copy = TAB_COPY[tab];

    const handleRefresh = () => {
        setRefreshing(true);
        window.location.reload();
    };

    /**
     * QP codes offered by the filter, taken from the tab being viewed and counted
     * so the list answers "how much am I about to see". Sorted because the natural
     * order is just whichever row was scanned first. Counted in one pass rather
     * than filtered per code while rendering.
     *
     * A code selected on the other tab is added back in with a count of zero: the
     * selection deliberately survives the switch, and without this the modal
     * could not show — let alone untick — the very thing emptying the list.
     */
    const qpCodeOptions = useMemo(() => {
        const counts = new Map<string, number>();
        const codes =
            tab === "attendance"
                ? attendance.map((r) => r.qp_code_scanned)
                : booklets.map((b) => b.qp_code_scanned);
        for (const code of codes) {
            if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
        }
        for (const code of qpFilters) {
            if (!counts.has(code)) counts.set(code, 0);
        }
        return [...counts.entries()]
            .map(([code, count]) => ({ code, count }))
            .sort((a, b) => a.code.localeCompare(b.code));
    }, [tab, attendance, booklets, qpFilters]);

    const filteredAttendance = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return attendance.filter((r) => {
            // The marker's display name is resolved server-side and is not a field
            // on the row, so it has to be looked up to be searchable like the column
            // the user can actually see.
            const marker = r.marked_by ? userNames[r.marked_by] ?? "" : "";
            const matchesQuery =
                !q ||
                (r.student_name && r.student_name.toLowerCase().includes(q)) ||
                (r.uucms && r.uucms.toLowerCase().includes(q)) ||
                (r.answer_booklet_code && r.answer_booklet_code.toLowerCase().includes(q)) ||
                (r.course_name && r.course_name.toLowerCase().includes(q)) ||
                (r.course_code && r.course_code.toLowerCase().includes(q)) ||
                (r.qp_code_scanned && r.qp_code_scanned.toLowerCase().includes(q)) ||
                marker.toLowerCase().includes(q);
            const matchesQp = qpFilters.length === 0 || qpFilters.includes(r.qp_code_scanned);
            return matchesQuery && matchesQp;
        });
    }, [attendance, userNames, searchQuery, qpFilters]);

    const filteredBooklets = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return booklets.filter((b) => {
            const uploader = b.uploaded_by ? userNames[b.uploaded_by] ?? "" : "";
            const matchesQuery =
                !q ||
                (b.answer_booklet_code &&
                    b.answer_booklet_code.toLowerCase().includes(q)) ||
                (b.student_name && b.student_name.toLowerCase().includes(q)) ||
                (b.uucms && b.uucms.toLowerCase().includes(q)) ||
                (b.course_name && b.course_name.toLowerCase().includes(q)) ||
                (b.course_code && b.course_code.toLowerCase().includes(q)) ||
                (b.qp_code_scanned && b.qp_code_scanned.toLowerCase().includes(q)) ||
                uploader.toLowerCase().includes(q);
            const matchesQp = qpFilters.length === 0 || qpFilters.includes(b.qp_code_scanned ?? "");
            return matchesQuery && matchesQp;
        });
    }, [booklets, userNames, searchQuery, qpFilters]);

    const attendancePage = paginate(filteredAttendance, page);
    const bookletsPage = paginate(filteredBooklets, bookletPage);

    const shown = tab === "attendance" ? filteredAttendance.length : filteredBooklets.length;
    const available = tab === "attendance" ? attendance.length : booklets.length;
    const setCurrentPage = tab === "attendance" ? setPage : setBookletPage;

    const clearAll = () => {
        setSearchQuery("");
        setQpFilters([]);
        setQpDraft([]);
        setPage(1);
        setBookletPage(1);
    };

    return (
        <div className="flex min-h-svh flex-col bg-background font-sans text-foreground">
            <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-8 pt-8">
                {/* Header. One row at every width so the refresh stays in the corner
                    on a phone too; the heading is allowed to wrap rather than push the
                    button off, and `items-start` keeps that button beside the first
                    line instead of floating down the middle. The heading is per-tab. */}
                <div className="mb-6 flex items-start justify-between gap-3">
                    <h1 className="min-w-0 text-2xl font-semibold">{copy.heading}</h1>
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing}
                        aria-label="Refresh"
                        title="Refresh"
                        className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-[0.7em] border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-muted/60 transition shadow-sm"
                    >
                        <LuRefreshCw
                            className={`h-4 w-4 text-muted-foreground ${refreshing ? "animate-spin" : ""}`}
                        />
                        {/* Label dropped on a phone, where the heading and the button
                            share one row. `aria-label` above keeps the button named. */}
                        <span className="hidden sm:inline">Refresh</span>
                    </button>
                </div>

                {/* Tabs. Same bar as the admin users table. Counts are the unfiltered
                    totals, so they describe the tab rather than the current search. */}
                <div className="mb-4 flex gap-1 rounded-[0.7em] border border-border bg-card p-1">
                    {(
                        [
                            { key: "attendance", label: "Attendance", count: attendance.length },
                            { key: "booklets", label: "Booklets", count: booklets.length },
                        ] as const
                    ).map((t) => {
                        const selected = tab === t.key;
                        return (
                            <button
                                key={t.key}
                                type="button"
                                onClick={() => setTab(t.key)}
                                aria-current={selected ? "true" : undefined}
                                // min-w-0 lets each tab shrink below its content width,
                                // so the labels truncate instead of overflowing the bar.
                                className={`flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[0.5em] px-2 py-2 text-xs font-medium transition-colors sm:gap-2 sm:px-3 sm:text-sm ${
                                    selected
                                        ? "bg-muted text-foreground"
                                        : "text-muted-foreground hover:bg-muted/50"
                                }`}
                            >
                                <span className="truncate">{t.label}</span>
                                <span
                                    className={`flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[0.6rem] font-semibold ${
                                        selected
                                            ? "bg-foreground/10 text-foreground"
                                            : "bg-muted text-muted-foreground"
                                    }`}
                                >
                                    {t.count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Search + filter. Same shape and behaviour as the admin users table:
                    one row at every width, the button collapsing to its icon on mobile
                    so the field keeps the width, and the label returning from `sm` up.
                    Both reset to page 1, since page 7 of a filtered list is not a page
                    anyone can act on. The QP selection is shared by both tabs on
                    purpose and is not cleared when the tab changes. */}
                <div className="mb-4 flex items-center gap-2">
                    <label className="relative flex min-w-0 flex-1 items-center">
                        <LuSearch
                            size={15}
                            className="pointer-events-none absolute left-3 text-muted-foreground"
                        />
                        <input
                            type="search"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setPage(1);
                                setBookletPage(1);
                            }}
                            placeholder={copy.search}
                            className="w-full rounded-[0.6em] border border-border bg-card px-3 py-2 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={() => {
                            setQpDraft(qpFilters);
                            setFilterOpen(true);
                        }}
                        aria-label={
                            qpFilters.length > 0
                                ? `Filter records, ${qpFilters.length} QP code${qpFilters.length === 1 ? "" : "s"} selected`
                                : "Filter records by QP code"
                        }
                        className="flex shrink-0 cursor-pointer items-center gap-2 rounded-[0.6em] border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                    >
                        <LuFilter size={15} className="text-muted-foreground" />
                        <span className="hidden whitespace-nowrap sm:inline">Filter</span>
                        {qpFilters.length > 0 && (
                            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-semibold text-primary-foreground">
                                {qpFilters.length}
                            </span>
                        )}
                    </button>
                </div>

                {tab === "booklets" && bookletLoadError ? (
                    <div className="flex flex-col gap-2 rounded-[0.8em] border border-red-400/40 bg-red-500/10 px-4 py-4 text-sm text-red-500 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-400">
                        <p className="font-medium">Could not load scanned booklets.</p>
                        <p>{bookletLoadError}</p>
                        <p className="text-xs opacity-80">
                            If this mentions{" "}
                            <code className="font-mono">answer_booklets</code>, apply the pending
                            Supabase migration{" "}
                            <code className="font-mono">20260928020000_answer_booklets.sql</code>{" "}
                            (e.g. <code className="font-mono">supabase db push</code>), then reload.
                        </p>
                    </div>
                ) : shown === 0 ? (
                    <EmptyState
                        tab={tab}
                        hasAnyRecords={available > 0}
                        onClear={clearAll}
                    />
                ) : (
                    <>
                        {tab === "attendance" ? (
                            <AttendanceTable
                                records={attendancePage.rows}
                                userNames={userNames}
                            />
                        ) : (
                            <BookletTable
                                booklets={bookletsPage.rows}
                                userNames={userNames}
                            />
                        )}

                        <Pager
                            currentPage={
                                tab === "attendance"
                                    ? attendancePage.currentPage
                                    : bookletsPage.currentPage
                            }
                            totalPages={
                                tab === "attendance"
                                    ? attendancePage.totalPages
                                    : bookletsPage.totalPages
                            }
                            firstRow={
                                tab === "attendance" ? attendancePage.firstRow : bookletsPage.firstRow
                            }
                            lastRow={
                                tab === "attendance" ? attendancePage.lastRow : bookletsPage.lastRow
                            }
                            shown={shown}
                            available={available}
                            countLabel={copy.countLabel}
                            onPage={setCurrentPage}
                        />
                    </>
                )}

                {filterOpen && (
                    <QpFilterModal
                        options={qpCodeOptions}
                        draft={qpDraft}
                        onDraftChange={setQpDraft}
                        onClear={() => {
                            setQpDraft([]);
                            setQpFilters([]);
                            setPage(1);
                            setBookletPage(1);
                        }}
                        onDone={() => {
                            setQpFilters(qpDraft);
                            setPage(1);
                            setBookletPage(1);
                            setFilterOpen(false);
                        }}
                        onClose={() => setFilterOpen(false)}
                    />
                )}
            </main>
        </div>
    );
}

/** Attendance: one value per column, so nothing is stacked inside a cell. The
 *  table is wider than a phone, so it keeps its natural width and the wrapper
 *  scrolls sideways instead of squeezing the columns until everything wraps. */
function AttendanceTable({
    records,
    userNames,
}: {
    records: AttendanceRecord[];
    userNames: Record<string, string>;
}) {
    return (
        <div className="rounded-[0.8em] border border-border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px] text-left text-sm">
                    <thead className="bg-muted/40 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <tr>
                            <th className="px-4 py-3.5">Candidate</th>
                            <th className="px-4 py-3.5">UUCMS</th>
                            <th className="px-4 py-3.5">College</th>
                            <th className="px-4 py-3.5">Program</th>
                            <th className="px-4 py-3.5">Course</th>
                            <th className="px-4 py-3.5">Course Code</th>
                            <th className="px-4 py-3.5">Exam Date</th>
                            <th className="px-4 py-3.5">Booklet Code</th>
                            <th className="px-4 py-3.5">QP Code</th>
                            <th className="px-4 py-3.5">Marked By</th>
                            <th className="px-4 py-3.5">Marked At</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-normal">
                        {records.map((r) => (
                            <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                                <td className="px-4 py-3.5 font-semibold text-foreground whitespace-nowrap">
                                    {r.student_name || "—"}
                                </td>
                                <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                    {r.uucms || "—"}
                                </td>
                                <td
                                    className="px-4 py-3.5 text-xs font-medium text-foreground max-w-[14rem] truncate"
                                    title={r.college_name || r.college_code || undefined}
                                >
                                    {r.college_name || r.college_code || "—"}
                                </td>
                                <td className="px-4 py-3.5 text-xs text-muted-foreground max-w-[12rem] truncate">
                                    {r.program_name} {r.semester ? `(Sem ${r.semester})` : ""}
                                </td>
                                <td className="px-4 py-3.5 text-xs font-medium text-foreground max-w-[12rem] truncate">
                                    {r.course_name || "—"}
                                </td>
                                <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                    {r.course_code || "—"}
                                </td>
                                <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                                    {r.exam_date || "—"}
                                </td>
                                <td className="px-4 py-3.5 font-mono text-xs font-medium text-foreground whitespace-nowrap">
                                    {r.answer_booklet_code || "—"}
                                </td>
                                <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                    {r.qp_code_scanned || "—"}
                                </td>
                                <td className="px-4 py-3.5 text-xs text-foreground max-w-[10rem] truncate">
                                    {r.marked_by ? userNames[r.marked_by] ?? "Unknown" : "—"}
                                </td>
                                {/* Date and time are one timestamp, so they stay on a
                                    single line here rather than becoming two columns.
                                    Minutes are the useful precision: invigilation runs
                                    in halls, not to the second. */}
                                <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                                    {formatDateSafe(r.marked_at, "MMM d, yyyy")},{" "}
                                    {formatDateSafe(r.marked_at, "HH:mm")}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/** Booklets: every column the table holds, one value each, same treatment. The
 *  scan itself is a link rather than a stored URL, because the bucket is private
 *  and the signed URL the uploader got back has long expired by now. */
function BookletTable({
    booklets,
    userNames,
}: {
    booklets: AnswerBooklet[];
    userNames: Record<string, string>;
}) {
    return (
        <div className="rounded-[0.8em] border border-border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[1500px] text-left text-sm">
                    <thead className="bg-muted/40 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <tr>
                            <th className="px-4 py-3.5">Booklet Code</th>
                            <th className="px-4 py-3.5">Candidate</th>
                            <th className="px-4 py-3.5">UUCMS</th>
                            <th className="px-4 py-3.5">College</th>
                            <th className="px-4 py-3.5">Program</th>
                            <th className="px-4 py-3.5">Semester</th>
                            <th className="px-4 py-3.5">Academic Year</th>
                            <th className="px-4 py-3.5">Course</th>
                            <th className="px-4 py-3.5">Course Code</th>
                            <th className="px-4 py-3.5">Exam Date</th>
                            <th className="px-4 py-3.5">QP Code</th>
                            <th className="px-4 py-3.5">Pages</th>
                            <th className="px-4 py-3.5">Uploaded By</th>
                            <th className="px-4 py-3.5">Uploaded At</th>
                            <th className="px-4 py-3.5">Scan</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-normal">
                        {booklets.map((b) => (
                            <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                                <td className="px-4 py-3.5 font-mono text-xs font-medium text-foreground whitespace-nowrap">
                                    {b.answer_booklet_code}
                                </td>
                                <td className="px-4 py-3.5 font-semibold text-foreground whitespace-nowrap">
                                    {b.student_name || "—"}
                                </td>
                                <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                    {b.uucms || "—"}
                                </td>
                                <td
                                    className="px-4 py-3.5 text-xs font-medium text-foreground max-w-[14rem] truncate"
                                    title={b.college_name || b.college_code || undefined}
                                >
                                    {b.college_name || b.college_code || "—"}
                                </td>
                                <td className="px-4 py-3.5 text-xs text-muted-foreground max-w-[12rem] truncate">
                                    {b.program_name || "—"}
                                </td>
                                <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                                    {b.semester || "—"}
                                </td>
                                <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                                    {b.academic_year || "—"}
                                </td>
                                <td className="px-4 py-3.5 text-xs font-medium text-foreground max-w-[12rem] truncate">
                                    {b.course_name || "—"}
                                </td>
                                <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                    {b.course_code || "—"}
                                </td>
                                <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                                    {b.exam_date || "—"}
                                </td>
                                <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                    {b.qp_code_scanned || "—"}
                                </td>
                                <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                                    {b.page_count ?? "—"}
                                </td>
                                <td className="px-4 py-3.5 text-xs text-foreground max-w-[10rem] truncate">
                                    {b.uploaded_by ? userNames[b.uploaded_by] ?? "Unknown" : "—"}
                                </td>
                                <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                                    {formatDateSafe(b.uploaded_at, "MMM d, yyyy")},{" "}
                                    {formatDateSafe(b.uploaded_at, "HH:mm")}
                                </td>
                                <td className="px-4 py-3.5 whitespace-nowrap">
                                    <a
                                        href={`/api/answer-booklet/file?id=${b.id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline underline-offset-2"
                                    >
                                        <LiaExternalLinkAltSolid size={13} />
                                        View
                                    </a>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/**
 * Buttons pinned to opposite edges with the page count centred between them: a
 * three-column grid rather than `justify-between`, which would centre the count
 * only approximately, since "Previous" and "Next" are not the same width. The
 * "Showing n–m of z" line has its own row and is hidden on a phone, where
 * "Page 2 of 15" already says where you are.
 */
function Pager({
    currentPage,
    totalPages,
    firstRow,
    lastRow,
    shown,
    available,
    countLabel,
    onPage,
}: {
    currentPage: number;
    totalPages: number;
    firstRow: number;
    lastRow: number;
    shown: number;
    available: number;
    countLabel: string;
    onPage: (page: number) => void;
}) {
    return (
        <div className="mt-4 flex flex-col gap-3">
            <p className="hidden text-xs text-muted-foreground sm:block">
                Showing {firstRow}–{lastRow} of {shown} {countLabel}
                {shown !== available && <> (filtered from {available})</>}
            </p>
            <div className="grid grid-cols-3 items-center gap-2">
                <button
                    type="button"
                    onClick={() => onPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    aria-label="Previous page"
                    className="inline-flex cursor-pointer items-center gap-1 justify-self-start rounded-[0.6em] border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <LuChevronLeft size={14} />
                    <span className="hidden whitespace-nowrap sm:inline">Previous</span>
                </button>
                <span className="text-center text-xs text-muted-foreground">
                    Page {currentPage} of {totalPages}
                </span>
                <button
                    type="button"
                    onClick={() => onPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    aria-label="Next page"
                    className="inline-flex cursor-pointer items-center gap-1 justify-self-end rounded-[0.6em] border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <span className="hidden whitespace-nowrap sm:inline">Next</span>
                    <LuChevronRight size={14} />
                </button>
            </div>
        </div>
    );
}

/**
 * QP code filter, shared by both tabs. Applies on Done so the list is not
 * refiltered on every tick.
 */
function QpFilterModal({
    options,
    draft,
    onDraftChange,
    onClear,
    onDone,
    onClose,
}: {
    options: { code: string; count: number }[];
    draft: string[];
    onDraftChange: (next: string[]) => void;
    onClear: () => void;
    onDone: () => void;
    onClose: () => void;
}) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md rounded-[0.8em] border border-border bg-card p-6 shadow-lg"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Filter records by QP code"
            >
                <h2 className="text-base font-semibold text-foreground">Filter records</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                    Select one or more QP codes. Records matching any selected code are shown.
                </p>

                {options.length === 0 ? (
                    <p className="mt-4 rounded-[0.6em] border border-border bg-background px-3 py-4 text-center text-sm text-muted-foreground">
                        No QP codes have been scanned yet.
                    </p>
                ) : (
                    <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
                        {options.map(({ code, count }) => {
                            const checked = draft.includes(code);
                            return (
                                <label
                                    key={code}
                                    className={`relative flex cursor-pointer items-center gap-3 rounded-[0.6em] border px-3 py-2.5 transition-colors ${
                                        checked
                                            ? "border-primary/40 bg-primary/10"
                                            : "border-border bg-background hover:bg-muted"
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) =>
                                            onDraftChange(
                                                e.target.checked
                                                    ? [...draft, code]
                                                    : draft.filter((c) => c !== code)
                                            )
                                        }
                                        className="pointer-events-none absolute h-5 w-5 opacity-0"
                                    />
                                    <span
                                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[0.4em] border-2 transition-all ${
                                            checked
                                                ? "border-primary bg-primary text-primary-foreground"
                                                : "border-border bg-background"
                                        }`}
                                    >
                                        {checked && (
                                            <svg
                                                className="h-3.5 w-3.5"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={3}
                                                    d="M5 13l4 4L19 7"
                                                />
                                            </svg>
                                        )}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium text-foreground">
                                        {code}
                                    </span>
                                    {/* Zero means selected from the other tab, with
                                        nothing on this one. */}
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {count}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                )}

                <div className="mt-5 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClear}
                        className="cursor-pointer rounded-[0.6em] border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    >
                        Clear
                    </button>
                    <button
                        type="button"
                        onClick={onDone}
                        className="cursor-pointer rounded-[0.6em] border border-blue-500/30 bg-blue-500/10 px-6 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-500/15 dark:text-blue-400"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Two different empty states, because they call for different actions: nothing on
 * the tab at all means go and use the tool that fills it, while no matches means
 * the search or filter is too narrow and the way out is to widen it.
 */
function EmptyState({
    tab,
    hasAnyRecords,
    onClear,
}: {
    tab: Tab;
    hasAnyRecords: boolean;
    onClear: () => void;
}) {
    if (hasAnyRecords) {
        return (
            <div className="flex flex-col items-center justify-center rounded-[0.8em] border border-border bg-card px-6 py-16 text-center shadow-sm">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <LuSearch size={24} />
                </div>
                <h2 className="text-lg font-semibold">No records match</h2>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Nothing matches your search and filter.
                </p>
                <button
                    type="button"
                    onClick={onClear}
                    className="mt-4 cursor-pointer rounded-[0.6em] border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                    Clear search and filter
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center rounded-[0.8em] border border-border bg-card px-6 py-16 text-center shadow-sm">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <LuUsers size={24} />
            </div>
            {tab === "attendance" ? (
                <>
                    <h2 className="text-lg font-semibold">No attendance records found</h2>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                        Mark student attendance using the Invigilation Module or Booklet Scanner to
                        see records here.
                    </p>
                </>
            ) : (
                <>
                    <h2 className="text-lg font-semibold">No booklets scanned yet</h2>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                        Scan and upload an answer booklet with the Booklet Scanner to see it here.
                    </p>
                </>
            )}
        </div>
    );
}
