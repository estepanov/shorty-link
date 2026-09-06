import type { SsoProtocol, SsoPublicProvider } from "./sso-catalog";
import type {
	SsoGroupRoleMapping,
	SsoOidcWriteConfig,
	SsoProviderPatch,
	SsoProviderWrite,
	SsoSamlWriteConfig,
} from "./sso-contract";

export type { SsoProtocol };
export type {
	SsoGroupRoleMapping,
	SsoOidcWriteConfig,
	SsoProviderPatch,
	SsoProviderWrite,
	SsoSamlWriteConfig,
};

export const DEFAULT_SAML_ATTRIBUTE_MAPPING = {
	email: "email",
	emailVerified: "email_verified",
	name: "displayName",
} as const;

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

export type SsoOidcReadConfig = SsoOidcWriteConfig & {
	allowIdpInitiated?: boolean;
	clientId?: string;
	clientSecret?: string;
	issuer?: string;
	pkce?: boolean;
	tokenEndpointAuthentication?: string;
};

export type SsoSamlReadConfig = SsoSamlWriteConfig & {
	allowIdpInitiated?: boolean;
	callbackUrl?: string;
	issuer?: string;
};

export type SsoProviderRead = SsoAdminProvider & {
	oidcConfig: SsoOidcReadConfig | null;
	samlConfig: SsoSamlReadConfig | null;
};
