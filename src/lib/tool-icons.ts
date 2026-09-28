import type { IconType } from "react-icons";
import {
    LuScanBarcode,
    LuCamera,
    LuFileText,
} from "react-icons/lu";
import { ImBarcode } from "react-icons/im";
import { MdAutoGraph } from "react-icons/md";
import { BiSolidCard } from "react-icons/bi";

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
    barcode: ImBarcode,
    "id-card": BiSolidCard,
    "attendance-records": MdAutoGraph,
};

export function toolIcon(slug: string): IconType {
    return TOOL_ICONS[slug] ?? LuFileText;
}
