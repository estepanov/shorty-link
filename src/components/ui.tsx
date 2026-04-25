import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { useAuthContext } from "@/lib/admin-auth";
import { authClient } from "@/lib/auth-client";
import { getTreaty, unwrap } from "@/lib/eden";
import { createTranslator, type Locale, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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
	const { hasPermission } = useAuthContext();

	async function handleSignOut() {
		const api = getTreaty();
		await unwrap(await api.admin.sessions.current.delete());
		window.location.href = "/";
	}

	const showLinks = hasPermission("links.read");
	const showDomains = hasPermission("domains.read");
	const showAccess =
		hasPermission("users.read") ||
		hasPermission("invites.manage") ||
		hasPermission("sessions.manage") ||
		hasPermission("apikeys.manage") ||
		hasPermission("roles.manage");

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
								<div className="hidden items-center gap-0.5 sm:flex">
									<HeaderLink to="/admin" activeOptions={{ exact: true }}>
										{t("nav.dashboard")}
									</HeaderLink>
									{showLinks ? (
										<HeaderLink to="/admin/links">
											{t("nav.shortLinks")}
										</HeaderLink>
									) : null}
									{showDomains ? (
										<HeaderLink to="/admin/domains">
											{t("nav.domains")}
										</HeaderLink>
									) : null}
									{showAccess ? (
										<HeaderLink to="/admin/access">
											{t("nav.access")}
										</HeaderLink>
									) : null}
									<HeaderLink to="/admin/profile">
										{t("nav.profile")}
									</HeaderLink>
								</div>
								<button
									type="button"
									onClick={handleSignOut}
									className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
								>
									{t("nav.signOut")}
								</button>
							</>
						) : (
							<HeaderLink to="/admin">{t("nav.signIn")}</HeaderLink>
						)}
					</nav>
				</div>
			</header>
			{children}
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
			className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
		>
			{children}
		</Link>
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
		default: "bg-card text-card-foreground border-border",
		feature:
			"bg-foreground text-background border-foreground shadow-[0_24px_60px_-20px_color-mix(in_oklab,var(--foreground)_45%,transparent)]",
		muted: "bg-muted text-foreground border-transparent",
	} as const;

	return (
		<section
			className={cn(
				"rounded-xl border p-6 transition-colors",
				variants[variant],
				className,
			)}
		>
			{children}
		</section>
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
	const tones: Record<ButtonTone, string> = {
		primary:
			"bg-primary text-primary-foreground border-primary hover:bg-primary/90",
		secondary: "bg-card text-card-foreground border-border hover:bg-muted",
		danger:
			"bg-destructive text-destructive-foreground border-destructive hover:bg-destructive/90",
		ghost: "bg-transparent text-foreground border-transparent hover:bg-muted",
		accent: "bg-accent text-accent-foreground border-accent hover:bg-accent/90",
	};

	const sizes: Record<ButtonSize, string> = {
		sm: "h-8 px-3 text-xs gap-1.5",
		md: "h-10 px-4 text-sm gap-2",
		lg: "h-11 px-5 text-sm gap-2",
	};

	return (
		<button
			{...props}
			className={cn(
				"inline-flex items-center justify-center rounded-md border font-medium tracking-tight transition-all",
				"disabled:cursor-not-allowed disabled:opacity-60",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
				"active:translate-y-px",
				tones[tone],
				sizes[size],
				className,
			)}
		>
			{children}
		</button>
	);
}

/* -------------------------------------------------------------------------- */
/*  Form fields                                                               */
/* -------------------------------------------------------------------------- */

const fieldBase =
	"w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input {...props} className={cn(fieldBase, "h-10", props.className)} />
	);
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
	return (
		<select
			{...props}
			className={cn(fieldBase, "h-10 pr-8", props.className)}
		/>
	);
}

export function TextArea(
	props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
	return (
		<textarea
			{...props}
			className={cn(fieldBase, "min-h-28 py-2.5", props.className)}
		/>
	);
}

export function FieldLabel({
	children,
	htmlFor,
}: {
	children: ReactNode;
	htmlFor?: string;
}) {
	return (
		<label
			className="grid gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground [&_input]:normal-case [&_select]:normal-case [&_textarea]:normal-case"
			htmlFor={htmlFor}
		>
			{children}
		</label>
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
	const tones = {
		info: "border-info/30 bg-info/10 text-info",
		error: "border-destructive/30 bg-destructive/10 text-destructive",
		success: "border-success/30 bg-success/10 text-success",
	} as const;

	return (
		<div
			role={tone === "error" ? "alert" : "status"}
			className={cn(
				"rounded-md border px-4 py-3 text-sm leading-relaxed",
				tones[tone],
			)}
		>
			{children}
		</div>
	);
}

export function message(
	t: ReturnType<typeof createTranslator>,
	key: MessageKey | string,
) {
	return t(key);
}
