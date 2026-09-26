"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AccessGate from "@/components/AccessGate";
import Navbar from "@/components/Navbar";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { createClient } from "@/utils/supabase/client";
import { LuCamera, LuScanBarcode, LuUpload, LuCircleCheck, LuArrowLeft } from "react-icons/lu";
import { HiOutlineDeviceMobile } from "react-icons/hi";
import { IoChevronForwardOutline, IoRefreshOutline } from "react-icons/io5";
import { BiSolidErrorAlt } from "react-icons/bi";

import { PDFDocument } from "pdf-lib";
import { WebcamBookletScanner, type ScannedPage } from "@/components/WebcamBookletScanner";

// ─── Types ────────────────────────────────────────────────────────────────────

type FlowStep =
  | "instructions"
  | "scan-barcode-start"    // scan initial answer booklet barcode
  | "candidate-details"     // show fetched candidate details
  | "scanning-pages"        // scan 37 pages
  | "scan-barcode-end"      // re-scan barcode to confirm
  | "upload"                // upload button screen
  | "done";                 // back to instructions

interface CandidateDetails {
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
  centre_code?: string | null;
  qp_code_expected?: string | null;
  qp_code_scanned?: string | null;
  exam_time?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ZXING_NOISE = [
  "MultiFormatReader: non-ReaderException",
  "Trying to play video that is already playing.",
  "Trying to play video that has ended.",
  "It was not possible to play the video.",
  "got interrupted by new loading request",
];

let beepCtx: AudioContext | null = null;
function playBeep() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    beepCtx = beepCtx ?? new Ctx();
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
  } catch {}
}

// ─── Barcode Scanner ──────────────────────────────────────────────────────────

function BarcodeScanner({
  label,
  hint,
  onScanned,
}: {
  label: string;
  hint: string;
  onScanned: (value: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const scannedRef = useRef(false);

  useEffect(() => {
    scannedRef.current = false;
    const video = videoRef.current;
    if (!video) return;

    const originalWarn = console.warn;
    const originalError = console.error;
    const isNoise = (args: unknown[]) => {
      const f = args[0];
      return typeof f === "string" && ZXING_NOISE.some((p) => f.startsWith(p));
    };
    console.warn = (...args) => { if (!isNoise(args)) originalWarn(...args); };
    console.error = (...args) => { if (!isNoise(args)) originalError(...args); };

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
      try { video.pause(); video.srcObject = null; } catch {}
      stream?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
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
      } catch {}
      rafId = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
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

    return () => {
      cancel();
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, [onScanned]);

  return (
    <div className="relative flex flex-col w-full overflow-hidden rounded-[0.8em] border border-border">
      <div className="relative h-64 bg-black overflow-hidden">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="relative h-36 w-56">
            {[["top-0 left-0", "border-t-2 border-l-2"], ["top-0 right-0", "border-t-2 border-r-2"],
              ["bottom-0 left-0", "border-b-2 border-l-2"], ["bottom-0 right-0", "border-b-2 border-r-2"],
            ].map(([pos, border]) => (
              <span key={pos} className={`absolute ${pos} h-6 w-6 border-white/80 rounded-sm ${border}`} />
            ))}
            <div className="absolute inset-x-0 top-1/2 h-0.5 animate-[scanline_2.4s_ease-in-out_infinite] bg-emerald-400/90" />
          </div>
        </div>
        <div className="absolute bottom-0 inset-x-0 bg-black/60 px-4 py-2 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <LuScanBarcode size={14} className="text-white/80" />
            <span className="text-xs font-medium text-white">{label}</span>
          </div>
          <p className="text-[11px] text-white/60">{hint}</p>
        </div>
      </div>
      {error && (
        <div className="p-4 text-sm text-red-500">{error}</div>
      )}
    </div>
  );
}

// ─── Info Row ─────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-border last:border-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right font-medium text-foreground">{value || "—"}</span>
    </div>
  );
}

// ─── Step: Instructions ───────────────────────────────────────────────────────

function InstructionsStep({ onStart }: { onStart: () => void }) {
  const steps = [
    {
      icon: "1",
      title: "Scan answer booklet barcode",
      body: "Point camera at the barcode on the answer booklet cover. The system fetches the candidate's details.",
    },
    {
      icon: "2",
      title: "Review candidate details",
      body: "Verify the student info fetched from the database before proceeding.",
    },
    {
      icon: "3",
      title: "Scan all 37 pages",
      body: "Hold each page spread in front of the camera. QR codes are auto-detected and pages captured in order.",
    },
    {
      icon: "4",
      title: "Confirm with barcode again",
      body: "Scan the booklet barcode once more. It must match the starting scan to confirm integrity.",
    },
    {
      icon: "5",
      title: "Upload",
      body: "All pages are compiled and uploaded to Supabase with the candidate record. You're done!",
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-28 pt-5 space-y-5">
        {/* Hero card */}
        <div className="rounded-[0.8em] bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 px-5 py-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-[0.8em] bg-primary/15 text-primary mb-3">
            <LuCamera size={24} />
          </div>
          <h1 className="text-xl font-bold text-foreground">Answer Booklet Scanner</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scan and upload answer booklets using your device camera. Follow the steps below.
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-[0.5em] bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            <HiOutlineDeviceMobile size={13} />
            Camera required
          </div>
        </div>

        {/* Steps */}
        <div className="rounded-[0.8em] border border-border bg-card px-4 py-4 space-y-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">How it works</p>
          {steps.map((s) => (
            <div key={s.icon} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {s.icon}
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">{s.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Tip */}
        <div className="rounded-[0.8em] border border-amber-400/30 bg-amber-500/5 px-4 py-3">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            <span className="font-bold uppercase tracking-wide mr-1">Tip:</span>
            Align each page spread with the horizontal center line on the camera feed for best results.
          </p>
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm">
        <button
          id="start-scanner-btn"
          onClick={onStart}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <LuScanBarcode size={16} />
          Start Scanning
          <IoChevronForwardOutline size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Step: Scan barcode ───────────────────────────────────────────────────────

function ScanBarcodeStep({
  title,
  subtitle,
  hint,
  onScanned,
  onBack,
}: {
  title: string;
  subtitle: string;
  hint: string;
  onScanned: (value: string) => void;
  onBack?: () => void;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-10 pt-5 space-y-4">
        <div className="rounded-[0.8em] border border-border bg-card px-4 py-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{subtitle}</p>
          <h2 className="mt-1 text-lg font-bold text-foreground">{title}</h2>
        </div>
        <BarcodeScanner
          label="Scan Barcode"
          hint={hint}
          onScanned={onScanned}
        />
        <p className="text-center text-xs text-muted-foreground">
          Hold the barcode steady inside the frame. Scanning happens automatically.
        </p>
      </div>
      {onBack && (
        <div className="border-t border-border px-4 py-3">
          <button
            onClick={onBack}
            className="flex w-full items-center justify-center gap-2 rounded-[0.8em] border border-border py-2.5 text-sm text-muted-foreground hover:bg-muted"
          >
            <LuArrowLeft size={14} />
            Back
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Step: Candidate Details ──────────────────────────────────────────────────

function CandidateDetailsStep({
  bookletCode,
  details,
  loading,
  error,
  onProceed,
  onProceedAnyway,
  onRetry,
}: {
  bookletCode: string | null;
  details: CandidateDetails | null;
  loading: boolean;
  error: string | null;
  onProceed: () => void;
  onProceedAnyway: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-32 pt-5 space-y-4">
        <div className="rounded-[0.8em] border border-border bg-card px-4 py-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Step 1 Complete</p>
          <h2 className="mt-1 text-lg font-bold text-foreground">Candidate Details</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Scanned booklet code: <span className="font-mono font-semibold text-foreground">{bookletCode || "—"}</span>
          </p>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-[0.8em] border border-border bg-card py-12 text-sm text-muted-foreground">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
            </span>
            <p>Fetching candidate from database…</p>
          </div>
        )}

        {error && !loading && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-[0.8em] border border-red-400/30 bg-red-500/10 px-4 py-3.5 text-sm text-red-500">
              <BiSolidErrorAlt size={20} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Candidate Lookup Failed</p>
                <p className="mt-0.5 text-xs text-red-500/90">{error}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground px-1">
              You can re-scan the barcode or proceed directly with booklet code <strong>{bookletCode}</strong>.
            </p>
          </div>
        )}

        {details && !loading && (
          <div className="rounded-[0.8em] border border-border bg-card px-4 py-3 space-y-1">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Candidate Record</p>
            <InfoRow label="Answer Booklet Code" value={details.answer_booklet_code} />
            <InfoRow label="Student Name" value={details.student_name} />
            <InfoRow label="UUCMS / Roll No" value={details.uucms} />
            <InfoRow label="College" value={details.college_name ? `${details.college_name} (${details.college_code || "—"})` : details.college_code} />
            <InfoRow label="Program" value={details.program_name} />
            <InfoRow label="Semester" value={details.semester} />
            <InfoRow label="Academic Year" value={details.academic_year} />
            <InfoRow label="Course" value={details.course_name ? `${details.course_name} (${details.course_code || "—"})` : details.course_code} />
            {details.qp_code_scanned && <InfoRow label="QP Code Scanned" value={details.qp_code_scanned} />}
            {details.qp_code_expected && <InfoRow label="QP Code Expected" value={details.qp_code_expected} />}
            <InfoRow label="Exam Date" value={details.exam_date} />
            {details.exam_time && <InfoRow label="Exam Time" value={details.exam_time} />}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm space-y-2">
        {details && !loading && (
          <button
            id="proceed-to-scan-btn"
            onClick={onProceed}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
          >
            Start Scanning Pages
            <IoChevronForwardOutline size={14} />
          </button>
        )}

        {error && !loading && (
          <button
            onClick={onProceedAnyway}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Continue with Booklet Code Only
            <IoChevronForwardOutline size={14} />
          </button>
        )}

        {!loading && (
          <button
            onClick={onRetry}
            className="flex w-full items-center justify-center gap-2 rounded-[0.8em] border border-border py-2.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <IoRefreshOutline size={15} />
            Scan Barcode Again
          </button>
        )}
      </div>
    </div>
  );
}

async function createPdfFromPages(pages: ScannedPage[]): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();

  for (const page of pages) {
    if (!page.thumb) continue;
    try {
      const base64Data = page.thumb.includes(",") ? page.thumb.split(",")[1] : page.thumb;
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const img = await pdfDoc.embedJpg(bytes);
      const pdfPage = pdfDoc.addPage([img.width, img.height]);
      pdfPage.drawImage(img, {
        x: 0,
        y: 0,
        width: img.width,
        height: img.height,
      });
    } catch (err) {
      console.warn("Failed to embed page into PDF:", err);
    }
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" });
}

function UploadStep({
  pages,
  candidate,
  onUploaded,
  onBack,
}: {
  pages: ScannedPage[];
  candidate: CandidateDetails;
  onUploaded: () => void;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  const handleUpload = async () => {
    if (pages.length === 0) return;
    setStatus("uploading");
    setErrorMsg(null);

    try {
      // Build a multi-page PDF blob from all captured page images
      const pdfBlob = await createPdfFromPages(pages);
      const file = new File([pdfBlob], `${candidate.answer_booklet_code}.pdf`, {
        type: "application/pdf",
      });

      const meta: Record<string, string> = {
        answer_booklet_code: candidate.answer_booklet_code,
        uucms: candidate.uucms ?? "",
        student_name: candidate.student_name ?? "",
        college_code: candidate.college_code ?? "",
        college_name: candidate.college_name ?? "",
        program_name: candidate.program_name ?? "",
        semester: candidate.semester ?? "",
        academic_year: candidate.academic_year ?? "",
        course_code: candidate.course_code ?? "",
        course_name: candidate.course_name ?? "",
        exam_date: candidate.exam_date ?? "",
        page_count: String(pages.length),
      };

      const formData = new FormData();
      formData.append("file", file);
      formData.append("meta", JSON.stringify(meta));

      const res = await fetch("/api/answer-booklet/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Upload failed");
      }

      const data = await res.json() as { ok: boolean; url: string; id: string };
      setUploadedUrl(data.url);
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Upload failed");
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-28 pt-5 space-y-4">
        {status !== "done" ? (
          <>
            <div className="rounded-[0.8em] border border-border bg-card px-4 py-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">All pages scanned</p>
              <h2 className="mt-1 text-lg font-bold text-foreground">Ready to Upload</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {pages.length} page{pages.length !== 1 ? "s" : ""} scanned for{" "}
                <span className="font-semibold text-foreground">{candidate.student_name || candidate.answer_booklet_code}</span>.
              </p>
            </div>

            <div className="rounded-[0.8em] border border-border bg-card px-4 py-3">
              <InfoRow label="Booklet Code" value={candidate.answer_booklet_code} />
              <InfoRow label="Pages Scanned" value={String(pages.length)} />
              <InfoRow label="Student" value={candidate.student_name} />
              <InfoRow label="Course" value={candidate.course_name} />
            </div>

            {/* Page strip preview */}
            {pages.length > 0 && (
              <div className="rounded-[0.8em] border border-border bg-card p-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Scanned Pages ({pages.length})
                </p>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {pages.map((p, i) => (
                    <div key={p.id} className="shrink-0 w-16">
                      {p.thumb ? (
                        <img src={p.thumb} alt={`Page ${i + 1}`} className="h-24 w-full rounded-[0.4em] bg-black object-contain" />
                      ) : (
                        <div className="h-24 w-full rounded-[0.4em] bg-black flex items-center justify-center text-[10px] text-white/40">no preview</div>
                      )}
                      <p className="mt-1 text-center text-[10px] text-muted-foreground truncate">
                        {p.codes.length > 0 ? p.codes[0] : `#${i + 1}`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="flex items-center gap-3 rounded-[0.8em] border border-red-400/30 bg-red-500/10 px-3 py-3 text-sm text-red-500">
                <BiSolidErrorAlt size={18} className="shrink-0" />
                {errorMsg}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
              <LuCircleCheck size={32} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Upload Complete!</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {pages.length} pages uploaded for {candidate.student_name || candidate.answer_booklet_code}.
              </p>
            </div>
            {uploadedUrl && (
              <a
                href={uploadedUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary underline break-all max-w-xs"
              >
                View uploaded file ↗
              </a>
            )}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm space-y-2">
        {status === "done" ? (
          <button
            onClick={onUploaded}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <LuCamera size={16} />
            Scan Another Booklet
          </button>
        ) : (
          <>
            {errorMsg && (
              <div className="flex items-start gap-2.5 rounded-[0.8em] border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-500">
                <BiSolidErrorAlt size={16} className="shrink-0 mt-0.5" />
                <span className="flex-1">{errorMsg}</span>
              </div>
            )}
            <button
              id="upload-booklet-btn"
              onClick={handleUpload}
              disabled={status === "uploading" || pages.length === 0}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[0.8em] bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {status === "uploading" ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                  </span>
                  Uploading…
                </>
              ) : status === "error" ? (
                <>
                  <IoRefreshOutline size={16} />
                  Retry Upload
                </>
              ) : (
                <>
                  <LuUpload size={15} />
                  Upload Answer Booklet
                </>
              )}
            </button>
            <button
              onClick={onBack}
              disabled={status === "uploading"}
              className="flex w-full items-center justify-center gap-2 rounded-[0.8em] border border-border py-2.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <LuArrowLeft size={14} />
              Back to scanning
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Flow ────────────────────────────────────────────────────────────────

function WebcamScannerFlow() {
  const [step, setStep] = useState<FlowStep>("instructions");
  const [startBarcode, setStartBarcode] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<CandidateDetails | null>(null);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [scannedPages, setScannedPages] = useState<ScannedPage[]>([]);
  const [confirmBarcode, setConfirmBarcode] = useState<string | null>(null);
  const [barcodeMismatch, setBarcodeMismatch] = useState(false);

  const supabase = createClient();

  // Fetch candidate from attendance table by answer_booklet_code
  const fetchCandidate = useCallback(async (code: string) => {
    setCandidateLoading(true);
    setCandidateError(null);
    setCandidate(null);
    const trimmed = code.trim();
    try {
      const res = await fetch(`/api/attendance/lookup?code=${encodeURIComponent(trimmed)}`);
      const json = await res.json();
      if (!res.ok || !json.found || !json.candidate) {
        throw new Error(json.error || `No candidate record found in attendance for booklet code: ${trimmed}`);
      }

      const c = json.candidate;
      const details: CandidateDetails = {
        answer_booklet_code: trimmed,
        uucms: c.uucms ?? null,
        student_name: c.student_name ?? null,
        college_code: c.college_code ?? null,
        college_name: c.college_name ?? null,
        program_name: c.program_name ?? null,
        semester: c.semester ?? null,
        academic_year: c.academic_year ?? null,
        course_code: c.course_code ?? null,
        course_name: c.course_name ?? null,
        exam_date: c.exam_date ?? null,
        centre_code: c.centre_code ?? null,
        qp_code_expected: c.qp_code_expected ?? null,
        qp_code_scanned: c.qp_code_scanned ?? null,
        exam_time: c.exam_time ?? null,
      };
      setCandidate(details);
    } catch (e) {
      setCandidateError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setCandidateLoading(false);
    }
  }, []);

  // Step: Initial barcode scanned
  const handleStartBarcode = useCallback(async (code: string) => {
    const trimmed = code.trim();
    setStartBarcode(trimmed);
    setStep("candidate-details");
    await fetchCandidate(trimmed);
  }, [fetchCandidate]);

  // Fallback to proceed even if not yet in database
  const handleProceedAnyway = useCallback(() => {
    if (!startBarcode) return;
    setCandidate({
      answer_booklet_code: startBarcode,
      uucms: null,
      student_name: null,
      college_code: null,
      college_name: null,
      program_name: null,
      semester: null,
      academic_year: null,
      course_code: null,
      course_name: null,
      exam_date: null,
    });
    setCandidateError(null);
    setStep("scanning-pages");
  }, [startBarcode]);

  // Step: Confirm end barcode
  const handleConfirmBarcode = useCallback((code: string) => {
    const trimmed = code.trim();
    setConfirmBarcode(trimmed);
    if (trimmed === startBarcode) {
      setBarcodeMismatch(false);
      setStep("upload");
    } else {
      setBarcodeMismatch(true);
    }
  }, [startBarcode]);

  // Step: Page 37 scanned — trigger end barcode scan
  const handlePagesComplete = useCallback((pages: ScannedPage[]) => {
    setScannedPages(pages);
    setStep("scan-barcode-end");
  }, []);

  // Reset everything back to instructions
  const resetFlow = useCallback(() => {
    setStep("instructions");
    setStartBarcode(null);
    setCandidate(null);
    setCandidateLoading(false);
    setCandidateError(null);
    setScannedPages([]);
    setConfirmBarcode(null);
    setBarcodeMismatch(false);
  }, []);

  return (
    <div className="flex flex-col h-svh overflow-hidden bg-background font-sans text-foreground">
      <Navbar />

      {/* Step header pill */}
      <div className="px-4 pt-3 pb-1 flex items-center gap-2">
        {step !== "instructions" && (
          <button
            onClick={() => {
              if (step === "scan-barcode-start") setStep("instructions");
              else if (step === "candidate-details") setStep("scan-barcode-start");
              else if (step === "scanning-pages") setStep("candidate-details");
              else if (step === "scan-barcode-end") setStep("scanning-pages");
              else if (step === "upload") setStep("scan-barcode-end");
            }}
            className="flex items-center justify-center h-7 w-7 rounded-full hover:bg-muted text-muted-foreground"
          >
            <LuArrowLeft size={16} />
          </button>
        )}
        <div className="flex items-center gap-1.5">
          {(["scan-barcode-start", "candidate-details", "scanning-pages", "scan-barcode-end", "upload"] as FlowStep[]).map((s, i) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                step === "instructions" ? "w-1.5 bg-border" :
                step === s ? "w-5 bg-primary" :
                (["scan-barcode-start", "candidate-details", "scanning-pages", "scan-barcode-end", "upload"] as FlowStep[]).indexOf(step) > i
                  ? "w-1.5 bg-primary/50"
                  : "w-1.5 bg-border"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {step === "instructions" && (
          <InstructionsStep onStart={() => setStep("scan-barcode-start")} />
        )}

        {step === "scan-barcode-start" && (
          <ScanBarcodeStep
            title="Scan Answer Booklet Barcode"
            subtitle="Step 1 · Identify Candidate"
            hint="Point camera at the barcode on the answer booklet"
            onScanned={handleStartBarcode}
            onBack={() => setStep("instructions")}
          />
        )}

        {step === "candidate-details" && (
          <CandidateDetailsStep
            bookletCode={startBarcode}
            details={candidate}
            loading={candidateLoading}
            error={candidateError}
            onProceed={() => setStep("scanning-pages")}
            onProceedAnyway={handleProceedAnyway}
            onRetry={() => setStep("scan-barcode-start")}
          />
        )}

        {step === "scanning-pages" && candidate && (
          <WebcamBookletScanner
            onPagesComplete={handlePagesComplete}
            candidateCode={startBarcode ?? ""}
          />
        )}

        {step === "scan-barcode-end" && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-10 pt-5 space-y-4">
              <div className="rounded-[0.8em] border border-border bg-card px-4 py-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Step 4 · Confirm</p>
                <h2 className="mt-1 text-lg font-bold text-foreground">Scan Booklet Barcode Again</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Scan the same barcode as the start to confirm this is the same booklet.
                </p>
              </div>

              {barcodeMismatch && confirmBarcode && (
                <div className="flex items-center gap-3 rounded-[0.8em] border border-red-400/30 bg-red-500/10 px-3 py-3 text-sm text-red-500">
                  <BiSolidErrorAlt size={18} className="shrink-0" />
                  Barcode mismatch! Scanned: <strong>{confirmBarcode}</strong> — Expected: <strong>{startBarcode}</strong>
                </div>
              )}

              <BarcodeScanner
                label="Confirm Barcode"
                hint={`Expected: ${startBarcode}`}
                onScanned={handleConfirmBarcode}
              />
            </div>
          </div>
        )}

        {step === "upload" && candidate && (
          <UploadStep
            pages={scannedPages}
            candidate={candidate}
            onUploaded={resetFlow}
            onBack={() => setStep("scanning-pages")}
          />
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WebcamScannerPage() {
  return (
    <AccessGate slug="webcam-scanner">
      <WebcamScannerFlow />
    </AccessGate>
  );
}
