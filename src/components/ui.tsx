import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

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

	async function handleSignOut() {
		const api = getTreaty();
		await unwrap(await api.admin.sessions.current.delete());
		window.location.href = "/";
	}

	return (
		<div className="min-h-screen text-stone-950 transition-colors dark:text-amber-50">
			<header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5">
				<Link
					to="/"
					className="group inline-flex items-center gap-3 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-stone-950"
				>
					<span className="grid size-11 place-items-center rounded-2xl bg-stone-950 text-lg font-black text-amber-100 shadow-[6px_6px_0_#f97316] dark:bg-amber-200 dark:text-stone-950 dark:shadow-[6px_6px_0_#1d4ed8]">
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
								<HeaderLink to="/admin/links">{t("nav.shortLinks")}</HeaderLink>
								<HeaderLink to="/admin/users">{t("nav.access")}</HeaderLink>
								<HeaderLink to="/admin/profile">{t("nav.profile")}</HeaderLink>
							</div>
							<button
								type="button"
								onClick={handleSignOut}
								className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-amber-50 dark:focus-visible:ring-white dark:focus-visible:ring-offset-stone-950"
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
			className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-sm font-medium text-stone-700 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-amber-100 dark:hover:bg-stone-800 dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-stone-950"
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
			className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-amber-50 dark:focus-visible:ring-white dark:focus-visible:ring-offset-stone-950"
		>
			{children}
		</Link>
	);
}

export function Card({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<section
			className={`rounded-[2rem] border border-stone-950/10 bg-white/70 p-6 shadow-[0_24px_80px_rgba(29,27,22,0.10)] backdrop-blur dark:border-white/10 dark:bg-stone-950/70 dark:shadow-[0_24px_80px_rgba(0,0,0,0.30)] ${className}`}
		>
			{children}
		</section>
	);
}

export function Button({
	children,
	tone = "primary",
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
	tone?: "primary" | "secondary" | "danger";
}) {
	const styles =
		tone === "danger"
			? "border-red-950/20 bg-red-100 text-red-950 hover:bg-red-200 dark:border-red-300/30 dark:bg-red-500/20 dark:text-red-100 dark:hover:bg-red-500/30"
			: tone === "secondary"
				? "border-stone-200 bg-white text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white dark:hover:bg-stone-800"
				: "border-stone-950 bg-stone-950 text-white hover:bg-stone-800 dark:border-white dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200";

	return (
		<button
			{...props}
			className={`rounded-2xl border px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 dark:focus-visible:ring-white dark:focus-visible:ring-offset-stone-950 ${styles} ${props.className ?? ""}`}
		>
			{children}
		</button>
	);
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			{...props}
			className={`w-full rounded-2xl border border-stone-950/15 bg-white/80 px-4 py-3 text-stone-950 outline-none transition placeholder:text-stone-600 focus:border-blue-700 focus:ring-2 focus:ring-blue-700 dark:border-white/15 dark:bg-white/10 dark:text-amber-50 dark:placeholder:text-stone-300 dark:focus:border-amber-300 dark:focus:ring-amber-300 ${props.className ?? ""}`}
		/>
	);
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
	return (
		<select
			{...props}
			className={`w-full rounded-2xl border border-stone-950/15 bg-white/80 px-4 py-3 text-stone-950 outline-none transition focus:border-blue-700 focus:ring-2 focus:ring-blue-700 dark:border-white/15 dark:bg-stone-900 dark:text-amber-50 dark:focus:border-amber-300 dark:focus:ring-amber-300 ${props.className ?? ""}`}
		/>
	);
}

export function TextArea(
	props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
	return (
		<textarea
			{...props}
			className={`min-h-28 w-full rounded-2xl border border-stone-950/15 bg-white/80 px-4 py-3 text-stone-950 outline-none transition placeholder:text-stone-600 focus:border-blue-700 focus:ring-2 focus:ring-blue-700 dark:border-white/15 dark:bg-white/10 dark:text-amber-50 dark:placeholder:text-stone-300 dark:focus:border-amber-300 dark:focus:ring-amber-300 ${props.className ?? ""}`}
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
			className="grid gap-2 text-sm font-bold text-stone-800 dark:text-stone-200"
			htmlFor={htmlFor}
		>
			{children}
		</label>
	);
}

export function Notice({
	children,
	tone = "info",
}: {
	children: ReactNode;
	tone?: "info" | "error" | "success";
}) {
	const styles =
		tone === "error"
			? "border-red-950/20 bg-red-100 text-red-950 dark:border-red-300/30 dark:bg-red-500/20 dark:text-red-100"
			: tone === "success"
				? "border-emerald-950/20 bg-emerald-100 text-emerald-950 dark:border-emerald-300/30 dark:bg-emerald-500/20 dark:text-emerald-100"
				: "border-blue-950/20 bg-blue-100 text-blue-950 dark:border-blue-300/30 dark:bg-blue-500/20 dark:text-blue-100";

	return (
		<div className={`rounded-2xl border px-4 py-3 text-sm ${styles}`}>
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
