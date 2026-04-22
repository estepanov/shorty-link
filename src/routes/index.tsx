import { Link, createFileRoute } from "@tanstack/react-router";

import { AppShell, Button, Card } from "@/components/ui";
import { createTranslator, defaultLocale } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const t = createTranslator(defaultLocale);

  return (
    <AppShell>
      <main className="mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-7xl items-center gap-8 px-5 py-10 lg:grid-cols-[1.15fr_0.85fr]">
        <section>
          <p className="mb-5 inline-flex rounded-full border border-stone-950 bg-amber-200 px-4 py-2 text-sm font-black uppercase tracking-[0.24em] text-stone-950 shadow-[4px_4px_0_#1d4ed8]">
            {t("home.badge")}
          </p>
          <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-tight text-stone-950 sm:text-7xl">
            {t("home.title")}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-700">
            {t("home.description")}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/admin">
              <Button>{t("home.openAdmin")}</Button>
            </Link>
            <a href="https://github.com/" rel="noreferrer">
              <Button tone="secondary">{t("home.docs")}</Button>
            </a>
          </div>
        </section>

        <Card className="relative overflow-hidden bg-stone-950 text-amber-50">
          <div className="absolute -right-16 -top-16 size-44 rounded-full bg-orange-500/60 blur-2xl" />
          <div className="relative">
            <p className="text-sm font-black uppercase tracking-[0.25em] text-amber-300">
              {t("home.redirectModel")}
            </p>
            <ol className="mt-6 grid gap-4 text-base leading-7">
              <li>1. {t("home.modelOne")}</li>
              <li>2. {t("home.modelTwo")}</li>
              <li>3. {t("home.modelThree")}</li>
              <li>4. {t("home.modelFour")}</li>
            </ol>
          </div>
        </Card>
      </main>
    </AppShell>
  );
}
