/**
 * POST /api/answer-booklet/upload
 * 
 * Accepts multipart/form-data with:
 *  - file: JSON/PDF blob of the booklet pages
 *  - meta: JSON string of candidate details
 * 
 * 1. Ensures the Supabase storage bucket `answer_booklet` exists (creates if not).
 * 2. Uploads the file to the `answer_booklet` bucket.
 * 3. Retrieves the public URL.
 * 4. Updates the matching `attendance` record with the booklet URL.
 * 5. Returns { ok: true, url }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getServiceClient } from "@/lib/admin";
import { canAccessTool, mergeToolAccess, userAccess } from "@/lib/access";
import { fetchPublicTools } from "@/lib/public-tools";

const BUCKET = process.env.ANSWER_BOOKLET_BUCKET || "answer_booklets";

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
    if (!canAccessTool(access, "booklet-scanner") && !canAccessTool(access, "webcam-scanner")) {
        return NextResponse.json({ error: "You don't have access to this tool" }, { status: 403 });
    }

    let formData: FormData;
    try {
        formData = await req.formData();
    } catch {
        return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const file = formData.get("file") as File | null;
    const metaRaw = formData.get("meta") as string | null;

    if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    let meta: Record<string, string> = {};
    if (metaRaw) {
        try {
            meta = JSON.parse(metaRaw);
        } catch {
            return NextResponse.json({ error: "Invalid meta JSON" }, { status: 400 });
        }
    }

    const admin = getServiceClient();

    // 1. Ensure bucket exists
    try {
        const { data: buckets, error: listErr } = await admin.storage.listBuckets();
        if (!listErr && buckets) {
            const exists = buckets.some((b) => b.name === BUCKET || b.id === BUCKET);
            if (!exists) {
                const { error: createErr } = await admin.storage.createBucket(BUCKET, {
                    public: true,
                    fileSizeLimit: 52428800, // 50 MB
                });
                if (createErr && !createErr.message.includes("already exists")) {
                    console.error("[answer-booklet/upload] Bucket creation error:", createErr);
                }
            }
        }
    } catch (bucketErr) {
        console.warn("[answer-booklet/upload] Bucket check warning:", bucketErr);
    }

    // 2. Build unique storage path: bookletcode/timestamp.ext
    const ext = file.name.split(".").pop() ?? "json";
    const code = (meta.answer_booklet_code || "unknown").trim();
    const timestamp = Date.now();
    const storagePath = `${code}/${timestamp}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await admin.storage
        .from(BUCKET)
        .upload(storagePath, arrayBuffer, {
            contentType: file.type || "application/json",
            upsert: true,
        });

    if (uploadError) {
        console.error("[answer-booklet/upload] Storage upload failed:", uploadError);
        return NextResponse.json(
            { error: `Storage upload failed: ${uploadError.message}. Make sure the bucket "${BUCKET}" exists in Supabase Storage.` },
            { status: 500 }
        );
    }

    // 3. Get public URL
    const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
    const bookletUrl = urlData.publicUrl;

    // 4. Update attendance table record matching answer_booklet_code
    try {
        // Try updating booklet_url on attendance row
        const { error: attendanceErr } = await admin
            .from("attendance")
            .update({ booklet_url: bookletUrl })
            .ilike("answer_booklet_code", code);

        if (attendanceErr) {
            console.warn("[answer-booklet/upload] attendance table update notice:", attendanceErr.message);
        }
    } catch (e) {
        console.warn("[answer-booklet/upload] attendance update caught:", e);
    }

    // 5. Also optionally record in answer_booklets table if it exists
    try {
        const pageCount = meta.page_count ? parseInt(meta.page_count, 10) : 0;
        await admin.from("answer_booklets").insert({
            answer_booklet_code: code,
            uucms: meta.uucms || null,
            student_name: meta.student_name || null,
            college_code: meta.college_code || null,
            college_name: meta.college_name || null,
            program_name: meta.program_name || null,
            semester: meta.semester || null,
            academic_year: meta.academic_year || null,
            course_code: meta.course_code || null,
            course_name: meta.course_name || null,
            exam_date: meta.exam_date || null,
            booklet_url: bookletUrl,
            page_count: isNaN(pageCount) ? 0 : pageCount,
            uploaded_by: user.id,
        });
    } catch {
        // Not critical if answer_booklets table is not configured
    }

    return NextResponse.json({ ok: true, url: bookletUrl }, { status: 200 });
}
