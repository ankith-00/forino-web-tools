"use client";

import { createContext, useContext } from "react";
import type { UserBranding } from "@/lib/site-branding";

/**
 * Carries the signed-in user's own site branding down to the header and footer.
 *
 * The values are read on the server in the root layout and handed in here, rather
 * than fetched by each component. Two reasons: a per-component fetch would put a
 * Supabase round trip on every page load and on every client-side navigation, and
 * it would render the default name first and correct it after hydration — so a
 * user with a custom title would briefly see the platform one.
 *
 * Kept separate from `ThemeProvider`: that is the reader's own preference, held in
 * localStorage, while this is per-account server state.
 */

const SiteBrandingContext = createContext<UserBranding>({
    siteTitle: null,
    footerNote: null,
});

export function SiteBrandingProvider({
    branding,
    children,
}: {
    branding: UserBranding;
    children: React.ReactNode;
}) {
    return (
        <SiteBrandingContext.Provider value={branding}>{children}</SiteBrandingContext.Provider>
    );
}

/**
 * The current user's branding. Defaults to "unconfigured", so a component rendered
 * outside the provider still shows the platform name rather than a blank.
 */
export function useSiteBranding(): UserBranding {
    return useContext(SiteBrandingContext);
}