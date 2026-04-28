import { useForm } from "@tanstack/react-form";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useRouter,
} from "@tanstack/react-router";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { CopyButton } from "@/components/copy-button";
import {
	AppShell,
	Button,
	Card,
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
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemHeader,
	ItemTitle,
} from "@/components/ui/item";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuthContext } from "@/lib/admin-auth";
import { authClient } from "@/lib/auth-client";
import { getTreaty, unwrap } from "@/lib/eden";
import { createTranslator, defaultLocale, supportedLocales } from "@/lib/i18n";
import type { Permission } from "@/lib/permissions";

export const Route = createFileRoute("/admin")({
	component: Admin,
});

type DashboardData = {
	domains: Array<{
		id: string;
		hostname: string;
		label: string | null;
		isPrimary: boolean;
		isActive: boolean;
		createdAt: number;
	}>;
	events: Array<{
		id: string;
		createdAt: number;
		hostname: string;
		slug: string;
		country: string | null;
		referer: string | null;
		userAgent: string | null;
		userAgentBrowser: string | null;
		userAgentOs: string | null;
		userAgentDeviceType: string | null;
		userAgentIsBot: boolean | null;
	}>;
	invites: Array<{
		id: string;
		email: string;
		inviteUrl: string;
		invitedBy: string | null;
		invitedByName: string | null;
		invitedByEmail: string | null;
		createdAt: number;
		expiresAt: number;
	}>;
	links: Array<{
		id: string;
		hostname: string;
		slug: string;
		targetUrl: string;
		title: string | null;
		notes: string | null;
		statusCode: number;
		preserveQueryParams: boolean;
		isActive: boolean;
		hitCount: number;
		createdAt: number;
		updatedAt: number;
	}>;
	session: {
		user: {
			id: string;
			email: string;
			name: string;
			locale?: string;
		};
	};
	summary: {
		domains: number;
		invites: number;
		links: number;
		redirects: number;
	};
};

type BootstrapState = {
	canBootstrap: boolean;
	hasUsers: boolean;
};

function Admin() {
	const location = useLocation();
	const { data: session } = authClient.useSession();
	const locale =
		(session?.user as { locale?: string } | undefined)?.locale ?? defaultLocale;
	const t = createTranslator(locale);
	const isInviteRoute = location.pathname.startsWith("/admin/invite/");
	const isDashboardRoute =
		location.pathname === "/admin" || location.pathname === "/admin/";
	const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
	const [dashboard, setDashboard] = useState<DashboardData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const { hasPermission, isPending: isAuthContextPending } = useAuthContext();

	async function refresh() {
		setError(null);
		try {
			const api = getTreaty();
			const bootstrapState = await unwrap<BootstrapState>(
				await api.admin.bootstrap.get(),
			);
			setBootstrap(bootstrapState);

			if (session && isDashboardRoute) {
				const nextDashboard = await unwrap<DashboardData>(
					await api.admin.dashboard.get(),
				);
				setDashboard(nextDashboard);
			} else if (!isDashboardRoute) {
				setDashboard(null);
			}
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh is stable within this component; re-fetch when invite-route context toggles, when the dashboard route is (re-)entered, or when the authenticated user identity changes.
	useEffect(() => {
		if (isInviteRoute) {
			return;
		}

		void refresh();
	}, [isInviteRoute, isDashboardRoute, session?.user?.id]);

	if (isInviteRoute) {
		return <Outlet />;
	}

	if (!bootstrap) {
		return (
			<AppShell locale={locale}>
				<TooltipProvider>
					<main className="mx-auto max-w-7xl px-5 py-10">
						<Card>{t("loading.app")}</Card>
					</main>
				</TooltipProvider>
			</AppShell>
		);
	}

	return (
		<AppShell locale={locale}>
			<TooltipProvider>
				<main className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-8">
					{error ? <Notice tone="error">{t(error)}</Notice> : null}
					{!session ? (
						bootstrap.canBootstrap ? (
							<BootstrapForm locale={locale} />
						) : (
							<PasskeyLogin />
						)
					) : !isDashboardRoute ? (
						<Outlet />
					) : isDashboardRoute && isAuthContextPending ? (
						<Card>{t("loading.dashboard")}</Card>
					) : dashboard ? (
						<DashboardView data={dashboard} hasPermission={hasPermission} />
					) : (
						<Card>{t("loading.dashboard")}</Card>
					)}
				</main>
			</TooltipProvider>
		</AppShell>
	);
}

function mapPasskeyError(raw: unknown): string {
	const code =
		typeof raw === "object" && raw !== null && "code" in raw
			? String((raw as { code?: unknown }).code ?? "")
			: "";
	const name =
		raw instanceof Error
			? raw.name
			: typeof raw === "object" && raw !== null && "name" in raw
				? String((raw as { name?: unknown }).name ?? "")
				: "";
	const message =
		raw instanceof Error
			? raw.message
			: typeof raw === "object" && raw !== null && "message" in raw
				? String((raw as { message?: unknown }).message ?? "")
				: "";
	const normalizedCode = code.toUpperCase();
	const normalizedName = name.toUpperCase();

	if (message.startsWith("errors.")) return message;
	if (
		normalizedCode === "PASSKEY_CANCELLED" ||
		normalizedCode === "ERROR_CREDENTIAL_NOT_FOUND" ||
		normalizedName === "NOTALLOWEDERROR" ||
		normalizedName === "ABORTERROR"
	) {
		return "errors.passkeyCancelled";
	}
	if (
		normalizedCode === "PASSKEY_NOT_FOUND" ||
		normalizedCode === "CREDENTIAL_NOT_FOUND" ||
		normalizedCode === "NO_CREDENTIAL" ||
		normalizedName === "INVALIDSTATEERROR"
	) {
		return "errors.passkeyNotFound";
	}
	if (
		normalizedCode === "PASSKEY_NOT_SUPPORTED" ||
		normalizedName === "NOTSUPPORTEDERROR" ||
		normalizedName === "SECURITYERROR"
	) {
		return "errors.passkeyUnsupported";
	}
	return "errors.passkeyVerifyFailed";
}

function PasskeyLogin() {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const t = createTranslator(defaultLocale);

	async function signIn() {
		setBusy(true);
		setError(null);
		try {
			const result = await authClient.signIn.passkey({ autoFill: false });
			if (result?.error) {
				setError(mapPasskeyError(result.error));
				return;
			}
			if (result?.data && !("error" in (result as object) && result.error)) {
				await router.navigate({ to: "/admin" });
				return;
			}
			setError("errors.passkeyVerifyFailed");
		} catch (nextError) {
			setError(mapPasskeyError(nextError));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Card className="mx-auto max-w-2xl p-8">
			<p className="eyebrow text-accent">{t("auth.noPasswords")}</p>
			<h1 className="mt-4 font-display text-4xl tracking-tight">
				{t("auth.signIn")}
			</h1>
			<p className="mt-4 text-muted-foreground">{t("auth.loginHint")}</p>
			<Button className="mt-6" disabled={busy} onClick={signIn} type="button">
				{busy ? t("auth.waiting") : t("auth.signIn")}
			</Button>
			{error ? (
				<div className="mt-4">
					<Notice tone="error">
						<p className="font-bold">{t(error)}</p>
						<p className="mt-1">{t("auth.passkeyRemediation")}</p>
						<div className="mt-3">
							<Button
								disabled={busy}
								onClick={signIn}
								tone="secondary"
								type="button"
							>
								{t("auth.tryAgain")}
							</Button>
						</div>
					</Notice>
				</div>
			) : null}
		</Card>
	);
}

function BootstrapForm({ locale }: { locale: string }) {
	const router = useRouter();
	const t = createTranslator(locale);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: {
			email: "",
			locale,
			name: "",
		},
		onSubmit: async ({ value }) => {
			setBusy(true);
			setError(null);
			try {
				const api = getTreaty();
				const { context } = await unwrap<{ context: string }>(
					await api.admin.onboarding.bootstrap.post(value),
				);
				const result = await authClient.passkey.addPasskey({
					context,
					name: `${value.email} primary passkey`,
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
				setBusy(false);
			}
		},
	});

	return (
		<Card className="mx-auto max-w-3xl p-8">
			<p className="eyebrow text-accent">{t("auth.noPasswords")}</p>
			<h1 className="mt-4 font-display text-4xl tracking-tight">
				{t("auth.bootstrapTitle")}
			</h1>
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
								autoComplete="name"
								onBlur={field.handleBlur}
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
								autoComplete="username webauthn"
								onBlur={field.handleBlur}
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
				<Button disabled={busy} type="submit">
					{busy ? t("auth.waiting") : t("auth.addPasskey")}
				</Button>
			</form>
			{error ? (
				<div className="mt-4">
					<Notice tone="error">{t(error)}</Notice>
				</div>
			) : null}
		</Card>
	);
}

function DashboardView({
	data,
	hasPermission,
}: {
	data: DashboardData;
	hasPermission: (permission: Permission | Permission[]) => boolean;
}) {
	const locale = data.session.user.locale ?? defaultLocale;
	const t = createTranslator(locale);
	const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

	const showLinks = hasPermission("links.read");
	const showLinksWrite = hasPermission("links.write");
	const showDomains = hasPermission("domains.read");
	const showDomainsWrite = hasPermission("domains.write");
	const showInvitesRead = hasPermission("invites.read");
	const showInvitesCreate = hasPermission("invites.create");
	const showAnalytics = hasPermission("analytics.read");

	const dashboardHasContent =
		showLinks || showDomains || showInvitesRead || showAnalytics;

	return (
		<div className="grid gap-6">
			<section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
				<Card variant="feature" className="p-8">
					<p className="eyebrow text-background/70">{t("dashboard.title")}</p>
					<h1 className="mt-3 font-display text-4xl tracking-tight text-background">
						{data.session.user.name}
					</h1>
					<p className="mt-2 text-sm text-background/70">
						{data.session.user.email}
					</p>
					<div className="mt-7 flex flex-wrap gap-2">
						{showLinksWrite ? (
							<ActionLink to="/admin/links/new" tone="invert">
								{t("actions.addLink")}
							</ActionLink>
						) : null}
						{showDomainsWrite ? (
							<ActionLink to="/admin/domains/new" tone="invert">
								{t("actions.addDomain")}
							</ActionLink>
						) : null}
						{showInvitesCreate ? (
							<ActionLink to="/admin/invites/new" tone="invert">
								{t("actions.addInvite")}
							</ActionLink>
						) : null}
					</div>
				</Card>
				<div className="grid gap-4 sm:grid-cols-2">
					{showLinks ? (
						<Stat label={t("dashboard.links")} value={data.summary.links} />
					) : null}
					{showAnalytics ? (
						<Stat
							label={t("dashboard.redirects")}
							value={data.summary.redirects}
						/>
					) : null}
					{showDomains ? (
						<Stat label={t("dashboard.domains")} value={data.summary.domains} />
					) : null}
					{showInvitesRead ? (
						<Stat label={t("dashboard.invites")} value={data.summary.invites} />
					) : null}
				</div>
			</section>

			{!dashboardHasContent ? (
				<Card>
					<p className="text-sm text-muted-foreground">
						{t("errors.permissionDenied")}
					</p>
				</Card>
			) : (
				<>
					{showAnalytics ? (
						<Card>
							<h2 className="font-display text-2xl tracking-tight">
								{t("dashboard.recentRedirects")}
							</h2>
							<RecentRedirectsTable
								events={data.events}
								locale={locale}
								t={t}
							/>
						</Card>
					) : null}

					<section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
						{showLinks ? (
							<Card>
								<div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
									<h2 className="font-display text-2xl tracking-tight">
										{t("dashboard.latestLinks")}
									</h2>
									<div className="flex flex-wrap gap-2">
										<ActionLink to="/admin/links">
											{t("links.viewAll")}
										</ActionLink>
										{showLinksWrite ? (
											<ActionLink to="/admin/links/new" tone="primary">
												{t("actions.addLink")}
											</ActionLink>
										) : null}
									</div>
								</div>
								<ItemGroup className="mt-5 gap-3">
									{data.links.length ? (
										data.links.map((link) => (
											<Item key={link.id} variant="outline">
												<ItemContent className="min-w-0">
													<ItemHeader>
														<ItemTitle>
															<Link
																className="rounded font-mono underline decoration-accent decoration-2 underline-offset-4 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
																params={{ id: link.id }}
																to="/admin/links/$id"
															>
																{link.slug}
															</Link>
														</ItemTitle>
													</ItemHeader>
													<ItemDescription className="break-all">
														{formatHostname(link.hostname, t)} ·{" "}
														{link.targetUrl}
													</ItemDescription>
												</ItemContent>
												<ItemActions className="shrink-0">
													<span className="flex flex-col items-center text-center tabular-nums text-muted-foreground">
														<span className="text-sm font-semibold text-foreground">
															{link.hitCount}
														</span>
														<span className="text-xs leading-none">
															{t("table.hits")}
														</span>
													</span>
													{showLinksWrite ? (
														<ActionLink to={`/admin/links/${link.id}/edit`}>
															{t("forms.update")}
														</ActionLink>
													) : null}
												</ItemActions>
											</Item>
										))
									) : (
										<EmptyState compact description={t("dashboard.noLinks")} />
									)}
								</ItemGroup>
							</Card>
						) : null}

						<div className="grid gap-6">
							{showDomains ? (
								<Card>
									<div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
										<h2 className="font-display text-2xl tracking-tight">
											{t("dashboard.latestDomains")}
										</h2>
										{showDomainsWrite ? (
											<ActionLink to="/admin/domains/new" tone="primary">
												{t("actions.addDomain")}
											</ActionLink>
										) : null}
									</div>
									<ItemGroup className="mt-5 gap-3">
										{data.domains.length ? (
											data.domains.map((domain) => (
												<Item key={domain.id} variant="outline">
													<ItemContent className="min-w-0">
														<ItemHeader>
															<ItemTitle>{domain.hostname}</ItemTitle>
														</ItemHeader>
														<ItemDescription>
															{domain.label ?? t("domains.noLabel")} ·{" "}
															{domain.isPrimary
																? t("domains.primary")
																: t("domains.secondary")}{" "}
															·{" "}
															{domain.isActive
																? t("domains.active")
																: t("domains.inactive")}
														</ItemDescription>
													</ItemContent>
													{showDomainsWrite ? (
														<ItemActions className="shrink-0">
															<ActionLink
																to={`/admin/domains/${domain.id}/edit`}
															>
																{t("forms.update")}
															</ActionLink>
														</ItemActions>
													) : null}
												</Item>
											))
										) : (
											<EmptyState
												compact
												description={t("dashboard.noDomains")}
											/>
										)}
									</ItemGroup>
								</Card>
							) : null}

							{showInvitesRead ? (
								<Card>
									<div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
										<h2 className="font-display text-2xl tracking-tight">
											{t("dashboard.latestInvites")}
										</h2>
										{showInvitesCreate ? (
											<ActionLink to="/admin/invites/new" tone="primary">
												{t("actions.addInvite")}
											</ActionLink>
										) : null}
									</div>
									<ItemGroup className="mt-5 gap-3">
										{data.invites.length ? (
											data.invites.map((invite) => (
												<Item key={invite.id} variant="outline">
													<ItemContent className="min-w-0">
														<ItemHeader>
															<ItemTitle className="break-all">
																{invite.email}
															</ItemTitle>
														</ItemHeader>
														<ItemDescription>
															{t("table.expires")}{" "}
															{new Date(invite.expiresAt).toLocaleDateString(
																locale,
															)}
															{invite.invitedByName ? (
																<>
																	{" "}
																	· {t("users.invitedBy")}{" "}
																	{invite.invitedBy ? (
																		<Link
																			className="rounded underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
																			params={{ id: invite.invitedBy }}
																			to="/admin/access/users/$id"
																		>
																			{invite.invitedByName}
																		</Link>
																	) : (
																		invite.invitedByName
																	)}
																</>
															) : null}
														</ItemDescription>
													</ItemContent>
													<ItemActions className="shrink-0">
														<Tooltip
															open={
																copiedInviteId === invite.id ? true : undefined
															}
														>
															<TooltipTrigger>
																<CopyButton
																	label={t("actions.copyLink")}
																	copiedLabel={t("actions.copied")}
																	onCopied={() => {
																		setCopiedInviteId(invite.id);
																		setTimeout(
																			() => setCopiedInviteId(null),
																			2000,
																		);
																	}}
																	text={invite.inviteUrl}
																/>
															</TooltipTrigger>
															<TooltipContent>
																<p>
																	{copiedInviteId === invite.id
																		? t("actions.copyInviteSuccess")
																		: t("actions.copyInviteLink")}
																</p>
															</TooltipContent>
														</Tooltip>
														{showInvitesCreate ? (
															<ActionLink
																to={`/admin/invites/${invite.id}/edit`}
															>
																{t("forms.update")}
															</ActionLink>
														) : null}
													</ItemActions>
												</Item>
											))
										) : (
											<EmptyState
												compact
												description={t("dashboard.noInvites")}
											/>
										)}
									</ItemGroup>
								</Card>
							) : null}
						</div>
					</section>
				</>
			)}
		</div>
	);
}

function formatHostname(
	hostname: string,
	t: ReturnType<typeof createTranslator>,
) {
	return hostname === "__default__" ? t("domains.default") : hostname;
}

function RecentRedirectsTable({
	events,
	locale,
	t,
}: {
	events: DashboardData["events"];
	locale: string;
	t: ReturnType<typeof createTranslator>;
}) {
	const columns = useMemo<ColumnDef<DashboardData["events"][number]>[]>(
		() => [
			{
				accessorKey: "createdAt",
				header: t("table.when"),
				cell: ({ row }) =>
					new Date(row.original.createdAt).toLocaleString(locale),
			},
			{
				accessorKey: "hostname",
				header: t("table.host"),
				cell: ({ row }) => formatHostname(row.original.hostname, t),
			},
			{
				accessorKey: "slug",
				header: t("table.slug"),
				cell: ({ row }) => (
					<span className="font-medium">{row.original.slug}</span>
				),
			},
			{
				accessorKey: "country",
				header: t("table.country"),
				cell: ({ row }) => row.original.country ?? t("table.direct"),
			},
			{
				accessorKey: "userAgentDeviceType",
				header: t("stats.device"),
				cell: ({ row }) =>
					formatUserAgentValue(row.original.userAgentDeviceType, t),
			},
			{
				accessorKey: "userAgentBrowser",
				header: t("stats.browser"),
				cell: ({ row }) =>
					row.original.userAgentIsBot
						? t("stats.bot")
						: formatUserAgentValue(row.original.userAgentBrowser, t),
			},
			{
				accessorKey: "userAgentOs",
				header: t("stats.os"),
				cell: ({ row }) => formatUserAgentValue(row.original.userAgentOs, t),
			},
			{
				accessorKey: "userAgent",
				header: t("stats.userAgent"),
				cell: ({ row }) => (
					<UserAgentPopover userAgent={row.original.userAgent} t={t} />
				),
			},
			{
				accessorKey: "referer",
				header: t("table.referer"),
				cell: ({ row }) => (
					<span className="block max-w-xs truncate">
						{row.original.referer ?? t("table.direct")}
					</span>
				),
			},
		],
		[locale, t],
	);
	const table = useReactTable({
		data: events,
		columns,
		getCoreRowModel: getCoreRowModel(),
	});

	return (
		<div className="mt-5 overflow-hidden rounded-md border border-border">
			<Table>
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow key={headerGroup.id}>
							{headerGroup.headers.map((header) => (
								<TableHead key={header.id}>
									{header.isPlaceholder
										? null
										: flexRender(
												header.column.columnDef.header,
												header.getContext(),
											)}
								</TableHead>
							))}
						</TableRow>
					))}
				</TableHeader>
				<TableBody>
					{table.getRowModel().rows.length ? (
						table.getRowModel().rows.map((row) => (
							<TableRow key={row.id}>
								{row.getVisibleCells().map((cell) => (
									<TableCell key={cell.id}>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))
					) : (
						<TableRow>
							<TableCell
								className="h-20 text-muted-foreground"
								colSpan={columns.length}
							>
								{t("dashboard.noRedirects")}
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</div>
	);
}

function UserAgentPopover({
	userAgent,
	t,
}: {
	userAgent: string | null;
	t: ReturnType<typeof createTranslator>;
}) {
	if (!userAgent) {
		return <span className="text-muted-foreground">{t("stats.unknown")}</span>;
	}

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					className="h-auto px-0 text-primary underline-offset-4 hover:underline"
					size="sm"
					tone="ghost"
					type="button"
				>
					{t("stats.viewUserAgent")}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
				<PopoverHeader>
					<PopoverTitle>{t("stats.rawUserAgent")}</PopoverTitle>
					<PopoverDescription>
						{t("stats.rawUserAgentDescription")}
					</PopoverDescription>
				</PopoverHeader>
				<p className="max-h-48 overflow-auto break-all rounded-md bg-muted p-2 font-mono text-xs">
					{userAgent}
				</p>
			</PopoverContent>
		</Popover>
	);
}

function formatUserAgentValue(
	value: string | null | undefined,
	t: ReturnType<typeof createTranslator>,
) {
	switch (value) {
		case "bot":
			return t("stats.bot");
		case "desktop":
			return t("stats.device.desktop");
		case "mobile":
			return t("stats.device.mobile");
		case "tablet":
			return t("stats.device.tablet");
		case "unknown":
		case "Unknown":
		case null:
		case undefined:
			return t("stats.unknown");
		default:
			return value;
	}
}

function ActionLink({
	children,
	to,
	tone = "secondary",
}: {
	children: ReactNode;
	to: string;
	tone?: "primary" | "secondary" | "invert";
}) {
	const styles =
		tone === "primary"
			? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
			: tone === "invert"
				? "bg-background/10 text-background border-background/20 hover:bg-background/20"
				: "bg-card text-card-foreground border-border hover:bg-muted";

	return (
		<Link
			className={`inline-flex h-9 items-center justify-center rounded-md border px-3 text-xs font-medium tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${styles}`}
			to={to}
		>
			{children}
		</Link>
	);
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<Card>
			<p className="eyebrow">{label}</p>
			<p className="mt-3 font-display text-4xl tracking-tight tabular-nums">
				{value}
			</p>
		</Card>
	);
}
