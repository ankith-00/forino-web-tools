"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Navbar from "@/components/layout/Navbar";
import AccessGate from "@/components/access/AccessGate";
import { BrowserMultiFormatReader } from "@zxing/browser";
import {
    HiOutlineCheckCircle,
    HiCheckCircle,
    HiXCircle,
    HiOutlineCheck,
    HiOutlineX,
    HiOutlineRefresh,
} from "react-icons/hi";
import { RiVerifiedBadgeFill } from "react-icons/ri";
import { BiSolidErrorAlt } from "react-icons/bi";
import { LuScanBarcode } from "react-icons/lu";
import { IoChevronForwardOutline } from "react-icons/io5";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4; // 4 = confirmation/done

interface Course {
    sl_no: number;
    term: string;
    qp_code: string;
    course_code: string;
    course_name: string;
    exam_date: string;
    exam_time: string;
    centre_code: string;
}

interface Student {
    uucms: string;
    student_name: string;
    college_code: string;
    college_name: string;
    program_level: string;
    program_name: string;
    discipline: string;
    semester: string;
    academic_year: string;
    month_of_exam: string;
    timetable: Course[];
}

interface Toast {
    type: "success" | "error";
    message: string;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function ToastBanner({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    useEffect(() => {
        const t = setTimeout(onDismiss, 4000);
        return () => clearTimeout(t);
    }, [onDismiss]);

    return (
        <div className={`flex w-full items-center gap-3 rounded-[0.8em] border px-4 py-3 shadow-lg ${toast.type === "success"
            ? "border-emerald-400/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
            : "border-red-400/30 bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300"
            }`}>
            {toast.type === "success"
                ? <RiVerifiedBadgeFill size={16} className="shrink-0 text-emerald-500" />
                : <BiSolidErrorAlt size={16} className="shrink-0 text-red-500" />}
            <span className="text-sm font-medium">{toast.message}</span>
            <button onClick={onDismiss} className="cursor-pointer opacity-60 hover:opacity-100">
                <HiOutlineX size={13} />
            </button>
        </div>
    );
}

// ─── Camera Scanner ───────────────────────────────────────────────────────────

const ZXING_NOISE_PREFIXES = [
    "MultiFormatReader: non-ReaderException",
    "Trying to play video that is already playing.",
    "Trying to play video that has ended.",
    "It was not possible to play the video.",
    "got interrupted by new loading request",
];

let beepCtx: AudioContext | null = null;

function playBeep() {
    try {
        const AudioCtx =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        beepCtx = beepCtx ?? new AudioCtx();
        if (beepCtx.state === "suspended") void beepCtx.resume();
        const osc = beepCtx.createOscillator();
        const gain = beepCtx.createGain();
        osc.connect(gain);
        gain.connect(beepCtx.destination);
        osc.type = "sine";
        osc.frequency.value = 1250;
        const now = beepCtx.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.2);
    } catch (e) {
        void e;
    }
}

function CameraScanner({
    label,
    hint,
    onScanned,
    paused,
}: {
    label: string;
    hint: string;
    onScanned: (value: string) => void;
    paused: boolean;
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState<string | null>(null);
    const scannedRef = useRef(false);

    useEffect(() => {
        if (paused) return;
        scannedRef.current = false;

        const video = videoRef.current;
        if (!video) return;

        const reader = new BrowserMultiFormatReader();
        let cancelled = false;
        let stream: MediaStream | null = null;
        let rafId = 0;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        const cancel = () => {
            if (cancelled) return;
            cancelled = true;
            cancelAnimationFrame(rafId);
            rafId = 0;
            try {
                video.pause();
                video.srcObject = null;
            } catch {}
            stream?.getTracks().forEach((t) => {
                try {
                    t.stop();
                } catch {}
            });
            stream = null;
        };

        const tick = () => {
            if (cancelled) return;
            rafId = 0;
            try {
                const { videoWidth, videoHeight } = video;
                if (videoWidth > 0 && videoHeight > 0) {
                    canvas.width = videoWidth;
                    canvas.height = videoHeight;
                    ctx?.drawImage(video, 0, 0, videoWidth, videoHeight);
                    const result = reader.decodeFromCanvas(canvas);
                    if (result && !cancelled && !scannedRef.current) {
                        scannedRef.current = true;
                        cancel();
                        playBeep();
                        onScanned(result.getText());
                        return;
                    }
                }
            } catch (e) {
                void e;
            }
            rafId = requestAnimationFrame(tick);
        };

        (async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "environment" },
                    audio: false,
                });
                if (cancelled) {
                    stream.getTracks().forEach((t) => {
                        try {
                            t.stop();
                        } catch {}
                    });
                    return;
                }
                video.srcObject = stream;
                await video.play();
                if (cancelled) return;
                rafId = requestAnimationFrame(tick);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : "Camera access denied.");
            }
        })();

        return cancel;
    }, [paused, onScanned]);

    useEffect(() => {
        const originalWarn = console.warn;
        const originalError = console.error;
        const isNoise = (args: unknown[]) => {
            const first = args[0];
            return typeof first === "string" && ZXING_NOISE_PREFIXES.some((p) => first.startsWith(p));
        };
        const filteredWarn: typeof console.warn = (...args) => {
            if (!isNoise(args)) originalWarn(...args);
        };
        const filteredError: typeof console.error = (...args) => {
            if (!isNoise(args)) originalError(...args);
        };
        console.warn = filteredWarn;
        console.error = filteredError;
        return () => {
            console.warn = originalWarn;
            console.error = originalError;
        };
    }, []);

    return (
        <div className="relative flex flex-col">
            {/* Full-width camera feed */}
            <div className="relative h-[42vh] min-h-[240px] w-full shrink-0 overflow-hidden bg-black">
                <video
                    ref={videoRef}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                />

                {/* Scan overlay */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
                    {/* Corner brackets */}
                    <div className="relative h-40 w-64">
                        {[["top-0 left-0", "border-t-2 border-l-2"],
                        ["top-0 right-0", "border-t-2 border-r-2"],
                        ["bottom-0 left-0", "border-b-2 border-l-2"],
                        ["bottom-0 right-0", "border-b-2 border-r-2"]
                        ].map(([pos, border]) => (
                            <span key={pos} className={`absolute ${pos} h-6 w-6 border-white/80 rounded-sm ${border}`} />
                        ))}
                        {/* Scan line */}
                        <div className="absolute inset-x-0 top-1/2 h-0.5 animate-[scanline_2.4s_ease-in-out_infinite] bg-white" />
                    </div>
                </div>

                {/* Label bar */}
                <div className="absolute bottom-0 inset-x-0 bg-black/60 px-4 py-2 backdrop-blur-sm">
                    <div className="flex items-center gap-2">
                        <LuScanBarcode size={15} className="text-white/80" />
                        <span className="text-xs font-medium text-white">{label}</span>
                    </div>
                    <p className="text-xs text-white/60">{hint}</p>
                </div>
            </div>

            {error && (
                <div className="m-4 rounded-[0.8em] border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                    {error}
                </div>
            )}
        </div>
    );
}

// ─── Info row ─────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between gap-4 py-1.5 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-right font-medium text-foreground">{value || "—"}</span>
        </div>
    );
}

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-[0.8em] border border-border bg-card px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
            <div className="divide-y divide-border">{children}</div>
        </div>
    );
}

// ─── Step 1 intro: instructions before scanning ─────────────────────────────

function Step1Intro({ onStart }: { onStart: () => void }) {
    const steps = [
        {
            title: "Get the hall ticket",
            body: "Ask the student for their printed hall ticket (UUCMS admit card).",
        },
        {
            title: "Find the barcode",
            body: "The scannable UUCMS barcode is printed on the hall ticket.",
        },
        {
            title: "Press Start Scanning",
            body: "The camera opens. Point it at the barcode and hold the phone steady.",
        },
        {
            title: "Scans automatically",
            body: "Once detected, the student&apos;s details open so you can pick the subject.",
        },
    ];

    return (
        <div className="relative flex h-full flex-col overflow-hidden">
            <div className="flex-1 min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 pb-24 pt-4">
                <div className="rounded-[0.8em] border border-border bg-card px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Step 1 · Hall Ticket
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-foreground">
                        Scan the student&apos;s hall ticket
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Records which student is attending, so attendance can be marked for the selected subject.
                    </p>
                </div>

                <SectionCard title="Before you start">
                    <div className="space-y-4 py-1">
                        {steps.map((s, i) => (
                            <div key={s.title} className="flex gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                                    {i + 1}
                                </span>
                                <div>
                                    <p className="text-sm font-medium text-foreground">{s.title}</p>
                                    <p className="text-xs text-muted-foreground">{s.body}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </SectionCard>

                <div className="rounded-[0.8em] border border-amber-400/30 bg-amber-500/5 px-4 py-3">
                    <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                        <span className="mr-1.5 font-semibold uppercase tracking-wide">Tip:</span>
                        Allow camera permission when asked and keep the barcode inside the scanning frame.
                    </p>
                </div>
            </div>

            <div className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
                <button
                    onClick={onStart}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                    <LuScanBarcode size={16} />
                    Start Scanning
                </button>
            </div>
        </div>
    );
}

// ─── Step 1: Hall ticket scan + student data + subject select ─────────────────

function Step1({
    onNext,
}: {
    onNext: (student: Student, course: Course) => void;
}) {
    const [started, setStarted] = useState(false);
    const [scanning, setScanning] = useState(true);
    const [loading, setLoading] = useState(false);
    const [student, setStudent] = useState<Student | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

    const handleScanned = useCallback(async (value: string) => {
        setScanning(false);
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/student?uucms=${encodeURIComponent(value)}`);
            if (!res.ok) {
                const d = await res.json();
                throw new Error(d.error ?? "Student not found");
            }
            const data = await res.json();
            setStudent(data.student);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Lookup failed");
        } finally {
            setLoading(false);
        }
    }, []);

    const reset = () => {
        setScanning(true);
        setStudent(null);
        setSelectedCourse(null);
        setError(null);
    };

    return (
        <div className="relative flex h-full flex-col overflow-hidden">
            {!started ? (
                <Step1Intro onStart={() => setStarted(true)} />
            ) : scanning ? (
                <CameraScanner
                    label="Scan Hall Ticket Barcode"
                    hint="Point camera at the student's UUCMS barcode"
                    onScanned={handleScanned}
                    paused={false}
                />
            ) : (
                <div className="flex-1 min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 pb-24 pt-4">
                    {loading && (
                        <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
                            <span className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                            </span>
                            Looking up student…
                        </div>
                    )}

                    {error && (
                        <>
                            <div className="flex items-center gap-3 rounded-[0.8em] border border-red-400/30 bg-red-500/10 px-3 py-3 text-sm text-red-500">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.5em] bg-red-500/15 text-red-500">
                                    <BiSolidErrorAlt size={18} />
                                </span>
                                <span>{error}</span>
                            </div>
                            <div className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
                                <button
                                    onClick={reset}
                                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] bg-primary py-3 text-sm font-medium text-primary-foreground"
                                >
                                    <HiOutlineRefresh size={16} />
                                    Try again
                                </button>
                            </div>
                        </>
                    )}

                    {student && (
                        <>
                            {/* Student details */}
                            <SectionCard title="Student Details">
                                <InfoRow label="Name" value={student.student_name} />
                                <InfoRow label="UUCMS" value={student.uucms} />
                                <InfoRow label="College" value={student.college_name} />
                                <InfoRow label="Program" value={student.program_name} />
                                <InfoRow label="Semester" value={student.semester} />
                                <InfoRow label="Academic Year" value={student.academic_year} />
                            </SectionCard>

                            {/* Timetable */}
                            <div>
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Select Subject
                                </p>
                                <div className="space-y-2">
                                    {student.timetable.map((c) => {
                                        const selected = selectedCourse?.course_code === c.course_code;
                                        return (
                                            <button
                                                key={c.course_code}
                                                onClick={() => setSelectedCourse(selected ? null : c)}
                                                className={`relative w-full cursor-pointer rounded-[0.8em] border py-3 pl-9 pr-4 text-left transition-all ${selected
                                                    ? "border-primary bg-primary/5"
                                                    : "border-border bg-card hover:border-primary/40 hover:bg-muted/40"
                                                    }`}
                                            >
                                                <span className={`absolute left-3 top-3 flex h-4 w-4 items-center justify-center rounded-[0.25em] border ${selected
                                                    ? "border-primary bg-primary"
                                                    : "border-border"
                                                    }`}>
                                                    {selected && <HiOutlineCheck size={12} className="text-primary-foreground" />}
                                                </span>
                                                <div className="flex items-start justify-between gap-2">
                                                    <div>
                                                        <p className="text-sm font-medium text-foreground">{c.course_name}</p>
                                                        <p className="text-xs text-muted-foreground">{c.course_code} · {c.qp_code}</p>
                                                    </div>
                                                    <div className="shrink-0 text-right">
                                                        <p className="text-xs font-medium text-foreground">{c.exam_date}</p>
                                                        <p className="text-xs text-muted-foreground">{c.exam_time}</p>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Reset */}
                            <button
                                onClick={reset}
                                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] border border-border py-2.5 text-sm text-muted-foreground hover:bg-muted"
                            >
                                <HiOutlineRefresh size={14} />
                                Scan different student
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Sticky next */}
            {student && selectedCourse && (
                <div className="fixed bottom-0 inset-x-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
                    <button
                        onClick={() => onNext(student, selectedCourse)}
                        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                        Next — Scan QP Code
                        <IoChevronForwardOutline size={15} />
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Step 2: QP Code scan ─────────────────────────────────────────────────────

function Step2({
    student,
    course,
    onNext,
    onBack,
}: {
    student: Student;
    course: Course;
    onNext: (qpCode: string) => void;
    onBack: () => void;
}) {
    const [scanning, setScanning] = useState(true);
    const [scanned, setScanned] = useState<string | null>(null);
    const [editingQp, setEditingQp] = useState(false);
    const [qpDraft, setQpDraft] = useState("");

    const handleScanned = useCallback((value: string) => {
        setScanning(false);
        setScanned(value);
        setQpDraft(value);
    }, []);

    const mismatch = scanned !== null && scanned !== course.qp_code;
    const canNext = scanned !== null && !mismatch && !editingQp;

    const startQpEdit = () => {
        setQpDraft(scanned ?? "");
        setEditingQp(true);
    };

    const saveQpEdit = () => {
        setScanned(qpDraft.trim());
        setEditingQp(false);
    };

    return (
        <div className="relative flex h-full flex-col overflow-hidden">
            {scanning ? (
                <>
                    <CameraScanner
                        label="Scan QP Code Barcode"
                        hint="Point camera at the question paper barcode"
                        onScanned={handleScanned}
                        paused={false}
                    />
                    <div className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
                        <button
                            onClick={onBack}
                            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] border border-border py-3 text-sm font-medium text-muted-foreground"
                        >
                            ← Go back
                        </button>
                    </div>
                </>
            ) : (
                <div className="flex-1 min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 pb-24 pt-4">
                    <SectionCard title="Student Details">
                        <InfoRow label="Name" value={student.student_name} />
                        <InfoRow label="UUCMS" value={student.uucms} />
                        <InfoRow label="College" value={student.college_name} />
                        <InfoRow label="Program" value={student.program_name} />
                        <InfoRow label="Semester" value={student.semester} />
                        <InfoRow label="Academic Year" value={student.academic_year} />
                    </SectionCard>

                    <SectionCard title="Selected Subject">
                        <InfoRow label="Subject" value={course.course_name} />
                        <InfoRow label="Course Code" value={course.course_code} />
                        <InfoRow label="Exam Date" value={course.exam_date} />
                        <InfoRow label="Exam Time" value={course.exam_time} />
                        <InfoRow label="Expected QP" value={course.qp_code} />
                    </SectionCard>

                    {scanned && (
                        <SectionCard title="Scanned QP Code">
                            {editingQp ? (
                                <div className="space-y-2">
                                    <input
                                        value={qpDraft}
                                        onChange={(e) => setQpDraft(e.target.value)}
                                        className="w-full rounded-[0.6em] border border-border bg-background px-3 py-2 text-sm focus:border-foreground"
                                    />
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => setEditingQp(false)}
                                            className="flex cursor-pointer items-center justify-center rounded-[0.6em] border border-border px-4 py-2 text-sm text-muted-foreground"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={saveQpEdit}
                                            className="flex cursor-pointer items-center justify-center rounded-[0.6em] bg-primary px-8 py-2 text-sm font-medium text-primary-foreground"
                                        >
                                            Save
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <InfoRow label="Value" value={scanned} />
                                    <InfoRow label="Expected" value={course.qp_code} />
                                    {mismatch ? (
                                        <div className="flex items-center justify-between gap-2 py-[0.5em]">
                                            <p className="flex items-center gap-1.5 text-xs text-red-500">
                                                <HiXCircle size={14} className="shrink-0" />
                                                QP code mismatch with expected
                                            </p>
                                            <button
                                                onClick={startQpEdit}
                                                className="cursor-pointer text-xs font-medium text-primary underline"
                                            >
                                                Edit value
                                            </button>
                                        </div>
                                    ) : (
                                        <p className="flex items-center gap-1.5 py-[0.5em] text-xs text-emerald-500">
                                            <HiCheckCircle size={14} className="shrink-0" />
                                            QP code matches expected
                                        </p>
                                    )}
                                </>
                            )}
                        </SectionCard>
                    )}

                    <button
                        onClick={onBack}
                        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] border border-border py-2.5 text-sm text-muted-foreground hover:bg-muted"
                    >
                        ← Back
                    </button>
                </div>
            )}

            {canNext && (
                <div className="fixed bottom-0 inset-x-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
                    <button
                        onClick={() => onNext(scanned!)}
                        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                        Next — Scan Answer Booklet
                        <IoChevronForwardOutline size={15} />
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Step 3: Answer booklet scan + confirm ────────────────────────────────────

function Step3({
    student,
    course,
    qpCode,
    onBack,
    onDone,
}: {
    student: Student;
    course: Course;
    qpCode: string;
    onBack: () => void;
    onDone: () => void;
}) {
    const [scanning, setScanning] = useState(true);
    const [bookletCode, setBookletCode] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [qpValue, setQpValue] = useState(qpCode);
    const [editingQp, setEditingQp] = useState(false);
    const [qpDraft, setQpDraft] = useState(qpCode);
    const [editingBooklet, setEditingBooklet] = useState(false);
    const [bookletDraft, setBookletDraft] = useState("");

    const handleScanned = useCallback((value: string) => {
        setScanning(false);
        setBookletCode(value);
    }, []);

    const mismatch = qpValue !== course.qp_code;

    const startQpEdit = () => {
        setQpDraft(qpValue);
        setEditingQp(true);
    };

    const saveQpEdit = () => {
        setQpValue(qpDraft.trim());
        setEditingQp(false);
    };

    const startBookletEdit = () => {
        setBookletDraft(bookletCode ?? "");
        setEditingBooklet(true);
    };

    const saveBookletEdit = () => {
        setBookletCode(bookletDraft.trim());
        setEditingBooklet(false);
    };

    const handleMark = async () => {
        if (!bookletCode) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch("/api/attendance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    uucms: student.uucms,
                    student_name: student.student_name,
                    college_code: student.college_code,
                    college_name: student.college_name,
                    program_name: student.program_name,
                    semester: student.semester,
                    academic_year: student.academic_year,
                    course_code: course.course_code,
                    course_name: course.course_name,
                    exam_date: course.exam_date,
                    exam_time: course.exam_time,
                    qp_code_expected: course.qp_code,
                    centre_code: course.centre_code,
                    qp_code_scanned: qpValue,
                    answer_booklet_code: bookletCode,
                }),
            });

            if (!res.ok) {
                const d = await res.json().catch(() => null);
                if (res.status === 409) {
                    throw new Error("Attendance already marked for this student and subject.");
                }
                throw new Error(d?.error ?? "Failed to mark attendance");
            }

            onDone();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to mark attendance");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="relative flex h-full flex-col overflow-hidden">
            {scanning ? (
                <>
                    <CameraScanner
                        label="Scan Answer Booklet Barcode"
                        hint="Point camera at the answer booklet barcode"
                        onScanned={handleScanned}
                        paused={false}
                    />
                    <div className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
                        <button
                            onClick={onBack}
                            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] border border-border py-3 text-sm font-medium text-muted-foreground"
                        >
                            ← Go back
                        </button>
                    </div>
                </>
            ) : (
                <div className="flex-1 min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 pb-28 pt-4">
                    {/* Summary */}
                    <SectionCard title="Student Details">
                        <InfoRow label="Name" value={student.student_name} />
                        <InfoRow label="UUCMS" value={student.uucms} />
                        <InfoRow label="College" value={student.college_name} />
                        <InfoRow label="Program" value={student.program_name} />
                        <InfoRow label="Semester" value={student.semester} />
                        <InfoRow label="Academic Year" value={student.academic_year} />
                    </SectionCard>

                    <SectionCard title="Subject">
                        <InfoRow label="Subject" value={course.course_name} />
                        <InfoRow label="Course Code" value={course.course_code} />
                        <InfoRow label="Exam Date" value={course.exam_date} />
                        <InfoRow label="Exam Time" value={course.exam_time} />
                        <InfoRow label="Centre" value={course.centre_code} />
                    </SectionCard>

                    <SectionCard title="QP Code">
                        <InfoRow label="Expected" value={course.qp_code} />
                        {editingQp ? (
                            <div className="space-y-2 pt-1">
                                <input
                                    value={qpDraft}
                                    onChange={(e) => setQpDraft(e.target.value)}
                                    className="w-full rounded-[0.6em] border border-border bg-background px-3 py-2 text-sm focus:border-foreground"
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={saveQpEdit}
                                        className="flex cursor-pointer items-center justify-center rounded-[0.6em] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                                    >
                                        Save
                                    </button>
                                    <button
                                        onClick={() => setEditingQp(false)}
                                        className="flex cursor-pointer items-center justify-center rounded-[0.6em] border border-border px-4 py-2 text-sm text-muted-foreground"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <InfoRow label="Scanned" value={qpValue} />
                                {mismatch ? (
                                    <div className="flex items-center justify-between gap-2 py-[0.5em]">
                                        <p className="flex items-center gap-1.5 text-xs text-red-500">
                                            <HiXCircle size={14} className="shrink-0" />
                                            QP code mismatch with expected
                                        </p>
                                        <button
                                            onClick={startQpEdit}
                                            className="cursor-pointer text-xs font-medium text-primary underline"
                                        >
                                            Edit value
                                        </button>
                                    </div>
                                ) : (
                                    <p className="flex items-center gap-1.5 py-[0.5em] text-xs text-emerald-500">
                                        <HiCheckCircle size={14} className="shrink-0" />
                                        QP code matches expected
                                    </p>
                                )}
                            </>
                        )}
                    </SectionCard>

                    {bookletCode && (
                        <SectionCard title="Answer Booklet">
                            {editingBooklet ? (
                                <div className="space-y-2 pt-1">
                                    <input
                                        value={bookletDraft}
                                        onChange={(e) => setBookletDraft(e.target.value)}
                                        className="w-full rounded-[0.6em] border border-border bg-background px-3 py-2 text-sm focus:border-foreground"
                                    />
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => setEditingBooklet(false)}
                                            className="flex cursor-pointer items-center justify-center rounded-[0.6em] border border-border px-4 py-2 text-sm text-muted-foreground"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={saveBookletEdit}
                                            className="flex cursor-pointer items-center justify-center rounded-[0.6em] bg-primary px-8 py-2 text-sm font-medium text-primary-foreground"
                                        >
                                            Save
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <InfoRow label="Scanned Code" value={bookletCode} />
                                    <div className="flex items-center justify-between gap-2 py-[0.5em]">
                                        <p className="text-xs text-muted-foreground">Incorrect scan?</p>
                                        <button
                                            onClick={startBookletEdit}
                                            className="cursor-pointer text-xs font-medium text-primary underline"
                                        >
                                            Edit value
                                        </button>
                                    </div>
                                </>
                            )}
                        </SectionCard>
                    )}

                    {error && (
                        <div className="rounded-[0.8em] border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={onBack}
                        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] border border-border py-2.5 text-sm text-muted-foreground hover:bg-muted"
                    >
                        ← Back
                    </button>
                </div>
            )}

            {bookletCode && !mismatch && !editingQp && !editingBooklet && (
                <div className="fixed bottom-0 inset-x-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
                    <button
                        onClick={handleMark}
                        disabled={submitting}
                        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] bg-emerald-600 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                    >
                        {submitting ? "Marking…" : "Mark Attendance"}
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function ScannerApp() {
    const [step, setStep] = useState<Step>(1);
    const [student, setStudent] = useState<Student | null>(null);
    const [course, setCourse] = useState<Course | null>(null);
    const [qpCode, setQpCode] = useState<string | null>(null);
    const [toast, setToast] = useState<Toast | null>(null);
    const [isMobile, setIsMobile] = useState<boolean | null>(null);

    useEffect(() => {
        const checkDevice = () => {
            const widthOk = window.innerWidth <= 768;
            const userAgentOk = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
                navigator.userAgent
            );
            setIsMobile(widthOk || userAgentOk);
        };

        checkDevice();
        window.addEventListener("resize", checkDevice);
        return () => window.removeEventListener("resize", checkDevice);
    }, []);

    if (isMobile === false) {
        return (
            <div className="flex h-svh flex-col bg-background text-foreground">
                <Navbar />
                <div className="flex flex-1 items-center justify-center px-6 text-center">
                    <div className="max-w-sm rounded-[1em] border border-border bg-card p-6 shadow-sm">
                        <div className="mb-3 flex justify-center text-primary">
                            <LuScanBarcode size={32} />
                        </div>
                        <h1 className="text-xl font-semibold">Kindly use mobile</h1>
                        <p className="mt-2 text-sm text-muted-foreground">
                            This scanner works only on mobile devices. Please open this page from your phone or tablet.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (isMobile === null) {
        return (
            <div className="flex h-svh items-center justify-center bg-background text-sm text-muted-foreground">
                Checking device…
            </div>
        );
    }

    const STEP_LABELS: Record<Step, string> = {
        1: "Hall Ticket",
        2: "QP Code",
        3: "Answer Booklet",
        4: "Done",
    };

    const handleStep1Done = (s: Student, c: Course) => {
        setStudent(s);
        setCourse(c);
        setStep(2);
    };

    const handleStep2Done = (qp: string) => {
        setQpCode(qp);
        setStep(3);
    };

    const handleDone = () => {
        setToast({ type: "success", message: "Attendance marked successfully" });
        // Reset for next student
        setTimeout(() => {
            setStep(1);
            setStudent(null);
            setCourse(null);
            setQpCode(null);
        }, 1200);
    };

    return (
        <div className="flex h-svh flex-col overflow-hidden overscroll-none bg-background font-sans text-foreground">
            <Navbar />

            {toast && (
                <div className="fixed inset-x-0 top-16 z-50 flex justify-center px-4">
                    <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
                </div>
            )}

            {/* Step indicator strip */}
            <div className="flex items-start border-b border-border bg-card px-6 py-3">
                {([1, 2, 3] as Step[]).map((s, i) => (
                    <Fragment key={s}>
                        <div className="flex flex-col items-center gap-1.5">
                            <div className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold transition-colors ${step > s
                                ? "border-primary bg-primary text-primary-foreground"
                                : step === s
                                    ? "border-primary text-primary"
                                    : "border-border text-muted-foreground/50"
                                }`}>
                                {step > s ? <HiOutlineCheckCircle size={10} /> : s}
                            </div>
                            <span className={`text-center text-[11px] font-medium transition-colors ${step === s ? "text-primary" : step > s ? "text-muted-foreground" : "text-muted-foreground/50"
                                }`}>
                                {STEP_LABELS[s]}
                            </span>
                        </div>
                        {i < 2 && (
                            <div className={`relative top-[10px] mx-2 h-px flex-1 ${step > s ? "bg-primary" : "bg-border"}`} />
                        )}
                    </Fragment>
                ))}
            </div>

            {/* Step content — fills remaining height, details scroll inside bottom card */}
            <div className="relative flex-1 overflow-hidden">
                {step === 1 && <Step1 onNext={handleStep1Done} />}
                {step === 2 && student && course && (
                    <Step2
                        student={student}
                        course={course}
                        onNext={handleStep2Done}
                        onBack={() => setStep(1)}
                    />
                )}
                {step === 3 && student && course && qpCode && (
                    <Step3
                        student={student}
                        course={course}
                        qpCode={qpCode}
                        onBack={() => setStep(2)}
                        onDone={handleDone}
                    />
                )}
            </div>

        </div>
    );
}

export default function ScannerPage() {
    return (
        <AccessGate slug="scanner">
            <ScannerApp />
        </AccessGate>
    );
}
