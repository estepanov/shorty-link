import { useForm } from "@tanstack/react-form";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

function PencilIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			viewBox="0 0 24 24"
		>
			<path d="m18 2 4 4-13 13H5v-4z" />
			<path d="m14.5 5.5 4 4" />
		</svg>
	);
}

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
	Switch,
} from "@/components/ui";
import {
	useAdminAuthGuard,
	useAuthContext,
	useRequirePermission,
} from "@/lib/admin-auth";
import type {
	AdminUser,
	AssignableRole,
	UserListData,
} from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import { cn } from "@/lib/utils";

type UserActive = "all" | "active" | "inactive";

type UserSearch = {
	page?: number;
	pageSize?: number;
	search?: string;
	active?: Exclude<UserActive, "all">;
};

const userActiveValues: UserActive[] = ["all", "active", "inactive"];

function validateUsersSearch(search: Record<string, unknown>): UserSearch {
	const out: UserSearch = {};
	const pageRaw = Number(search.page);
	if (Number.isFinite(pageRaw) && pageRaw > 1) out.page = Math.floor(pageRaw);
	const sizeRaw = Number(search.pageSize);
	if (Number.isFinite(sizeRaw) && sizeRaw > 0 && sizeRaw !== 25) {
		out.pageSize = Math.floor(sizeRaw);
	}
	if (search.search != null && search.search !== "") {
		out.search = String(search.search);
	}
	if (
		typeof search.active === "string" &&
		(userActiveValues as string[]).includes(search.active) &&
		search.active !== "all"
	) {
		out.active = search.active as Exclude<UserActive, "all">;
	}
	return out;
}

export const Route = createFileRoute("/admin/access/users")({
	component: UsersTab,
	validateSearch: validateUsersSearch,
});

type UserFilters = {
	active: UserActive;
	pageSize: number;
	search: string;
};

const defaultFilters: UserFilters = {
	active: "all",
	pageSize: 25,
	search: "",
};

function UsersTab() {
	const location = useLocation();
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const { isAuthorized } = useRequirePermission("users.read");
	const { hasPermission } = useAuthContext();
	const canWriteUsers = hasPermission("users.write");
	const canDeleteUsers = hasPermission("users.delete");
	const isUsersListRoute =
		location.pathname === "/admin/access/users" ||
		location.pathname === "/admin/access/users/";
	const [roles, setRoles] = useState<AssignableRole[]>([]);
	const [data, setData] = useState<UserListData | null>(null);
	const search = Route.useSearch();
	const page = search.page ?? 1;
	const filters: UserFilters = {
		active: search.active ?? defaultFilters.active,
		pageSize: search.pageSize ?? defaultFilters.pageSize,
		search: search.search ?? defaultFilters.search,
	};
	const navigate = useNavigate({ from: Route.fullPath });
	const setPage = (next: number) =>
		void navigate({
			search: (prev) => ({ ...prev, page: next > 1 ? next : undefined }),
		});
	const applyFilters = (values: UserFilters) =>
		void navigate({
			search: () => ({
				active: values.active !== "all" ? values.active : undefined,
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
	}, [filters.active, filters.pageSize, filters.search]);

	async function refresh() {
		setError(null);
		try {
			const api = getTreaty();
			const [nextData, nextRoles] = await Promise.all([
				unwrap<UserListData>(
					await api.admin.users.get({
						query: {
							active: filters.active,
							page,
							pageSize: filters.pageSize,
							search: filters.search,
						},
					}),
				),
				unwrap<AssignableRole[]>(await api.admin.roles.assignable.get()),
			]);
			setData(nextData);
			setRoles(nextRoles);
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh stable; refetch when session identity or filters change.
	useEffect(() => {
		if (session && isUsersListRoute) {
			void refresh();
		}
	}, [
		session?.user.id,
		filters.active,
		filters.pageSize,
		filters.search,
		page,
		isUsersListRoute,
	]);

	if (!isUsersListRoute) {
		return <Outlet />;
	}

	if (isPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	if (!isAuthorized) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	const firstItem =
		data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
	const lastItem = data ? Math.min(data.page * data.pageSize, data.total) : 0;

	return (
		<div className="grid gap-6">
			<Card>
				<form
					className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr_0.8fr_auto]"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field name="search">
						{(field) => (
							<FieldLabel>
								{t("users.search")}
								<Input
									onChange={(event) => field.handleChange(event.target.value)}
									value={field.state.value}
								/>
							</FieldLabel>
						)}
					</form.Field>
					<form.Field name="active">
						{(field) => (
							<FieldLabel>
								{t("forms.active")}
								<Select
									onValueChange={(val) =>
										field.handleChange(val as UserFilters["active"])
									}
									value={field.state.value}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">{t("links.allStates")}</SelectItem>
										<SelectItem value="active">
											{t("links.activeOnly")}
										</SelectItem>
										<SelectItem value="inactive">
											{t("links.inactiveOnly")}
										</SelectItem>
									</SelectContent>
								</Select>
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
						{t("users.showing")} {firstItem}-{lastItem} {t("users.of")}{" "}
						{data?.total ?? 0}
					</p>
					<DataPagination
						page={data?.page ?? page}
						totalPages={data?.totalPages ?? 1}
						onPageChange={setPage}
						disabled={!data}
						previousLabel={t("users.previous")}
						nextLabel={t("users.next")}
					/>
				</div>
				<div className="mt-5 grid gap-3">
					{data?.items.map((u: AdminUser) => (
						<UserRow
							key={u.id}
							canDeleteUsers={canDeleteUsers}
							canWriteUsers={canWriteUsers}
							currentUserId={session.user.id}
							locale={locale}
							onRefresh={refresh}
							roles={roles}
							setError={setError}
							t={t}
							user={u}
						/>
					))}
					{!data?.items.length ? (
						<EmptyState description={t("users.emptyActive")} />
					) : null}
				</div>
			</Card>
		</div>
	);
}

function UserRow({
	canDeleteUsers,
	canWriteUsers,
	currentUserId,
	locale,
	onRefresh,
	roles,
	setError,
	t,
	user: u,
}: {
	canDeleteUsers: boolean;
	canWriteUsers: boolean;
	currentUserId: string;
	locale: string;
	onRefresh: () => Promise<void>;
	roles: AssignableRole[];
	setError: (message: string | null) => void;
	t: ReturnType<typeof import("@/lib/i18n").createTranslator>;
	user: AdminUser;
}) {
	const [editing, setEditing] = useState(false);
	const [pendingRoleId, setPendingRoleId] = useState(u.roleId);
	const isSelf = u.id === currentUserId;

	return (
		<DataRow className={isSelf ? "!border-accent/20 !bg-accent/5" : undefined}>
			<div className="flex flex-col justify-between gap-2 md:flex-row md:items-start">
				<div className="flex-1">
					<Link
						className="font-medium text-accent underline decoration-accent decoration-2 underline-offset-4 hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
						params={{ id: u.id }}
						to="/admin/access/users/$id"
					>
						{u.name}
					</Link>{" "}
					<span className="text-sm text-muted-foreground">({u.email})</span>
					{isSelf ? (
						<span className="ml-1.5 inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent align-middle">
							{t("users.you")}
						</span>
					) : null}
					<p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
						{editing && roles.length > 0 ? (
							<>
								<Select
									onValueChange={(val) => {
										setPendingRoleId(val);
									}}
									value={pendingRoleId}
								>
									<SelectTrigger className="w-auto">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{roles.map((role) => (
											<SelectItem key={role.id} value={role.id}>
												{role.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									className="!rounded-xl !px-2.5 !py-1.5 !text-xs"
									onClick={async () => {
										if (pendingRoleId === u.roleId) {
											setEditing(false);
											return;
										}
										setError(null);
										try {
											const api = getTreaty();
											await unwrap(
												await api.admin
													.users({ id: u.id })
													.role.patch({ roleId: pendingRoleId }),
											);
											await onRefresh();
											setEditing(false);
										} catch (nextError) {
											setError(
												nextError instanceof Error
													? nextError.message
													: "errors.unknown",
											);
										}
									}}
									type="button"
								>
									{t("forms.save")}
								</Button>
								<Button
									className="!rounded-xl !border-transparent !bg-transparent !px-2.5 !py-1.5 !text-xs hover:!bg-muted"
									onClick={() => {
										setEditing(false);
										setPendingRoleId(u.roleId);
									}}
									tone="secondary"
									type="button"
								>
									{t("forms.cancel")}
								</Button>
							</>
						) : (
							<>
								<span className="font-bold">{u.roleName}</span>
								{roles.length > 0 && canWriteUsers ? (
									<Button
										className="!rounded-md !border-transparent !bg-transparent !p-1 !h-auto !text-muted-foreground hover:!text-foreground hover:!bg-muted"
										onClick={() => {
											setPendingRoleId(u.roleId);
											setEditing(true);
										}}
										tone="secondary"
										type="button"
									>
										<PencilIcon className="size-3.5" />
									</Button>
								) : null}
							</>
						)}
						<span>·</span>
						<span>{u.locale}</span>
						<span>·</span>
						<span>{new Date(u.createdAt).toLocaleDateString(locale)}</span>
					</p>
				</div>
				<div className="flex items-center gap-3">
					<label className="flex items-center gap-2">
						<Switch
							aria-label={u.isActive ? t("users.disable") : t("users.enable")}
							checked={u.isActive}
							disabled={isSelf || !canWriteUsers}
							onCheckedChange={async (checked) => {
								setError(null);
								try {
									const api = getTreaty();
									await unwrap(
										await api.admin.users({ id: u.id }).patch({
											isActive: checked,
										}),
									);
									await onRefresh();
								} catch (nextError) {
									setError(
										nextError instanceof Error
											? nextError.message
											: "errors.unknown",
									);
								}
							}}
						/>
						<span
							className={cn(
								"text-xs font-medium tracking-tight",
								u.isActive ? "text-success" : "text-muted-foreground",
							)}
						>
							{u.isActive ? t("users.statusActive") : t("users.statusInactive")}
						</span>
					</label>
					{canDeleteUsers ? (
						<DeleteConfirmationDialog
							title={t("forms.confirmDelete")}
							description={t("forms.confirmDeleteDescription")}
							confirmLabel={t("forms.delete")}
							cancelLabel={t("forms.cancel")}
							onConfirm={async () => {
								setError(null);
								try {
									const api = getTreaty();
									await unwrap(await api.admin.users({ id: u.id }).delete());
									await onRefresh();
								} catch (nextError) {
									setError(
										nextError instanceof Error
											? nextError.message
											: "errors.unknown",
									);
								}
							}}
						>
							<Button
								className="!rounded-xl !px-3 !py-1.5 !text-xs"
								disabled={isSelf}
								tone="danger"
								type="button"
							>
								{t("users.delete")}
							</Button>
						</DeleteConfirmationDialog>
					) : null}
				</div>
			</div>
		</DataRow>
	);
}
