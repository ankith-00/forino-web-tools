"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { Detection } from "@/lib/scanjet/spread";
import { useSpreadDecode, type FrameSurface } from "@/lib/scanjet/use-spread-decode";

/**
 * The desktop half of the camera bridge: frames pushed by a phone over
 * `adb reverse`, rendered as if they were a local camera.
 *
 * Received JPEGs are drawn into a canvas that is captured as a MediaStream, and
 * that stream is attached to a plain `<video>`. Going via a real video element
 * rather than decoding the canvas directly is deliberate: `object-fit` only
 * works on a video, and the shared decode loop maps QR positions using the
 * element's on-screen box. Attaching a video therefore leaves the decoder, the
 * position mapping, and `captureSpreadJpeg` completely unchanged, and the rest
 * of the app cannot tell a bridged phone from a built-in webcam.
 *
 * The canvas is held at the frame's own pixel size and the element uses
 * `object-fit: contain`, so a frame is never resampled on its way in, and the
 * display fit crops nothing away on its way to the screen. That is what keeps a
 * portrait phone feed sharp and correctly oriented here instead of magnified and
 * cropped to a third of its rows; see `containedBox` in `@/lib/scanjet/capture`
 * for the mapping that goes with it.
 *
 * Frames are pulled, not pushed, and a duplicate frame is harmless — the decoder
 * simply re-reads what it already had. That is what bounds latency: if the
 * desktop falls behind, it skips forward instead of building a backlog.
 */

const POLL_INTERVAL_MS = 100;

export type BridgeInfo = {
  live: boolean;
  width: number;
  height: number;
  /** How long ago the relay received this frame. */
  ageMs: number;
  /** Measured arrival rate, so a stalled tunnel is visible as a number. */
  fps: number;
};

export type BridgeCameraProps = {
  onDetect: (d: Detection) => void;
  onInfo: (info: BridgeInfo) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  className?: string;
};

export function BridgeCamera({ onDetect, onInfo, videoRef, className }: BridgeCameraProps) {
  const [live, setLive] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Reported through a ref so the poll loop is not torn down on every render.
  const onInfoRef = useRef(onInfo);
  useEffect(() => {
    onInfoRef.current = onInfo;
  }, [onInfo]);

  useEffect(() => {
    const host = hostRef.current;
    const video = videoRef.current;
    if (!host || !video) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastSeq = -1;
    let frames = 0;
    let windowStart = Date.now();
    let fps = 0;

    // Kept in the DOM but out of the way: a detached canvas is a grey area for
    // captureStream, and a 1px transparent element is not.
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.width = "1px";
    canvas.style.height = "1px";
    canvas.style.opacity = "0";
    canvas.style.pointerEvents = "none";
    host.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    video.srcObject = stream;
    void video.play().catch(() => {});

    const idle = () => {
      if (stopped) return;
      setLive(false);
      onInfoRef.current({ live: false, width: 0, height: 0, ageMs: Number.POSITIVE_INFINITY, fps: 0 });
    };

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/camera-frame", { cache: "no-store" });
        if (res.status === 204) {
          idle();
        } else if (res.ok) {
          const seq = Number(res.headers.get("X-Cam-Seq") ?? 0);
          const ageMs = Number(res.headers.get("X-Cam-Age") ?? 0);
          const width = Number(res.headers.get("X-Cam-Width") ?? 0);
          const height = Number(res.headers.get("X-Cam-Height") ?? 0);
          const bitmap = await createImageBitmap(await res.blob());

          if (!stopped && ctx) {
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
            }
            ctx.drawImage(bitmap, 0, 0);
            // The stream was captured at 0 fps, so nothing moves until asked.
            track?.requestFrame();
            bitmap.close();

            if (seq !== lastSeq) {
              lastSeq = seq;
              frames += 1;
              const now = Date.now();
              if (now - windowStart >= 1000) {
                fps = Math.round((frames * 1000) / (now - windowStart));
                frames = 0;
                windowStart = now;
              }
            }
            setLive(true);
            onInfoRef.current({ live: true, width, height, ageMs, fps });
          } else {
            bitmap.close();
          }
        }
      } catch {
        // A failed poll just means nothing arrived this tick.
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      video.srcObject = null;
      track?.stop();
      canvas.remove();
    };
  }, [videoRef]);

  useSpreadDecode({
    surfaceRef: videoRef as RefObject<FrameSurface | null>,
    onDetect,
    enabled: live,
  });

  return (
    <div ref={hostRef} className={`relative overflow-hidden bg-black ${className ?? ""}`}>
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        aria-label="Document camera (phone over USB)"
        className="absolute inset-0 h-full w-full object-contain"
      />
      {!live ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90 p-6 text-center">
          <span className="text-sm font-semibold">Waiting for the phone…</span>
          <p className="max-w-xs text-xs text-muted-foreground">
            Run <span className="font-mono">adb reverse tcp:3000 tcp:3000</span>, open{" "}
            <span className="font-mono">/camera</span> on the phone, and press Start.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default BridgeCamera;
