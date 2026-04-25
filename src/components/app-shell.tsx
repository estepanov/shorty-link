import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { useAuthContext } from "@/lib/admin-auth";
import { authClient } from "@/lib/auth-client";
import { getTreaty, unwrap } from "@/lib/eden";
import { createTranslator, type Locale, type MessageKey } from "@/lib/i18n";

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
		<div className="min-h-screen text-stone-950 transition-colors ">
			<header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5">
				<Link
					to="/"
					className="group inline-flex items-center gap-3 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 "
				>
					<span className="grid size-11 place-items-center rounded-2xl bg-stone-950 text-lg font-black text-background shadow-[6px_6px_0_#f97316] dark:bg-amber-200 dark:text-stone-950 dark:shadow-[6px_6px_0_#1d4ed8]">
						sl
					</span>
					<span className="text-xl font-black tracking-tight">
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
							<div className="hidden items-center sm:flex">
								<HeaderLink to="/admin">{t("nav.dashboard")}</HeaderLink>
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
									<HeaderLink to="/admin/access">{t("nav.access")}</HeaderLink>
								) : null}
								<HeaderLink to="/admin/profile">{t("nav.profile")}</HeaderLink>
							</div>
							<button
								type="button"
								onClick={handleSignOut}
								className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-stone-800 dark:hover:text-amber-50 "
							>
								{t("nav.signOut")}
							</button>
						</>
					) : (
						<HeaderLink to="/admin">{t("nav.signIn")}</HeaderLink>
					)}
				</nav>
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
			className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-card text-sm font-medium text-stone-700 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:text-background dark:hover:bg-stone-800 "
			onClick={handleToggle}
			title={label}
			type="button"
		>
			<span className="sr-only">{label}</span>
			<span aria-hidden="true">{theme === "dark" ? "☾" : "☀"}</span>
		</button>
	);
}

function HeaderLink({ children, to }: { children: ReactNode; to: string }) {
	return (
		<Link
			to={to}
			className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-stone-800 dark:hover:text-amber-50 "
		>
			{children}
		</Link>
	);
}

export function message(
	t: ReturnType<typeof createTranslator>,
	key: MessageKey | string,
) {
	return t(key);
}
