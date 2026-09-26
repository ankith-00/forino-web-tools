"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import Navbar from "@/components/Navbar";
import SpreadCamera from "@/components/SpreadCamera";
import { frameToView } from "@/lib/scanjet/capture";
import { scanFrame, type ScannedPage } from "@/lib/scanjet/capture-page";
import { SEEN_WINDOW_MS, type Detection } from "@/lib/scanjet/spread";

// Re-export so consumers can import the type from here.
export type { ScannedPage };

/**
 * The scanner, reading the browser's own camera: full-width feed, center guide,
 * paper detection, and a horizontal strip of individual scanned pages.
 *
 * No phone/ADB required — `facingMode: environment` gives the back camera on
 * phones and the default camera elsewhere. The page finder runs on the *browser*
 * (Canny → hull → max-area quad → perspective warp), so it works on any device
 * with a camera and WebAssembly.
 *
 * Flow:
 *   1. Live QR boxes appear as the decoder reports them.
 *   2. When a set of codes holds steady for 700 ms, we capture the frame,
 *      run page detection, and straighten each page.
 *   3. A spread (open book) is split at its dark gutter into two separate
 *      pages — left and right each get their own thumbnail in the bottom strip.
 *   4. Dedupe is keyed on the QR code set, so turning to the next spread
 *      appends two new tiles, not duplicates.
 */

/** How often the visible code list is rebuilt from what the decoder reported. */
const PUBLISH_MS = 100;

/** How long a set of codes must hold steady before the page is scanned. */
const DWELL_MS = 100;

/** Max codes kept in the dwell buffer. */
const MAX_BUFFER = 64;

type Captured = {
  pages: ScannedPage[];
  /** The code set that triggered this capture, for the dedupe key. */
  key: string;
};

export interface WebcamBookletScannerProps {
  /** When provided, the component runs in embedded mode (no Navbar) and calls
   *  this when QR page 37 has been scanned with all accumulated pages. */
  onPagesComplete?: (pages: ScannedPage[]) => void;
  /** A label/code shown in the UI when running embedded. */
  candidateCode?: string;
}

export function WebcamBookletScanner({ onPagesComplete, candidateCode }: WebcamBookletScannerProps = {}) {
  const embedded = !!onPagesComplete;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seen = useRef<Detection[]>([]);
  const capturedKeys = useRef<Set<string>>(new Set());
  const dwell = useRef<{ key: string; since: number } | null>(null);
  const scanning = useRef(false);

  const [live, setLive] = useState<Detection[]>([]);
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [busy, setBusy] = useState(false);
  const [outline, setOutline] = useState<ScannedPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [seqActive, setSeqActive] = useState(false);
  const expectedSeqRef = useRef<number | null>(null);
  const sequenceDoneRef = useRef(false);

  const manualScan = useCallback(() => {
    if (scanning.current) return;
    scanning.current = true;
    setBusy(true);
    setError(null);

    void scanFrame(videoRef.current, [])
      .then((found) => {
        if (found && found.length > 0) {
          setOutline(found);
          const kept: Captured = { pages: found, key: `manual-${Date.now()}` };
          setPages((prev) => [...prev, ...kept.pages]);
        } else {
          setError("No page edges found");
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Page scan failed");
      })
      .finally(() => {
        scanning.current = false;
        setBusy(false);
      });
  }, []);

  // Preview box and camera frame size — kept in state so the overlay can map
  // normalized quads without reading a ref during render.
  const [preview, setPreview] = useState({ w: 0, h: 0 });
  const [frame, setFrame] = useState({ w: 0, h: 0 });

  const onDetect = useCallback((d: Detection) => {
    if (seen.current.length > MAX_BUFFER) seen.current = seen.current.slice(-MAX_BUFFER / 2);
    seen.current.push(d);
  }, []);

  // Live readout + capture trigger. One interval drives both so they never
  // disagree about what is in frame.
  useEffect(() => {
    const publish = () => {
      const now = Date.now();
      seen.current = seen.current.filter((d) => now - d.at <= SEEN_WINDOW_MS);

      const latest = new Map<string, Detection>();
      for (const d of seen.current) {
        const prev = latest.get(d.value);
        if (!prev || prev.at < d.at) latest.set(d.value, d);
      }
      const current = [...latest.values()].sort((a, b) => a.cx - b.cx);
      setLive(current);

      // Keep the frame size in sync (outside render).
      const el = videoRef.current;
      if (el && el.videoWidth && el.videoHeight) {
        setFrame((prev) =>
          prev.w === el.videoWidth && prev.h === el.videoHeight ? prev : { w: el.videoWidth, h: el.videoHeight }
        );
      }

      if (scanning.current || current.length === 0) {
        dwell.current = null;
        if (current.length === 0) setError(null);
        return;
      }

      const key = current.map((d) => d.value).sort().join("|");
      if (dwell.current?.key !== key) {
        dwell.current = { key, since: now };
        return;
      }
      if (now - dwell.current.since < DWELL_MS) return;

      const numericCodes = current.map(d => parseInt(d.value, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
      if (numericCodes.length > 0) {
        if (expectedSeqRef.current === null) {
          if (numericCodes.includes(1)) {
            expectedSeqRef.current = Math.max(...numericCodes) + 1;
            setSeqActive(true);
          }
        } else if (expectedSeqRef.current <= 37) {
          if (!numericCodes.includes(expectedSeqRef.current)) {
            setError(`Expected QR page ${expectedSeqRef.current}`);
            return;
          } else {
            expectedSeqRef.current = Math.max(...numericCodes) + 1;
            if (expectedSeqRef.current > 37) {
              setSeqActive(false);
              // Signal parent that all 37 pages have been scanned
              sequenceDoneRef.current = true;
            }
          }
        }
      }

      if (capturedKeys.current.has(key)) {
        dwell.current = null;
        setError("This page already exists");
        return;
      }

      capturedKeys.current.add(key);
      dwell.current = null;
      scanning.current = true;
      setBusy(true);
      setError(null);

      const preH = previewRef.current?.clientHeight || 0;
      const topCodes = current.filter(d => d.box && (d.box.y + d.box.height / 2) < preH / 2).map(d => d.value);
      const bottomCodes = current.filter(d => d.box && (d.box.y + d.box.height / 2) >= preH / 2).map(d => d.value);
      const codes = current.map((d) => d.value);

      // Tell the detector which halves of the frame have QR codes — this allows
      // it to find pages even when one of the two "boxes" is empty.
      const codeHints = {
        top: topCodes.length > 0,
        bottom: bottomCodes.length > 0,
      };

      void scanFrame(videoRef.current, codes, codeHints)
        .then((found) => {
          if (found && found.length > 0) {
            if (found.length >= 2) {
              found[0].codes = topCodes;
              found[1].codes = bottomCodes;
            } else if (found.length === 1) {
              // Single page: assign codes based on which half had the QR
              found[0].codes = topCodes.length > 0 ? topCodes : bottomCodes;
            }
            
            let finalFound = found;
            // Only keep the page with QR 37 to discard the other blank box
            if (codes.includes("37")) {
              finalFound = finalFound.filter(p => p.codes.includes("37"));
              if (finalFound.length === 0) finalFound = found; // safety fallback
            }
            
            setOutline(finalFound);
            const kept: Captured = { pages: finalFound, key };
            setPages((prev) => {
              const next = [...prev, ...kept.pages];
              // If sequence just completed (page 37 captured), notify parent
              if (sequenceDoneRef.current && onPagesComplete) {
                sequenceDoneRef.current = false;
                // Defer so state settles first
                setTimeout(() => onPagesComplete(next), 100);
              }
              return next;
            });
          } else {
            capturedKeys.current.delete(key);
            setError("No page edges found — try more of the paper in frame");
          }
        })
        .catch((e: unknown) => {
          capturedKeys.current.delete(key);
          setError(e instanceof Error ? e.message : "Page scan failed");
        })
        .finally(() => {
          scanning.current = false;
          setBusy(false);
        });
    };

    const timer = setInterval(publish, PUBLISH_MS);
    return () => clearInterval(timer);
  }, []);

  // ResizeObserver on the preview wrapper to track its client size.
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.round(e.contentRect.width);
        const h = Math.round(e.contentRect.height);
        if (w > 0 && h > 0) {
          setPreview((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
        }
      }
    });
    if (previewRef.current) ro.observe(previewRef.current);
    return () => ro.disconnect();
  }, []);

  /** Map a point in video-frame pixels onto the letterboxed preview. */
  const toView = (x: number, y: number) => {
    if (frame.w === 0 || frame.h === 0 || preview.w === 0 || preview.h === 0) return { x: 0, y: 0 };
    const r = frameToView(frame.w, frame.h, preview.w, preview.h, { x, y, width: 0, height: 0 });
    return { x: r.x, y: r.y };
  };

  return (
    <div className={`flex flex-col overflow-hidden bg-background font-sans text-foreground relative ${embedded ? 'h-full' : 'h-svh'}`}>
      {!embedded && <Navbar />}

      {/* Full-screen feed, flex-1 to fill remaining space. */}
      <div className="relative flex-1 w-full bg-black overflow-hidden" ref={previewRef}>
        <SpreadCamera onDetect={onDetect} videoRef={videoRef} className="w-full h-full" />

        {/* Center spine guide — helps the operator line up the booklet gutter. */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute top-1/2 left-0 right-0 h-px -translate-y-1/2 bg-white/60" />
        </div>

        {/* Live QR boxes. `box` is already in preview pixels. */}
        {live.map((d) =>
          d.box ? (
            <div
              key={`box-${d.value}`}
              className="pointer-events-none absolute rounded-[0.4em] border-2 border-emerald-400/90"
              style={{
                left: d.box.x,
                top: d.box.y,
                width: d.box.width,
                height: d.box.height,
              }}
            >
              <span className="absolute -top-6 left-0 rounded bg-emerald-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
                {d.value}
              </span>
            </div>
          ) : null
        )}

        {/* Detected page outlines — one polygon per page (a spread yields two halves). */}
        {outline?.map((p) => {
          const pts = p.quad.map((corner) => toView(corner.x, corner.y));
          return (
            <svg
              key={`outline-${p.id}`}
              className="pointer-events-none absolute inset-0 w-full h-full"
              viewBox={`0 0 ${preview.w} ${preview.h}`}
              preserveAspectRatio="none"
            >
              <polygon
                points={pts.map((q) => `${q.x},${q.y}`).join(" ")}
                fill="none"
                stroke="rgb(250 204 21)"
                strokeWidth={2}
                strokeDasharray="8 6"
              />
            </svg>
          );
        })}

        {busy ? (
          <p className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-bold text-yellow-300 backdrop-blur-sm">
            Finding page edges…
          </p>
        ) : null}

        {error ? (
          <p className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/80 px-6 py-3 text-sm font-bold text-red-300 backdrop-blur-sm shadow-xl z-20">
            {error}
          </p>
        ) : null}

        {!busy && !seqActive && (
          <button
            onClick={manualScan}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 z-0 w-16 h-16 rounded-full border-[3px] border-white flex items-center justify-center transition-transform hover:scale-105 active:scale-95 shadow-lg"
            aria-label="Manual Scan"
          >
            <div className="w-[52px] h-[52px] bg-white rounded-full shadow-sm opacity-80" />
          </button>
        )}
      </div>

      {/* Horizontal strip of scanned pages — each tile is one page.
          Now a slidable overlay on top of the camera feed. */}
      <div 
        className={`absolute bottom-0 left-0 right-0 z-10 bg-card border-t border-border transition-transform duration-300 ease-in-out ${isPanelOpen ? "translate-y-0" : "translate-y-full"}`}
      >
        {/* Toggle Handle */}
        <div 
          className="absolute -top-8 left-1/2 -translate-x-1/2 h-8 px-6 bg-card border-t border-l border-r border-border rounded-t-xl flex items-center justify-center cursor-pointer shadow-sm select-none"
          onClick={() => setIsPanelOpen(!isPanelOpen)}
        >
          <span className="text-[10px] font-bold tracking-widest text-muted-foreground">
            {isPanelOpen ? "HIDE PAGES" : `SHOW PAGES ${pages.length > 0 ? `(${pages.length})` : ""}`}
          </span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5">
          <p className="text-[10px] font-bold tracking-widest text-muted-foreground">
            PAGES {pages.length > 0 ? `· ${pages.length}` : ""}
          </p>
        </div>
        <div className="flex gap-2 overflow-x-auto px-3 pb-3">
          {pages.length === 0 ? (
            <p className="py-1 text-xs text-muted-foreground">
              Hold a page in view — the paper is found and straightened once the
              codes settle. Align the booklet spine with the center line.
            </p>
          ) : (
            pages.map((p, i) => (
              <figure
                key={p.id}
                className="flex w-24 shrink-0 flex-col gap-1 rounded-[0.6em] border border-border bg-background p-1.5"
              >
                {p.thumb ? (
                  <img
                    src={p.thumb}
                    alt={`Page ${i + 1}`}
                    className="h-32 w-full rounded-[0.4em] bg-black object-contain"
                  />
                ) : (
                  <div className="flex h-32 w-full items-center justify-center rounded-[0.4em] bg-black text-[10px] text-white/50">
                    no preview
                  </div>
                )}
                <figcaption className="truncate text-[10px] font-bold text-muted-foreground">
                  {p.codes.length > 0 ? p.codes.join(" ") : `#${i + 1}`}
                </figcaption>
              </figure>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default WebcamBookletScanner;