import { env } from "cloudflare:workers";
import {
	getLogger as baseGetLogger,
	configureSync,
	getConsoleSink,
	type Logger,
	type LogLevel,
} from "@logtape/logtape";

const VALID_LEVELS = new Set<LogLevel>([
	"trace",
	"debug",
	"info",
	"warning",
	"error",
	"fatal",
]);

function resolveLogLevel(): LogLevel {
	const raw = (env as { LOG_LEVEL?: string }).LOG_LEVEL?.toLowerCase();
	if (raw && VALID_LEVELS.has(raw as LogLevel)) {
		return raw as LogLevel;
	}
	return "debug";
}

configureSync({
	sinks: {
		console: getConsoleSink(),
	},
	loggers: [
		{
			category: ["app"],
			lowestLevel: resolveLogLevel(),
			sinks: ["console"],
		},
		{
			category: ["logtape", "meta"],
			lowestLevel: "warning",
			sinks: ["console"],
		},
	],
	reset: true,
});

export type AppLogger = Logger;

export function getLogger(category: readonly string[] | string): AppLogger {
	const segments = typeof category === "string" ? [category] : category;
	return baseGetLogger(["app", ...segments]);
}

export function serializeError(error: unknown): {
	name: string;
	message: string;
	stack?: string;
	cause?: unknown;
} {
	if (error instanceof Error) {
		const cause = (error as Error & { cause?: unknown }).cause;
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
			...(cause !== undefined ? { cause } : {}),
		};
	}
	return { name: typeof error, message: String(error) };
}
