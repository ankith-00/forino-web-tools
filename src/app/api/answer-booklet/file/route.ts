/**
 * GET /api/answer-booklet/file?id=<row id>
 * Redirects to a short-lived signed URL for a scanned booklet PDF.
 *
 * The bucket is private, so this is the only way to open a scan. It takes a row
 * id rather than a storage path on purpose: the path is read from the row here,
 * so a caller cannot ask for an arbitrary object in the bucket.
 *
 * Either tool grants access — the Booklet Scanner that uploaded it, or the
 * records page that lists it — since both are legitimate reasons to open a
 * booklet and both already have a server-side check to copy.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getServiceClient } from "@/lib/admin";
import { canAccessTool, mergeToolAccess, userAccess } from "@/lib/access";
import { fetchPublicTools } from "@/lib/public-tools";

// Underscored, matching the bucket that exists on the live database.
const BUCKET = "answer_booklets";
/** Long enough to open and download, short enough that a leaked link is not a
 *  permanent link to a candidate's marked answers. */
const SIGNED_URL_TTL_SECONDS = 120;

/** Recovers the object path from a pre-migration public URL, for rows that
 *  predate `file_path`. Kept as a runtime fallback as well as doing the work in
 *  the migration, so a row is servable even if the backfill missed it. */
function pathFromLegacyUrl(url: string | null): string {
    if (!url) return "";
    const match = url.split("?")[0].match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+)$/);
    return match ? match[1] : "";
}

export async function GET(req: NextRequest) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const publicTools = await fetchPublicTools(supabase);
    const access = mergeToolAccess(userAccess(user), publicTools);
    if (!canAccessTool(access, "webcam-scanner") && !canAccessTool(access, "attendance-records")) {
        return NextResponse.json(
            { error: "You don't have access to scanned booklets" },
            { status: 403 }
        );
    }

    const id = req.nextUrl.searchParams.get("id")?.trim();
    if (!id) {
        return NextResponse.json({ error: "Booklet id is required" }, { status: 400 });
    }

    const admin = getServiceClient();
    const { data, error } = await admin
        .from("answer_booklets")
        // `booklet_url` is the legacy column: rows uploaded before this route
        // existed store a public URL rather than a path.
        .select("file_path, booklet_url")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        console.error("[api/answer-booklet/file] lookup failed:", error);
        return NextResponse.json({ error: "Failed to look up that booklet" }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json({ error: "No such booklet" }, { status: 404 });
    }

    const filePath = data.file_path || pathFromLegacyUrl(data.booklet_url);
    if (!filePath) {
        return NextResponse.json({ error: "That booklet has no file" }, { status: 404 });
    }

    const { data: signed, error: signError } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);

    if (signError || !signed) {
        console.error("[api/answer-booklet/file] signing failed:", signError);
        return NextResponse.json({ error: "Failed to open that booklet" }, { status: 500 });
    }

    // Redirect rather than returning the URL as JSON, so the link behaves like a
    // normal file link (right-click, open in new tab) instead of dumping a
    // signed URL into the page.
    return NextResponse.redirect(signed.signedUrl);
}
