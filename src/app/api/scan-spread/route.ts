/**
 * POST /api/scan-spread
 * Stores the page images captured by the booklet scanner (/booklet-scanner).
 *
 * Two modes:
 *   { sessionId, pair: {left,right}, imageBase64 }  → writes one JPEG
 *   { sessionId, complete: true, spreads: [...] }   → writes the ordered manifest
 *
 * Writes go through the service role because authenticated clients have no
 * direct storage access, so the caller is verified server-side first and must
 * hold `booklet-scanner` access — same gate as /api/attendance.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getServiceClient } from "@/lib/admin";
import { canAccessTool, mergeToolAccess, userAccess } from "@/lib/access";
import { fetchPublicTools } from "@/lib/public-tools";

const TOOL = "booklet-scanner";
/** A 1080p JPEG crop lands around 200–500 KB; allow room for a full page. */
const MAX_BASE64_CHARS = 6_000_000;
const SESSION_ID = /^[A-Za-z0-9_-]{6,64}$/;

const bucket = () => process.env.SCAN_BUCKET ?? "page-spreads";

function decodeJpeg(base64: string): Uint8Array {
    return Uint8Array.from(Buffer.from(base64, "base64"));
}

export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const publicTools = await fetchPublicTools(supabase);
    const access = mergeToolAccess(userAccess(user), publicTools);
    if (!canAccessTool(access, TOOL)) {
        return NextResponse.json({ error: "You don't have access to this tool" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!SESSION_ID.test(sessionId)) {
        return NextResponse.json({ error: "Invalid or missing sessionId" }, { status: 400 });
    }

    let storage;
    try {
        storage = getServiceClient().storage.from(bucket());
    } catch (e) {
        console.error("[api/scan-spread] storage not configured:", e);
        return NextResponse.json({ error: "Storage is not configured on this server" }, { status: 503 });
    }

    if (body.complete === true) {
        const spreads = Array.isArray(body.spreads) ? body.spreads : [];
        const path = `${sessionId}/manifest.json`;
        const { error } = await storage.upload(
            path,
            JSON.stringify(
                {
                    session_id: sessionId,
                    operator: user.id,
                    operator_email: user.email ?? null,
                    completed_at: new Date().toISOString(),
                    page_count: spreads.length,
                    spreads,
                },
                null,
                2
            ),
            { contentType: "application/json", upsert: true }
        );
        if (error) {
            console.error("[api/scan-spread] manifest upload failed:", error);
            return NextResponse.json({ error: "Failed to save the scan manifest" }, { status: 500 });
        }
        return NextResponse.json({ ok: true, path }, { status: 201 });
    }

    const pair = body.pair as { left?: unknown; right?: unknown } | undefined;
    const left = pair?.left;
    const right = pair?.right;
    if (typeof left !== "number" || typeof right !== "number") {
        return NextResponse.json({ error: "A spread needs numeric left and right pages" }, { status: 400 });
    }

    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    if (!imageBase64) {
        return NextResponse.json({ error: "Missing imageBase64" }, { status: 400 });
    }
    if (imageBase64.length > MAX_BASE64_CHARS) {
        return NextResponse.json({ error: "Image is too large" }, { status: 413 });
    }

    // A finished single page is stored as "37" rather than "37-0".
    const name = right ? `${left}-${right}.jpg` : `${left}.jpg`;
    const path = `${sessionId}/${name}`;
    const { error } = await storage.upload(path, decodeJpeg(imageBase64), {
        contentType: "image/jpeg",
        upsert: true,
    });
    if (error) {
        console.error("[api/scan-spread] upload failed:", error);
        return NextResponse.json({ error: "Failed to save the page image" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, path }, { status: 201 });
}
