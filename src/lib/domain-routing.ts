import {
	isRedirectStatusCode,
	type RedirectStatusCode,
} from "@/lib/redirect-status";

export const managedDomainRootBehaviors = ["landing", "redirect"] as const;
export type ManagedDomainRootBehavior =
	(typeof managedDomainRootBehaviors)[number];

export const managedDomainUnknownSlugBehaviors = [
	"not_found",
	"redirect",
] as const;
export type ManagedDomainUnknownSlugBehavior =
	(typeof managedDomainUnknownSlugBehaviors)[number];

export const managedDomainRootBehaviorOptions = [
	{
		value: "landing",
		labelKey: "domains.rootBehavior.landing",
	},
	{
		value: "redirect",
		labelKey: "domains.rootBehavior.redirect",
	},
] as const satisfies ReadonlyArray<{
	labelKey: string;
	value: ManagedDomainRootBehavior;
}>;

export const managedDomainUnknownSlugBehaviorOptions = [
	{
		value: "not_found",
		labelKey: "domains.unknownSlugBehavior.notFound",
	},
	{
		value: "redirect",
		labelKey: "domains.unknownSlugBehavior.redirect",
	},
] as const satisfies ReadonlyArray<{
	labelKey: string;
	value: ManagedDomainUnknownSlugBehavior;
}>;

export function isManagedDomainRootBehavior(
	value: string,
): value is ManagedDomainRootBehavior {
	return managedDomainRootBehaviors.includes(
		value as ManagedDomainRootBehavior,
	);
}

export function normalizeManagedDomainRootBehavior(
	value: string | undefined,
): ManagedDomainRootBehavior {
	const normalized = value ?? "";
	return isManagedDomainRootBehavior(normalized) ? normalized : "landing";
}

export function isManagedDomainUnknownSlugBehavior(
	value: string,
): value is ManagedDomainUnknownSlugBehavior {
	return managedDomainUnknownSlugBehaviors.includes(
		value as ManagedDomainUnknownSlugBehavior,
	);
}

export function normalizeManagedDomainUnknownSlugBehavior(
	value: string | undefined,
): ManagedDomainUnknownSlugBehavior {
	const normalized = value ?? "";
	return isManagedDomainUnknownSlugBehavior(normalized)
		? normalized
		: "not_found";
}

export function normalizeManagedDomainRedirectStatusCode(
	value: number | undefined,
): RedirectStatusCode | null {
	return typeof value === "number" && isRedirectStatusCode(value)
		? value
		: null;
}
