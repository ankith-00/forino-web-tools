"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";

import type { Detection } from "@/lib/scanjet/spread";
import { useSpreadDecode, type FrameSurface } from "@/lib/scanjet/use-spread-decode";

/**
 * The document camera for the browser, when the frames come from a camera the
 * desktop can open — either the built-in one or a phone that is enumerating as
 * a UVC device.
 *
 * All this component does is obtain a MediaStream and hand it to the shared
 * decode loop; everything about reading QRs lives in
 * `@/lib/scanjet/use-spread-decode`. A phone whose frames arrive over HTTP
 * instead uses `BridgeCamera`, which shares that same loop.
 *
 * The video element is handed to the caller through `videoRef` so the accepted
 * spread can be captured straight from the camera frame (see `@/lib/scanjet/capture`).
 */

function describe(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow the camera for this site in your browser, then retry.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found. On a phone, check that no other app is holding the camera, then retry.";
  }
  if (name === "NotReadableError") return "The camera is in use by another app. Close it, then retry.";
  return "The camera could not be opened.";
}

export type SpreadCameraProps = {
  /** Called for every QR in every frame, with its position across the preview. */
  onDetect: (d: Detection) => void;
  /** Receives the raw <video>, used to capture accepted spreads. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /**
   * Which camera to open. `null` takes the browser's own default, which is the
   * built-in camera on a desktop. A device id opens that camera instead, which
   * is how a phone enumerating over USB-C is used: it shows up as an ordinary
   * camera, but the desktop will not fall back to it on its own.
   */
  deviceId?: string | null;
  className?: string;
};

export function SpreadCamera({ onDetect, videoRef, deviceId = null, className }: SpreadCameraProps) {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let attached: HTMLVideoElement | null = null;

    (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        if (!stopped) {
          setError(
            "This page cannot open a camera. Open it over https (or localhost) in Chrome, Edge, Safari or Firefox."
          );
        }
        return;
      }

      try {
        // A tethered camera has no facing mode, so the hint is only meaningful
        // for the local one. The size stays an `ideal` either way: a UVC device
        // negotiates its own format and will simply ignore the request.
        const video = deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { facingMode: { ideal: "environment" as const }, width: { ideal: 1920 }, height: { ideal: 1080 } };
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      } catch (e) {
        if (!stopped) setError(describe(e));
        return;
      }

      const el = videoRef.current;
      if (stopped || !el) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      setError(null);
      attached = el;
      el.srcObject = stream;
      await el.play().catch(() => {});
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      setReady(true);
    })();

    return () => {
      stopped = true;
      setReady(false);
      // Drop the dead stream so a bridged source mounting next does not inherit
      // a frozen last frame.
      if (attached) attached.srcObject = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };
  }, [attempt, videoRef, deviceId]);

  useSpreadDecode({
    surfaceRef: videoRef as RefObject<FrameSurface | null>,
    onDetect,
    enabled: ready,
    onError: setError,
  });

  return (
    <div className={`relative overflow-hidden bg-black ${className ?? ""}`}>
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        aria-label="Document camera"
        className="absolute inset-0 h-full w-full object-contain"
      />

      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
          <h2 className="text-lg font-semibold">Camera unavailable</h2>
          <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-1 rounded-[0.8em] bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      ) : null}

      {!error && !ready ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
          <span className="text-sm text-muted-foreground">Starting camera…</span>
        </div>
      ) : null}
    </div>
  );
}

export default SpreadCamera;
