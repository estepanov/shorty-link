import { Input, TextArea } from "@/components/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import type { MessageKey } from "@/lib/i18n";
import type {
	SsoFormMode,
	SsoProviderFormApi,
} from "./sso-provider-form-model";

type FieldsProps = {
	form: SsoProviderFormApi;
	t: (key: MessageKey | string) => string;
};

export function SsoIdentityFields({
	form,
	mode,
	t,
}: FieldsProps & { mode: SsoFormMode }) {
	return (
		<>
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
		</>
	);
}

export function SsoProtocolFields({
	form,
	mode,
	t,
}: FieldsProps & { mode: SsoFormMode }) {
	return (
		<form.Subscribe selector={(state) => state.values.protocol}>
			{(protocol) =>
				protocol === "oidc" ? (
					<>
						<form.Field name="clientId">
							{(field) => (
								<Field>
									<FieldLabel>{t("sso.clientId")}</FieldLabel>
									<Input
										onChange={(event) => field.handleChange(event.target.value)}
										required
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
										onChange={(event) => field.handleChange(event.target.value)}
										placeholder={mode === "edit" ? "********" : undefined}
										required={mode === "create"}
										type="password"
										value={field.state.value}
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="skipDiscovery">
							{(field) => (
								<Field orientation="horizontal">
									<Checkbox
										checked={field.state.value}
										id="sso-skip-discovery"
										onCheckedChange={(checked) =>
											field.handleChange(checked === true)
										}
									/>
									<FieldLabel
										className="font-normal text-sm"
										htmlFor="sso-skip-discovery"
									>
										{t("sso.skipDiscovery")}
									</FieldLabel>
								</Field>
							)}
						</form.Field>
						<form.Field name="discoveryEndpoint">
							{(field) => (
								<Field>
									<FieldLabel>{t("sso.discoveryEndpoint")}</FieldLabel>
									<Input
										onChange={(event) => field.handleChange(event.target.value)}
										value={field.state.value}
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="authorizationEndpoint">
							{(field) => (
								<Field>
									<FieldLabel>{t("sso.authorizationEndpoint")}</FieldLabel>
									<Input
										onChange={(event) => field.handleChange(event.target.value)}
										value={field.state.value}
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="tokenEndpoint">
							{(field) => (
								<Field>
									<FieldLabel>{t("sso.tokenEndpoint")}</FieldLabel>
									<Input
										onChange={(event) => field.handleChange(event.target.value)}
										value={field.state.value}
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="jwksEndpoint">
							{(field) => (
								<Field>
									<FieldLabel>{t("sso.jwksEndpoint")}</FieldLabel>
									<Input
										onChange={(event) => field.handleChange(event.target.value)}
										value={field.state.value}
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="userInfoEndpoint">
							{(field) => (
								<Field>
									<FieldLabel>{t("sso.userInfoEndpoint")}</FieldLabel>
									<Input
										onChange={(event) => field.handleChange(event.target.value)}
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
										onChange={(event) => field.handleChange(event.target.value)}
										rows={8}
										value={field.state.value}
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="entryPoint">
							{(field) => (
								<Field>
									<FieldLabel>{t("sso.entryPoint")}</FieldLabel>
									<Input
										onChange={(event) => field.handleChange(event.target.value)}
										value={field.state.value}
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="idpEntityId">
							{(field) => (
								<Field>
									<FieldLabel>{t("sso.idpEntityId")}</FieldLabel>
									<Input
										onChange={(event) => field.handleChange(event.target.value)}
										value={field.state.value}
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="cert">
							{(field) => (
								<Field>
									<FieldLabel>{t("sso.cert")}</FieldLabel>
									<TextArea
										onChange={(event) => field.handleChange(event.target.value)}
										rows={6}
										value={field.state.value}
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="privateKey">
							{(field) => (
								<Field>
									<FieldLabel>{t("sso.privateKey")}</FieldLabel>
									<TextArea
										onChange={(event) => field.handleChange(event.target.value)}
										placeholder={mode === "edit" ? "********" : undefined}
										rows={6}
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
										onChange={(event) => field.handleChange(event.target.value)}
										required
										value={field.state.value}
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="samlEmailVerifiedAttribute">
							{(field) => (
								<Field>
									<FieldLabel>{t("sso.samlEmailVerifiedAttribute")}</FieldLabel>
									<FieldDescription>
										{t("sso.samlEmailVerifiedHint")}
									</FieldDescription>
									<Input
										onChange={(event) => field.handleChange(event.target.value)}
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
										onChange={(event) => field.handleChange(event.target.value)}
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
	);
}

export function SsoProvisioningFields({ form, t }: FieldsProps) {
	return (
		<>
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
						<FieldDescription>{t("sso.groupMappingsHint")}</FieldDescription>
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
						<FieldLabel className="font-normal text-sm" htmlFor="sso-enabled">
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
						<FieldLabel className="font-normal text-sm" htmlFor="sso-enforce">
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
		</>
	);
}
