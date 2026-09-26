"use client";

import React, { useMemo, useState } from "react";
import { format } from "date-fns";
import {
    LuUsers,
    LuFileText,
    LuCalendar,
    LuClock,
    LuExternalLink,
    LuRefreshCw,
    LuSearch,
    LuDownload,
    LuCircleCheck,
    LuFileCheck,
} from "react-icons/lu";

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
    booklet_url?: string | null;
}

export interface AnswerBookletRecord {
    id: string;
    answer_booklet_code: string;
    uucms: string;
    student_name: string;
    course_code: string;
    course_name: string;
    exam_date: string;
    booklet_url: string;
    page_count: number;
    uploaded_by: string;
    uploaded_at: string;
}

interface AttendanceRecordsClientProps {
    attendance: AttendanceRecord[];
    answerBooklets: AnswerBookletRecord[];
    userId: string;
}

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

function getSafePdfUrl(rawUrl: string): string {
    if (!rawUrl) return "#";
    if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
        return rawUrl;
    }
    // If it's a relative path inside Supabase storage
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const cleanPath = rawUrl.replace(/^\/+/, "");
    if (cleanPath.startsWith("answer_booklets/")) {
        return `${supabaseUrl}/storage/v1/object/public/${cleanPath}`;
    }
    return `${supabaseUrl}/storage/v1/object/public/answer_booklets/${cleanPath}`;
}

export function AttendanceRecordsClient({
    attendance,
    answerBooklets,
    userId,
}: AttendanceRecordsClientProps) {
    const [activeTab, setActiveTab] = useState<"attendance" | "booklets">("attendance");
    const [searchQuery, setSearchQuery] = useState("");
    const [refreshing, setRefreshing] = useState(false);

    const handleRefresh = () => {
        setRefreshing(true);
        window.location.reload();
    };

    const filteredAttendance = useMemo(() => {
        if (!searchQuery.trim()) return attendance;
        const q = searchQuery.toLowerCase().trim();
        return attendance.filter((r) =>
            (r.student_name && r.student_name.toLowerCase().includes(q)) ||
            (r.uucms && r.uucms.toLowerCase().includes(q)) ||
            (r.answer_booklet_code && r.answer_booklet_code.toLowerCase().includes(q)) ||
            (r.course_name && r.course_name.toLowerCase().includes(q)) ||
            (r.course_code && r.course_code.toLowerCase().includes(q))
        );
    }, [attendance, searchQuery]);

    const filteredBooklets = useMemo(() => {
        if (!searchQuery.trim()) return answerBooklets;
        const q = searchQuery.toLowerCase().trim();
        return answerBooklets.filter((r) =>
            (r.student_name && r.student_name.toLowerCase().includes(q)) ||
            (r.uucms && r.uucms.toLowerCase().includes(q)) ||
            (r.answer_booklet_code && r.answer_booklet_code.toLowerCase().includes(q)) ||
            (r.course_name && r.course_name.toLowerCase().includes(q)) ||
            (r.course_code && r.course_code.toLowerCase().includes(q))
        );
    }, [answerBooklets, searchQuery]);

    return (
        <div className="flex min-h-svh flex-col bg-background font-sans text-foreground">
            <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-8 pt-8">
                {/* Header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-semibold">Attendance Records</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {activeTab === "attendance"
                                ? "Verified candidate attendance entries marked through the barcode scanner"
                                : "Uploaded booklet PDF documents with multi-page scan captures"}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="inline-flex cursor-pointer items-center gap-2 rounded-[0.7em] border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-muted/60 transition shadow-sm"
                        >
                            <LuRefreshCw className={`h-4 w-4 text-muted-foreground ${refreshing ? "animate-spin" : ""}`} />
                            Refresh
                        </button>
                    </div>
                </div>

                {/* Search & Tabs Toolbar */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
                    {/* Tabs */}
                    <div className="inline-flex rounded-[0.8em] border border-border bg-muted/40 p-1">
                        <button
                            onClick={() => setActiveTab("attendance")}
                            className={`flex cursor-pointer items-center gap-2 rounded-[0.6em] px-4 py-2 text-sm font-semibold transition ${
                                activeTab === "attendance"
                                    ? "bg-card text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <LuUsers className="h-4 w-4" />
                            Attendance Records ({attendance.length})
                        </button>
                        <button
                            onClick={() => setActiveTab("booklets")}
                            className={`flex cursor-pointer items-center gap-2 rounded-[0.6em] px-4 py-2 text-sm font-semibold transition ${
                                activeTab === "booklets"
                                    ? "bg-card text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <LuFileText className="h-4 w-4" />
                            Scanned PDFs ({answerBooklets.length})
                        </button>
                    </div>

                    {/* Search Bar */}
                    <div className="relative w-full sm:w-80">
                        <LuSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by student, UUCMS, booklet code..."
                            className="w-full rounded-[0.7em] border border-border bg-card pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none transition shadow-sm"
                        />
                    </div>
                </div>

                {/* Tab Contents */}
                {activeTab === "attendance" ? (
                    <AttendanceTab records={filteredAttendance} />
                ) : (
                    <BookletsTab records={filteredBooklets} />
                )}
            </main>
        </div>
    );
}

function AttendanceTab({
    records,
}: {
    records: AttendanceRecord[];
}) {
    if (records.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-[0.8em] border border-border bg-card px-6 py-16 text-center shadow-sm">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-3">
                    <LuUsers size={24} />
                </div>
                <h2 className="text-lg font-semibold">No attendance records found</h2>
                <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                    Mark student attendance using the Barcode Scanner or Webcam Scanner to see records here.
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-[0.8em] border border-border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-muted/40 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <tr>
                            <th className="px-4 py-3.5">Candidate</th>
                            <th className="px-4 py-3.5">College & Program</th>
                            <th className="px-4 py-3.5">Course & Exam</th>
                            <th className="px-4 py-3.5">Booklet & QP Code</th>
                            <th className="px-4 py-3.5">Marked At</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-normal">
                        {records.map((r) => (
                            <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                                <td className="px-4 py-3.5">
                                    <div className="font-semibold text-foreground">{r.student_name || "—"}</div>
                                    <div className="text-xs font-mono text-muted-foreground mt-0.5">{r.uucms || "—"}</div>
                                </td>
                                <td className="px-4 py-3.5 max-w-xs">
                                    <div className="text-xs font-medium text-foreground truncate" title={r.college_name || r.college_code}>
                                        {r.college_name || r.college_code || "—"}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                        {r.program_name} {r.semester ? `(Sem ${r.semester})` : ""}
                                    </div>
                                </td>
                                <td className="px-4 py-3.5">
                                    <div className="text-xs font-medium text-foreground">{r.course_name || "—"}</div>
                                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                                        <span>{r.course_code}</span>
                                        {r.exam_date && (
                                            <>
                                                <span>•</span>
                                                <span>{r.exam_date}</span>
                                            </>
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-3.5 font-mono text-xs">
                                    <div className="font-medium text-foreground">
                                        <span className="text-[10px] text-muted-foreground uppercase mr-1">Booklet:</span>
                                        {r.answer_booklet_code || "—"}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground mt-0.5">
                                        <span className="text-[10px] uppercase mr-1">QP:</span>
                                        {r.qp_code_scanned || "—"}
                                    </div>
                                </td>
                                <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                                    <div>{formatDateSafe(r.marked_at, "MMM d, yyyy")}</div>
                                    <div className="text-[11px] text-muted-foreground/80">{formatDateSafe(r.marked_at, "HH:mm:ss")}</div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function BookletsTab({ records }: { records: AnswerBookletRecord[] }) {
    if (records.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-[0.8em] border border-border bg-card px-6 py-16 text-center shadow-sm">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-3">
                    <LuFileText size={24} />
                </div>
                <h2 className="text-lg font-semibold">No scanned PDFs yet</h2>
                <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                    Answer booklets scanned through the Webcam Scanner will appear here as downloadable PDFs.
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-[0.8em] border border-border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-muted/40 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <tr>
                            <th className="px-4 py-3.5">Candidate</th>
                            <th className="px-4 py-3.5">Course</th>
                            <th className="px-4 py-3.5">Booklet Code</th>
                            <th className="px-4 py-3.5 text-center">Pages</th>
                            <th className="px-4 py-3.5">Uploaded</th>
                            <th className="px-4 py-3.5 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-normal">
                        {records.map((r) => {
                            const pdfUrl = getSafePdfUrl(r.booklet_url);

                            return (
                                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                                    <td className="px-4 py-3.5">
                                        <div className="font-semibold text-foreground">{r.student_name || "—"}</div>
                                        <div className="text-xs font-mono text-muted-foreground mt-0.5">{r.uucms || "—"}</div>
                                    </td>
                                    <td className="px-4 py-3.5">
                                        <div className="text-xs font-medium text-foreground">{r.course_name || "—"}</div>
                                        <div className="text-[11px] text-muted-foreground mt-0.5">
                                            {r.course_code} {r.exam_date ? `• ${r.exam_date}` : ""}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 font-mono text-xs font-semibold text-foreground">
                                        {r.answer_booklet_code || "—"}
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <span className="inline-flex items-center rounded-[0.4em] bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                                            {r.page_count || "—"} pages
                                        </span>
                                    </td>
                                    <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                                        <div>{formatDateSafe(r.uploaded_at, "MMM d, yyyy")}</div>
                                        <div className="text-[11px] text-muted-foreground/80">{formatDateSafe(r.uploaded_at, "HH:mm:ss")}</div>
                                    </td>
                                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                        <a
                                            href={pdfUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[0.6em] bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition shadow-sm"
                                        >
                                            <LuFileText size={14} />
                                            View PDF
                                            <LuExternalLink size={12} />
                                        </a>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}