import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function migrationStatements(sql: string) {
	const statements: string[] = [];
	let buffer: string[] = [];
	let inTrigger = false;

	for (const line of sql.split("\n")) {
		const trimmed = line.trim();
		if (/^CREATE\s+TRIGGER\b/i.test(trimmed)) {
			inTrigger = true;
		}
		buffer.push(line);
		if (
			(inTrigger && /^END;$/i.test(trimmed)) ||
			(!inTrigger && trimmed.endsWith(";"))
		) {
			const statement = buffer.join("\n").trim();
			if (statement) {
				statements.push(statement);
			}
			buffer = [];
			inTrigger = false;
		}
	}

	const trailing = buffer.join("\n").trim();
	if (trailing) {
		statements.push(trailing);
	}
	return statements;
}

/** Applies every `migrations/*.sql` in lexical order so test D1 matches production DDL. */
export async function applyD1Migrations(database: D1Database) {
	const dir = join(process.cwd(), "migrations");
	const files = readdirSync(dir)
		.filter((name) => name.endsWith(".sql"))
		.sort();
	for (const file of files) {
		const sql = readFileSync(join(dir, file), "utf8");
		for (const statement of migrationStatements(sql)) {
			await database.prepare(statement).run();
		}
	}
}
