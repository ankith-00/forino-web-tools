/**
 * POST /api/answer-booklet/upload
 * Stores the booklet PDF compiled by the Booklet Scanner and records the row that
 * the records page lists.
 *
 * The scanner already posts here (multipart `file` + JSON `meta`) and expects
 * `{ ok, url, id }` back, so this is the write half of that flow. Access is
 * verified server-side against live app_metadata plus the public-tool set before
 * anything is written, and the write itself goes through the service role —
 * `answer_booklets` has RLS on with no policies, so no client can insert into it
 * directly.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getServiceClient } from "@/lib/admin";
import { canAccessTool, mergeToolAccess, userAccess } from "@/lib/access";
import { fetchPublicTools } from "@/lib/public-tools";

// Underscored, matching the bucket that exists on the live database. An earlier
// version of this file used "answer-booklets" with a hyphen, which matches no
// bucket and would have failed every upload with a bucket-not-found error.
const BUCKET = "answer_booklets";

/** Copied from the candidate record. Booklet code is the only required one: it
 *  is the key the uploader keys on, and everything else is a copy that may be
 *  empty if the scanner's lookup returned a sparse attendance row. */
const OPTIONAL_FIELDS = [
    "uucms",
    "student_name",
    "college_code",
    "college_name",
    "program_name",
    "semester",
    "academic_year",
    "course_code",
    "course_name",
    "exam_date",
    "qp_code_scanned",
] as const;

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
    if (!canAccessTool(access, "webcam-scanner")) {
        return NextResponse.json(
            { error: "You don't have access to this tool" },
            { status: 403 }
        );
    }

    let form: FormData;
    try {
        form = await req.formData();
    } catch {
        return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    let meta: Record<string, unknown>;
    try {
        meta = JSON.parse(String(form.get("meta") ?? "{}")) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });
    }

    const code = typeof meta.answer_booklet_code === "string" ? meta.answer_booklet_code.trim() : "";
    if (!code) {
        return NextResponse.json({ error: "Answer booklet code is required" }, { status: 400 });
    }

    // Only PDF is accepted: the scanner compiles one, and allowing arbitrary
    // content types would put user-supplied bytes behind the app's own origin.
    if (file.type && file.type !== "application/pdf") {
        return NextResponse.json({ error: "Only PDF uploads are accepted" }, { status: 415 });
    }

    const admin = getServiceClient();

    // Timestamped so a re-scan never overwrites the file the previous row points
    // at. The row is replaced (see the unique constraint) but its old object is
    // left in the bucket rather than deleted here, so a failed insert cannot
    // destroy the scan it was replacing.
    const filePath = `${code}/${Date.now()}.pdf`;

    const { error: uploadError } = await admin.storage
        .from(BUCKET)
        .upload(filePath, file, { contentType: "application/pdf", upsert: false });
    if (uploadError) {
        console.error("[api/answer-booklet/upload] storage upload failed:", uploadError);
        return NextResponse.json({ error: "Failed to store the booklet" }, { status: 500 });
    }

    const record: Record<string, unknown> = { answer_booklet_code: code, file_path: filePath, uploaded_by: user.id };
    for (const field of OPTIONAL_FIELDS) {
        const value = meta[field];
        if (typeof value === "string" && value.trim() !== "") record[field] = value.trim();
    }
    const pages = Number(meta.page_count);
    if (Number.isFinite(pages) && pages > 0) record.page_count = Math.floor(pages);

    // Upsert rather than insert: the uploader retries a failed scan, and the
    // unique constraint on the booklet code means a plain insert would then
    // reject the retry with a duplicate-key error the scanner cannot act on.
    const { data, error: insertError } = await admin
        .from("answer_booklets")
        .upsert(record, { onConflict: "answer_booklet_code" })
        .select("id")
        .single();
    if (insertError) {
        console.error("[api/answer-booklet/upload] insert failed:", insertError);
        return NextResponse.json({ error: "Failed to save the booklet record" }, { status: 500 });
    }

    // A signed URL so the scanner's "View uploaded file" link works straight
    // away. It is short-lived; the records page mints its own per view.
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(filePath, 60);

    return NextResponse.json({ ok: true, url: signed?.signedUrl ?? "", id: data.id }, { status: 201 });
}
