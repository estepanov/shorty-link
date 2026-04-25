import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	Button,
	Card,
	FieldLabel,
	Input,
	Notice,
	Select,
} from "@/components/ui";
import { useAdminAuthGuard, useAuthContext } from "@/lib/admin-auth";
import { getTreaty, unwrap } from "@/lib/eden";
import { supportedLocales } from "@/lib/i18n";
import { PERMISSION_GROUPS } from "@/lib/permissions";

export const Route = createFileRoute("/admin/profile")({
	component: Profile,
});

function Profile() {
	const { session, isPending, locale, refetch, t } = useAdminAuthGuard();
	const { authContext, hasPermission } = useAuthContext();
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
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	return (
		<div className="mx-auto w-full max-w-3xl">
			<Card>
				<h1 className="text-4xl font-medium">{t("profile.title")}</h1>
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
					<Button type="submit">{t("forms.save")}</Button>
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
				{authContext ? (
					<div className="mt-8 border-t border-border pt-6">
						<h2 className="text-xl font-medium">{authContext.role.name}</h2>
						{authContext.role.isSystem ? (
							<span className="mt-1 inline-block rounded-lg border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
								{t("roles.systemBadge")}
							</span>
						) : null}
						<ul className="mt-4 grid gap-1 text-sm">
							{Object.entries(PERMISSION_GROUPS).map(([group, permissions]) => (
								<li key={group}>
									<span className="font-bold text-muted-foreground">
										{t(`roles.permissionGroup.${group}`)}
									</span>
									<ul className="ml-4 list-disc text-muted-foreground/80">
										{permissions.map((perm) => (
											<li key={perm}>
												<span
													className={
														authContext.permissions.includes(perm)
															? ""
															: "line-through opacity-40"
													}
												>
													{t(`permissions.${perm}`)}
												</span>
											</li>
										))}
									</ul>
								</li>
							))}
						</ul>
					</div>
				) : null}
				{(hasPermission("sessions.manage") ||
					hasPermission("apikeys.manage")) && (
					<div className="mt-8 flex flex-wrap gap-3 border-t border-border pt-6">
						{hasPermission("sessions.manage") ? (
							<Link
								className="text-sm font-bold text-accent underline decoration-accent decoration-2 underline-offset-4 hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
								to="/admin/sessions"
							>
								{t("nav.sessions")}
							</Link>
						) : null}
						{hasPermission("apikeys.manage") ? (
							<Link
								className="text-sm font-bold text-accent underline decoration-accent decoration-2 underline-offset-4 hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
								to="/admin/api-keys"
							>
								{t("nav.apiKeys")}
							</Link>
						) : null}
					</div>
				)}
			</Card>
		</div>
	);
}
