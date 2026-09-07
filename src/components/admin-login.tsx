import { useForm } from "@tanstack/react-form";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	Button,
	Card,
	FieldLabel,
	Input,
	Notice,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { getTreaty, unwrap } from "@/lib/eden";
import { createTranslator, defaultLocale, supportedLocales } from "@/lib/i18n";
import type { SsoPublicCatalog } from "@/lib/sso-catalog";
import { isSsoEnforcedForEmail, visibleSsoProviders } from "@/lib/sso-catalog";
import { mapSsoErrorCode, parseSsoCallbackError } from "@/lib/sso-errors";

export type BootstrapState = {
	canBootstrap: boolean;
	hasUsers: boolean;
};

function mapPasskeyError(raw: unknown): string {
	const code =
		typeof raw === "object" && raw !== null && "code" in raw
			? String((raw as { code?: unknown }).code ?? "")
			: "";
	const name =
		raw instanceof Error
			? raw.name
			: typeof raw === "object" && raw !== null && "name" in raw
				? String((raw as { name?: unknown }).name ?? "")
				: "";
	const message =
		raw instanceof Error
			? raw.message
			: typeof raw === "object" && raw !== null && "message" in raw
				? String((raw as { message?: unknown }).message ?? "")
				: "";
	const normalizedCode = code.toUpperCase();
	const normalizedName = name.toUpperCase();

	if (message.startsWith("errors.")) return message;
	if (
		normalizedCode === "PASSKEY_CANCELLED" ||
		normalizedCode === "ERROR_CREDENTIAL_NOT_FOUND" ||
		normalizedName === "NOTALLOWEDERROR" ||
		normalizedName === "ABORTERROR"
	) {
		return "errors.passkeyCancelled";
	}
	if (
		normalizedCode === "PASSKEY_NOT_FOUND" ||
		normalizedCode === "CREDENTIAL_NOT_FOUND" ||
		normalizedCode === "NO_CREDENTIAL" ||
		normalizedName === "INVALIDSTATEERROR"
	) {
		return "errors.passkeyNotFound";
	}
	if (
		normalizedCode === "PASSKEY_NOT_SUPPORTED" ||
		normalizedName === "NOTSUPPORTEDERROR" ||
		normalizedName === "SECURITYERROR"
	) {
		return "errors.passkeyUnsupported";
	}
	return "errors.passkeyVerifyFailed";
}

export function PasskeyLogin() {
	const location = useLocation();
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [email, setEmail] = useState("");
	const [catalog, setCatalog] = useState<SsoPublicCatalog | null>(null);
	const t = createTranslator(defaultLocale);

	useEffect(() => {
		void unwrap<SsoPublicCatalog>(
			getTreaty().admin["sso-providers"].public.get(),
		).then(setCatalog, () =>
			setCatalog({ hasEnforcedDomain: false, providers: [] }),
		);
	}, []);

	const normalizedEmail = email.trim().toLowerCase();
	const enforced = catalog
		? isSsoEnforcedForEmail(normalizedEmail, catalog.providers)
		: false;
	const visibleProviders = catalog
		? visibleSsoProviders(catalog, normalizedEmail)
		: [];
	const callbackError = parseSsoCallbackError(location.search);
	const visibleError = error ?? callbackError;

	async function signInSso(providerId: string) {
		setBusy(true);
		setError(null);
		try {
			const result = await authClient.signIn.sso({
				providerId,
				callbackURL: "/admin",
				errorCallbackURL: "/admin",
				email: normalizedEmail || undefined,
				loginHint: normalizedEmail || undefined,
			});
			if (result.error) {
				setError(mapSsoErrorCode(result.error.message ?? result.error.code));
			}
		} catch (nextError) {
			setError(
				mapSsoErrorCode(
					nextError instanceof Error ? nextError.message : undefined,
				),
			);
		} finally {
			setBusy(false);
		}
	}

	async function signIn() {
		setBusy(true);
		setError(null);
		try {
			const result = await authClient.signIn.passkey({ autoFill: false });
			if (result?.error) {
				setError(mapPasskeyError(result.error));
				return;
			}
			if (result?.data && !("error" in (result as object) && result.error)) {
				await router.navigate({ to: "/admin" });
				return;
			}
			setError("errors.passkeyVerifyFailed");
		} catch (nextError) {
			setError(mapPasskeyError(nextError));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Card className="mx-auto max-w-2xl p-8">
			<p className="eyebrow text-accent">{t("auth.noPasswords")}</p>
			<h1 className="mt-4 font-display text-4xl tracking-tight">
				{t("auth.signIn")}
			</h1>
			<p className="mt-4 text-muted-foreground">{t("auth.loginHint")}</p>
			{catalog?.hasEnforcedDomain ? (
				<div className="mt-6 grid gap-2">
					<FieldLabel>
						{t("sso.workEmail")}
						<Input
							autoComplete="email"
							onChange={(event) => setEmail(event.target.value)}
							type="email"
							value={email}
						/>
					</FieldLabel>
				</div>
			) : null}
			{enforced ? null : (
				<Button className="mt-6" disabled={busy} onClick={signIn} type="button">
					{busy ? t("auth.waiting") : t("auth.signIn")}
				</Button>
			)}
			{visibleProviders.length ? (
				<div className="mt-4 grid gap-2">
					{visibleProviders.map((provider) => (
						<Button
							disabled={busy}
							key={provider.providerId}
							onClick={() => {
								void signInSso(provider.providerId);
							}}
							tone="secondary"
							type="button"
						>
							{t("sso.signInWith")} {provider.displayName}
						</Button>
					))}
				</div>
			) : null}
			{visibleError ? (
				<div className="mt-4">
					<Notice tone="error">
						<p className="font-bold">{t(visibleError)}</p>
						{enforced ? null : (
							<>
								<p className="mt-1">{t("auth.passkeyRemediation")}</p>
								<div className="mt-3">
									<Button
										disabled={busy}
										onClick={signIn}
										tone="secondary"
										type="button"
									>
										{t("auth.tryAgain")}
									</Button>
								</div>
							</>
						)}
					</Notice>
				</div>
			) : null}
		</Card>
	);
}

export function BootstrapForm({ locale }: { locale: string }) {
	const router = useRouter();
	const t = createTranslator(locale);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: {
			email: "",
			locale,
			name: "",
		},
		onSubmit: async ({ value }) => {
			setBusy(true);
			setError(null);
			try {
				const api = getTreaty();
				const { context } = await unwrap<{ context: string }>(
					await api.admin.onboarding.bootstrap.post(value),
				);
				const result = await authClient.passkey.addPasskey({
					context,
					name: `${value.email} primary passkey`,
				});

				if (result.error) {
					throw new Error(result.error.message ?? "errors.unknown");
				}

				await authClient.signIn.passkey({ autoFill: false });
				await router.navigate({ to: "/admin" });
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
				setBusy(false);
			}
		},
	});

	return (
		<Card className="mx-auto max-w-3xl p-8">
			<p className="eyebrow text-accent">{t("auth.noPasswords")}</p>
			<h1 className="mt-4 font-display text-4xl tracking-tight">
				{t("auth.bootstrapTitle")}
			</h1>
			<form
				className="mt-8 grid gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<form.Field name="name">
					{(field) => (
						<FieldLabel>
							{t("forms.name")}
							<Input
								autoComplete="name"
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								required
								value={field.state.value}
							/>
						</FieldLabel>
					)}
				</form.Field>
				<form.Field name="email">
					{(field) => (
						<FieldLabel>
							{t("forms.email")}
							<Input
								autoComplete="username webauthn"
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								required
								type="email"
								value={field.state.value}
							/>
						</FieldLabel>
					)}
				</form.Field>
				<form.Field name="locale">
					{(field) => (
						<FieldLabel>
							{t("forms.locale")}
							<Select
								onValueChange={field.handleChange}
								value={field.state.value}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{supportedLocales.map((option) => (
										<SelectItem key={option} value={option}>
											{option.toUpperCase()}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</FieldLabel>
					)}
				</form.Field>
				<Button disabled={busy} type="submit">
					{busy ? t("auth.waiting") : t("auth.addPasskey")}
				</Button>
			</form>
			{error ? (
				<div className="mt-4">
					<Notice tone="error">{t(error)}</Notice>
				</div>
			) : null}
		</Card>
	);
}
