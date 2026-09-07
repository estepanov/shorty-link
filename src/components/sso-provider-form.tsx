import { AdminFormRoot, FormFooter } from "@/components/admin-forms";
import { Button, Notice } from "@/components/ui";
import { FieldGroup, FieldSet } from "@/components/ui/field";
import type { MessageKey } from "@/lib/i18n";
import {
	SsoIdentityFields,
	SsoProtocolFields,
	SsoProvisioningFields,
} from "./sso-provider-form-fields";
import {
	type SsoFormMode,
	type SsoFormValues,
	useSsoProviderForm,
} from "./sso-provider-form-model";

export type { SsoFormValues };

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
	mode: SsoFormMode;
	onSaved: () => void;
	t: (key: MessageKey | string) => string;
}) {
	const { error, form } = useSsoProviderForm({
		initialValues,
		mode,
		onSaved,
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
					<SsoIdentityFields form={form} mode={mode} t={t} />
					<SsoProtocolFields form={form} mode={mode} t={t} />
					<SsoProvisioningFields form={form} t={t} />
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
