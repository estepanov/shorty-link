import type { SsoProtocol, SsoPublicProvider } from "./sso-catalog";

export type { SsoProtocol };

export type SsoGroupRoleMapping = {
	group: string;
	roleId: string;
};

export type SsoOidcWriteConfig = {
	authorizationEndpoint?: string;
	discoveryEndpoint?: string;
	jwksEndpoint?: string;
	skipDiscovery?: boolean;
	tokenEndpoint?: string;
	userInfoEndpoint?: string;
};

export type SsoSamlWriteConfig = {
	entryPoint?: string;
	idpMetadata?: {
		entityID?: string;
		metadata?: string;
	};
};

export type SsoProviderWrite = {
	allowIdpInitiated?: boolean;
	clientId?: string;
	clientSecret?: string;
	defaultRoleId?: string | null;
	displayName: string;
	domain: string;
	enabled?: boolean;
	enforceSso?: boolean;
	groupClaim?: string;
	groupRoleMappings?: SsoGroupRoleMapping[];
	issuer: string;
	jitEnabled?: boolean;
	oidcConfig?: SsoOidcWriteConfig;
	protocol: SsoProtocol;
	providerId: string;
	samlConfig?: SsoSamlWriteConfig;
};

export type SsoProviderPatch = Partial<SsoProviderWrite>;

export type SsoAdminProvider = SsoPublicProvider & {
	acsUrl: string;
	allowIdpInitiated: boolean;
	callbackUrl: string;
	defaultRoleId: string | null;
	enabled: boolean;
	groupClaim: string;
	groupRoleMappings: SsoGroupRoleMapping[];
	hasClientSecret: boolean;
	issuer: string;
	jitEnabled: boolean;
	spMetadataUrl: string;
};

export type SsoProviderRead = SsoAdminProvider & {
	oidcConfig: Record<string, unknown> | null;
	samlConfig: Record<string, unknown> | null;
};
