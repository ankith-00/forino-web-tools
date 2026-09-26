/**
 * Turning an accepted spread into a stored page image.
 *
 * The camera decodes each frame at full sensor resolution, so a capture is taken
 * from the raw video frame rather than from the on-screen preview. Boxes coming
 * out of the decoder are in view pixels (the overlay draws them directly), so
 * they are mapped back into frame pixels here before cropping.
 *
 * Scope: this is a rectangular crop around the two page codes, NOT a
 * perspective-corrected page image. Straightening a page quad is the next
 * piece of work (see `opencv`/warp work in the ScanJet history).
 */

export type Rect = { x: number; y: number; width: number; height: number };

/** How much room to leave around the codes, as a fraction of the whole frame. */
const PAD_X = 0.22;
const PAD_Y = 0.3;
const JPEG_QUALITY = 0.85;

/**
 * The preview is `object-fit: contain`: the whole frame is shown, in the
 * orientation it arrived in, with the leftover panel width or height as black
 * bars. Nothing is cropped away, and the scale is the *smaller* of the two axis
 * ratios — which matters because the phone may well be holding the camera in
 * portrait, and a `cover` fit would then magnify a 1080-wide frame into a
 * landscape panel and show only about a third of its rows.
 *
 * (The converse holds too, and is the honest limit of this: on a panel larger
 * than the frame, `contain` still enlarges it. It is `cover`'s cropping, not
 * any upscaling, that was destroying rows the decoder needs.)
 *
 * `contain` introduces an offset that `cover` did not have, so the mapping is
 * no longer a pure scale about the centre: the drawn rectangle has to be
 * positioned as well as scaled. Both directions of the conversion live here for
 * that reason — they are inverses of one another, and the reader in
 * `use-spread-decode` and the crop below both depend on agreeing exactly.
 */
export type ContentBox = { x: number; y: number; width: number; height: number; scale: number };

/** Where the frame is actually drawn inside the preview element, under `contain`. */
export function containedBox(iw: number, ih: number, cw: number, ch: number): ContentBox {
  if (!iw || !ih || !cw || !ch) return { x: 0, y: 0, width: cw || 0, height: ch || 0, scale: 0 };
  const scale = Math.min(cw / iw, ch / ih);
  return {
    x: (cw - iw * scale) / 2,
    y: (ch - ih * scale) / 2,
    width: iw * scale,
    height: ih * scale,
    scale,
  };
}

/** Frame pixels → preview pixels, for drawing the decoder's boxes. */
export function frameToView(iw: number, ih: number, cw: number, ch: number, b: Rect): Rect {
  const box = containedBox(iw, ih, cw, ch);
  return {
    x: box.x + b.x * box.scale,
    y: box.y + b.y * box.scale,
    width: b.width * box.scale,
    height: b.height * box.scale,
  };
}

/** Preview pixels → frame pixels, for cropping the accepted spread. */
export function viewToFrame(iw: number, ih: number, cw: number, ch: number, b: Rect): Rect {
  const box = containedBox(iw, ih, cw, ch);
  if (!box.scale) return b;
  return {
    x: (b.x - box.x) / box.scale,
    y: (b.y - box.y) / box.scale,
    width: b.width / box.scale,
    height: b.height / box.scale,
  };
}

/** `viewToFrame` for a `<video>`, which is where every box the caller holds came from. */
export function videoBoxToFrame(video: HTMLVideoElement, b: Rect): Rect {
  return viewToFrame(video.videoWidth, video.videoHeight, video.clientWidth, video.clientHeight, b);
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function clamp(r: Rect, w: number, h: number): Rect {
  const x = Math.max(0, Math.min(r.x, w));
  const y = Math.max(0, Math.min(r.y, h));
  return {
    x,
    y,
    width: Math.max(1, Math.min(r.x + r.width, w) - x),
    height: Math.max(1, Math.min(r.y + r.height, h) - y),
  };
}

/**
 * The frame region covering the whole open spread: the union of the page codes,
 * grown by a margin and clipped to the frame. Falls back to the entire frame
 * when no code was decoded, so a capture is never lost to a missed read.
 */
export function spreadRegion(video: HTMLVideoElement, boxes: readonly Rect[]): Rect {
  const full: Rect = { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
  if (boxes.length === 0) return full;

  const frameBoxes = boxes.map((b) => videoBoxToFrame(video, b));
  const merged = frameBoxes.reduce(union);
  const padded: Rect = {
    x: merged.x - full.width * PAD_X,
    y: merged.y - full.height * PAD_Y,
    width: merged.width + full.width * PAD_X * 2,
    height: merged.height + full.height * PAD_Y * 2,
  };
  return clamp(padded, full.width, full.height);
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Grab the current video frame, cropped to the spread. Returns null when the
 * video has no dimensions yet (camera still starting) or the browser refuses
 * to encode — the caller treats that as "capture skipped", not an error.
 */
export async function captureSpreadJpeg(
  video: HTMLVideoElement | null,
  boxes: readonly Rect[],
): Promise<{ blob: Blob; region: Rect } | null> {
  if (!video || !video.videoWidth || !video.videoHeight) return null;

  const region = spreadRegion(video, boxes);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(region.width);
  canvas.height = Math.round(region.height);

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);

  const blob = await toBlob(canvas, JPEG_QUALITY);
  return blob ? { blob, region } : null;
}

/** Base64 without the data-URL prefix, ready for a JSON POST body. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}
