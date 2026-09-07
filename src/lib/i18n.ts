import { enMessages, type MessageKey } from "./messages/en";
import { esMessages } from "./messages/es";

export type { MessageKey };

export const supportedLocales = ["en", "es"] as const;
export type Locale = (typeof supportedLocales)[number];

export const defaultLocale: Locale = "en";

export const messages = {
	en: enMessages,
	es: esMessages,
} as const;

export function normalizeLocale(value?: string | null): Locale {
	const requested = value?.toLowerCase().split(",")[0]?.split("-")[0];
	return supportedLocales.includes(requested as Locale)
		? (requested as Locale)
		: defaultLocale;
}

export function createTranslator(locale: string | null | undefined) {
	const normalized = normalizeLocale(locale);
	const dictionary = messages[normalized];

	return (key: MessageKey | string) =>
		(dictionary as Record<string, string>)[key] ??
		(messages.en as Record<string, string>)[key] ??
		key;
}

export function interpolate(
	template: string,
	vars: Record<string, string>,
): string {
	return template.replace(
		/\{\{(\w+)\}\}/g,
		(_, key) => vars[key] ?? `{{${key}}}`,
	);
}
