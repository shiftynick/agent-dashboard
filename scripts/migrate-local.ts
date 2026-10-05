// Applies migrations/*.sql to the local D1 of a running `pnpm dev` server.
// `cf d1 migrations apply` needs a real database ID, which local dev has none of.
// Usage: node scripts/migrate-local.ts [dev-server-url]
import { readFileSync, readdirSync } from "node:fs";

const origin = process.argv[2] ?? "http://localhost:5173";
const api = `${origin}/cdn-cgi/local/explorer/api/d1/database`;
const databases = await (await fetch(api)).json();
const endpoint = `${api}/${databases.result[0].uuid}/raw`;
const dir = new URL("../migrations/", import.meta.url);

async function sql(statement: string, params: unknown[] = []) {
	const response = await fetch(endpoint, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ sql: statement, params }),
	});
	const json = await response.json();
	if (!json.success) throw new Error(JSON.stringify(json.errors));
	return json.result[0].results.rows as unknown[][];
}

await sql(`CREATE TABLE IF NOT EXISTS d1_migrations (
	id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE,
	applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`);
const applied = new Set((await sql("SELECT name FROM d1_migrations")).map((row) => row[0]));

for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
	if (applied.has(name)) continue;
	await sql(readFileSync(new URL(name, dir), "utf8"));
	await sql("INSERT INTO d1_migrations (name) VALUES (?)", [name]);
	console.log(`applied ${name}`);
}
