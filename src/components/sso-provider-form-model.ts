import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { getTreaty, unwrap } from "@/lib/eden";
import {
	emptySsoFormValues,
	type SsoFormValues,
	toSsoProviderCreate,
	toSsoProviderPatch,
} from "./sso-provider-form-codec";

export type { SsoFormValues } from "./sso-provider-form-codec";

export type SsoFormMode = "create" | "edit";

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
	const originalProtocol =
		initialValues?.protocol ?? emptySsoFormValues.protocol;
	const form = useForm({
		defaultValues: { ...emptySsoFormValues, ...initialValues },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const api = getTreaty();
				if (mode === "create") {
					await unwrap(
						await api.admin["sso-providers"].post(toSsoProviderCreate(value)),
					);
				} else {
					await unwrap(
						await api.admin["sso-providers"]({
							providerId: value.providerId,
						}).patch(toSsoProviderPatch(value, originalProtocol)),
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
