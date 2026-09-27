/**
 * Branded invitation email. Sent by an admin from /manage-users.
 *
 * Unlike the confirmation email, this one does not confirm anything: the link
 * leads to /invite/accept, where the invitee chooses their own password. The
 * account does not exist in Supabase until they do, so an ignored invite leaves
 * no half-registered user behind.
 *
 * Layout primitives live in ./shell and are shared with the confirmation email.
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

/** Must match INVITE_TTL_DAYS in src/lib/invites.ts. */
const LINK_LIFETIME_DAYS = 7;

const EXPIRY_NOTE = `This invitation expires in ${LINK_LIFETIME_DAYS} days and can only be used once.`;

export interface InviteEmailParams {
    /** Absolute URL of /invite/accept carrying the one-time token. */
    acceptUrl: string;
    /** Name the admin typed. Falls back to "there" when blank. */
    displayName?: string | null;
    /** Name of the admin who sent the invite, for "X invited you". */
    invitedByName?: string | null;
}

export function inviteEmail({
    acceptUrl,
    displayName,
    invitedByName,
}: InviteEmailParams): { subject: string; html: string; text: string } {
    const safeName = displayName?.trim() ? escapeHtml(displayName.trim()) : null;
    const greeting = safeName ? `Hi ${safeName},` : "Hi there,";

    // Only mention the inviter if we actually know who they are, so the email
    // never reads "... invited you" with a blank name.
    const from = invitedByName?.trim() ? escapeHtml(invitedByName.trim()) : null;
    const lede = from
        ? `${from} has invited you to join ${BRAND}.`
        : `You have been invited to join ${BRAND}.`;

    const subject = `You're invited to join ${BRAND} — set your password`;

    const html = shell(`
        ${header(`${BRAND}: ${lede} choose a password to get started.`)}
        <tr>
            <td style="padding:24px 40px 0 40px;">
                <h1 style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:${INK};">
                    You've been invited to ${BRAND}
                </h1>
                <p style="margin:16px 0 0;font-size:15px;line-height:24px;color:${MUTED};">
                    ${greeting} ${lede} Pick a password and your account is ready —
                    you'll have access to every tool that's currently public.
                </p>
            </td>
        </tr>
        ${button(acceptUrl, "Accept invitation")}
        ${fallbackLink(acceptUrl, "Button not working? Paste this link into your browser:")}
        ${note(
            `If you weren't expecting this invitation, you can safely ignore this email — no account will be created.`
        )}
        ${footer(EXPIRY_NOTE)}
    `);

    const text = [
        greeting,
        "",
        `${lede} Pick a password and your account is ready — you'll have access to every tool that's currently public:`,
        acceptUrl,
        "",
        EXPIRY_NOTE,
        "",
        `If you weren't expecting this invitation, you can safely ignore this email — no account will be created.`,
    ].join("\n");

    return { subject, html, text };
}
