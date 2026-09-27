/**
 * GET /api/auth/confirm?token_hash=<hashed_token>&type=signup
 *
 * Redemption target for the link in our Resend confirmation email. Verifying
 * the one-time token through the cookie-aware server client signs the user in
 * immediately, so they land on the dashboard already authenticated.
 *
 * This must be a route handler rather than a page: confirming writes the
 * Supabase session cookie, and only route handlers and server actions can set
 * cookies. A server action needs a form POST, which an emailed GET link cannot
 * produce.
 */
import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";

/** Anything else in the query string is rejected rather than forwarded. */
const ALLOWED_TYPES = new Set<EmailOtpType>([
    "signup",
    "invite",
    "magiclink",
    "recovery",
    "email_change",
    "email",
]);

export async function GET(request: NextRequest) {
    const origin = request.nextUrl.origin;
    const toLogin = (reason: string) =>
        NextResponse.redirect(new URL(`/login?confirm=${reason}`, origin));

    const tokenHash = request.nextUrl.searchParams.get("token_hash")?.trim();
    if (!tokenHash) {
        return toLogin("invalid");
    }

    const requestedType = request.nextUrl.searchParams.get("type")?.trim() as EmailOtpType | null;
    const type: EmailOtpType =
        requestedType && ALLOWED_TYPES.has(requestedType) ? requestedType : "signup";

    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

    if (error) {
        // Expired, already used, or tampered with. The reason is deliberately
        // coarse — the detail is in the server log, not the query string.
        console.error("[auth/confirm] verifyOtp failed:", error);
        return toLogin("failed");
    }

    return NextResponse.redirect(new URL("/dashboard", origin));
}
