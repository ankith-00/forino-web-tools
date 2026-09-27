/**
 * POST /api/auth/register
 *
 * Creates an unconfirmed user and emails our own branded confirmation link
 * via Resend. The client never calls supabase.auth.signUp, because GoTrue
 * would send its own template and we would lose control of the design.
 *
 * `admin.createUser` does not send mail, and `admin.generateLink` only mints
 * a token, so exactly one email goes out per request.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/admin";
import { appUrl, EmailDeliveryError, sendEmail } from "@/lib/email/resend";
import { confirmEmail } from "@/lib/email/templates/confirm-email";

/** Keeps this endpoint from being used to spam arbitrary inboxes. */
const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 5;
const attemptLog = new Map<string, number[]>();

function clientKey(req: NextRequest): string {
    const forwarded = req.headers.get("x-forwarded-for");
    return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function isRateLimited(key: string): boolean {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const times = (attemptLog.get(key) ?? []).filter((t) => t > cutoff);
    if (times.length >= LIMIT) {
        attemptLog.set(key, times);
        return true;
    }
    times.push(now);
    attemptLog.set(key, times);
    if (attemptLog.size > 5000) attemptLog.clear();
    return false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Mirrors the rules enforced in the register form, server-side. */
const SPECIAL_CHAR_RE = /[!@#$%^&*(),.?":{}|<>]/;

function validate(password: string): string | null {
    if (password.length < 6) return "Password must be at least 6 characters.";
    if (!/\d/.test(password)) return "Password must contain a number.";
    if (!SPECIAL_CHAR_RE.test(password)) {
        return "Password must contain a special character.";
    }
    return null;
}

export async function POST(req: NextRequest) {
    let body: { email?: unknown; password?: unknown; displayName?: unknown };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";

    if (!email || !EMAIL_RE.test(email)) {
        return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    const passwordError = validate(password);
    if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // Checked here rather than at the top: only a request that will actually
    // create a user and send an email costs anything, so a typo in the form
    // must not burn a slot and lock the person out for an hour.
    if (isRateLimited(clientKey(req))) {
        return NextResponse.json(
            { error: "Too many accounts created from this device. Please try again later." },
            { status: 429 }
        );
    }

    const supabase = getServiceClient();

    // createUser with email_confirm:false is what keeps GoTrue from sending its
    // own confirmation email on top of ours.
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: { display_name: displayName || null },
    });

    if (createError || !created.user) {
        const message = createError?.message ?? "Could not create the account.";
        if (/already|registered|exists/i.test(message)) {
            return NextResponse.json(
                { error: "An account with this email already exists. Try signing in instead." },
                { status: 409 }
            );
        }
        // Provider detail goes to the log, not the response.
        console.error("[api/auth/register] createUser failed:", createError);
        return NextResponse.json(
            { error: "We could not create your account. Please try again." },
            { status: 400 }
        );
    }

    try {
        // `password` is required by the signup link type even though the user
        // already exists; GoTrue accepts it and re-asserts the same password.
        const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
            type: "signup",
            email,
            password,
            options: { redirectTo: `${appUrl()}/api/auth/confirm` },
        });
        if (linkError || !link.properties.hashed_token) {
            throw new EmailDeliveryError(
                linkError?.message ?? "Supabase did not return a confirmation token."
            );
        }

        // The one-time token goes to our own endpoint, not Supabase's verify
        // endpoint, so we control where the session lands.
        const confirmUrl = `${appUrl()}/api/auth/confirm?token_hash=${
            link.properties.hashed_token
        }&type=signup`;

        const message = confirmEmail({ confirmUrl, displayName });
        await sendEmail({ to: email, ...message });
    } catch (err) {
        // Roll the half-registered user back, otherwise a retry would be
        // rejected as "already registered" with no way to resend the link.
        await supabase.auth.admin
            .deleteUser(created.user.id)
            .catch((cleanupErr: unknown) =>
                console.error("[api/auth/register] rollback failed:", cleanupErr)
            );

        const message =
            err instanceof EmailDeliveryError
                ? err.message
                : "We could not send the confirmation email. Please try again.";
        // The reason (unverified domain, bad API key, suppressed address) is
        // actionable for us but means nothing to the person registering.
        console.error("[api/auth/register] confirmation email failed:", message, err);
        return NextResponse.json(
            {
                error:
                    "We could not send your confirmation email. Please try again in a few minutes.",
            },
            { status: 502 }
        );
    }

    return NextResponse.json({
        ok: true,
        message: "Registration successful! Please check your email to confirm your account.",
    });
}
