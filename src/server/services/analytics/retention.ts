export function parseRetentionDays(
	value: string | number | undefined,
): number | undefined {
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value <= 0) {
			return undefined;
		}
		return Math.floor(value);
	}

	if (!value) {
		return undefined;
	}

	const parsed = Number.parseInt(value.trim(), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return undefined;
	}

	return parsed;
}

export function readRetentionDays(env: object): number | undefined {
	if (!("ANALYTICS_RAW_EVENT_RETENTION_DAYS" in env)) {
		return undefined;
	}

	const value = (env as { ANALYTICS_RAW_EVENT_RETENTION_DAYS?: unknown })
		.ANALYTICS_RAW_EVENT_RETENTION_DAYS;
	if (typeof value === "number" || typeof value === "string") {
		return parseRetentionDays(value);
	}
	return undefined;
}
