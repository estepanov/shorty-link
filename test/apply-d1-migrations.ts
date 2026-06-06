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
		// Split only on `;` followed by optional whitespace and a newline. A naive `;`
		// split would break migrations where `;` appears mid-line (e.g. SQL comments such
		// as `frontend; the` in 0007) or multi-statement lines without that pattern.
		const statements = sql
			.split(/;\s*\n/)
			.map((statement) => statement.trim())
			.filter(Boolean);
		for (const statement of statements) {
			await database.prepare(statement).run();
		}
	}
}
