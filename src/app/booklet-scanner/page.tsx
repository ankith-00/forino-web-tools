"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import AccessGate from "@/components/AccessGate";
import BridgeCamera, { type BridgeInfo } from "@/components/BridgeCamera";
import Navbar from "@/components/Navbar";
import SpreadCamera from "@/components/SpreadCamera";
import {
  useCameraSources,
  useStreamInfo,
  type CameraSource,
  type StreamInfo,
} from "@/lib/scanjet/use-camera-sources";
import type { Detection } from "@/lib/scanjet/spread";

/**
 * /booklet-scanner — feed bring-up, deliberately bare.
 *
 * This route exists to answer one question: can a phone, tethered over USB-C,
 * drive the decoder? Everything else — page cards, the centre line, the verdict
 * banner, JPEG capture, the Supabase manifest — has been detached so the only
 * variables left are the cable, the phone's webcam mode, and the browser.
 *
 * The ZXing decode loop is deliberately still running, because a live readout of
 * the codes it finds is what proves the whole chain at once: phone camera → UVC
 * → Chrome → canvas → WebAssembly decoder → this list. A clean video preview
 * only proves the first two hops.
 *
 * The page-ordering pipeline in `@/lib/scanjet` is untouched and still covered by
 * its unit tests; it is simply not wired into this screen yet.
 */

/**
 * Picks which camera the scanner reads, and reports what it negotiated.
 *
 * A phone on a USB-C cable appears here as an ordinary camera, so it needs no
 * special casing — but the desktop will not switch to it on its own, and it is
 * only present once it has been plugged in, so the list also refreshes on
 * `devicechange`.
 *
 * The resolution readout is the important part. The page QRs are ~40 px across
 * in a 1080p view, and a 720p feed shrinks them to ~27 px, which ZXing may not
 * read at all — so a tethered camera that comes up at 1280×720 is worth knowing
 * about before anyone starts turning pages.
 */
function CameraSourcePicker({
  devices,
  deviceId,
  onChange,
  stream,
}: {
  devices: CameraSource[];
  deviceId: string | null;
  onChange: (id: string | null) => void;
  stream: StreamInfo | null;
}) {
  const full = stream ? stream.width >= 1600 : true;

  return (
    <div className="rounded-[0.8em] border border-border bg-card p-2.5">
      <label
        htmlFor="scan-camera"
        className="block text-[10px] font-bold tracking-widest text-muted-foreground"
      >
        CAMERA
      </label>

      {devices.length > 0 ? (
        <select
          id="scan-camera"
          value={deviceId ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="mt-1 w-full rounded-[0.6em] border border-border bg-background px-2 py-1.5 text-xs font-bold text-foreground"
        >
          <option value="">Default camera</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      ) : (
        <p className="mt-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
          No cameras found
        </p>
      )}

      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
        {devices.length > 1
          ? "For a phone: connect a USB-C cable, then set USB preferences → Webcam on the phone."
          : "Only one camera found. Plug a phone in and set USB preferences → Webcam to add a second."}
      </p>

      {stream ? (
        <p
          className={`mt-2 text-[11px] font-bold ${full ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
        >
          {stream.width} × {stream.height}
          {!full ? " · may not read" : ""}
        </p>
      ) : (
        <p className="mt-2 text-[11px] font-bold text-muted-foreground">No preview</p>
      )}
      {stream ? (
        <p className="truncate text-[10px] text-muted-foreground" title={stream.label}>
          {stream.label}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The other half of the bring-up: a phone pushing frames over `adb reverse`
 * instead of a camera the desktop can open. Kept beside the camera picker
 * because choosing between them is the same decision.
 */
function BridgePanel({
  active,
  onToggle,
  info,
}: {
  active: boolean;
  onToggle: () => void;
  info: BridgeInfo | null;
}) {
  return (
    <div className="rounded-[0.8em] border border-border bg-card p-2.5">
      <p className="text-[10px] font-bold tracking-widest text-muted-foreground">PHONE OVER USB</p>
      <button
        onClick={onToggle}
        className={`mt-1 w-full rounded-[0.6em] border px-2 py-1.5 text-xs font-bold ${
          active
            ? "border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "border-border text-foreground"
        }`}
      >
        {active ? "Using bridged phone" : "Use bridged phone"}
      </button>

      {active ? (
        info?.live ? (
          <>
            <p className="mt-2 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
              {info.width} × {info.height} · {info.fps} fps
            </p>
            <p className="text-[10px] text-muted-foreground">frame age {info.ageMs} ms</p>
          </>
        ) : (
          <p className="mt-2 text-[11px] font-bold text-amber-600 dark:text-amber-400">
            Waiting for frames
          </p>
        )
      ) : (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          Run <span className="font-mono">adb reverse tcp:3000 tcp:3000</span>, then open{" "}
          <span className="font-mono">/camera</span> on the phone and press Start.
        </p>
      )}
    </div>
  );
}

function BookletScannerApp() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { devices, deviceId, setDeviceId, refresh } = useCameraSources();
  const stream = useStreamInfo(videoRef);
  const cameraLive = stream !== null;

  // Bridged phone vs a camera the desktop can open. Mutually exclusive: both
  // render into the same <video>, so only one may be mounted at a time.
  const [useBridge, setUseBridge] = useState(false);
  const [bridgeInfo, setBridgeInfo] = useState<BridgeInfo | null>(null);

  // The newest codes seen in the live frame, most recent first. This is the
  // whole point of keeping the decoder on: if a phone feed can resolve the page
  // QRs, they appear here.
  const [codes, setCodes] = useState<Detection[]>([]);

  const onDetect = useCallback((d: Detection) => {
    setCodes((prev) => [d, ...prev.filter((p) => p.value !== d.value)].slice(0, 8));
  }, []);

  // Labels stay hidden until camera permission has been granted once, which only
  // happens after the preview starts — so re-enumerate as soon as a stream
  // appears, otherwise the phone is listed as a nameless "Camera 3".
  useEffect(() => {
    if (cameraLive) refresh();
  }, [cameraLive, refresh]);

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background font-sans text-foreground">
      <Navbar />

      <div className="relative flex-1 overflow-hidden bg-black">
        {useBridge ? (
          <BridgeCamera
            onDetect={onDetect}
            onInfo={setBridgeInfo}
            videoRef={videoRef}
            className="h-full w-full"
          />
        ) : (
          <SpreadCamera
            onDetect={onDetect}
            videoRef={videoRef}
            deviceId={deviceId}
            className="h-full w-full"
          />
        )}

        <div className="absolute right-3 top-3 flex w-56 flex-col gap-2">
          <BridgePanel active={useBridge} onToggle={() => setUseBridge((b) => !b)} info={bridgeInfo} />

          {useBridge ? null : (
            <CameraSourcePicker
              devices={devices}
              deviceId={deviceId}
              onChange={setDeviceId}
              stream={stream}
            />
          )}

          <div className="rounded-[0.8em] border border-border bg-card p-2.5">
            <p className="text-[10px] font-bold tracking-widest text-muted-foreground">
              CODES IN FRAME
            </p>
            {codes.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {codes.map((d) => (
                  <li key={d.value} className="flex items-center gap-2 text-xs font-bold">
                    <span className="text-emerald-500">{d.value}</span>
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {d.cx < 0.5 ? "left" : "right"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">None</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BookletScannerPage() {
  return (
    <AccessGate slug="booklet-scanner">
      <BookletScannerApp />
    </AccessGate>
  );
}
