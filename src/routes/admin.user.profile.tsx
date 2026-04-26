import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AccountTabs } from "@/components/account-tabs";
import {
	Button,
	Card,
	FieldLabel,
	Input,
	Notice,
	PageHeader,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui";
import { useAdminAuthGuard, useAuthContext } from "@/lib/admin-auth";
import { getTreaty, unwrap } from "@/lib/eden";
import { supportedLocales } from "@/lib/i18n";
import { PERMISSION_GROUPS } from "@/lib/permissions";

export const Route = createFileRoute("/admin/user/profile")({
	component: Profile,
});

function Profile() {
	const { session, isPending, locale, refetch, t } = useAdminAuthGuard();
	const { authContext } = useAuthContext();
	const [notice, setNotice] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: {
			email: session?.user.email ?? "",
			locale,
			name: session?.user.name ?? "",
		},
		onSubmit: async ({ value }) => {
			setError(null);
			setNotice(null);
			try {
				const api = getTreaty();
				await unwrap(await api.admin.profile.patch(value));
				await refetch();
				setNotice("profile.saved");
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: form.reset is stable; re-seed only when the authenticated user's identity, email, name, or locale changes.
	useEffect(() => {
		if (!session) {
			return;
		}

		form.reset({
			email: session.user.email,
			locale,
			name: session.user.name,
		});
	}, [locale, session?.user.email, session?.user.id, session?.user.name]);

	if (isPending) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Card>{t("loading.app")}</Card>
			</div>
		);
	}

	if (!session) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Notice tone="error">{t("errors.unauthorized")}</Notice>
			</div>
		);
	}

	return (
		<div className="mx-auto grid w-full max-w-7xl gap-6">
			<PageHeader
				title={t("profile.title")}
				description={t("profile.description")}
			/>
			<AccountTabs locale={locale} />

			<div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
				<Card>
					<h2 className="font-display text-2xl tracking-tight">
						{t("profile.identity")}
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						{t("profile.identityDescription")}
					</p>
					<form
						className="mt-6 grid gap-4"
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
						<form.Field name="email">
							{(field) => (
								<FieldLabel>
									{t("forms.email")}
									<Input
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
						<div className="flex justify-end">
							<Button type="submit">{t("forms.save")}</Button>
						</div>
					</form>
					{notice ? (
						<div className="mt-4">
							<Notice tone="success">{t(notice)}</Notice>
						</div>
					) : null}
					{error ? (
						<div className="mt-4">
							<Notice tone="error">{t(error)}</Notice>
						</div>
					) : null}
				</Card>

				{authContext ? (
					<Card>
						<p className="eyebrow">{t("profile.role")}</p>
						<div className="mt-2 flex flex-wrap items-center gap-2">
							<h2 className="font-display text-2xl tracking-tight">
								{authContext.role.name}
							</h2>
							{authContext.role.isSystem ? (
								<span className="inline-block rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
									{t("roles.systemBadge")}
								</span>
							) : null}
						</div>
						<hr className="rule my-5" />
						<dl className="grid gap-4 text-sm">
							{Object.entries(PERMISSION_GROUPS).map(([group, permissions]) => (
								<div key={group}>
									<dt className="eyebrow text-foreground">
										{t(`roles.permissionGroup.${group}`)}
									</dt>
									<dd>
										<ul className="mt-2 grid gap-1">
											{permissions.map((perm) => {
												const granted = authContext.permissions.includes(perm);
												return (
													<li className="flex items-center gap-2" key={perm}>
														<span
															aria-hidden="true"
															className={
																granted
																	? "inline-block size-1.5 rounded-full bg-success"
																	: "inline-block size-1.5 rounded-full bg-muted-foreground/40"
															}
														/>
														<span
															className={
																granted
																	? "text-foreground"
																	: "text-muted-foreground/70 line-through"
															}
														>
															{t(`permissions.${perm}`)}
														</span>
													</li>
												);
											})}
										</ul>
									</dd>
								</div>
							))}
						</dl>
					</Card>
				) : null}
			</div>
		</div>
	);
}
