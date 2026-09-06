import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { AdminFormRoot, FormFooter } from "@/components/admin-forms";
import { Button, Input, Notice, TextArea } from "@/components/ui";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldSet,
} from "@/components/ui/field";
import { getTreaty, unwrap } from "@/lib/eden";
import type { MessageKey } from "@/lib/i18n";
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

export function SsoProviderForm({
	callbackUrl,
	acsUrl,
	initialValues,
	mode,
	onSaved,
	t,
}: {
	acsUrl?: string;
	callbackUrl?: string;
	initialValues?: Partial<SsoFormValues>;
	mode: "create" | "edit";
	onSaved: () => void;
	t: (key: MessageKey | string) => string;
}) {
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { ...emptyValues, ...initialValues },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const api = getTreaty();
				const mappings = parseMappings(value.groupRoleMappings);
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
					groupRoleMappings: mappings,
					issuer: value.issuer,
					jitEnabled: value.jitEnabled,
					protocol: value.protocol,
					providerId: value.providerId,
					samlConfig:
						value.protocol === "saml"
							? {
									idpMetadata: { metadata: value.idpMetadata },
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
					await unwrap(
						await api.admin["sso-providers"]({
							providerId: value.providerId,
						}).patch(payload),
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

	return (
		<AdminFormRoot
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			{error ? <Notice tone="error">{t(error)}</Notice> : null}
			<FieldSet>
				<FieldGroup>
					<form.Field name="displayName">
						{(field) => (
							<Field>
								<FieldLabel>{t("sso.displayName")}</FieldLabel>
								<Input
									onChange={(event) => field.handleChange(event.target.value)}
									required
									value={field.state.value}
								/>
							</Field>
						)}
					</form.Field>
					<form.Field name="providerId">
						{(field) => (
							<Field>
								<FieldLabel>{t("sso.providerId")}</FieldLabel>
								<Input
									disabled={mode === "edit"}
									onChange={(event) => field.handleChange(event.target.value)}
									required
									value={field.state.value}
								/>
							</Field>
						)}
					</form.Field>
					<form.Field name="protocol">
						{(field) => (
							<Field>
								<FieldLabel>{t("sso.protocol")}</FieldLabel>
								<select
									className="border-input bg-background h-9 rounded-md border px-3 text-sm"
									disabled={mode === "edit"}
									onChange={(event) =>
										field.handleChange(
											event.target.value === "saml" ? "saml" : "oidc",
										)
									}
									value={field.state.value}
								>
									<option value="oidc">{t("sso.protocolOidc")}</option>
									<option value="saml">{t("sso.protocolSaml")}</option>
								</select>
							</Field>
						)}
					</form.Field>
					<form.Field name="issuer">
						{(field) => (
							<Field>
								<FieldLabel>{t("sso.issuer")}</FieldLabel>
								<Input
									onChange={(event) => field.handleChange(event.target.value)}
									required
									value={field.state.value}
								/>
							</Field>
						)}
					</form.Field>
					<form.Field name="domain">
						{(field) => (
							<Field>
								<FieldLabel>{t("sso.domains")}</FieldLabel>
								<FieldDescription>{t("sso.domainsHint")}</FieldDescription>
								<Input
									onChange={(event) => field.handleChange(event.target.value)}
									required
									value={field.state.value}
								/>
							</Field>
						)}
					</form.Field>
					<form.Subscribe selector={(state) => state.values.protocol}>
						{(protocol) =>
							protocol === "oidc" ? (
								<>
									<form.Field name="clientId">
										{(field) => (
											<Field>
												<FieldLabel>{t("sso.clientId")}</FieldLabel>
												<Input
													onChange={(event) =>
														field.handleChange(event.target.value)
													}
													value={field.state.value}
												/>
											</Field>
										)}
									</form.Field>
									<form.Field name="clientSecret">
										{(field) => (
											<Field>
												<FieldLabel>{t("sso.clientSecret")}</FieldLabel>
												<Input
													autoComplete="new-password"
													onChange={(event) =>
														field.handleChange(event.target.value)
													}
													placeholder={mode === "edit" ? "********" : undefined}
													type="password"
													value={field.state.value}
												/>
											</Field>
										)}
									</form.Field>
								</>
							) : (
								<>
									<form.Field name="idpMetadata">
										{(field) => (
											<Field>
												<FieldLabel>{t("sso.idpMetadata")}</FieldLabel>
												<TextArea
													onChange={(event) =>
														field.handleChange(event.target.value)
													}
													rows={8}
													value={field.state.value}
												/>
											</Field>
										)}
									</form.Field>
									<form.Field name="samlEmailAttribute">
										{(field) => (
											<Field>
												<FieldLabel>{t("sso.samlEmailAttribute")}</FieldLabel>
												<Input
													onChange={(event) =>
														field.handleChange(event.target.value)
													}
													required
													value={field.state.value}
												/>
											</Field>
										)}
									</form.Field>
									<form.Field name="samlEmailVerifiedAttribute">
										{(field) => (
											<Field>
												<FieldLabel>
													{t("sso.samlEmailVerifiedAttribute")}
												</FieldLabel>
												<FieldDescription>
													{t("sso.samlEmailVerifiedHint")}
												</FieldDescription>
												<Input
													onChange={(event) =>
														field.handleChange(event.target.value)
													}
													required
													value={field.state.value}
												/>
											</Field>
										)}
									</form.Field>
									<form.Field name="samlNameAttribute">
										{(field) => (
											<Field>
												<FieldLabel>{t("sso.samlNameAttribute")}</FieldLabel>
												<Input
													onChange={(event) =>
														field.handleChange(event.target.value)
													}
													required
													value={field.state.value}
												/>
											</Field>
										)}
									</form.Field>
								</>
							)
						}
					</form.Subscribe>
					<form.Field name="defaultRoleId">
						{(field) => (
							<Field>
								<FieldLabel>{t("sso.defaultRole")}</FieldLabel>
								<Input
									onChange={(event) => field.handleChange(event.target.value)}
									value={field.state.value}
								/>
							</Field>
						)}
					</form.Field>
					<form.Field name="groupClaim">
						{(field) => (
							<Field>
								<FieldLabel>{t("sso.groupClaim")}</FieldLabel>
								<Input
									onChange={(event) => field.handleChange(event.target.value)}
									value={field.state.value}
								/>
							</Field>
						)}
					</form.Field>
					<form.Field name="groupRoleMappings">
						{(field) => (
							<Field>
								<FieldLabel>{t("sso.groupMappings")}</FieldLabel>
								<FieldDescription>
									{t("sso.groupMappingsHint")}
								</FieldDescription>
								<TextArea
									onChange={(event) => field.handleChange(event.target.value)}
									rows={4}
									value={field.state.value}
								/>
							</Field>
						)}
					</form.Field>
					<form.Field name="enabled">
						{(field) => (
							<Field orientation="horizontal">
								<Checkbox
									checked={field.state.value}
									id="sso-enabled"
									onCheckedChange={(checked) =>
										field.handleChange(checked === true)
									}
								/>
								<FieldLabel
									className="font-normal text-sm"
									htmlFor="sso-enabled"
								>
									{t("sso.enabled")}
								</FieldLabel>
							</Field>
						)}
					</form.Field>
					<form.Field name="jitEnabled">
						{(field) => (
							<Field orientation="horizontal">
								<Checkbox
									checked={field.state.value}
									id="sso-jit-enabled"
									onCheckedChange={(checked) =>
										field.handleChange(checked === true)
									}
								/>
								<FieldLabel
									className="font-normal text-sm"
									htmlFor="sso-jit-enabled"
								>
									{t("sso.jitEnabled")}
								</FieldLabel>
							</Field>
						)}
					</form.Field>
					<form.Field name="enforceSso">
						{(field) => (
							<Field orientation="horizontal">
								<Checkbox
									checked={field.state.value}
									id="sso-enforce"
									onCheckedChange={(checked) =>
										field.handleChange(checked === true)
									}
								/>
								<FieldLabel
									className="font-normal text-sm"
									htmlFor="sso-enforce"
								>
									{t("sso.enforceSso")}
								</FieldLabel>
							</Field>
						)}
					</form.Field>
					<form.Field name="allowIdpInitiated">
						{(field) => (
							<Field orientation="horizontal">
								<Checkbox
									checked={field.state.value}
									id="sso-idp-initiated"
									onCheckedChange={(checked) =>
										field.handleChange(checked === true)
									}
								/>
								<FieldLabel
									className="font-normal text-sm"
									htmlFor="sso-idp-initiated"
								>
									{t("sso.allowIdpInitiated")}
								</FieldLabel>
							</Field>
						)}
					</form.Field>
				</FieldGroup>
			</FieldSet>
			{callbackUrl ? (
				<p className="text-muted-foreground text-sm">
					{t("sso.callbackUrl")}: {callbackUrl}
				</p>
			) : null}
			{acsUrl ? (
				<p className="text-muted-foreground text-sm">
					{t("sso.acsUrl")}: {acsUrl}
				</p>
			) : null}
			<FormFooter>
				<Button type="submit">
					{mode === "create" ? t("sso.create") : t("sso.save")}
				</Button>
			</FormFooter>
		</AdminFormRoot>
	);
}
