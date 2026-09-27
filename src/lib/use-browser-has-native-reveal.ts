"use client";

import { useSyncExternalStore } from "react";

/**
 * Returns true only on legacy Edge, which injects its own password reveal
 * button. Chrome, Firefox and Safari show no native toggle on a plain
 * password input, so those browsers always need our custom one — otherwise
 * users see two reveal buttons and the native one does nothing useful.
 *
 * Uses `useSyncExternalStore` rather than `useState` + `useEffect`: reading
 * `window` during render is unsafe on the server, but a plain lazy
 * `useState` initialiser would produce different markup on the server and the
 * client and trip a hydration mismatch. This primitive is built for exactly
 * that case — it reports the server value for SSR and the hydration pass, then
 * swaps in the real client value afterwards, with no cascading re-render.
 */

function subscribe(): () => void {
    return () => {};
}

function getSnapshot(): boolean {
    return !!(window as unknown as { documentMode?: number }).documentMode;
}

function getServerSnapshot(): boolean {
    return false;
}

export function useBrowserHasNativeReveal(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
