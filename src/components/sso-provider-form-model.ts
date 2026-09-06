import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { getTreaty, unwrap } from "@/lib/eden";
import { DEFAULT_SAML_ATTRIBUTE_MAPPING } from "@/lib/sso-types";

export type SsoFormValues = {
	allowIdpInitiated: boolean;
	clientId: string;
	clientSecret: string;
	defaultRoleId: string;
	displayName: string;
	domain: string;
	enabled: boolean;
	enforceSso: boolean;
	groupClaim: string;
	groupRoleMappings: string;
	issuer: string;
	idpMetadata: string;
	jitEnabled: boolean;
	protocol: "oidc" | "saml";
	providerId: string;
	samlEmailAttribute: string;
	samlEmailVerifiedAttribute: string;
	samlNameAttribute: string;
};

export type SsoFormMode = "create" | "edit";

const emptyValues: SsoFormValues = {
	allowIdpInitiated: false,
	clientId: "",
	clientSecret: "",
	defaultRoleId: "",
	displayName: "",
	domain: "",
	enabled: true,
	enforceSso: false,
	groupClaim: "groups",
	groupRoleMappings: "",
	issuer: "",
	idpMetadata: "",
	jitEnabled: false,
	protocol: "oidc",
	providerId: "",
	samlEmailAttribute: DEFAULT_SAML_ATTRIBUTE_MAPPING.email,
	samlEmailVerifiedAttribute: DEFAULT_SAML_ATTRIBUTE_MAPPING.emailVerified,
	samlNameAttribute: DEFAULT_SAML_ATTRIBUTE_MAPPING.name,
};

function parseMappings(value: string) {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [group, roleId] = line.split("=").map((part) => part.trim());
			if (!group || !roleId) {
				throw new Error("errors.ssoGroupMappingInvalid");
			}
			return { group, roleId };
		});
}

export function useSsoProviderForm({
	initialValues,
	mode,
	onSaved,
}: {
	initialValues?: Partial<SsoFormValues>;
	mode: SsoFormMode;
	onSaved: () => void;
}) {
	const [error, setError] = useState<string | null>(null);
	const originalProtocol = initialValues?.protocol ?? emptyValues.protocol;
	const form = useForm({
		defaultValues: { ...emptyValues, ...initialValues },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const api = getTreaty();
				const protocol = mode === "edit" ? originalProtocol : value.protocol;
				const payload = {
					allowIdpInitiated: value.allowIdpInitiated,
					clientId: value.clientId || undefined,
					clientSecret: value.clientSecret || undefined,
					defaultRoleId: value.defaultRoleId || null,
					displayName: value.displayName,
					domain: value.domain,
					enabled: value.enabled,
					enforceSso: value.enforceSso,
					groupClaim: value.groupClaim,
					groupRoleMappings: parseMappings(value.groupRoleMappings),
					issuer: value.issuer,
					jitEnabled: value.jitEnabled,
					protocol,
					providerId: value.providerId,
					samlConfig:
						protocol === "saml"
							? {
									...(value.idpMetadata.trim()
										? {
												idpMetadata: {
													metadata: value.idpMetadata,
												},
											}
										: {}),
									mapping: {
										email: value.samlEmailAttribute,
										emailVerified: value.samlEmailVerifiedAttribute,
										name: value.samlNameAttribute,
									},
								}
							: undefined,
				};
				if (mode === "create") {
					await unwrap(await api.admin["sso-providers"].post(payload));
				} else {
					const { providerId, ...patch } = payload;
					await unwrap(
						await api.admin["sso-providers"]({
							providerId,
						}).patch(patch),
					);
				}
				onSaved();
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});
	return { error, form };
}

export type SsoProviderFormApi = ReturnType<typeof useSsoProviderForm>["form"];
