import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button, Card, FieldLabel, Input, Notice } from "@/components/ui";
import { useAdminAuthGuard } from "@/lib/admin-auth";
import type {
	AdminApiKey,
	AdminApiKeyList,
	AdminCreatedApiKey,
} from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import type { createTranslator } from "@/lib/i18n";

export const Route = createFileRoute("/admin/api-keys")({
	component: ApiKeys,
});

function ApiKeys() {
	const { session, isPending, t } = useAdminAuthGuard();
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
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	return (
		<div className="mx-auto grid w-full max-w-5xl gap-6">
			<Card>
				<Link
					className="text-sm font-bold text-blue-800 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 dark:text-blue-300 dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-stone-950 rounded"
					to="/admin/profile"
				>
					{t("nav.profile")}
				</Link>
				<h1 className="mt-4 text-4xl font-black">{t("keys.title")}</h1>
				<p className="mt-2 text-stone-700 dark:text-stone-300">
					{t("keys.description")}
				</p>
				<form
					className="mt-6 grid gap-4 md:grid-cols-[1fr_12rem_auto]"
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
					<div className="flex items-end">
						<Button type="submit">{t("keys.create")}</Button>
					</div>
				</form>
				{createdKey ? (
					<div className="mt-4">
						<Notice tone="success">
							<strong>{t("keys.created")}</strong>
							<code className="mt-2 block break-all rounded-xl bg-stone-950 px-3 py-2 text-amber-100 dark:bg-black/40 dark:text-amber-100">
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
				<div className="grid gap-3">
					{keys.length ? (
						keys.map((key) => (
							<ApiKeyRow key={key.id} item={key} onChange={refresh} t={t} />
						))
					) : (
						<p className="rounded-2xl border border-stone-950/10 bg-white/70 p-4 text-sm text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-stone-300">
							{t("keys.empty")}
						</p>
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
		<div className="rounded-2xl border border-stone-950/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
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
					<Button type="submit">{t("forms.save")}</Button>
					<Button
						onClick={() => setEditing(false)}
						tone="secondary"
						type="button"
					>
						{t("forms.cancel")}
					</Button>
				</form>
			) : (
				<div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
					<div>
						<p className="font-black">{item.name ?? t("keys.unnamed")}</p>
						<p className="text-sm text-stone-600 dark:text-stone-300">
							{item.prefix ?? "sl_"}
							{item.start ?? "••••"} ·{" "}
							{item.enabled === false ? t("keys.disabled") : t("keys.enabled")}
						</p>
					</div>
					<div className="flex gap-2">
						<Button
							onClick={() => setEditing(true)}
							tone="secondary"
							type="button"
						>
							{t("keys.edit")}
						</Button>
						<Button
							onClick={async () => {
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
							tone="danger"
							type="button"
						>
							{t("keys.delete")}
						</Button>
					</div>
				</div>
			)}
			{error ? (
				<div className="mt-3">
					<Notice tone="error">{t(error)}</Notice>
				</div>
			) : null}
		</div>
	);
}
