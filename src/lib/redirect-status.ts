export const supportedRedirectStatusCodes = [301, 302, 303, 307, 308] as const;

export type RedirectStatusCode = (typeof supportedRedirectStatusCodes)[number];
export type RedirectStatusCodeFilter = "all" | `${RedirectStatusCode}`;

export const redirectStatusOptions = [
	{ code: 301, isPermanent: true, labelKey: "statusCodes.301" },
	{ code: 302, isPermanent: false, labelKey: "statusCodes.302" },
	{ code: 303, isPermanent: false, labelKey: "statusCodes.303" },
	{ code: 307, isPermanent: false, labelKey: "statusCodes.307" },
	{ code: 308, isPermanent: true, labelKey: "statusCodes.308" },
] as const satisfies ReadonlyArray<{
	code: RedirectStatusCode;
	isPermanent: boolean;
	labelKey: string;
}>;

export function isRedirectStatusCode(
	value: number,
): value is RedirectStatusCode {
	return supportedRedirectStatusCodes.includes(value as RedirectStatusCode);
}

export function normalizeRedirectStatusCode(
	value: number | undefined,
): RedirectStatusCode {
	return typeof value === "number" && isRedirectStatusCode(value) ? value : 302;
}

export function parseRedirectStatusCodeFilter(
	value: string,
): RedirectStatusCode | undefined {
	const parsed = Number(value);

	return Number.isInteger(parsed) && isRedirectStatusCode(parsed)
		? parsed
		: undefined;
}
