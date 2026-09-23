/**
 * GET /api/student?uucms=<id>
 * Looks up a student record in MongoDB candidate-data collection by UUCMS id.
 * Returns the student object without exposing raw MongoDB internals.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
    const uucms = req.nextUrl.searchParams.get("uucms")?.trim();

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
