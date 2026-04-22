import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { authClient } from "@/lib/auth-client";
import { createTranslator, type Locale, type MessageKey } from "@/lib/i18n";

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
    await authClient.signOut();
    window.location.href = "/";
  }

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5">
        <Link to="/" className="group inline-flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-stone-950 text-lg font-black text-amber-100 shadow-[6px_6px_0_#f97316]">
            sl
          </span>
          <span className="text-xl font-black tracking-tight">{t("app.name")}</span>
        </Link>
        <nav aria-label={t("nav.label")} className="flex items-center gap-2">
          {isPending ? null : session ? (
            <>
              <div className="hidden gap-2 sm:flex">
                <NavLink to="/admin">{t("nav.dashboard")}</NavLink>
                <NavLink to="/admin/profile">{t("nav.profile")}</NavLink>
                <NavLink to="/admin/sessions">{t("nav.sessions")}</NavLink>
                <NavLink to="/admin/api-keys">{t("nav.apiKeys")}</NavLink>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-full border border-stone-950/10 bg-white/60 px-4 py-2 text-sm font-bold text-stone-800 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-950/30 hover:bg-white"
              >
                {t("nav.signOut")}
              </button>
            </>
          ) : (
            <NavLink to="/admin">{t("nav.signIn")}</NavLink>
          )}
        </nav>
      </header>
      {children}
    </div>
  );
}

function NavLink({ children, to }: { children: ReactNode; to: string }) {
  return (
    <Link
      to={to}
      className="rounded-full border border-stone-950/10 bg-white/60 px-4 py-2 text-sm font-bold text-stone-800 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-950/30 hover:bg-white"
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
      className={`rounded-[2rem] border border-stone-950/10 bg-white/70 p-6 shadow-[0_24px_80px_rgba(29,27,22,0.10)] backdrop-blur ${className}`}
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
      ? "border-red-950/20 bg-red-100 text-red-950 hover:bg-red-200"
      : tone === "secondary"
        ? "border-stone-950/15 bg-white/70 text-stone-900 hover:bg-white"
        : "border-stone-950 bg-stone-950 text-amber-100 shadow-[5px_5px_0_#f97316] hover:-translate-y-0.5";

  return (
    <button
      {...props}
      className={`rounded-2xl border px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-2xl border border-stone-950/15 bg-white/80 px-4 py-3 text-stone-950 outline-none transition placeholder:text-stone-500 focus:border-blue-700 focus:ring-4 focus:ring-blue-700/15 ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-2xl border border-stone-950/15 bg-white/80 px-4 py-3 text-stone-950 outline-none transition focus:border-blue-700 focus:ring-4 focus:ring-blue-700/15 ${props.className ?? ""}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-28 w-full rounded-2xl border border-stone-950/15 bg-white/80 px-4 py-3 text-stone-950 outline-none transition placeholder:text-stone-500 focus:border-blue-700 focus:ring-4 focus:ring-blue-700/15 ${props.className ?? ""}`}
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
    <label className="grid gap-2 text-sm font-bold text-stone-800" htmlFor={htmlFor}>
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
      ? "border-red-950/20 bg-red-100 text-red-950"
      : tone === "success"
        ? "border-emerald-950/20 bg-emerald-100 text-emerald-950"
        : "border-blue-950/20 bg-blue-100 text-blue-950";

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

export function message(t: ReturnType<typeof createTranslator>, key: MessageKey | string) {
  return t(key);
}
