"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Navbar from "@/components/layout/Navbar";
import AccessGate from "@/components/access/AccessGate";
import {
    requestUploadUrl,
    uploadFileDirect,
    startProcessing,
    getStatus,
    getResult,
    checkBackend,
    type StatusResponse,
    type ResultResponse,
} from "@/utils/pdf-engine";
import { IoCloudUploadOutline } from "react-icons/io5";
import { RiVerifiedBadgeFill } from "react-icons/ri";
import { BiSolidErrorAlt } from "react-icons/bi";
import {
    HiOutlineCheckCircle,
    HiOutlineDownload,
    HiOutlineRefresh,
    HiOutlineX,
} from "react-icons/hi";
import { HiOutlineDocumentArrowDown } from "react-icons/hi2";
import { LuFileChartColumn } from "react-icons/lu";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "upload" | "processing" | "done" | "error";

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ type, message, onDismiss }: { type: "success" | "error"; message: string; onDismiss: () => void }) {
    useEffect(() => {
        const t = setTimeout(onDismiss, 5000);
        return () => clearTimeout(t);
    }, [onDismiss]);

    return (
        <div className={`fixed bottom-6 left-1/2 z-50 flex w-max max-w-sm -translate-x-1/2 items-center gap-3 rounded-[0.8em] border px-4 py-3 shadow-lg transition-all duration-300 ${
            type === "success"
                ? "border-emerald-400/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "border-red-400/30 bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300"
        }`}>
            {type === "success"
                ? <RiVerifiedBadgeFill size={18} className="shrink-0 text-emerald-500" />
                : <BiSolidErrorAlt size={18} className="shrink-0 text-red-500" />
            }
            <span className="text-sm font-medium">{message}</span>
            <button onClick={onDismiss} className="ml-1 cursor-pointer opacity-60 hover:opacity-100">
                <HiOutlineX size={14} />
            </button>
        </div>
    );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ["Upload", "Processing", "Complete"] as const;

function StepDots({ step }: { step: Step }) {
    const idx = step === "upload" ? 0 : step === "processing" ? 1 : 2;
    return (
        <div className="flex items-center gap-2">
            {STEPS.map((label, i) => (
                <div key={label} className="flex items-center gap-2">
                    <div className="flex flex-col items-center gap-1">
                        <div className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-300 ${
                            i < idx
                                ? "border-primary bg-primary text-primary-foreground"
                                : i === idx
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground"
                        }`}>
                            {i < idx ? <HiOutlineCheckCircle size={14} /> : i + 1}
                        </div>
                        <span className={`text-xs ${i === idx ? "text-foreground" : "text-muted-foreground"}`}>
                            {label}
                        </span>
                    </div>
                    {i < STEPS.length - 1 && (
                        <div className={`mb-4 h-px w-12 transition-colors duration-300 ${i < idx ? "bg-primary" : "bg-border"}`} />
                    )}
                </div>
            ))}
        </div>
    );
}

// ─── Upload step ──────────────────────────────────────────────────────────────

function UploadStep({ onStart, disabled }: { onStart: (file: File) => void; disabled: boolean }) {
    const [dragging, setDragging] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const accept = useCallback((f: File) => { if (disabled) return; if (f.name.toLowerCase().endsWith(".pdf")) setFile(f); }, [disabled]);
    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        const f = e.dataTransfer.files[0];
        if (f) accept(f);
    }, [disabled, accept]);
    const onDragOver = (e: React.DragEvent) => { e.preventDefault(); if (!disabled) setDragging(true); };
    const onDragLeave = () => setDragging(false);
    const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) accept(f); };
    const formatSize = (b: number) => b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1024 * 1024)).toFixed(2)} MB`;

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Upload Hall Ticket PDF</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Upload a UUCMS hall ticket PDF. Barcodes will be stamped onto each student&apos;s ticket.
                </p>
            </div>

            {/* Drop zone */}
            <div
                onClick={() => !disabled && !file && inputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                className={`relative flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-[0.8em] border-2 border-dashed transition-all duration-200 ${
                    disabled
                        ? "cursor-not-allowed border-border bg-muted/20 opacity-60"
                        : dragging
                        ? "cursor-pointer border-primary bg-primary/5 scale-[1.01]"
                        : file
                        ? "cursor-default border-primary/40 bg-primary/5"
                        : "cursor-pointer border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
                }`}
            >
                <input ref={inputRef} type="file" accept=".pdf" disabled={disabled} className="hidden" onChange={onInputChange} />

                {file ? (
                    <div className="flex w-full flex-col items-center gap-3 px-6">
                        {/* X button top-right */}
                        <button
                            onClick={(e) => { e.stopPropagation(); setFile(null); }}
                            className="absolute right-3 top-3 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                        >
                            <HiOutlineX size={12} />
                        </button>
                        <div className="flex h-14 w-14 items-center justify-center rounded-[0.8em] bg-primary/10">
                            <LuFileChartColumn size={28} className="text-primary" />
                        </div>
                        <div className="text-center">
                            <p className="max-w-xs truncate text-sm font-medium text-foreground">{file.name}</p>
                            <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-3 px-6 text-center">
                        <div className={`flex h-14 w-14 items-center justify-center rounded-[0.8em] transition-colors ${dragging && !disabled ? "bg-primary/20" : "bg-muted"}`}>
                            <IoCloudUploadOutline size={30} className={dragging && !disabled ? "text-primary" : "text-muted-foreground"} />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-foreground">
                                {disabled
                                    ? "Uploads are paused"
                                    : dragging
                                    ? "Drop to upload"
                                    : "Drag & drop your PDF here"}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {disabled
                                    ? "Backend is currently unavailable. Retrying automatically…"
                                    : "or click to browse — PDF files only"}
                            </p>
                        </div>
                    </div>
                )}
            </div>

            <button
                disabled={!file || disabled}
                onClick={() => file && onStart(file)}
                className="w-full cursor-pointer rounded-[0.8em] bg-primary py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
                Start Processing
            </button>
        </div>
    );
}

// ─── Processing step ──────────────────────────────────────────────────────────

function ProcessingStep({ status, uploadProgress }: { status: StatusResponse | null; uploadProgress: number }) {
    const isUploading = uploadProgress < 100;
    const processed = status?.processed_pages ?? 0;
    const total = status?.total_pages ?? 0;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

    const stats = [
        {
            label: "Total pages",
            value: total,
            color: "border-blue-400/30 bg-blue-500/5",
            valueColor: "text-blue-600 dark:text-blue-400",
        },
        {
            label: "Processed",
            value: processed,
            color: "border-violet-400/30 bg-violet-500/5",
            valueColor: "text-violet-600 dark:text-violet-400",
        },
        {
            label: "Barcodes placed",
            value: status?.barcode_success ?? 0,
            color: "border-emerald-400/30 bg-emerald-500/5",
            valueColor: "text-emerald-600 dark:text-emerald-400",
        },
        {
            label: "Failed",
            value: status?.barcode_failed ?? 0,
            color: "border-red-400/30 bg-red-500/5",
            valueColor: "text-red-600 dark:text-red-400",
        },
    ];

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">
                    {isUploading ? "Uploading PDF…" : "Processing PDF…"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    {isUploading
                        ? "Transferring your file to storage — please keep this tab open."
                        : "Extracting student records and stamping barcodes. This may take a moment."}
                </p>
            </div>

            {/* Upload progress bar */}
            {isUploading && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Uploading</span>
                        <span>{uploadProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                    </div>
                </div>
            )}

            {/* Processing progress bar */}
            {!isUploading && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Pages processed</span>
                        <span>{pct}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    {total > 0 && (
                        <p className="text-right text-xs text-muted-foreground">{processed} / {total} pages</p>
                    )}
                </div>
            )}

            {/* Stats grid — show always, 0 by default */}
            {!isUploading && (
                <div className="grid grid-cols-2 gap-3">
                    {stats.map(({ label, value, color, valueColor }) => (
                        <div key={label} className={`rounded-[0.8em] border px-4 py-3 ${color}`}>
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className={`mt-0.5 text-xl font-semibold ${valueColor}`}>{value}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Pulse indicator */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                {isUploading ? "Uploading…" : "Processing…"}
            </div>
        </div>
    );
}

// ─── Done step ────────────────────────────────────────────────────────────────

function DoneStep({ result: resultData, status, onReset }: { result: ResultResponse; status: StatusResponse | null; onReset: () => void }) {
    const [downloading, setDownloading] = useState(false);

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const res = await fetch(resultData.download_url);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = resultData.filename;
            a.click();
            URL.revokeObjectURL(url);
        } finally {
            setDownloading(false);
        }
    };

    const successRate = status && status.barcode_success + status.barcode_failed > 0
        ? Math.round((status.barcode_success / (status.barcode_success + status.barcode_failed)) * 100)
        : null;

    const summaryStats = [
        { label: "Total pages", value: status?.total_pages ?? "—", color: "border-blue-400/30 bg-blue-500/5", valueColor: "text-blue-600 dark:text-blue-400" },
        { label: "Barcodes placed", value: status?.barcode_success ?? "—", color: "border-emerald-400/30 bg-emerald-500/5", valueColor: "text-emerald-600 dark:text-emerald-400" },
        { label: "Barcode failures", value: status?.barcode_failed ?? "—", color: "border-red-400/30 bg-red-500/5", valueColor: "text-red-600 dark:text-red-400" },
        { label: "Success rate", value: successRate !== null ? `${successRate}%` : "—", color: "border-violet-400/30 bg-violet-500/5", valueColor: "text-violet-600 dark:text-violet-400" },
    ];

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Processing Complete</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Your hall ticket PDF has been processed and barcodes have been stamped.
                </p>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 gap-3">
                {summaryStats.map(({ label, value, color, valueColor }) => (
                    <div key={label} className={`rounded-[0.8em] border px-4 py-3 ${color}`}>
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className={`mt-0.5 text-xl font-semibold ${valueColor}`}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Filename */}
            <div className="flex items-center gap-3 rounded-[0.8em] border border-border bg-muted/40 px-4 py-3">
                <HiOutlineDocumentArrowDown size={18} className="shrink-0 text-muted-foreground" />
                <span className="truncate text-sm text-foreground">{resultData.filename}</span>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3">
                <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] bg-primary py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                    <HiOutlineDownload size={16} />
                    {downloading ? "Downloading…" : "Download PDF"}
                </button>
                <button
                    onClick={onReset}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] border border-border py-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                    <HiOutlineRefresh size={15} />
                    Process another PDF
                </button>
            </div>
        </div>
    );
}

// ─── Error step ───────────────────────────────────────────────────────────────

function ErrorStep({ message, onReset }: { message: string; onReset: () => void }) {
    return (
        <div className="flex flex-col gap-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Processing Failed</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Something went wrong while processing your PDF.
                </p>
            </div>

            <div className="rounded-[0.8em] border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-400">
                {message || "An unexpected error occurred. Please try again."}
            </div>

            <button
                onClick={onReset}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] bg-primary py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
                <HiOutlineRefresh size={15} />
                Try again
            </button>
        </div>
    );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "barcode-job-id";

export default function BarcodePage() {
    return (
        <AccessGate slug="barcode">
            <BarcodeApp />
        </AccessGate>
    );
}

function BarcodeApp() {
    const [step, setStep] = useState<Step>("upload");
    const [uploadProgress, setUploadProgress] = useState(0);
    const [jobId, setJobId] = useState<string | null>(null);
    const [status, setStatus] = useState<StatusResponse | null>(null);
    const [result, setResult] = useState<ResultResponse | null>(null);
    const [errorMsg, setErrorMsg] = useState("");
    const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
    const [resuming, setResuming] = useState(true); // true while checking localStorage on mount
    const [backendStatus, setBackendStatus] = useState<"checking" | "ok" | "down">("checking");
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

    useEffect(() => {
        let active = true;
        let checkTimer: ReturnType<typeof setTimeout>;
        const check = async () => {
            const ok = await checkBackend();
            if (!active) return;
            setBackendStatus(ok ? "ok" : "down");
            if (!ok) checkTimer = setTimeout(check, 10000);
        };
        check();
        return () => { active = false; clearTimeout(checkTimer); };
    }, []);

    const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

    const startPolling = (id: string) => {
        pollRef.current = setInterval(async () => {
            try {
                const s = await getStatus(id);
                setStatus(s);
                if (s.status === "done") {
                    stopPolling();
                    const r = await getResult(id);
                    setResult(r);
                    setStep("done");
                    localStorage.removeItem(STORAGE_KEY);
                    setToast({ type: "success", message: "Completed successfully" });
                } else if (s.status === "error") {
                    stopPolling();
                    setErrorMsg(s.error_message || "Processing failed.");
                    setStep("error");
                    localStorage.removeItem(STORAGE_KEY);
                    setToast({ type: "error", message: s.error_message || "Processing failed." });
                }
            } catch (e) {
                console.error("poll error", e);
            }
        }, 2000);
    };

    // On mount — check if there's a saved job to reconnect to
    useEffect(() => {
        const savedId = localStorage.getItem(STORAGE_KEY);
        if (!savedId) { queueMicrotask(() => setResuming(false)); return; }

        const resume = async () => {
            try {
                const s = await getStatus(savedId);
                setJobId(savedId);
                setStatus(s);

                if (s.status === "processing") {
                    // Job still running — jump into processing and keep polling
                    setUploadProgress(100);
                    setStep("processing");
                    startPolling(savedId);
                } else if (s.status === "done") {
                    const r = await getResult(savedId);
                    setResult(r);
                    setStep("done");
                    localStorage.removeItem(STORAGE_KEY);
                    setToast({ type: "success", message: "Completed successfully" });
                } else {
                    // error or unknown — clear and start fresh
                    localStorage.removeItem(STORAGE_KEY);
                }
            } catch {
                // Job not found (TTL expired) or network error — clear and start fresh
                localStorage.removeItem(STORAGE_KEY);
            } finally {
                setResuming(false);
            }
        };
        resume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleStart = async (file: File) => {
        try {
            setStep("processing");
            setUploadProgress(0);
            const { job_id, object_key, upload_url } = await requestUploadUrl(file.name);
            setJobId(job_id);
            localStorage.setItem(STORAGE_KEY, job_id); // persist before upload starts
            await uploadFileDirect(upload_url, file, setUploadProgress);
            setUploadProgress(100);
            await startProcessing(job_id, object_key, file.name);
            startPolling(job_id);
        } catch (e: unknown) {
            stopPolling();
            const msg = e instanceof Error ? e.message : "Something went wrong.";
            setErrorMsg(msg);
            setStep("error");
            setToast({ type: "error", message: msg });
        }
    };

    const handleReset = () => {
        stopPolling();
        localStorage.removeItem(STORAGE_KEY);
        setStep("upload");
        setUploadProgress(0);
        setJobId(null);
        setStatus(null);
        setResult(null);
        setErrorMsg("");
    };

    const cardStep: Step = step === "error" ? "done" : step;

    // Show nothing while checking for a saved job to avoid flash of upload screen
    if (resuming) {
        return (
            <div className="flex min-h-svh flex-col bg-background font-sans text-foreground">
                <Navbar />
                {backendStatus === "down" && (
                    <div className="mx-4 mt-3 flex items-center justify-center gap-2.5 rounded-[0.8em] border border-red-400/30 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300 sm:mx-auto sm:max-w-6xl sm:px-6">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.5em] bg-red-500/15 sm:h-6 sm:w-6">
                            <BiSolidErrorAlt size={16} />
                        </span>
                        <span>We are running out of resources at this time. Please try later.</span>
                    </div>
                )}
                <main className="flex flex-1 items-center justify-center">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                        </span>
                        Checking for active jobs…
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="flex min-h-svh flex-col bg-background font-sans text-foreground">
            <Navbar />

            {backendStatus === "down" && (
                <div className="mx-4 mt-3 flex items-center justify-center gap-2.5 rounded-[0.8em] border border-red-400/30 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300 sm:mx-auto sm:max-w-6xl sm:px-6">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.5em] bg-red-500/15 sm:h-6 sm:w-6">
                        <BiSolidErrorAlt size={16} />
                    </span>
                    <span>We are running out of resources at this time. Please try later.</span>
                </div>
            )}

            <main className="flex flex-1 items-start justify-center px-4 pt-[2em] pb-6 sm:items-center sm:py-12">
                <div className="w-full max-w-md">
                    <div className="mb-8 flex justify-center">
                        <StepDots step={cardStep} />
                    </div>

                    <div className="rounded-[0.8em] border border-border bg-card p-8">
                        {step === "upload" && <UploadStep onStart={handleStart} disabled={backendStatus !== "ok"} />}
                        {step === "processing" && <ProcessingStep status={status} uploadProgress={uploadProgress} />}
                        {step === "done" && result && <DoneStep result={result} status={status} onReset={handleReset} />}
                        {step === "error" && <ErrorStep message={errorMsg} onReset={handleReset} />}
                    </div>

                    {jobId && step !== "upload" && (
                        <p className="mt-4 text-center text-xs text-muted-foreground">
                            Job ID: <span className="font-mono">{jobId}</span>
                        </p>
                    )}
                </div>
            </main>

            {toast && (
                <Toast
                    type={toast.type}
                    message={toast.message}
                    onDismiss={() => setToast(null)}
                />
            )}
        </div>
    );
}
