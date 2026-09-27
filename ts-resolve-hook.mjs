// Temporary: let Node's native TypeScript loader resolve the repo's
// extensionless relative imports. The app itself is fine — Next/bundler
// resolution handles these — but `node` needs the extension added by hand.
// Used via `node --import ./ts-resolve-hook-register.mjs <script>`.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx"];

/** Mirrors the `paths` alias in tsconfig.json. */
const ROOTS = { "@/": "src/" };

export async function resolve(specifier, context, nextResolve) {
    try {
        return await nextResolve(specifier, context);
    } catch (err) {
        for (const [prefix, dir] of Object.entries(ROOTS)) {
            if (!specifier.startsWith(prefix)) continue;
            for (const ext of EXTS) {
                const candidate = path.resolve(process.cwd(), dir, specifier.slice(prefix.length) + ext);
                if (existsSync(candidate)) {
                    return { url: pathToFileURL(candidate).href, shortCircuit: true };
                }
            }
        }
        const relative = specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:");
        if (!relative) throw err;
        const base = context.parentURL
            ? path.dirname(fileURLToPath(context.parentURL))
            : process.cwd();
        for (const ext of EXTS) {
            const candidate = path.resolve(base, specifier + ext);
            if (existsSync(candidate)) {
                return { url: pathToFileURL(candidate).href, shortCircuit: true };
            }
        }
        // Also try an index file in the directory.
        for (const ext of EXTS) {
            const candidate = path.resolve(base, specifier, "index" + ext);
            if (existsSync(candidate)) {
                return { url: pathToFileURL(candidate).href, shortCircuit: true };
            }
        }
        throw err;
    }
}
