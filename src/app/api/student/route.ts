/**
 * GET /api/student?uucms=<id>
 * Looks up a student record in MongoDB candidate-data collection by UUCMS id.
 * Returns the student object without exposing raw MongoDB internals.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { createClient } from "@/utils/supabase/server";
import { canAccessTool, mergeToolAccess, userAccess } from "@/lib/access";
import { fetchPublicTools } from "@/lib/public-tools";

const LOOKUP_WINDOW_MS = 60_000;
const LOOKUP_LIMIT = 30;
const lookupLog = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
    const now = Date.now();
    const cutoff = now - LOOKUP_WINDOW_MS;
    const times = (lookupLog.get(userId) ?? []).filter((t) => t > cutoff);
    if (times.length >= LOOKUP_LIMIT) {
        lookupLog.set(userId, times);
        return true;
    }
    times.push(now);
    lookupLog.set(userId, times);
    if (lookupLog.size > 5000) lookupLog.clear();
    return false;
}

export async function GET(req: NextRequest) {
    const uucms = req.nextUrl.searchParams.get("uucms")?.trim();

    // Server-side gate: only users granted the scanner tool (or admins, or a public scanner) may look up students.
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

    if (isRateLimited(user.id)) {
        return NextResponse.json(
            { error: "Too many lookups. Please try again in a minute." },
            { status: 429 }
        );
    }

    if (!uucms) {
        return NextResponse.json({ error: "uucms query param is required" }, { status: 400 });
    }

    try {
        const db = await getDb();
        const doc = await db.collection("candidate-data").findOne(
            { "student.uucms": uucms },
            { projection: { _id: 0, student: 1 } }
        );

        if (!doc) {
            return NextResponse.json({ error: "Student not found" }, { status: 404 });
        }

        return NextResponse.json({ student: doc.student });
    } catch (err) {
        console.error("[api/student] MongoDB error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
