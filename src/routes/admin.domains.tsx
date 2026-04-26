import { useForm } from "@tanstack/react-form";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	Button,
	Card,
	DataRow,
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
import type { AdminDomain } from "@/lib/admin-types";
import { getTreaty, unwrap } from "@/lib/eden";
import type { createTranslator } from "@/lib/i18n";

export const Route = createFileRoute("/admin/domains")({
	component: DomainList,
});

type DomainFilters = {
	active: "all" | "active" | "inactive";
	pageSize: number;
	search: string;
};

const defaultFilters: DomainFilters = {
	active: "all",
	pageSize: 25,
	search: "",
};

function DomainList() {
	const location = useLocation();
	const { session, isPending, t } = useAdminAuthGuard();
	const [allDomains, setAllDomains] = useState<AdminDomain[]>([]);
	const [filters, setFilters] = useState<DomainFilters>(defaultFilters);
	const [page, setPage] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const isDomainListRoute =
		location.pathname === "/admin/domains" ||
		location.pathname === "/admin/domains/";
	const { hasPermission } = useAuthContext();
	const canWriteDomains = hasPermission("domains.write");
	const form = useForm({
		defaultValues: filters,
		onSubmit: ({ value }) => {
			setFilters(value);
			setPage(1);
		},
	});

	useEffect(() => {
		if (!session || !isDomainListRoute) {
			return;
		}

		async function refresh() {
			setError(null);
			try {
				const api = getTreaty();
				const domains = await unwrap<AdminDomain[]>(
					await api.admin.domains.get(),
				);
				setAllDomains(domains);
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		}

		void refresh();
	}, [isDomainListRoute, session?.user.id]);

	if (!isDomainListRoute) {
		return <Outlet />;
	}

	if (isPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	let visibleDomains = allDomains;

	if (filters.search) {
		const searchLower = filters.search.toLowerCase();
		visibleDomains = visibleDomains.filter(
			(d) =>
				d.hostname.toLowerCase().includes(searchLower) ||
				(d.label?.toLowerCase().includes(searchLower) ?? false),
		);
	}

	if (filters.active === "active") {
		visibleDomains = visibleDomains.filter((d) => d.isActive);
	} else if (filters.active === "inactive") {
		visibleDomains = visibleDomains.filter((d) => !d.isActive);
	}

	const total = visibleDomains.length;
	const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
	const safePage = Math.min(page, totalPages);
	const paginated = visibleDomains.slice(
		(safePage - 1) * filters.pageSize,
		safePage * filters.pageSize,
	);
	const firstItem = total > 0 ? (safePage - 1) * filters.pageSize + 1 : 0;
	const lastItem = Math.min(safePage * filters.pageSize, total);

	return (
		<div className="mx-auto grid w-full max-w-7xl gap-6">
			<Card>
				<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
					<div>
						<h1 className="text-4xl font-medium">{t("domains.title")}</h1>
					</div>
					{canWriteDomains ? (
						<Link
							className="inline-flex items-center justify-center rounded-md border border-primary bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
							to="/admin/domains/new"
						>
							{t("actions.addDomain")}
						</Link>
					) : null}
				</div>

				<form
					className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_0.8fr_0.8fr_auto]"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field name="search">
						{(field) => (
							<FieldLabel htmlFor="domains-search">
								{t("domains.search")}
								<Input
									id="domains-search"
									onChange={(event) => field.handleChange(event.target.value)}
									value={field.state.value}
								/>
							</FieldLabel>
						)}
					</form.Field>
					<form.Field name="active">
						{(field) => (
							<FieldLabel htmlFor="domains-active">
								{t("forms.active")}
								<Select
									onValueChange={(val) =>
										field.handleChange(val as DomainFilters["active"])
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
							<FieldLabel htmlFor="domains-page-size">
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
						{t("domains.showing")} {firstItem}-{lastItem} {t("links.of")}{" "}
						{total}
					</p>
					<div className="flex gap-2">
						<Button
							disabled={safePage <= 1}
							onClick={() => setPage((value) => Math.max(1, value - 1))}
							tone="secondary"
							type="button"
						>
							{t("links.previous")}
						</Button>
						<Button
							disabled={safePage >= totalPages}
							onClick={() =>
								setPage((value) => Math.min(totalPages, value + 1))
							}
							tone="secondary"
							type="button"
						>
							{t("links.next")}
						</Button>
					</div>
				</div>
				<div className="mt-5 grid gap-3">
					{paginated.map((domain) => (
						<DomainRow
							key={domain.id}
							domain={domain}
							t={t}
							canWrite={canWriteDomains}
						/>
					))}
					{!paginated.length ? (
						<EmptyState description={t("dashboard.noDomains")} />
					) : null}
				</div>
			</Card>
		</div>
	);
}

function DomainRow({
	domain,
	t,
	canWrite,
}: {
	domain: AdminDomain;
	t: ReturnType<typeof createTranslator>;
	canWrite: boolean;
}) {
	return (
		<DataRow>
			<div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-medium text-foreground">
							{domain.hostname}
						</span>
						{domain.isPrimary ? (
							<span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
								{t("domains.primary")}
							</span>
						) : null}
						<StatusBadge
							label={
								domain.isActive ? t("domains.active") : t("domains.inactive")
							}
							variant={domain.isActive ? "green" : "stone"}
						/>
					</div>
					{domain.label ? (
						<div className="mt-2 text-sm text-muted-foreground">
							{domain.label}
						</div>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{canWrite ? (
						<Link
							className="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
							params={{ id: domain.id }}
							to="/admin/domains/$id/edit"
						>
							{t("forms.update")}
						</Link>
					) : null}
				</div>
			</div>
		</DataRow>
	);
}

function StatusBadge({
	label,
	variant,
}: {
	label: string;
	variant: "green" | "stone";
}) {
	const variants = {
		green:
			"bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100",
		stone: "bg-muted text-muted-foreground",
	} as const;

	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${variants[variant]}`}
		>
			{label}
		</span>
	);
}
