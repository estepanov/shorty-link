export type SsoProtocol = "oidc" | "saml";

export type SsoPublicProvider = {
	displayName: string;
	domains: string[];
	enforceSso: boolean;
	protocol: SsoProtocol;
	providerId: string;
};

export type SsoPublicCatalog = {
	hasEnforcedDomain: boolean;
	providers: SsoPublicProvider[];
};

export function emailDomain(email: string): string | null {
	const trimmed = email.trim().toLowerCase();
	const at = trimmed.lastIndexOf("@");
	if (at <= 0 || at === trimmed.length - 1) {
		return null;
	}
	return trimmed.slice(at + 1);
}

export function domainMatches(email: string, domains: string[]): boolean {
	const domain = emailDomain(email);
	if (!domain) {
		return false;
	}
	return domains.includes(domain);
}

export function isSsoEnforcedForEmail(
	email: string,
	providers: readonly {
		domains: string[];
		enabled?: boolean;
		enforceSso: boolean;
	}[],
): boolean {
	return providers.some(
		(provider) =>
			provider.enabled !== false &&
			provider.enforceSso &&
			domainMatches(email, provider.domains),
	);
}

export function matchingSsoProvider(
	catalog: SsoPublicCatalog,
	email: string,
): SsoPublicProvider | null {
	return (
		catalog.providers.find((provider) =>
			domainMatches(email, provider.domains),
		) ?? null
	);
}

export function visibleSsoProviders(
	catalog: SsoPublicCatalog,
	email: string,
): SsoPublicProvider[] {
	const domain = emailDomain(email);
	if (!domain) {
		return catalog.providers.filter(
			(provider) => !catalog.hasEnforcedDomain || !provider.enforceSso,
		);
	}
	if (isSsoEnforcedForEmail(email, catalog.providers)) {
		return catalog.providers.filter((provider) =>
			domainMatches(email, provider.domains),
		);
	}
	return catalog.providers;
}
