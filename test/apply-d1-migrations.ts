import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type SqlLexerState =
	| "backtick"
	| "block-comment"
	| "bracket"
	| "double-quote"
	| "line-comment"
	| "normal"
	| "single-quote";

export function migrationStatements(sql: string) {
	const statements: string[] = [];
	let statementStart = 0;
	let lexerState: SqlLexerState = "normal";
	let token = "";
	let leadingTokens: string[] = [];
	let inTrigger = false;
	let triggerCaseDepth = 0;
	let triggerEndSeen = false;

	const commitToken = () => {
		if (!token) {
			return;
		}
		const keyword = token.toUpperCase();
		if (leadingTokens.length < 3) {
			leadingTokens.push(keyword);
			inTrigger =
				leadingTokens[0] === "CREATE" &&
				(leadingTokens[1] === "TRIGGER" ||
					(["TEMP", "TEMPORARY"].includes(leadingTokens[1] ?? "") &&
						leadingTokens[2] === "TRIGGER"));
		}
		if (inTrigger && keyword === "CASE") {
			triggerCaseDepth += 1;
		} else if (inTrigger && keyword === "END") {
			if (triggerCaseDepth > 0) {
				triggerCaseDepth -= 1;
			} else {
				triggerEndSeen = true;
			}
		}
		token = "";
	};

	const emitStatement = (end: number) => {
		const statement = sql.slice(statementStart, end).trim();
		if (statement) {
			statements.push(statement);
		}
		statementStart = end;
		leadingTokens = [];
		inTrigger = false;
		triggerCaseDepth = 0;
		triggerEndSeen = false;
	};

	for (let index = 0; index < sql.length; index += 1) {
		const character = sql[index];
		const next = sql[index + 1];
		switch (lexerState) {
			case "normal":
				if (character === "-" && next === "-") {
					commitToken();
					lexerState = "line-comment";
					index += 1;
				} else if (character === "/" && next === "*") {
					commitToken();
					lexerState = "block-comment";
					index += 1;
				} else if (character === "'") {
					commitToken();
					lexerState = "single-quote";
				} else if (character === '"') {
					commitToken();
					lexerState = "double-quote";
				} else if (character === "`") {
					commitToken();
					lexerState = "backtick";
				} else if (character === "[") {
					commitToken();
					lexerState = "bracket";
				} else if (/\w/.test(character)) {
					token += character;
				} else {
					commitToken();
					if (character === ";" && (!inTrigger || triggerEndSeen)) {
						emitStatement(index + 1);
					}
				}
				break;
			case "single-quote":
				if (character === "'" && next === "'") {
					index += 1;
				} else if (character === "'") {
					lexerState = "normal";
				}
				break;
			case "double-quote":
				if (character === '"' && next === '"') {
					index += 1;
				} else if (character === '"') {
					lexerState = "normal";
				}
				break;
			case "backtick":
				if (character === "`" && next === "`") {
					index += 1;
				} else if (character === "`") {
					lexerState = "normal";
				}
				break;
			case "bracket":
				if (character === "]") {
					lexerState = "normal";
				}
				break;
			case "line-comment":
				if (character === "\n") {
					lexerState = "normal";
				}
				break;
			case "block-comment":
				if (character === "*" && next === "/") {
					lexerState = "normal";
					index += 1;
				}
				break;
			default: {
				const _exhaustive: never = lexerState;
				throw new Error(`Unknown SQL lexer state: ${_exhaustive}`);
			}
		}
	}

	commitToken();
	emitStatement(sql.length);
	return statements;
}

type MigrationRange = {
	from?: string;
	through?: string;
};

/** Applies `migrations/*.sql` in lexical order so test D1 matches production DDL. */
export async function applyD1Migrations(
	database: D1Database,
	range: MigrationRange = {},
) {
	const dir = join(process.cwd(), "migrations");
	const files = readdirSync(dir)
		.filter((name) => name.endsWith(".sql"))
		.filter((name) => !range.from || name >= range.from)
		.filter((name) => !range.through || name <= range.through)
		.sort();
	for (const file of files) {
		const sql = readFileSync(join(dir, file), "utf8");
		for (const statement of migrationStatements(sql)) {
			await database.prepare(statement).run();
		}
	}
}
