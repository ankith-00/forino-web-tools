/**
 * Shared building blocks for transactional email templates.
 *
 * Email clients ignore <style> blocks, external CSS and Tailwind, so everything
 * here is hand-built with nested tables and inline styles. Anything cleverer
 * silently degrades in Outlook and Gmail — keep it that way.
 *
 * The five colour constants are duplicated from globals.css as hex on purpose:
 * oklch() has no reliable support in older mail clients, so the email gets an
 * equivalent flat hex instead. If the brand colour changes, update both.
 */

export const BRAND = "Forino";

/** Matches `--primary` in globals.css (oklch(0.1954 0.0168 18.6951)). */
export const INK = "#1c1917";
export const MUTED = "#78716c";
export const LINE = "#e7e5e4";
export const SURFACE = "#fafaf9";

/**
 * Escape for both element text and quoted attribute values. Every interpolation
 * below goes through this: the display name is attacker-influenced (anyone with
 * an admin invite right can put arbitrary text in it) and the URL is echoed into
 * an href, so an unescaped `"` would let the invitee break out of the attribute.
 */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** Wordmark + hidden preheader (the first line of text shown in the inbox). */
export function header(preheader: string): string {
    return `        <tr>
            <td style="padding:32px 40px 0 40px;">
                <p
                    style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;"
                >${escapeHtml(preheader)}</p>
                <p style="margin:0;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:${INK};">
                    ${BRAND}
                </p>
            </td>
        </tr>`;
}

/** Centred dark pill button. Bulleted-table markup, not a border-radius div. */
export function button(href: string, label: string): string {
    return `        <tr>
            <td align="center" style="padding:28px 40px 0 40px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
                    <tr>
                        <td align="center" bgcolor="${INK}" style="border-radius:8px;">
                            <a
                                href="${escapeHtml(href)}"
                                target="_blank"
                                style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;"
                            >${escapeHtml(label)}</a>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>`;
}

/**
 * Plain-text copy of the link, for clients that strip the button. Gmail and
 * Outlook on Windows are the usual culprits, so this is not optional.
 */
export function fallbackLink(href: string, intro: string): string {
    return `        <tr>
            <td style="padding:28px 40px 0 40px;">
                <p style="margin:0;font-size:13px;line-height:20px;color:${MUTED};">
                    ${escapeHtml(intro)}
                </p>
                <p style="margin:8px 0 0;font-size:13px;line-height:20px;word-break:break-all;">
                    <a href="${escapeHtml(href)}" target="_blank" style="color:${INK};">${escapeHtml(href)}</a>
                </p>
            </td>
        </tr>`;
}

/** Small muted aside, e.g. "you can safely ignore this email". */
export function note(body: string): string {
    return `        <tr>
            <td style="padding:28px 40px 0 40px;">
                <p style="margin:0;font-size:13px;line-height:20px;color:${MUTED};">
                    ${escapeHtml(body)}
                </p>
            </td>
        </tr>`;
}

/** Expiry line + copyright. `expiryNote` is template-specific. */
export function footer(expiryNote: string): string {
    return `        <tr>
            <td style="padding:0 40px 32px 40px;">
                <p style="margin:24px 0 0;font-size:12px;line-height:18px;color:${MUTED};">
                    ${escapeHtml(expiryNote)}
                </p>
                <p style="margin:12px 0 0;font-size:12px;line-height:18px;color:${MUTED};">
                    &copy; ${BRAND}
                </p>
            </td>
        </tr>`;
}

export function shell(rows: string): string {
    return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <title>${BRAND}</title>
    </head>
    <body style="margin:0;padding:0;background:${SURFACE};">
        <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            style="background:${SURFACE};padding:40px 16px;"
        >
            <tr>
                <td align="center">
                    <table
                        role="presentation"
                        width="100%"
                        cellpadding="0"
                        cellspacing="0"
                        style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:12px;"
                    >${rows}</table>
                </td>
            </tr>
        </table>
    </body>
</html>`;
}
