"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * /camera — the phone half of the camera bridge.
 *
 * A dumb viewfinder and nothing else: it opens the rear camera at full size,
 * encodes a JPEG every `CAPTURE_INTERVAL_MS`, and posts it to `/api/camera-frame`.
 * The desktop pulls from there. There is no scanning, no UI, and no state to
 * keep in sync, because the phone is only ever a lens.
 *
 * This runs on the phone's own browser, reached over an `adb reverse` tunnel:
 *
 *     adb reverse tcp:3000 tcp:3000
 *
 * then open http://localhost:3000/camera on the phone. Because that origin is
 * `localhost`, it counts as a secure context, so the camera works with no HTTPS
 * certificate — which is the main reason this route exists rather than streaming
 * a phone web page over Wi-Fi.
 *
 * The phone is not gated behind `AccessGate`, because it is a separate device
 * with no session and there is nothing on it worth protecting. Keep it that way
 * only while the bridge route is development-only.
 */

/** Must match DECODE_INTERVAL_MS on the receiving end, or frames are wasted. */
const CAPTURE_INTERVAL_MS = 120;
/**
 * 0.85 keeps the page QRs crisp. Their edges are the only high-frequency detail
 * in frame, so this is worth raising before lowering the resolution.
 */
const JPEG_QUALITY = 0.85;
/**
 * How long a single upload may take before it is abandoned.
 *
 * The send loop awaits each POST so that it cannot outrun the tunnel, which
 * makes the request the only thing pacing it — and also the only thing that can
 * stop it. One request that never settles takes the whole bridge down with it,
 * silently: the camera stays open, the preview stays live, and no further frame
 * is ever attempted. Racing every upload against a deadline keeps a stalled
 * tunnel a visible, recoverable condition instead of a permanent one.
 */
const UPLOAD_TIMEOUT_MS = 5000;
/**
 * How long to wait for the track to report its real dimensions.
 *
 * `videoWidth` stays 0 until the first frame's metadata lands, which on Android
 * can be noticeably later than `play()` resolving. Every send is guarded on a
 * non-zero size, so a track that never reports one yields a black rectangle
 * that is indistinguishable from a working camera. Giving up loudly here is what
 * turns "the feed is black" into an answer.
 */
const METADATA_TIMEOUT_MS = 8000;

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Resolve once the video element knows its intrinsic size, or false if that
 * never happens. `readyState` is checked first so an already-loaded element
 * resolves without waiting for an event that will not fire again.
 */
function waitForMetadata(video: HTMLVideoElement, timeoutMs: number): Promise<boolean> {
  const hasSize = () => video.videoWidth > 0 && video.videoHeight > 0;
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve(hasSize());

  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      video.removeEventListener("loadedmetadata", onMetadata);
      clearTimeout(timer);
      resolve(ok);
    };
    const onMetadata = () => finish(hasSize());
    const timer = setTimeout(() => finish(false), timeoutMs);
    video.addEventListener("loadedmetadata", onMetadata);
  });
}

/**
 * The size a frame is transmitted at, once the turn is applied.
 *
 * A quarter turn swaps the axes, so a 1080x1920 camera frame leaves here as
 * 1920x1080. The desktop needs this to be right: its preview is letterboxed to
 * the frame's own orientation, and the crop it takes for the stored page image
 * is measured against these numbers, not against the sensor's.
 */
function turned(turn: number, srcW: number, srcH: number) {
  const swap = turn === 90 || turn === 270;
  return { width: swap ? srcH : srcW, height: swap ? srcW : srcH };
}

/** POST one frame, giving up on it rather than stalling the loop forever. */async function postFrame(blob: Blob, w: number, h: number, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("/api/camera-frame", {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Cam-Width": String(w),
        "X-Cam-Height": String(h),
      },
      body: blob,
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Relay returned ${res.status}`);
    }
  } catch (e) {
    // The raw rejection for a deadline is a bare "aborted", which says nothing
    // about the part an operator can act on. Name the deadline instead.
    if ((e as { name?: string })?.name === "AbortError") {
      throw new Error(`The tunnel carried no frame for ${Math.round(timeoutMs / 1000)}s — giving up on that one.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn the display landscape, so the camera hands back a landscape frame.
 *
 * The `ideal: 1920x1080` below is only a hint, and Android's rear camera
 * resolves a video track against the device's *current* orientation. Held
 * upright, the A16 answers 1080x1920 however the constraint is worded, and the
 * desktop then shows a 9:16 frame in a landscape panel: `object-fit: cover`
 * magnifies it about 1.4x and keeps only ~30% of the rows, which reads as a
 * zoomed, soft preview.
 *
 * Rotating the phone by hand also works, but it cannot be relied on to stay put
 * once the phone is on a stand, so the page asks for it instead. `lock()` is
 * only honoured in fullscreen, hence the request first, and both steps are
 * best-effort — a browser may refuse either one.
 */
/**
 * `ScreenOrientation.lock()` is real and widely supported, but TypeScript's
 * `lib.dom.d.ts` declares only `unlock()` on that interface, so the one call we
 * need is described locally rather than by loosening the whole project.
 */
type LockableOrientation = ScreenOrientation & {
  lock(orientation: string): Promise<void>;
};

async function lockLandscape(): Promise<boolean> {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    }
    await (screen.orientation as LockableOrientation).lock("landscape");
    return screen.orientation.type.startsWith("landscape");
  } catch {
    return false;
  }
}

type Status = {
  sent: number;
  /** The frame as it goes out, after the turn — this is what the desktop sees. */
  width: number;
  height: number;
  /** The camera's own frame size, kept so the turn can be reported honestly. */
  srcWidth: number;
  srcHeight: number;
  error: string | null;
};

/**
 * The turn applied to a frame of the given camera size.
 *
 * `null` means "work it out": a portrait camera frame is quarter-turned so it
 * leaves as landscape, and a camera frame that is *already* landscape is left
 * alone. That second half matters — if the page's orientation lock does succeed
 * on some device, the camera hands back 1920x1080, and a hardcoded 90° would
 * turn a correct frame back into the tall one this exists to avoid.
 */
function effectiveTurn(override: number | null, srcW: number, srcH: number): number {
  if (override !== null) return override;
  return srcH > srcW ? 90 : 0;
}

export default function CameraBridgePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status>({
    sent: 0,
    width: 0,
    height: 0,
    srcWidth: 0,
    srcHeight: 0,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const [locked, setLocked] = useState<boolean | null>(null);
  // `null` lets the page turn the frame the right way up on its own; the button
  // overrides it, because which way is "up" depends on how the handset is
  // standing and only the operator can say.
  const [turnOverride, setTurnOverride] = useState<number | null>(null);
  // Held in a ref so that turning does not tear the camera down and reopen it:
  // the send loop reads the ref, and only the status line re-renders.
  const turnRef = useRef(turnOverride);
  useEffect(() => {
    turnRef.current = turnOverride;
  }, [turnOverride]);

  useEffect(() => {
    if (!running) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wakeLock: WakeLockSentinel | null = null;
    let sent = 0;

    (async () => {
      // Ask for landscape before the camera opens: the track is negotiated
      // against the device orientation, so this has to happen first to take
      // effect. The status is reported either way, because a refused lock means
      // the operator has to turn the phone themselves.
      setLocked(await lockLandscape());

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setStatus((s) => ({
          ...s,
          error:
            name === "NotAllowedError"
              ? "Camera permission was denied."
              : "The camera could not be opened.",
        }));
        return;
      }

      const video = videoRef.current;
      if (stopped || !video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;

      // Both of these can fail independently, and neither is visible in the
      // rendered result: a refused `play()` and a track stuck at 0x0 both leave
      // a black rectangle in the same box a working preview would occupy. So
      // neither is swallowed — each is checked, and each reports itself.
      const played = await video.play().then(
        () => true,
        () => false
      );
      const hasSize = await waitForMetadata(video, METADATA_TIMEOUT_MS);

      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      if (!hasSize) {
        setStatus((s) => ({
          ...s,
          error: "The camera opened but never delivered a frame (still 0×0).",
        }));
        return;
      }
      if (!played) {
        setStatus((s) => ({
          ...s,
          error: "The browser would not play the preview, so every frame would be black.",
        }));
        return;
      }

      // A phone that dims its screen suspends the camera, which looks exactly
      // like the cable being unplugged. Ask to stay awake for as long as we run.
      try {
        wakeLock = await navigator.wakeLock?.request("screen");
      } catch {
        // Not fatal — the stream may simply stop if the screen locks.
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setStatus((s) => ({ ...s, error: "This browser cannot read pixels from a canvas." }));
        return;
      }

      const src = { srcWidth: video.videoWidth, srcHeight: video.videoHeight };
      setStatus({
        sent: 0,
        ...turned(effectiveTurn(turnRef.current, src.srcWidth, src.srcHeight), src.srcWidth, src.srcHeight),
        ...src,
        error: null,
      });

      const send = async () => {
        if (stopped) return;
        try {
          const srcW = video.videoWidth;
          const srcH = video.videoHeight;
          if (srcW > 0 && srcH > 0) {
            // Rotating the pixels is the reliable way to land a landscape frame.
            // The alternative — asking the page to turn landscape and letting the
            // camera re-negotiate against the screen — depends on a fullscreen
            // request and an orientation lock that a browser may simply refuse,
            // and on a device with auto-rotate off, turning the handset changes
            // nothing at all. Here the frame is turned on its way out, so the
            // desktop's orientation no longer depends on the phone's posture.
            const deg = effectiveTurn(turnRef.current, srcW, srcH);
            const out = turned(deg, srcW, srcH);
            if (canvas.width !== out.width || canvas.height !== out.height) {
              canvas.width = out.width;
              canvas.height = out.height;
            }
            // About the output centre, so a quarter turn has room to happen, and
            // the source keeps its own size — after the rotation its axes already
            // line up with the canvas.
            ctx.save();
            ctx.translate(out.width / 2, out.height / 2);
            ctx.rotate((deg * Math.PI) / 180);
            ctx.drawImage(video, -srcW / 2, -srcH / 2, srcW, srcH);
            ctx.restore();
            const blob = await toBlob(canvas, JPEG_QUALITY);
            if (blob) {
              // Awaiting the POST is deliberate: it caps the send rate at
              // whatever the tunnel can actually carry, instead of queueing
              // frames until the tab falls over. The deadline is what keeps one
              // stalled request from ending the loop for good.
              await postFrame(blob, out.width, out.height, UPLOAD_TIMEOUT_MS);
              sent += 1;
              setStatus({
                sent,
                width: out.width,
                height: out.height,
                srcWidth: srcW,
                srcHeight: srcH,
                error: null,
              });
            }
          }
        } catch (e) {
          if (!stopped) {
            setStatus((s) => ({
              ...s,
              error: e instanceof Error ? e.message : "Could not send a frame.",
            }));
          }
        }
        timer = setTimeout(send, CAPTURE_INTERVAL_MS);
      };
      send();
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      void wakeLock?.release().catch(() => {});
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };
  }, [running, attempt]);

  const toggle = useCallback(() => setRunning((r) => !r), []);

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-black font-sans text-white">
      <div className="relative flex-1">
        <video ref={videoRef} muted playsInline autoPlay aria-label="Phone camera" className="h-full w-full object-cover" />

        <div className="absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 bg-black/70 p-3 text-xs">
          <span className="rounded bg-white/15 px-2 py-1 font-bold">
            {running ? "SENDING" : "STOPPED"}
          </span>
          {status.width > 0 ? (
            <span className="font-bold">
              {status.width} × {status.height}
            </span>
          ) : running ? (
            <span className="font-bold text-amber-400">no frames yet</span>
          ) : null}
          <span className="text-white/70">{status.sent} frames sent</span>
          <button
            onClick={() => setTurnOverride((t) => (t === null ? 0 : t >= 270 ? null : t + 90))}
            className="rounded bg-white/25 px-2 py-1.5 font-bold"
            aria-label="Rotate the frame sent to the desktop"
          >
            Turn {effectiveTurn(turnOverride, status.srcWidth, status.srcHeight)}&deg;
            {turnOverride === null ? " (auto)" : ""}
          </button>
          <button
            onClick={toggle}
            className="ml-auto rounded bg-white px-3 py-1.5 font-bold text-black"
          >
            {running ? "Stop" : "Start"}
          </button>
        </div>
      </div>

      <div className="space-y-2 border-t border-white/15 p-4 text-xs">
        {status.error ? <p className="font-bold text-red-400">{status.error}</p> : null}
        {status.width > 0 ? (
          <p className="text-white/70">
            Sending <span className="font-bold text-white">{status.width} &times; {status.height}</span>{" "}
            from a {status.srcWidth} &times; {status.srcHeight} camera.{" "}
            {effectiveTurn(turnOverride, status.srcWidth, status.srcHeight) % 180 === 0 ? (
              <>The frame is quarter-turned on its way out, so this screen&apos;s orientation does not
                matter — turn the handset whichever way frames the spread.</>
            ) : (
              <>The camera is already handing over a landscape frame, so nothing is turned.</>
            )}
          </p>
        ) : null}
        {status.width > 0 && status.height > status.width ? (
          <p className="font-bold text-amber-400">
            Still a tall frame ({status.width} × {status.height}). The desktop letterboxes a
            portrait feed, which leaves the page codes small — tap Turn to set 90&deg;.
          </p>
        ) : null}
        {running && locked === false ? (
          <p className="text-white/70">
            The browser would not lock this screen landscape. It does not matter — the frame is
            turned on its way to the desktop.
          </p>
        ) : null}
<p className="text-white/70">
            Keep this page open and the screen awake. On the desktop, open{" "}
            <span className="font-bold text-white">/tools/booklet-scanner</span> and choose{" "}
            <span className="font-bold text-white">Phone over USB</span>.
          </p>
        {!running ? (
          <button
            onClick={() => {
              setStatus((s) => ({ ...s, error: null }));
              setRunning(true);
            }}
            className="w-full rounded bg-white py-2.5 text-sm font-bold text-black"
          >
            Start sending
          </button>
        ) : null}
        {status.error ? (
          <button
            onClick={() => {
              setStatus((s) => ({ ...s, error: null }));
              setAttempt((a) => a + 1);
            }}
            className="w-full rounded border border-white/40 py-2.5 font-bold"
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
