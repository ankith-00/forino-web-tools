// The booklet scanner (/booklet-scanner) decodes page QR codes with ZXing compiled to
// WebAssembly. Serve the .wasm from our own origin (public/) so the scanner
// never loads code from a CDN and keeps working offline; copied on install so
// it always matches the installed package.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { copyFileSync, mkdirSync } from "node:fs";

const nodeRequire = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));

const from = nodeRequire.resolve("zxing-wasm/reader/zxing_reader.wasm");
const to = resolve(root, "public", "zxing_reader.wasm");

mkdirSync(resolve(root, "public"), { recursive: true });
copyFileSync(from, to);
