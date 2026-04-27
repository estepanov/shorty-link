import { useForm } from "@tanstack/react-form";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DataPagination } from "@/components/data-pagination";
import {
	Button,
	Card,
	DataRow,
	DeleteConfirmationDialog,
	EmptyState,
	FieldLabel,
	Input,
	Notice,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui";
import { useAdminAuthGuard, useAuthContext } from "@/lib/admin-auth";
import type { AdminRoleList } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

type RoleSearch = {
	page?: number;
	pageSize?: number;
	search?: string;
};

function validateRolesSearch(search: Record<string, unknown>): RoleSearch {
	const out: RoleSearch = {};
	const pageRaw = Number(search.page);
	if (Number.isFinite(pageRaw) && pageRaw > 1) out.page = Math.floor(pageRaw);
	const sizeRaw = Number(search.pageSize);
	if (Number.isFinite(sizeRaw) && sizeRaw > 0 && sizeRaw !== 25) {
		out.pageSize = Math.floor(sizeRaw);
	}
	if (search.search != null && search.search !== "") {
		out.search = String(search.search);
	}
	return out;
}

export const Route = createFileRoute("/admin/access/roles")({
	component: RolesTab,
	validateSearch: validateRolesSearch,
});

type RoleFilters = {
	pageSize: number;
	search: string;
};

const defaultFilters: RoleFilters = {
	pageSize: 25,
	search: "",
};

function RolesTab() {
	const location = useLocation();
	const router = useRouter();
	const { session, isPending, t } = useAdminAuthGuard();
	const { hasPermission } = useAuthContext();
	const isRolesListRoute =
		location.pathname === "/admin/access/roles" ||
		location.pathname === "/admin/access/roles/";
	const [data, setData] = useState<AdminRoleList | null>(null);
	const search = Route.useSearch();
	const page = search.page ?? 1;
	const filters: RoleFilters = {
		pageSize: search.pageSize ?? defaultFilters.pageSize,
		search: search.search ?? defaultFilters.search,
	};
	const navigate = useNavigate({ from: Route.fullPath });
	const setPage = (next: number) =>
		void navigate({
			search: (prev) => ({ ...prev, page: next > 1 ? next : undefined }),
		});
	const applyFilters = (values: RoleFilters) =>
		void navigate({
			search: () => ({
				pageSize:
					values.pageSize !== defaultFilters.pageSize
						? values.pageSize
						: undefined,
				search: values.search || undefined,
			}),
		});
	const resetFilters = () => void navigate({ search: () => ({}) });
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: filters,
		onSubmit: ({ value }) => applyFilters(value),
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: sync form draft when URL filters change (back/forward).
	useEffect(() => {
		form.reset(filters);
	}, [filters.pageSize, filters.search]);

	async function refresh() {
		setError(null);
		try {
			const api = getTreaty();
			const nextData = await unwrap<AdminRoleList>(
				await api.admin.roles.get({
					query: {
						page,
						pageSize: filters.pageSize,
						search: filters.search,
					},
				}),
			);
			setData(nextData);
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refetch when URL search or session changes.
	useEffect(() => {
		if (session && isRolesListRoute) {
			void refresh();
		}
	}, [
		session?.user.id,
		filters.pageSize,
		filters.search,
		page,
		isRolesListRoute,
	]);

	if (!isRolesListRoute) {
		return <Outlet />;
	}

	if (isPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	if (!hasPermission("roles.read")) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	async function deleteRole(roleId: string) {
		setError(null);
		try {
			const api = getTreaty();
			await unwrap(await api.admin.roles({ id: roleId }).delete());
			await refresh();
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	const firstItem =
		data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
	const lastItem = data ? Math.min(data.page * data.pageSize, data.total) : 0;

	return (
		<div className="grid gap-6">
			<Card>
				<div className="flex flex-col justify-between gap-3 sm:flex-row">
					<div className="flex flex-col gap-2 max-w-xl">
						<h2 className="text-2xl font-medium">{t("roles.title")}</h2>
						<p className="text-sm text-muted-foreground">
							{t("roles.description")}
						</p>
					</div>
					{hasPermission("roles.create") ? (
						<div>
							<Link
								className="inline-flex shrink-0 items-center justify-center rounded-md border border-primary bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
								to="/admin/roles/new"
							>
								{t("roles.create")}
							</Link>
						</div>
					) : null}
				</div>

				<form
					className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.8fr_auto]"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field name="search">
						{(field) => (
							<FieldLabel>
								{t("roles.search")}
								<Input
									onChange={(event) => field.handleChange(event.target.value)}
									value={field.state.value}
								/>
							</FieldLabel>
						)}
					</form.Field>
					<form.Field name="pageSize">
						{(field) => (
							<FieldLabel>
								{t("links.pageSize")}
								<Select
									onValueChange={(val) => field.handleChange(Number(val))}
									value={String(field.state.value)}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{[10, 25, 50, 100].map((size) => (
											<SelectItem key={size} value={String(size)}>
												{size}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</FieldLabel>
						)}
					</form.Field>
					<div className="flex items-end gap-2">
						<Button type="submit">{t("forms.apply")}</Button>
						<Button
							onClick={() => {
								form.reset(defaultFilters);
								resetFilters();
							}}
							tone="secondary"
							type="button"
						>
							{t("forms.reset")}
						</Button>
					</div>
				</form>

				{error ? (
					<div className="mt-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
			</Card>

			<Card>
				<div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
					<p className="shrink-0 text-sm font-bold text-muted-foreground">
						{t("roles.showing")} {firstItem}-{lastItem} {t("roles.of")}{" "}
						{data?.total ?? 0}
					</p>
					<DataPagination
						page={data?.page ?? page}
						totalPages={data?.totalPages ?? 1}
						onPageChange={setPage}
						disabled={!data}
						previousLabel={t("roles.previous")}
						nextLabel={t("roles.next")}
					/>
				</div>
				<div className="mt-5 grid gap-3">
					{data?.items.length ? (
						data.items.map((role) => (
							<DataRow key={role.id}>
								<div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
									<div className="flex-1">
										<p className="font-medium">
											<Link
												className="text-accent underline underline-offset-4 dark:text-accent"
												params={{ id: role.id }}
												to="/admin/access/roles/$id"
											>
												{role.name}
											</Link>
											{role.isSystem ? (
												<span className="ml-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
													{t("roles.systemBadge")}
												</span>
											) : null}
										</p>
										{role.description ? (
											<p className="mt-1 text-sm text-muted-foreground">
												{role.description}
											</p>
										) : null}
										<p className="mt-2 text-xs text-muted-foreground/80">
											{t("roles.permissionsCount").replace(
												"{{count}}",
												String(role.permissions.length),
											)}{" "}
											·{" "}
											{role.domainScopeCount === 0 && role.linkScopeCount === 0
												? t("roles.unrestricted")
												: `${t("roles.scopeDomains")}: ${role.domainScopeCount}, ${t("roles.scopeLinks")}: ${role.linkScopeCount}`}{" "}
											·{" "}
											{role.pendingInviteCount > 0
												? `${t("roles.pendingInvites").replace("{{count}}", String(role.pendingInviteCount))} · `
												: ""}
											{t("roles.usersCount").replace(
												"{{count}}",
												String(role.userCount),
											)}
										</p>
									</div>
									<div className="flex gap-2">
										{!role.isSystem && hasPermission("roles.update") ? (
											<Link params={{ id: role.id }} to="/admin/roles/$id/edit">
												<Button tone="secondary" type="button">
													{t("roles.edit")}
												</Button>
											</Link>
										) : null}
										{hasPermission("roles.delete") ? (
											<DeleteConfirmationDialog
												title={t("forms.confirmDelete")}
												description={t("forms.confirmDeleteDescription")}
												confirmLabel={t("forms.delete")}
												cancelLabel={t("forms.cancel")}
												onConfirm={() => deleteRole(role.id)}
											>
												<Button
													disabled={
														role.isSystem ||
														role.userCount > 0 ||
														role.pendingInviteCount > 0
													}
													tone="danger"
													type="button"
												>
													{t("roles.delete")}
												</Button>
											</DeleteConfirmationDialog>
										) : null}
									</div>
								</div>
							</DataRow>
						))
					) : (
						<EmptyState description={t("roles.empty")} />
					)}
				</div>
			</Card>
		</div>
	);
}
