import { useForm } from "@tanstack/react-form";
import { useEffect, useState } from "react";

import {
	Button,
	FieldLabel,
	Input,
	Notice,
	Select,
	TextArea,
} from "@/components/ui";
import type { AdminDomain, AdminLink, AssignableRole } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import type { createTranslator } from "@/lib/i18n";
import {
	normalizeRedirectStatusCode,
	redirectStatusOptions,
} from "@/lib/redirect-status";

export type CreatedInvite = {
	id: string;
	inviteUrl: string;
	token: string;
};

export function LinkForm({
	domains,
	initialLink,
	onSaved,
	t,
}: {
	domains: AdminDomain[];
	initialLink?: AdminLink | null;
	onSaved: () => Promise<void> | void;
	t: ReturnType<typeof createTranslator>;
}) {
	const [error, setError] = useState<string | null>(null);
	const selectedHostname =
		initialLink?.hostname === "__default__"
			? ""
			: (initialLink?.hostname ?? "");
	const hasSelectedManagedHostname = domains.some(
		(domain) => domain.hostname === selectedHostname,
	);
	const form = useForm({
		defaultValues: {
			hostname: selectedHostname,
			isActive: initialLink?.isActive ?? true,
			notes: initialLink?.notes ?? "",
			preserveQueryParams: initialLink?.preserveQueryParams ?? false,
			slug: initialLink?.slug ?? "",
			statusCode: normalizeRedirectStatusCode(initialLink?.statusCode),
			targetUrl: initialLink?.targetUrl ?? "",
			title: initialLink?.title ?? "",
		},
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const api = getTreaty();
				if (initialLink) {
					await unwrap(
						await api.admin.links({ id: initialLink.id }).patch(value),
					);
				} else {
					await unwrap(await api.admin.links.post(value));
				}
				await onSaved();
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: form.reset is stable; re-seed defaults only when the edited link identity changes.
	useEffect(() => {
		form.reset({
			hostname:
				initialLink?.hostname === "__default__"
					? ""
					: (initialLink?.hostname ?? ""),
			isActive: initialLink?.isActive ?? true,
			notes: initialLink?.notes ?? "",
			preserveQueryParams: initialLink?.preserveQueryParams ?? false,
			slug: initialLink?.slug ?? "",
			statusCode: normalizeRedirectStatusCode(initialLink?.statusCode),
			targetUrl: initialLink?.targetUrl ?? "",
			title: initialLink?.title ?? "",
		});
	}, [initialLink?.id]);

	return (
		<form
			className="mt-6 grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<div className="grid gap-4 md:grid-cols-2">
				<form.Field name="hostname">
					{(field) => (
						<FieldLabel>
							{t("forms.hostname")}
							<Select
								onChange={(event) => field.handleChange(event.target.value)}
								value={field.state.value}
							>
								<option value="">{t("domains.default")}</option>
								{selectedHostname && !hasSelectedManagedHostname ? (
									<option value={selectedHostname}>
										{selectedHostname} ({t("domains.current")})
									</option>
								) : null}
								{domains.map((domain) => (
									<option key={domain.id} value={domain.hostname}>
										{domain.hostname}
										{domain.label ? ` - ${domain.label}` : ""}
									</option>
								))}
							</Select>
						</FieldLabel>
					)}
				</form.Field>
				<form.Field name="statusCode">
					{(field) => (
						<FieldLabel>
							{t("forms.statusCode")}
							<Select
								onChange={(event) =>
									field.handleChange(
										normalizeRedirectStatusCode(Number(event.target.value)),
									)
								}
								value={field.state.value}
							>
								{redirectStatusOptions.map((option) => (
									<option key={option.code} value={option.code}>
										{t(option.labelKey)}
									</option>
								))}
							</Select>
							<p className="text-xs font-normal text-muted-foreground/80">
								{t("forms.statusCodeHelp")}
							</p>
						</FieldLabel>
					)}
				</form.Field>
			</div>
			<form.Field name="targetUrl">
				{(field) => (
					<FieldLabel>
						{t("forms.destination")}
						<Input
							onChange={(event) => field.handleChange(event.target.value)}
							placeholder={t("forms.placeholderDestination")}
							required
							value={field.state.value}
						/>
					</FieldLabel>
				)}
			</form.Field>
			<form.Field name="slug">
				{(field) => (
					<FieldLabel>
						{t("forms.slug")}
						<Input
							onChange={(event) => field.handleChange(event.target.value)}
							placeholder={t("forms.placeholderSlug")}
							value={field.state.value}
						/>
					</FieldLabel>
				)}
			</form.Field>
			<div className="grid gap-4 md:grid-cols-2">
				<form.Field name="title">
					{(field) => (
						<FieldLabel>
							{t("forms.title")}
							<Input
								onChange={(event) => field.handleChange(event.target.value)}
								value={field.state.value}
							/>
						</FieldLabel>
					)}
				</form.Field>
				<form.Field name="notes">
					{(field) => (
						<FieldLabel>
							{t("forms.notes")}
							<TextArea
								onChange={(event) => field.handleChange(event.target.value)}
								value={field.state.value}
							/>
						</FieldLabel>
					)}
				</form.Field>
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<form.Field name="preserveQueryParams">
					{(field) => (
						<label className="flex items-center gap-3 rounded-md bg-foreground/5 p-3 text-sm font-bold ">
							<input
								checked={field.state.value}
								onChange={(event) => field.handleChange(event.target.checked)}
								type="checkbox"
							/>
							{t("forms.preserveQuery")}
						</label>
					)}
				</form.Field>
				<form.Field name="isActive">
					{(field) => (
						<label className="flex items-center gap-3 rounded-md bg-foreground/5 p-3 text-sm font-bold ">
							<input
								checked={field.state.value}
								onChange={(event) => field.handleChange(event.target.checked)}
								type="checkbox"
							/>
							{t("forms.active")}
						</label>
					)}
				</form.Field>
			</div>
			<Button type="submit">
				{initialLink ? t("forms.update") : t("forms.create")}
			</Button>
			{error ? <Notice tone="error">{t(error)}</Notice> : null}
		</form>
	);
}

export function DomainForm({
	initialDomain,
	onSaved,
	t,
}: {
	initialDomain?: AdminDomain | null;
	onSaved: () => Promise<void> | void;
	t: ReturnType<typeof createTranslator>;
}) {
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: {
			hostname: initialDomain?.hostname ?? "",
			isActive: initialDomain?.isActive ?? true,
			isPrimary: initialDomain?.isPrimary ?? false,
			label: initialDomain?.label ?? "",
		},
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const api = getTreaty();
				if (initialDomain) {
					await unwrap(
						await api.admin.domains({ id: initialDomain.id }).patch(value),
					);
				} else {
					await unwrap(await api.admin.domains.post(value));
				}
				await onSaved();
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: form.reset is stable; re-seed defaults only when the edited domain identity changes.
	useEffect(() => {
		form.reset({
			hostname: initialDomain?.hostname ?? "",
			isActive: initialDomain?.isActive ?? true,
			isPrimary: initialDomain?.isPrimary ?? false,
			label: initialDomain?.label ?? "",
		});
	}, [initialDomain?.id]);

	return (
		<form
			className="mt-6 grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="hostname">
				{(field) => (
					<FieldLabel>
						{t("forms.hostname")}
						<Input
							onChange={(event) => field.handleChange(event.target.value)}
							placeholder={t("forms.placeholderHostname")}
							required
							value={field.state.value}
						/>
					</FieldLabel>
				)}
			</form.Field>
			<form.Field name="label">
				{(field) => (
					<FieldLabel>
						{t("forms.label")}
						<Input
							onChange={(event) => field.handleChange(event.target.value)}
							value={field.state.value}
						/>
					</FieldLabel>
				)}
			</form.Field>
			<div className="grid gap-3 sm:grid-cols-2">
				<form.Field name="isPrimary">
					{(field) => (
						<label className="flex items-center gap-3 rounded-md bg-foreground/5 p-3 text-sm font-bold ">
							<input
								checked={field.state.value}
								onChange={(event) => field.handleChange(event.target.checked)}
								type="checkbox"
							/>
							{t("forms.primary")}
						</label>
					)}
				</form.Field>
				<form.Field name="isActive">
					{(field) => (
						<label className="flex items-center gap-3 rounded-md bg-foreground/5 p-3 text-sm font-bold ">
							<input
								checked={field.state.value}
								onChange={(event) => field.handleChange(event.target.checked)}
								type="checkbox"
							/>
							{t("forms.active")}
						</label>
					)}
				</form.Field>
			</div>
			<Button type="submit">
				{initialDomain ? t("forms.update") : t("forms.create")}
			</Button>
			{error ? <Notice tone="error">{t(error)}</Notice> : null}
		</form>
	);
}

export function InviteForm({
	onSaved,
	roles,
	t,
}: {
	onSaved: (invite: CreatedInvite) => Promise<void> | void;
	roles: AssignableRole[];
	t: ReturnType<typeof createTranslator>;
}) {
	const [error, setError] = useState<string | null>(null);
	const defaultRoleId =
		roles.find((role) => role.id === "system_admin")?.id ?? roles[0]?.id ?? "";
	const form = useForm({
		defaultValues: {
			email: "",
			expiresInDays: 7,
			roleId: defaultRoleId,
		},
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const api = getTreaty();
				const invite = await unwrap<CreatedInvite>(
					await api.admin.invites.post(value),
				);
				form.reset();
				await onSaved(invite);
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});

	return (
		<form
			className="mt-6 grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
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
			<form.Field name="roleId">
				{(field) => (
					<FieldLabel>
						{t("users.role")}
						<Select
							onChange={(event) => field.handleChange(event.target.value)}
							value={field.state.value}
						>
							{roles.map((role) => (
								<option key={role.id} value={role.id}>
									{role.name}
								</option>
							))}
						</Select>
					</FieldLabel>
				)}
			</form.Field>
			<form.Field name="expiresInDays">
				{(field) => (
					<FieldLabel>
						{t("forms.expiresInDays")}
						<Input
							max={30}
							min={1}
							onChange={(event) =>
								field.handleChange(Number(event.target.value))
							}
							type="number"
							value={field.state.value}
						/>
					</FieldLabel>
				)}
			</form.Field>
			<Button type="submit">{t("forms.create")}</Button>
			{error ? <Notice tone="error">{t(error)}</Notice> : null}
		</form>
	);
}
