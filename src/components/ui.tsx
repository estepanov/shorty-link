import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { Alert as ShadcnAlert } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button as ShadcnButton } from "@/components/ui/button";
import { Card as ShadcnCard } from "@/components/ui/card";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Label as ShadcnLabel } from "@/components/ui/label";
import { Textarea as ShadcnTextarea } from "@/components/ui/textarea";
import { useAuthContext } from "@/lib/admin-auth";
import { authClient } from "@/lib/auth-client";
import { getTreaty, unwrap } from "@/lib/eden";
import { createTranslator, type Locale, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Re-exports                                                                */
/* -------------------------------------------------------------------------- */

export { MultiCombobox } from "@/components/ui/multi-combobox";
export {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

/* -------------------------------------------------------------------------- */
/*  Theme                                                                     */
/* -------------------------------------------------------------------------- */

type Theme = "light" | "dark";

const themeStorageKey = "shorty-link-theme";

function getStoredTheme(): Theme | null {
	try {
		const stored = window.localStorage.getItem(themeStorageKey);
		return stored === "light" || stored === "dark" ? stored : null;
	} catch {
		return null;
	}
}

function setStoredTheme(theme: Theme) {
	try {
		window.localStorage.setItem(themeStorageKey, theme);
	} catch {}
}

function getPreferredTheme(): Theme {
	if (typeof window === "undefined") {
		return "light";
	}

	const stored = getStoredTheme();
	if (stored) {
		return stored;
	}

	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function applyTheme(theme: Theme) {
	document.documentElement.classList.toggle("dark", theme === "dark");
	document.documentElement.style.colorScheme = theme;
}

export function useText(locale?: string | null) {
	return createTranslator(locale);
}

/* -------------------------------------------------------------------------- */
/*  AppShell                                                                  */
/* -------------------------------------------------------------------------- */

export function AppShell({
	children,
	locale,
}: {
	children: ReactNode;
	locale?: Locale | string | null;
}) {
	const t = useText(locale);
	const { data: session, isPending } = authClient.useSession();
	const { hasPermission, isPending: isAuthContextPending } = useAuthContext();
	const location = useLocation();
	const [menuOpen, setMenuOpen] = useState(false);

	async function handleSignOut() {
		const api = getTreaty();
		await unwrap(await api.admin.sessions.current.delete());
		window.location.href = "/";
	}

	const showLinks = !isAuthContextPending && hasPermission("links.read");
	const showDomains = !isAuthContextPending && hasPermission("domains.read");
	const showAccess =
		!isAuthContextPending &&
		(hasPermission("users.read") ||
			hasPermission("invites.read") ||
			hasPermission("sessions.manage") ||
			hasPermission("apikeys.manage") ||
			hasPermission("roles.read"));

	// Close mobile menu on navigation.
	// biome-ignore lint/correctness/useExhaustiveDependencies: path reset state
	useEffect(() => {
		setMenuOpen(false);
	}, [location.pathname]);

	// Close on Escape; lock body scroll while open.
	useEffect(() => {
		if (!menuOpen) return;
		function onKey(event: KeyboardEvent) {
			if (event.key === "Escape") setMenuOpen(false);
		}
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
			document.body.style.overflow = previousOverflow;
		};
	}, [menuOpen]);

	const navLinks = session ? (
		<>
			<HeaderLink to="/admin" activeOptions={{ exact: true }}>
				{t("nav.dashboard")}
			</HeaderLink>
			{showLinks ? (
				<HeaderLink to="/admin/links">{t("nav.shortLinks")}</HeaderLink>
			) : null}
			{showDomains ? (
				<HeaderLink to="/admin/domains">{t("nav.domains")}</HeaderLink>
			) : null}
			{showAccess ? (
				<HeaderLink to="/admin/access">{t("nav.access")}</HeaderLink>
			) : null}
			<HeaderLink to="/admin/user">{t("nav.profile")}</HeaderLink>
		</>
	) : null;

	return (
		<div className="min-h-screen text-foreground">
			<header className="sticky top-0 z-30 border-b border-border/70 bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/55">
				<div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-4">
					<Link
						to="/"
						className="group inline-flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					>
						<span
							aria-hidden="true"
							className="grid size-9 place-items-center rounded-md border border-border bg-foreground font-display text-sm font-medium text-background shadow-sm"
						>
							s/
						</span>
						<span className="font-display text-xl tracking-tight">
							{t("app.name")}
						</span>
					</Link>
					<nav
						aria-label={t("nav.label")}
						className="flex items-center gap-1 sm:gap-2"
					>
						<ThemeToggle t={t} />
						{isPending ? null : session ? (
							<>
								<div className="hidden items-center gap-0.5 md:flex">
									{navLinks}
								</div>
								<button
									type="button"
									onClick={handleSignOut}
									className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:inline-flex"
								>
									{t("nav.signOut")}
								</button>
								<MenuToggle
									open={menuOpen}
									onToggle={() => setMenuOpen((prev) => !prev)}
									label={menuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
								/>
							</>
						) : (
							<HeaderLink to="/admin">{t("nav.signIn")}</HeaderLink>
						)}
					</nav>
				</div>
			</header>
			{session ? (
				<MobileMenu
					open={menuOpen}
					onDismiss={() => setMenuOpen(false)}
					onSignOut={handleSignOut}
					signOutLabel={t("nav.signOut")}
					navLabel={t("nav.label")}
				>
					{navLinks}
				</MobileMenu>
			) : null}
			{children}
		</div>
	);
}

function MenuToggle({
	open,
	onToggle,
	label,
}: {
	open: boolean;
	onToggle: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-expanded={open}
			aria-controls="app-mobile-menu"
			onClick={onToggle}
			className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-card-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:hidden"
		>
			<span className="sr-only">{label}</span>
			<svg
				aria-hidden="true"
				className="size-4"
				fill="none"
				stroke="currentColor"
				strokeWidth={1.75}
				strokeLinecap="round"
				strokeLinejoin="round"
				viewBox="0 0 24 24"
			>
				{open ? (
					<>
						<path d="M6 6l12 12" />
						<path d="M18 6L6 18" />
					</>
				) : (
					<>
						<path d="M3 7h18" />
						<path d="M3 12h18" />
						<path d="M3 17h18" />
					</>
				)}
			</svg>
		</button>
	);
}

function MobileMenu({
	open,
	onDismiss,
	onSignOut,
	signOutLabel,
	navLabel,
	children,
}: {
	open: boolean;
	onDismiss: () => void;
	onSignOut: () => void | Promise<void>;
	signOutLabel: string;
	navLabel: string;
	children: ReactNode;
}) {
	return (
		<div
			id="app-mobile-menu"
			className={cn(
				"fixed inset-0 z-40 md:hidden",
				open ? "pointer-events-auto" : "pointer-events-none",
			)}
			aria-hidden={!open}
		>
			<button
				type="button"
				tabIndex={open ? 0 : -1}
				aria-label="Dismiss menu"
				onClick={onDismiss}
				className={cn(
					"absolute inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-200",
					open ? "opacity-100" : "opacity-0",
				)}
			/>
			<nav
				aria-label={navLabel}
				className={cn(
					"absolute inset-x-3 top-[calc(4rem+0.5rem)] origin-top rounded-xl border border-border bg-card p-3 shadow-lg transition-all duration-200",
					open
						? "translate-y-0 opacity-100 scale-100"
						: "-translate-y-2 opacity-0 scale-[0.98]",
				)}
			>
				<div className="grid gap-0.5">{children}</div>
				<hr className="rule my-3" />
				<button
					type="button"
					onClick={() => {
						void onSignOut();
					}}
					className="inline-flex w-full items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
				>
					<span>{signOutLabel}</span>
					<svg
						aria-hidden="true"
						className="size-4"
						fill="none"
						stroke="currentColor"
						strokeWidth={1.75}
						strokeLinecap="round"
						strokeLinejoin="round"
						viewBox="0 0 24 24"
					>
						<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
						<path d="M16 17l5-5-5-5" />
						<path d="M21 12H9" />
					</svg>
				</button>
			</nav>
		</div>
	);
}

function ThemeToggle({ t }: { t: ReturnType<typeof createTranslator> }) {
	const [theme, setTheme] = useState<Theme>("light");
	const label = theme === "dark" ? t("theme.useLight") : t("theme.useDark");

	useEffect(() => {
		setTheme(getPreferredTheme());

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		function handleChange(event: MediaQueryListEvent) {
			if (getStoredTheme()) {
				return;
			}

			const nextTheme = event.matches ? "dark" : "light";
			setTheme(nextTheme);
			applyTheme(nextTheme);
		}

		media.addEventListener("change", handleChange);
		return () => media.removeEventListener("change", handleChange);
	}, []);

	function handleToggle() {
		const nextTheme = theme === "dark" ? "light" : "dark";
		setStoredTheme(nextTheme);
		applyTheme(nextTheme);
		setTheme(nextTheme);
	}

	return (
		<button
			aria-label={label}
			className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-sm text-card-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
			onClick={handleToggle}
			title={label}
			type="button"
		>
			<span className="sr-only">{label}</span>
			<span aria-hidden="true">{theme === "dark" ? "☾" : "☀"}</span>
		</button>
	);
}

function HeaderLink({
	children,
	to,
	activeOptions,
}: {
	children: ReactNode;
	to: string;
	activeOptions?: { exact?: boolean };
}) {
	return (
		<Link
			to={to}
			activeProps={{
				className: "text-foreground bg-muted",
			}}
			activeOptions={activeOptions ?? { exact: false }}
			className="block rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:py-2"
		>
			{children}
		</Link>
	);
}

/* -------------------------------------------------------------------------- */
/*  Tabs                                                                      */
/* -------------------------------------------------------------------------- */

export type TabItem = {
	to: string;
	label: ReactNode;
	exact?: boolean;
};

export function Tabs({
	items,
	ariaLabel,
	className,
}: {
	items: TabItem[];
	ariaLabel?: string;
	className?: string;
}) {
	if (items.length === 0) return null;
	return (
		<nav
			aria-label={ariaLabel}
			className={cn("-mx-1 overflow-x-auto px-1", className)}
		>
			<div
				role="tablist"
				className="inline-flex w-fit min-w-full gap-1 rounded-md border border-border bg-card/60 p-1"
			>
				{items.map((tab) => (
					<Link
						key={tab.to}
						to={tab.to}
						role="tab"
						activeOptions={{ exact: tab.exact ?? true }}
						activeProps={{
							className:
								"bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground shadow-sm",
							"aria-selected": "true",
						}}
						inactiveProps={{ "aria-selected": "false" }}
						className="whitespace-nowrap rounded-sm px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					>
						{tab.label}
					</Link>
				))}
			</div>
		</nav>
	);
}

/* -------------------------------------------------------------------------- */
/*  PageHeader                                                                */
/* -------------------------------------------------------------------------- */

export function PageHeader({
	title,
	description,
	actions,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<Card>
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div className="min-w-0 flex-1">
					<h1 className="font-display text-4xl tracking-tight">{title}</h1>
					{description ? (
						<p className="mt-2 max-w-2xl text-muted-foreground">
							{description}
						</p>
					) : null}
				</div>
				{actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
			</div>
		</Card>
	);
}

/* -------------------------------------------------------------------------- */
/*  DataRow                                                                   */
/* -------------------------------------------------------------------------- */

export function DataRow({
	children,
	className,
	tone = "default",
	...rest
}: React.HTMLAttributes<HTMLDivElement> & {
	tone?: "default" | "muted";
}) {
	const tones = {
		default: "border-border bg-card/60",
		muted: "border-transparent bg-muted/40",
	} as const;

	return (
		<div
			{...rest}
			className={cn(
				"rounded-md border p-4 transition-colors",
				tones[tone],
				className,
			)}
		>
			{children}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*  EmptyState                                                                */
/* -------------------------------------------------------------------------- */

export function EmptyState({
	title,
	description,
	action,
	compact = false,
	className,
}: {
	title?: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	compact?: boolean;
	className?: string;
}) {
	const isText = description == null && action == null && title != null;

	return (
		<div
			role="status"
			className={cn(
				"rounded-md border border-border bg-card/60 text-muted-foreground",
				compact ? "p-4 text-sm" : "p-8 text-center",
				isText && !compact ? "text-sm" : null,
				className,
			)}
		>
			{title ? (
				<p
					className={cn(
						isText ? "" : "font-display text-lg tracking-tight text-foreground",
					)}
				>
					{title}
				</p>
			) : null}
			{description ? (
				<p className={cn("mx-auto max-w-md text-sm", title ? "mt-1.5" : "")}>
					{description}
				</p>
			) : null}
			{action ? (
				<div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>
			) : null}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*  Card                                                                      */
/* -------------------------------------------------------------------------- */

export function Card({
	children,
	className = "",
	variant = "default",
}: {
	children: ReactNode;
	className?: string;
	variant?: "default" | "feature" | "muted";
}) {
	const variants = {
		default: "",
		feature:
			"bg-foreground text-background border-foreground shadow-[0_24px_60px_-20px_color-mix(in_oklab,var(--foreground)_45%,transparent)]",
		muted: "bg-muted text-foreground border-transparent",
	} as const;

	return (
		<ShadcnCard
			className={cn(
				"rounded-xl border p-6 transition-colors",
				variants[variant],
				className,
			)}
		>
			{children}
		</ShadcnCard>
	);
}

/* -------------------------------------------------------------------------- */
/*  Button                                                                    */
/* -------------------------------------------------------------------------- */

type ButtonTone = "primary" | "secondary" | "danger" | "ghost" | "accent";
type ButtonSize = "sm" | "md" | "lg";

export function Button({
	children,
	tone = "primary",
	size = "md",
	className,
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
	tone?: ButtonTone;
	size?: ButtonSize;
}) {
	const variantMap: Record<
		ButtonTone,
		React.ComponentProps<typeof ShadcnButton>["variant"]
	> = {
		primary: "default",
		secondary: "outline",
		danger: "destructive",
		ghost: "ghost",
		accent: "default",
	};

	const sizeMap: Record<
		ButtonSize,
		React.ComponentProps<typeof ShadcnButton>["size"]
	> = {
		sm: "sm",
		md: "default",
		lg: "lg",
	};

	const toneClasses: Record<ButtonTone, string> = {
		primary: "",
		secondary: "",
		danger: "",
		ghost: "",
		accent: "bg-accent text-accent-foreground hover:bg-accent/90",
	};

	const sizeClasses: Record<ButtonSize, string> = {
		sm: "h-8 px-3 text-xs gap-1.5",
		md: "h-10 px-4 text-sm gap-2",
		lg: "h-11 px-5 text-sm gap-2",
	};

	return (
		<ShadcnButton
			{...props}
			variant={variantMap[tone]}
			size={sizeMap[size]}
			className={cn(
				"rounded-md font-medium tracking-tight active:translate-y-px",
				toneClasses[tone],
				sizeClasses[size],
				className,
			)}
		>
			{children}
		</ShadcnButton>
	);
}

/* -------------------------------------------------------------------------- */
/*  Form fields                                                               */
/* -------------------------------------------------------------------------- */

export function Input(props: React.ComponentProps<typeof ShadcnInput>) {
	return <ShadcnInput {...props} />;
}

export function TextArea(props: React.ComponentProps<typeof ShadcnTextarea>) {
	return <ShadcnTextarea {...props} />;
}

export function FieldLabel({
	children,
	htmlFor,
}: {
	children: ReactNode;
	htmlFor?: string;
}) {
	return (
		<ShadcnLabel
			className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground **:data-[slot=select-trigger]:w-full [&_input]:normal-case [&_select]:normal-case [&_textarea]:normal-case"
			htmlFor={htmlFor}
		>
			{children}
		</ShadcnLabel>
	);
}

/* -------------------------------------------------------------------------- */
/*  Notice                                                                    */
/* -------------------------------------------------------------------------- */

export function Notice({
	children,
	tone = "info",
}: {
	children: ReactNode;
	tone?: "info" | "error" | "success";
}) {
	if (tone === "error") {
		return (
			<ShadcnAlert
				variant="destructive"
				className="rounded-md border px-4 py-3 text-sm leading-relaxed"
			>
				{children}
			</ShadcnAlert>
		);
	}

	const tones = {
		info: "border-info/30 bg-info/10 text-info",
		success: "border-success/30 bg-success/10 text-success",
	} as const;

	return (
		<div
			role="status"
			className={cn(
				"rounded-md border px-4 py-3 text-sm leading-relaxed",
				tones[tone],
			)}
		>
			{children}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*  DeleteConfirmationDialog                                                  */
/* -------------------------------------------------------------------------- */

export function DeleteConfirmationDialog({
	children,
	title,
	description,
	confirmLabel,
	cancelLabel,
	onConfirm,
	confirmTone = "danger",
}: {
	children: React.ReactNode;
	title: React.ReactNode;
	description?: React.ReactNode;
	confirmLabel: React.ReactNode;
	cancelLabel: React.ReactNode;
	onConfirm: () => void | Promise<void>;
	confirmTone?: "danger" | "primary";
}) {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					{description ? (
						<AlertDialogDescription>{description}</AlertDialogDescription>
					) : null}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							void onConfirm();
						}}
						variant={confirmTone === "danger" ? "destructive" : "default"}
					>
						{confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function message(
	t: ReturnType<typeof createTranslator>,
	key: MessageKey | string,
) {
	return t(key);
}
