/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";

import {
    AUTHOR_URL,
    DEFAULT_SITE_TITLE,
    brandingEqual,
    normaliseBranding,
    resolveSiteTitle,
    userBranding,
    usesDefaultFooter,
} from "../site-branding.ts";

test("the default title is 'UTIL HUB', pinned so a rename cannot ship unnoticed", () => {
    // Deliberately literal rather than compared against the constant, so changing
    // DEFAULT_SITE_TITLE has to be a conscious edit here too.
    assert.equal(DEFAULT_SITE_TITLE, "UTIL HUB");
});

test("a user with no metadata at all gets the platform defaults", () => {
    const branding = userBranding(null);
    assert.equal(branding.siteTitle, null);
    assert.equal(branding.footerNote, null);
    assert.equal(resolveSiteTitle(branding), DEFAULT_SITE_TITLE);
    assert.equal(usesDefaultFooter(branding), true);
});

test("an absent app_metadata is treated as unconfigured, not as an error", () => {
    assert.deepEqual(userBranding({}), { siteTitle: null, footerNote: null });
    assert.deepEqual(userBranding({ app_metadata: {} }), { siteTitle: null, footerNote: null });
});

test("configured values are read from app_metadata", () => {
    const branding = userBranding({
        app_metadata: { site_title: "Exam Cell", footer_note: "Session 2026" },
    });
    assert.equal(branding.siteTitle, "Exam Cell");
    assert.equal(branding.footerNote, "Session 2026");
    assert.equal(resolveSiteTitle(branding), "Exam Cell");
    assert.equal(usesDefaultFooter(branding), false);
});

test("a blank stored value falls back rather than blanking the header", () => {
    // Guards a row hand-edited in the Supabase dashboard. Storing "" must not
    // render a nameless header or a footer with no credit line.
    const branding = userBranding({ app_metadata: { site_title: "", footer_note: "   " } });
    assert.equal(resolveSiteTitle(branding), DEFAULT_SITE_TITLE);
    assert.equal(usesDefaultFooter(branding), true);
});

test("a non-string value cannot get through", () => {
    const branding = userBranding({
        app_metadata: { site_title: 42, footer_note: { nested: true } },
    } as unknown as { app_metadata: unknown });
    assert.equal(branding.siteTitle, null);
    assert.equal(branding.footerNote, null);
});

test("surrounding whitespace is trimmed", () => {
    const branding = userBranding({
        app_metadata: { site_title: "  Exam Cell  ", footer_note: "\tSession 2026\n" },
    });
    assert.equal(branding.siteTitle, "Exam Cell");
    assert.equal(branding.footerNote, "Session 2026");
});

test("role and tool access sitting alongside the brand are ignored, not disturbed", () => {
    const branding = userBranding({
        app_metadata: {
            role: "user",
            tool_access: ["barcode"],
            blocked_tools: ["scanner"],
            site_title: "Exam Cell",
        },
    });
    assert.equal(branding.siteTitle, "Exam Cell");
    assert.equal(branding.footerNote, null);
});

test("blank admin input means revert to default, not blank output", () => {
    // The key behaviour: clearing a field is how an admin undoes a custom brand,
    // so it has to come back as `null` rather than as an empty string.
    const branding = normaliseBranding({ siteTitle: "", footerNote: "  " });
    assert.equal(branding.siteTitle, null);
    assert.equal(branding.footerNote, null);
    assert.equal(resolveSiteTitle(branding), DEFAULT_SITE_TITLE);
    assert.equal(usesDefaultFooter(branding), true);
});

test("admin input is trimmed and capped to the input maxLength", () => {
    const branding = normaliseBranding({
        siteTitle: "T".repeat(200),
        footerNote: "F".repeat(400),
    });
    assert.equal(branding.siteTitle?.length, 80);
    assert.equal(branding.footerNote?.length, 160);
});

test("a custom footer drops the author link, a default one keeps it", () => {
    // The author credit is deliberately not mixed into admin-authored text.
    assert.equal(usesDefaultFooter(userBranding({ app_metadata: { footer_note: "Exam Cell" } })), false);
    assert.equal(AUTHOR_URL, "https://www.ankith.dev");
});

test("normalise then read is a fixed point, so a save cannot drift", () => {
    const once = normaliseBranding({ siteTitle: "  Exam Cell  ", footerNote: " Session 2026 " });
    const twice = normaliseBranding({ siteTitle: once.siteTitle ?? "", footerNote: once.footerNote ?? "" });
    assert.deepEqual(twice, once);
});

test("equality compares both fields", () => {
    const base = { siteTitle: "Exam Cell", footerNote: "Session 2026" };
    assert.equal(brandingEqual(base, { ...base }), true);
    assert.equal(brandingEqual(base, { ...base, siteTitle: "Other" }), false);
    assert.equal(brandingEqual(base, { ...base, footerNote: null }), false);
});