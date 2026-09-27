import type { IconType } from "react-icons";
import {
    LuScanBarcode,
    LuCamera,
    LuFileChartColumn,
    LuIdCard,
    LuFileText,
} from "react-icons/lu";

/**
 * Per-tool icons, shared by the avatar menu and the dashboard so a tool looks
 * the same everywhere. Kept out of `@/lib/access` on purpose: that module is
 * imported by the edge proxy, which should not pull in the icon set.
 *
 * Titles live on TOOLS in `@/lib/access`; this is icons only.
 */
export const TOOL_ICONS: Record<string, IconType> = {
    scanner: LuScanBarcode,
    "webcam-scanner": LuCamera,
    barcode: LuFileChartColumn,
    "id-card": LuIdCard,
    "attendance-records": LuFileText,
};

export function toolIcon(slug: string): IconType {
    return TOOL_ICONS[slug] ?? LuFileText;
}
