import type { MessageKey } from "@/lib/i18n";

const shortySsoErrorKeys = new Set<MessageKey>([
	"errors.ssoCancelled",
	"errors.ssoConfigurationInvalid",
	"errors.ssoDiscoveryFailed",
	"errors.ssoEmailUnverified",
	"errors.ssoGroupMappingInvalid",
	"errors.ssoIdentityBoundaryImmutable",
	"errors.ssoNotProvisioned",
	"errors.ssoOwnerRoleForbidden",
	"errors.ssoProtocolImmutable",
	"errors.ssoProtocolInvalid",
	"errors.ssoProviderDisabled",
	"errors.ssoProviderConflict",
	"errors.ssoProviderExists",
	"errors.ssoProviderIdInvalid",
	"errors.ssoProviderIdReserved",
	"errors.ssoProviderMissing",
	"errors.ssoRequired",
	"errors.ssoSamlMetadataInvalid",
	"errors.ssoSecretDecryptFailed",
	"errors.ssoUserDisabled",
]);

const betterAuthSsoErrorKeys: Readonly<Record<string, MessageKey>> = {
	access_denied: "errors.ssoCancelled",
	account_selection_required: "errors.ssoCancelled",
	canceled: "errors.ssoCancelled",
	cancelled: "errors.ssoCancelled",
	consent_required: "errors.ssoCancelled",
	interaction_required: "errors.ssoCancelled",
	login_required: "errors.ssoCancelled",
	user_canceled: "errors.ssoCancelled",
	user_cancelled: "errors.ssoCancelled",
	invalid_provider: "errors.unknown",
	invalid_request: "errors.unknown",
	invalid_saml_response: "errors.unknown",
	invalid_state: "errors.unknown",
	replay_detected: "errors.unknown",
	server_error: "errors.unknown",
	temporarily_unavailable: "errors.unknown",
};

export function mapSsoErrorCode(value: unknown): MessageKey {
	if (typeof value !== "string") {
		return "errors.unknown";
	}

	const code = value.trim();
	if (shortySsoErrorKeys.has(code as MessageKey)) {
		return code as MessageKey;
	}

	return betterAuthSsoErrorKeys[code.toLowerCase()] ?? "errors.unknown";
}

export function parseSsoCallbackError(search: unknown): MessageKey | null {
	if (!search || typeof search !== "object" || Array.isArray(search)) {
		return null;
	}

	const values = search as Record<string, unknown>;
	if (!Object.hasOwn(values, "error")) {
		return null;
	}

	return mapSsoErrorCode(values.error);
}
