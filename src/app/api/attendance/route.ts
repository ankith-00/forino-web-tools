/**
 * POST /api/attendance
 * Records an attendance row ONLY for users verified (server-side, live metadata)
 * to have scanner access (granted, admin, or a public scanner).
 * Writes via the service role — authenticated clients have no direct table access.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getServiceClient } from "@/lib/admin";
import { canAccessTool, mergeToolAccess, userAccess } from "@/lib/access";
import { fetchPublicTools } from "@/lib/public-tools";

const REQUIRED_FIELDS = [
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
    "exam_time",
    "qp_code_expected",
    "centre_code",
    "qp_code_scanned",
    "answer_booklet_code",
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
    if (!canAccessTool(access, "scanner")) {
        return NextResponse.json({ error: "You don't have access to this tool" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const missing = REQUIRED_FIELDS.filter((f) => {
        const v = body[f];
        return typeof v !== "string" || v.trim() === "";
    });
    if (missing.length > 0) {
        return NextResponse.json(
            { error: `Missing fields: ${missing.join(", ")}` },
            { status: 400 }
        );
    }

    const record = Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, (body[f] as string).trim()]));

    const { error } = await getServiceClient().from("attendance").insert({
        ...record,
        marked_by: user.id,
    });
    if (error) {
        if (error.code === "23505") {
            return NextResponse.json(
                { error: "Attendance already marked for this student and subject." },
                { status: 409 }
            );
        }
        console.error("[api/attendance] insert failed:", error);
        return NextResponse.json({ error: "Failed to save attendance" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
}