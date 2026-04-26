import { useForm } from "@tanstack/react-form";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
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
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import type {
	AdminUser,
	AssignableRole,
	UserListData,
} from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/access/users")({
	component: UsersTab,
});

type UserFilters = {
	active: "all" | "active" | "inactive";
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
	const isUsersListRoute =
		location.pathname === "/admin/access/users" ||
		location.pathname === "/admin/access/users/";
	const [roles, setRoles] = useState<AssignableRole[]>([]);
	const [data, setData] = useState<UserListData | null>(null);
	const [filters, setFilters] = useState<UserFilters>(defaultFilters);
	const [page, setPage] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: filters,
		onSubmit: ({ value }) => {
			setFilters(value);
			setPage(1);
		},
	});

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
	}, [session?.user.id, filters, page, isUsersListRoute]);

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
								setFilters(defaultFilters);
								setPage(1);
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
					<p className="text-sm font-bold text-muted-foreground">
						{t("users.showing")} {firstItem}-{lastItem} {t("users.of")}{" "}
						{data?.total ?? 0}
					</p>
					<div className="flex gap-2">
						<Button
							disabled={!data || data.page <= 1}
							onClick={() => setPage((value) => Math.max(1, value - 1))}
							tone="secondary"
							type="button"
						>
							{t("users.previous")}
						</Button>
						<Button
							disabled={!data || data.page >= data.totalPages}
							onClick={() =>
								setPage((value) =>
									Math.min(data?.totalPages ?? value, value + 1),
								)
							}
							tone="secondary"
							type="button"
						>
							{t("users.next")}
						</Button>
					</div>
				</div>
				<div className="mt-5 grid gap-3">
					{data?.items.map((u: AdminUser) => (
						<UserRow
							key={u.id}
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
	locale,
	onRefresh,
	roles,
	setError,
	t,
	user: u,
}: {
	locale: string;
	onRefresh: () => Promise<void>;
	roles: AssignableRole[];
	setError: (message: string | null) => void;
	t: ReturnType<typeof import("@/lib/i18n").createTranslator>;
	user: AdminUser;
}) {
	const [editing, setEditing] = useState(false);
	const [pendingRoleId, setPendingRoleId] = useState(u.roleId);

	return (
		<DataRow>
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
								{roles.length > 0 ? (
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
				<div className="flex gap-2">
					<Button
						className="!rounded-xl !px-3 !py-1.5 !text-xs"
						onClick={async () => {
							setError(null);
							try {
								const api = getTreaty();
								await unwrap(
									await api.admin.users({ id: u.id }).patch({
										isActive: !u.isActive,
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
						tone="secondary"
						type="button"
					>
						{u.isActive ? t("users.disable") : t("users.enable")}
					</Button>
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
							tone="danger"
							type="button"
						>
							{t("users.delete")}
						</Button>
					</DeleteConfirmationDialog>
				</div>
			</div>
		</DataRow>
	);
}
