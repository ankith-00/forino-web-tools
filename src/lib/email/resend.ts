/**
 * Server-only Resend helper. Never import from client code — it reads a
 * secret env var. The client is created lazily so the app still boots when
 * RESEND_API_KEY is unset and the caller can surface an actionable error.
 */
import { Resend } from "resend";

let lazilyCreated: Resend | null = null;

export class EmailDeliveryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "EmailDeliveryError";
    }
}

function getResend(): Resend {
    if (!lazilyCreated) {
        const key = process.env.RESEND_API_KEY;
        if (!key) {
            throw new EmailDeliveryError(
                "Email sending needs the RESEND_API_KEY env var."
            );
        }
        lazilyCreated = new Resend(key);
    }
    return lazilyCreated;
}

/** Absolute origin of this app, used to build links inside emails. */
export function appUrl(): string {
    const url =
        process.env.NEXT_PUBLIC_APP_URL ??
        (process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : undefined) ??
        "http://localhost:3000";
    return url.replace(/\/+$/, "");
}

/** Verified Resend sender, e.g. "Forino <no-reply@yourdomain.com>". */
export function fromAddress(): string {
    const from = process.env.RESEND_FROM_EMAIL;
    if (!from) {
        throw new EmailDeliveryError(
            "Email sending needs the RESEND_FROM_EMAIL env var (a verified Resend sender)."
        );
    }
    return from;
}

export interface EmailMessage {
    to: string;
    subject: string;
    html: string;
    text: string;
}

/**
 * Sends one email and throws EmailDeliveryError on failure. Resend's own
 * API errors (invalid address, unverified domain) are wrapped so callers
 * only need to handle a single error type.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
    const { data, error } = await getResend().emails.send({
        from: fromAddress(),
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
    });

    if (error) {
        throw new EmailDeliveryError(error.message);
    }
    if (!data?.id) {
        throw new EmailDeliveryError("Resend accepted the email but returned no id.");
    }
}
