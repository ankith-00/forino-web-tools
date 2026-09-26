/**
 * Grab a camera frame, find the paper in it, and straighten each page.
 *
 * This is the browser-only layer. Everything algorithmic lives in `page-detect`
 * and `page-warp`, which are pure and unit-tested; the only thing here is the
 * canvas that connects a `<video>` to them, plus preview encoding.
 *
 * The flow per capture is: draw the video to a canvas, read it back, detect page
 * quads, warp each one, and encode a thumbnail. Detection runs on a downscaled
 * copy and warping is the expensive step, so this is tens to a couple hundred
 * milliseconds — fine for one shot on a settled spread, far too slow for a
 * per-frame loop.
 */

import { detectPages, scaleQuadsToFrame, type DetectionMode } from "./page-detect.ts";
import { rasterToDataUrl, warpPage, type Raster } from "./page-warp.ts";
import type { Quad } from "./geometry.ts";

export type ScannedPage = {
  /** Stable id for React keys and dedupe. */
  id: string;
  /** QR values that were readable when this page was captured. */
  codes: string[];
  /** How the detector read the frame: a spread, two sheets, one page, or nothing. */
  mode: DetectionMode;
  /** This page's corners, normalized 0..1 against the video frame. For the overlay. */
  quad: Quad;
  width: number;
  height: number;
  /** JPEG data URL for the thumbnail strip; null if encoding is unavailable. */
  thumb: string | null;
  /** The straightened page, kept for export without re-warping. */
  raster: Raster | null;
};

/**
 * Longest edge of the *preview* warp.
 *
 * Deliberately not `PAGE_MAX_DIM`. A 3200px page is right for a saved file and
 * wrong for a scrolling strip: a session of 40 pages would hold ~1GB of RGBA
 * and hundreds of megabytes of base64 thumbnails. Re-warping from the original
 * frame at export time costs a second and needs no extra memory.
 */
const PREVIEW_MAX_DIM = 720;

let pageCounter = 0;

/**
 * Scan the current video frame into straightened pages.
 *
 * Returns null when the video has no dimensions yet (not ready, or a stream that
 * never started) — callers should treat that as "try again later", not an error.
 *
 * @param codeHints - Optional hint about which vertical half of the frame has QR codes.
 *   Lets detectPages know which regions to expect pages in, improving accuracy when
 *   edge detection would otherwise fail (e.g. one empty box, one page with a QR).
 */
export async function scanFrame(
  video: HTMLVideoElement | null,
  codes: string[],
  codeHints?: { top: boolean; bottom: boolean }
): Promise<ScannedPage[] | null> {
  if (!video) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // Mirror the preview: the feed is CSS-mirrored on a phone's front camera, so
  // the capture must be too or the saved page is a mirror image.
  ctx.drawImage(video, 0, 0, w, h);

  let frame: ImageData;
  try {
    frame = ctx.getImageData(0, 0, w, h);
  } catch {
    // A tainted canvas (cross-origin stream) cannot be read back.
    return null;
  }

  const detected = detectPages(frame.data, w, h, codeHints);
  const inPixels = scaleQuadsToFrame(detected.pages, w, h);

  // One entry per detected page: a spread yields two, so the thumbnail strip
  // shows the two pages the operator actually turned, not one "spread" tile.
  return detected.pages.map((quad, i) => {
    const raster = warpPage(frame.data, w, h, {
      quad: inPixels[i],
      srcWidth: w,
      srcHeight: h,
      maxDim: PREVIEW_MAX_DIM,
    });
    return {
      id: `p${++pageCounter}`,
      codes,
      mode: detected.mode,
      quad,
      width: raster?.width ?? 0,
      height: raster?.height ?? 0,
      thumb: raster ? rasterToDataUrl(raster, 0.72) : null,
      raster,
    };
  });
}

/**
 * Read a frame from the video and reduce it to raw RGBA, for callers that want
 * to run detection themselves.
 */
export function grabFrame(video: HTMLVideoElement | null): ImageData | null {
  if (!video) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  try {
    return ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
}
