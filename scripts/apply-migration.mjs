import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import pg from "pg";

const root = fileURLToPath(new URL("..", import.meta.url));

const envLocal = readFileSync(resolve(root, ".env.local"), "utf8");
const envLine = envLocal.match(/^DATABASE_URL="([^"]+)"/m) ?? envLocal.match(/^DATABASE_URL=(\S+)/m);

const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? (envLine && envLine[1]);
if (!url) {
    console.error("No DATABASE_URL found in .env.local. Add it, then re-run.");
    process.exit(1);
}

const parsed = url.match(
    /^postgres(?:ql)?:\/\/([^:/]+):(.+)@([^:/@]+)(?::(\d+))?(?:\/([^?]+))?(?:\?.*)?$/
);
if (!parsed) {
    console.error("Could not parse DATABASE_URL.");
    process.exit(1);
}

const [, user, password, host, port, database] = parsed;

const client = new pg.Client({
    user,
    password,
    host,
    port: port ? Number(port) : 5432,
    database,
    ssl: { rejectUnauthorized: false },
});

const target = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(root, "supabase", "migrations", "20260923000000_create_attendance.sql");

try {
    await client.connect();
    console.log(`Connected to ${host}:${port}/${database}`);

    const sql = await readFile(target, "utf8");
    await client.query(sql);

    await client
        .query(
            `insert into supabase_migrations.schema_migrations (version, name, statements)
             values ($1, $2, 0) on conflict (version) do nothing`,
            ["20260923000000", "create_attendance"]
        )
        .catch(() => {});

    const { rows } = await client.query(`select to_regclass('public.attendance') as "table"`);
    console.log("Migration applied. public.attendance =", rows[0].table);
} catch (e) {
    console.error("Migration failed:", e.message);
    process.exitCode = 1;
} finally {
    await client.end();
}