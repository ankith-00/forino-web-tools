import type { IconType } from "react-icons";
import {
    LuCamera,
    LuFileText,
} from "react-icons/lu";
import { RiFileScanLine, RiQrScanAiLine } from "react-icons/ri";
import { PiUserFocus } from "react-icons/pi";
import { TbUserScan } from "react-icons/tb";
import { MdAutoGraph } from "react-icons/md";
import { BiSolidCard } from "react-icons/bi";
import { CiImageOn } from "react-icons/ci";

/**
 * Per-tool icons, shared by the avatar menu and the dashboard so a tool looks
 * the same everywhere. Kept out of `@/lib/access` on purpose: that module is
 * imported by the edge proxy, which should not pull in the icon set.
 *
 * Titles live on TOOLS in `@/lib/access`; this is icons only.
 */
export const TOOL_ICONS: Record<string, IconType> = {
    scanner: TbUserScan,
    "webcam-scanner": RiFileScanLine,
    barcode: RiQrScanAiLine,
    "id-card": PiUserFocus,
    "attendance-records": MdAutoGraph,
    "magic-frame": CiImageOn,
};

export function toolIcon(slug: string): IconType {
    return TOOL_ICONS[slug] ?? LuFileText;
}
