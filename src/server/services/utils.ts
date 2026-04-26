import type { AnyColumn } from "drizzle-orm";
import { sql } from "drizzle-orm";

export function escapeLikePattern(value: string) {
	return `%${value
		.replaceAll("\\", "\\\\")
		.replaceAll("%", "\\%")
		.replaceAll("_", "\\_")}%`;
}

export function likeEscaped(column: AnyColumn, pattern: string) {
	return sql`${column} like ${pattern} escape '\\'`;
}
