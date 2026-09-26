"use client";

import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";

/**
 * Choosing which camera the scanner reads.
 *
 * This is what lets a phone drive the scanner over a USB-C cable. Android's
 * "Device as webcam" (Android 14+, USB-C, OEM dependent) makes the handset
 * present itself as a plain UVC camera, so it reaches the app as one more entry
 * in `enumerateDevices()` — there is no phone-specific code anywhere in the
 * scanner, and the decode pipeline is unchanged. The one thing that has to
 * happen is that the operator *picks* the phone: Windows and Chrome keep
 * returning the desktop's own built-in camera unless a device is named
 * explicitly.
 *
 * Two details that are easy to get wrong:
 *
 *  - Labels are withheld until camera permission has been granted at least once,
 *    so the first enumeration comes back with empty strings. The list is
 *    refreshed once the preview reports a live stream.
 *  - The phone is plugged in *after* this page has loaded, so the first
 *    enumeration will not contain it. `devicechange` is the only way to notice.
 */

export type CameraSource = {
  deviceId: string;
  label: string;
};

/** What the chosen camera actually negotiated, and what the OS calls it. */
export type StreamInfo = {
  width: number;
  height: number;
  label: string;
};

async function listCameras(): Promise<CameraSource[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

export function useCameraSources() {
  const [devices, setDevices] = useState<CameraSource[]>([]);
  // null means "whatever the browser would use by itself", which is the built-in
  // camera on a desktop. A specific id means the operator chose.
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listCameras().then((cams) => {
      setDevices(cams);
      setDeviceId((current) => {
        // Keep the choice if it is still plugged in.
        if (current && cams.some((c) => c.deviceId === current)) return current;
        // A lone camera needs no choice, so select it and skip the dropdown.
        if (cams.length === 1) return cams[0].deviceId;
        return null;
      });
    });
  }, []);

  useEffect(() => {
    refresh();
    const md = navigator.mediaDevices;
    md.addEventListener("devicechange", refresh);
    return () => md.removeEventListener("devicechange", refresh);
  }, [refresh]);

  return { devices, deviceId, setDeviceId, refresh };
}

/**
 * Reads the live resolution and track name off the attached stream.
 *
 * This exists because resolution, not bandwidth, is what decides whether the
 * phone feed is usable: the page QRs are ~40 px across in a 1080p view, and
 * 720p shrinks them to ~27 px, which ZXing may not read at all. Showing the
 * negotiated size answers that question without a separate test page.
 *
 * Polled rather than driven by the decode loop, so it stays independent of the
 * scanner. State is only replaced when a value genuinely changes, so the caller
 * does not re-render on every tick.
 */
export function useStreamInfo(videoRef: RefObject<HTMLVideoElement | null>): StreamInfo | null {
  const [info, setInfo] = useState<StreamInfo | null>(null);

  useEffect(() => {
    const read = () => {
      const video = videoRef.current;
      const track = video?.srcObject instanceof MediaStream
        ? video.srcObject.getVideoTracks()[0]
        : undefined;
      if (!video || !track) {
        setInfo((prev) => (prev === null ? prev : null));
        return;
      }
      const width = video.videoWidth;
      const height = video.videoHeight;
      const label = track.label;
      setInfo((prev) =>
        prev && prev.width === width && prev.height === height && prev.label === label
          ? prev
          : { width, height, label },
      );
    };

    read();
    // The stream is attached asynchronously, so poll until one shows up.
    const timer = setInterval(read, 500);
    return () => clearInterval(timer);
  }, [videoRef]);

  return info;
}
