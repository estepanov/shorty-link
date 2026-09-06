import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function migrationStatements(sql: string) {
	const statements: string[] = [];
	let buffer: string[] = [];
	let inTrigger = false;
	let triggerCaseDepth = 0;
	// #region agent log
	appendFileSync(
		"/opt/cursor/logs/debug.log",
		`${JSON.stringify({ hypothesisId: "B,C,D", location: "test/apply-d1-migrations.ts:migrationStatements", message: "parser entry", data: { lineCount: sql.split("\n").length }, timestamp: Date.now() })}\n`,
	);
	// #endregion

	for (const [lineIndex, line] of sql.split("\n").entries()) {
		const trimmed = line.trim();
		if (/^CREATE\s+TRIGGER\b/i.test(trimmed)) {
			inTrigger = true;
			triggerCaseDepth = 0;
			// #region agent log
			appendFileSync(
				"/opt/cursor/logs/debug.log",
				`${JSON.stringify({ hypothesisId: "B,D", location: "test/apply-d1-migrations.ts:trigger-detection", message: "trigger detected", data: { lineIndex, bufferedLines: buffer.length, line: trimmed }, timestamp: Date.now() })}\n`,
			);
			// #endregion
		}
		buffer.push(line);
		const closesTrigger =
			inTrigger && triggerCaseDepth === 0 && /^END;$/i.test(trimmed);
		if (inTrigger) {
			const caseStarts = trimmed.match(/\bCASE\b/gi)?.length ?? 0;
			const caseEnds = trimmed.match(/\bEND\b/gi)?.length ?? 0;
			triggerCaseDepth = Math.max(0, triggerCaseDepth + caseStarts - caseEnds);
		}
		if (closesTrigger || (!inTrigger && trimmed.endsWith(";"))) {
			const statement = buffer.join("\n").trim();
			if (statement) {
				// #region agent log
				appendFileSync(
					"/opt/cursor/logs/debug.log",
					`${JSON.stringify({ hypothesisId: "A,B,C,D", location: "test/apply-d1-migrations.ts:statement-boundary", message: "statement emitted", data: { lineIndex, inTrigger, terminator: trimmed, statement }, timestamp: Date.now() })}\n`,
				);
				// #endregion
				statements.push(statement);
			}
			buffer = [];
			inTrigger = false;
		}
	}

	const trailing = buffer.join("\n").trim();
	if (trailing) {
		// #region agent log
		appendFileSync(
			"/opt/cursor/logs/debug.log",
			`${JSON.stringify({ hypothesisId: "A,C,D", location: "test/apply-d1-migrations.ts:trailing-buffer", message: "trailing statement emitted", data: { inTrigger, statement: trailing }, timestamp: Date.now() })}\n`,
		);
		// #endregion
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
			// #region agent log
			appendFileSync(
				"/opt/cursor/logs/debug.log",
				`${JSON.stringify({ hypothesisId: "A,B,C,D", location: "test/apply-d1-migrations.ts:before-execute", message: "executing migration statement", data: { file, statement }, timestamp: Date.now() })}\n`,
			);
			// #endregion
			try {
				await database.prepare(statement).run();
			} catch (error) {
				// #region agent log
				appendFileSync(
					"/opt/cursor/logs/debug.log",
					`${JSON.stringify({ hypothesisId: "A,B,C,D", location: "test/apply-d1-migrations.ts:execution-error", message: "migration statement failed", data: { file, statement, error: error instanceof Error ? error.message : String(error) }, timestamp: Date.now() })}\n`,
				);
				// #endregion
				throw error;
			}
		}
	}
}
