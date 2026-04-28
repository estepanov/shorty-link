import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AccountTabs } from "@/components/account-tabs";
import {
	Button,
	Card,
	DataRow,
	DeleteConfirmationDialog,
	EmptyState,
	FieldLabel,
	Input,
	Notice,
	PageHeader,
} from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type {
	AdminApiKey,
	AdminApiKeyList,
	AdminCreatedApiKey,
} from "@/lib/admin-types";
import { formatApiKeyPreview } from "@/lib/api-keys";
import { getTreaty, unwrap } from "@/lib/eden";
import type { createTranslator } from "@/lib/i18n";

export const Route = createFileRoute("/admin/user/api-keys")({
	component: ApiKeys,
});

function ApiKeys() {
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const { isAuthorized } = useRequirePermission("apikeys.manage");
	const [keys, setKeys] = useState<AdminApiKey[]>([]);
	const [createdKey, setCreatedKey] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: {
			expiresInDays: 30,
			name: "",
		},
		onSubmit: async ({ value }) => {
			try {
				setError(null);
				setCreatedKey(null);
				const api = getTreaty();
				const created = await unwrap<AdminCreatedApiKey>(
					await api.admin["api-keys"].post(value),
				);
				setCreatedKey(created.key ?? null);
				form.reset();
				await refresh();
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});

	async function refresh() {
		try {
			setError(null);
			const api = getTreaty();
			const data = await unwrap<AdminApiKeyList>(
				await api.admin["api-keys"].get({
					query: {
						limit: 100,
						sortBy: "createdAt",
						sortDirection: "desc",
					},
				}),
			);
			setKeys(data.apiKeys);
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh is stable within this component; re-fetch only when the authenticated user identity changes.
	useEffect(() => {
		if (session) {
			void refresh();
		}
	}, [session?.user.id]);

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

	if (!isAuthorized) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Notice tone="error">{t("errors.permissionDenied")}</Notice>
			</div>
		);
	}

	return (
		<div className="mx-auto grid w-full max-w-7xl gap-6">
			<PageHeader title={t("keys.title")} description={t("keys.description")} />
			<AccountTabs locale={locale} />

			<Card>
				<h2 className="font-display text-2xl tracking-tight">
					{t("keys.create")}
				</h2>
				<form
					className="mt-5 grid gap-4 md:grid-cols-[1fr_12rem_auto] md:items-end"
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
					<form.Field name="expiresInDays">
						{(field) => (
							<FieldLabel>
								{t("forms.expiresInDays")}
								<Input
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
					<Button type="submit">{t("keys.create")}</Button>
				</form>
				{createdKey ? (
					<div className="mt-4">
						<Notice tone="success">
							<strong className="block">{t("keys.created")}</strong>
							<code className="mt-2 block break-all rounded-md border border-border bg-foreground px-3 py-2 font-mono text-xs text-background">
								{createdKey}
							</code>
						</Notice>
					</div>
				) : null}
				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
			</Card>

			<Card>
				<h2 className="font-display text-2xl tracking-tight">
					{t("keys.title")}
				</h2>
				<div className="mt-5 grid gap-3">
					{keys.length ? (
						keys.map((key) => (
							<ApiKeyRow item={key} key={key.id} onChange={refresh} t={t} />
						))
					) : (
						<EmptyState description={t("keys.empty")} />
					)}
				</div>
			</Card>
		</div>
	);
}

function ApiKeyRow({
	item,
	onChange,
	t,
}: {
	item: AdminApiKey;
	onChange: () => Promise<void>;
	t: ReturnType<typeof createTranslator>;
}) {
	const [editing, setEditing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: {
			name: item.name ?? "",
		},
		onSubmit: async ({ value }) => {
			try {
				setError(null);
				const api = getTreaty();
				await unwrap(
					await api.admin["api-keys"]({ id: item.id }).patch({
						name: value.name,
					}),
				);
				setEditing(false);
				await onChange();
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});

	return (
		<DataRow>
			{editing ? (
				<form
					className="flex flex-col gap-3 md:flex-row"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field name="name">
						{(field) => (
							<Input
								aria-label={t("keys.nameAria")}
								onChange={(event) => field.handleChange(event.target.value)}
								value={field.state.value}
							/>
						)}
					</form.Field>
					<Button size="sm" type="submit">
						{t("forms.save")}
					</Button>
					<Button
						onClick={() => setEditing(false)}
						size="sm"
						tone="secondary"
						type="button"
					>
						{t("forms.cancel")}
					</Button>
				</form>
			) : (
				<div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
					<div className="min-w-0">
						<p className="font-medium">{item.name ?? t("keys.unnamed")}</p>
						<p className="mt-1 font-mono text-xs text-muted-foreground">
							{formatApiKeyPreview(item)}{" "}
							<span
								className={`ml-2 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
									item.enabled === false
										? "border-destructive/30 bg-destructive/10 text-destructive"
										: "border-success/30 bg-success/10 text-success"
								}`}
							>
								{item.enabled === false
									? t("keys.disabled")
									: t("keys.enabled")}
							</span>
						</p>
					</div>
					<div className="flex gap-2">
						<Button
							onClick={() => setEditing(true)}
							size="sm"
							tone="secondary"
							type="button"
						>
							{t("keys.edit")}
						</Button>
						<DeleteConfirmationDialog
							title={t("forms.confirmDelete")}
							description={t("forms.confirmDeleteDescription")}
							confirmLabel={t("forms.delete")}
							cancelLabel={t("forms.cancel")}
							onConfirm={async () => {
								try {
									setError(null);
									const api = getTreaty();
									await unwrap(
										await api.admin["api-keys"]({ id: item.id }).delete(),
									);
									await onChange();
								} catch (nextError) {
									setError(
										nextError instanceof Error
											? nextError.message
											: "errors.unknown",
									);
								}
							}}
						>
							<Button size="sm" tone="danger" type="button">
								{t("keys.delete")}
							</Button>
						</DeleteConfirmationDialog>
					</div>
				</div>
			)}
			{error ? (
				<div className="mt-3">
					<Notice tone="error">{t(error)}</Notice>
				</div>
			) : null}
		</DataRow>
	);
}
