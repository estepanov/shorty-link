import { useForm } from "@tanstack/react-form";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	AppShell,
	Button,
	Card,
	FieldLabel,
	Input,
	Notice,
	Select,
} from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { getTreaty } from "@/lib/eden";
import { createTranslator, defaultLocale, supportedLocales } from "@/lib/i18n";

export const Route = createFileRoute("/admin/invite/$token")({
	component: Invite,
});

function Invite() {
	const { token } = Route.useParams();
	const router = useRouter();
	const [email, setEmail] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const t = createTranslator(defaultLocale);
	const form = useForm({
		defaultValues: {
			locale: String(defaultLocale),
			name: "",
		},
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const api = getTreaty();
				const { context } = await unwrap<{ context: string }>(
					await api.admin.onboarding.invite.post({
						...value,
						token,
					}),
				);
				const result = await authClient.passkey.addPasskey({
					context,
					name: `${email ?? "Admin"} passkey`,
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
			}
		},
	});

	useEffect(() => {
		const api = getTreaty();
		void unwrap<{ email: string }>(api.admin.invites({ token }).get()).then(
			(invite) => setEmail(invite.email),
			() => setError("errors.inviteMissing"),
		);
	}, [token]);

	return (
		<AppShell>
			<main className="mx-auto max-w-2xl px-5 py-10">
				<Card>
					<p className="text-sm font-black uppercase tracking-[0.24em] text-blue-800 dark:text-blue-300">
						{t("auth.noPasswords")}
					</p>
					<h1 className="mt-4 text-4xl font-black">{t("auth.inviteTitle")}</h1>
					<p className="mt-3 text-stone-700 dark:text-stone-300">
						{email
							? `${t("auth.inviteFor")} ${email}.`
							: t("auth.loadingInvite")}
					</p>
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
										onChange={(event) => field.handleChange(event.target.value)}
										required
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
										onChange={(event) => field.handleChange(event.target.value)}
										value={field.state.value}
									>
										{supportedLocales.map((option) => (
											<option key={option} value={option}>
												{option.toUpperCase()}
											</option>
										))}
									</Select>
								</FieldLabel>
							)}
						</form.Field>
						<Button disabled={!email} type="submit">
							{t("auth.addPasskey")}
						</Button>
					</form>
					{error ? (
						<div className="mt-4">
							<Notice tone="error">{t(error)}</Notice>
						</div>
					) : null}
				</Card>
			</main>
		</AppShell>
	);
}

async function unwrap<T>(
	response:
		| Promise<{ data: unknown; error: unknown }>
		| { data: unknown; error: unknown },
) {
	const resolved = await response;
	if (resolved.error) {
		throw new Error("errors.unknown");
	}

	if (resolved.data instanceof Response) {
		throw new Error(await resolved.data.text().catch(() => "errors.unknown"));
	}

	return resolved.data as T;
}
