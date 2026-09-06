import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Applies every `migrations/*.sql` in lexical order so test D1 matches production DDL. */
export async function applyD1Migrations(database: D1Database) {
	const dir = join(process.cwd(), "migrations");
	const files = readdirSync(dir)
		.filter((name) => name.endsWith(".sql"))
		.sort();
	for (const file of files) {
		const sql = readFileSync(join(dir, file), "utf8");
		// Execute the migration as one SQLite script. Statement splitting cannot
		// distinguish top-level semicolons from those inside trigger BEGIN/END blocks.
		await database.exec(sql);
	}
}
