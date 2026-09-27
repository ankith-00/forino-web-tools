import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getServiceClient } from "@/lib/admin";
import { canAccessTool, mergeToolAccess, userAccess } from "@/lib/access";
import { fetchPublicTools } from "@/lib/public-tools";

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
    if (!canAccessTool(access, "webcam-scanner") && !canAccessTool(access, "scanner")) {
        return NextResponse.json({ error: "You don't have access to this tool" }, { status: 403 });
    }

    const code = req.nextUrl.searchParams.get("code")?.trim();
    if (!code) {
        return NextResponse.json({ error: "Booklet code is required" }, { status: 400 });
    }

    try {
        const admin = getServiceClient();

        // Query attendance table for answer_booklet_code
        // First try exact / ilike match
        const { data: rows, error } = await admin
            .from("attendance")
            .select("*")
            .ilike("answer_booklet_code", code)
            .limit(1);

        if (error) {
            console.error("[api/attendance/lookup] Supabase error:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        if (!rows || rows.length === 0) {
            // Also try trimmed exact match just in case
            const { data: exactRows, error: exactErr } = await admin
                .from("attendance")
                .select("*")
                .eq("answer_booklet_code", code)
                .limit(1);

            if (exactErr) {
                return NextResponse.json({ error: exactErr.message }, { status: 500 });
            }

            if (!exactRows || exactRows.length === 0) {
                return NextResponse.json({
                    found: false,
                    answer_booklet_code: code,
                    error: `No candidate found with Answer Booklet Code: "${code}" in attendance records.`
                }, { status: 404 });
            }

            return NextResponse.json({
                found: true,
                candidate: exactRows[0],
            });
        }

        return NextResponse.json({
            found: true,
            candidate: rows[0],
        });
    } catch (err) {
        console.error("[api/attendance/lookup] Server error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
