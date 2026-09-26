import { NextResponse } from "next/server";

/**
 * The camera bridge: a one-frame relay between a tethered phone and the desktop.
 *
 * A phone cannot be reached directly by the browser on the other end of the
 * cable, and a browser cannot listen on a port, so the phone pushes and the
 * desktop pulls. This route is that meeting point — it keeps only the newest
 * frame and nothing else.
 *
 * Frames are deliberately dropped rather than queued. If the desktop is slower
 * than the phone, the useful behaviour is to skip stale frames and show the most
 * recent one, which is also what keeps latency bounded; queueing would just build
 * a backlog and make the preview drift further behind the longer it ran.
 *
 * The transport is a plain POST plus a poll rather than a WebSocket because over
 * an `adb reverse` tunnel the two are within a millisecond of each other, and a
 * POST needs no custom server, which Next.js route handlers cannot provide.
 *
 * This is a local development tool and is hard-disabled in production. It has no
 * authentication, so exposing it would let anyone on the network supply the
 * frames the decoder reads. It must not be deployed as-is.
 */

export const dynamic = "force-dynamic";

/** A poll older than this is treated as "no phone", so a stalled phone reads as absent. */
const STALE_MS = 2000;

let latest: {
  bytes: ArrayBuffer;
  type: string;
  width: number;
  height: number;
  at: number;
  seq: number;
} | null = null;

let seq = 0;

function blocked() {
  return (
    new NextResponse("The camera bridge is a local development tool and is disabled in production.", {
      status: 404,
    })
  );
}

/** The phone posts a JPEG here, once per capture interval. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return blocked();

  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) {
    return new NextResponse("Expected an image body.", { status: 415 });
  }

  const width = Number(req.headers.get("x-cam-width") ?? 0);
  const height = Number(req.headers.get("x-cam-height") ?? 0);

  // A fresh ArrayBuffer per request, so retaining it does not alias a reused pool.
  const bytes = await req.arrayBuffer();
  latest = { bytes, type, width, height, at: Date.now(), seq: ++seq };

  return new NextResponse(null, { status: 204 });
}

/** The desktop pulls the newest frame. 204 means nothing fresh has arrived. */
export async function GET() {
  if (process.env.NODE_ENV === "production") return blocked();

  if (!latest || Date.now() - latest.at > STALE_MS) {
    return new NextResponse(null, { status: 204 });
  }

  return new NextResponse(latest.bytes, {
    headers: {
      "Content-Type": latest.type,
      "Cache-Control": "no-store",
      "X-Cam-Width": String(latest.width),
      "X-Cam-Height": String(latest.height),
      "X-Cam-Age": String(Date.now() - latest.at),
      "X-Cam-Seq": String(latest.seq),
    },
  });
}
