/**
 * Branded confirmation email for self-service registrations.
 *
 * The layout primitives live in ./shell and are shared with the invite email, so
 * the two stay visually identical.
 */

import {
    BRAND,
    INK,
    MUTED,
    button,
    escapeHtml,
    fallbackLink,
    footer,
    header,
    note,
    shell,
} from "./shell";

/** GoTrue's default OTP/confirmation-token lifetime. */
const LINK_LIFETIME_HOURS = 24;

const EXPIRY_NOTE = `This confirmation link expires in ${LINK_LIFETIME_HOURS} hours and can only be used once.`;

export interface ConfirmEmailParams {
    /** URL of /api/auth/confirm carrying the one-time token hash. */
    confirmUrl: string;
    displayName?: string | null;
}

export function confirmEmail({
    confirmUrl,
    displayName,
}: ConfirmEmailParams): { subject: string; html: string; text: string } {
    const greeting = displayName?.trim()
        ? `Hi ${escapeHtml(displayName.trim())},`
        : "Hi there,";

    const subject = `Confirm your email to activate your ${BRAND} account`;

    const html = shell(`
        ${header(`Confirm your email address to finish setting up your ${BRAND} account.`)}
        <tr>
            <td style="padding:24px 40px 0 40px;">
                <h1 style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:${INK};">
                    Confirm your email address
                </h1>
                <p style="margin:16px 0 0;font-size:15px;line-height:24px;color:${MUTED};">
                    ${greeting} you're almost there. Confirm your email address to activate your
                    ${BRAND} account and start using the tools you've been granted.
                </p>
            </td>
        </tr>
        ${button(confirmUrl, "Confirm email address")}
        ${fallbackLink(confirmUrl, "Button not working? Paste this link into your browser:")}
        ${note(`Didn't sign up for ${BRAND}? You can safely ignore this email — no account will be activated.`)}
        ${footer(EXPIRY_NOTE)}
    `);

    const text = [
        greeting,
        "",
        `Confirm your email address to activate your ${BRAND} account:`,
        confirmUrl,
        "",
        EXPIRY_NOTE,
        "",
        `Didn't sign up for ${BRAND}? You can safely ignore this email.`,
    ].join("\n");

    return { subject, html, text };
}
