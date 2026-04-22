import { useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { AppShell, Button, Card } from "@/components/ui";
import { createTranslator, defaultLocale } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  component: Home,
});

function TiltCard({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState("");
  const [glowPosition, setGlowPosition] = useState({ x: 50, y: 50 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -6;
    const rotateY = ((x - centerX) / centerX) * 6;

    setTransform(
      `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`
    );
    setGlowPosition({
      x: (x / rect.width) * 100,
      y: (y / rect.height) * 100,
    });
  };

  const handleMouseLeave = () => {
    setTransform("perspective(800px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)");
    setGlowPosition({ x: 50, y: 50 });
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="[transform-style:preserve-3d] transition-transform duration-200 ease-out will-change-transform"
      style={{ transform }}
    >
      <Card className="relative overflow-hidden !border-0 !bg-gradient-to-br !from-stone-800 !via-stone-950 !to-black text-amber-50 dark:border-white/10 dark:bg-stone-900/95">
        {/* Mouse-following radial glow */}
        <div
          className="pointer-events-none absolute inset-0 opacity-20 transition-opacity duration-300"
          style={{
            background: `radial-gradient(circle 280px at ${glowPosition.x}% ${glowPosition.y}%, rgba(251,191,36,0.35), transparent)`,
          }}
        />
        {/* Static ambient accent */}
        <div className="absolute -right-16 -top-16 size-44 rounded-full bg-orange-500/60 blur-2xl" />
        <div className="relative">{children}</div>
      </Card>
    </div>
  );
}

function Home() {
  const t = createTranslator(defaultLocale);

  return (
    <AppShell>
      <main className="mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-7xl items-center gap-8 px-5 py-10 lg:grid-cols-[1.15fr_0.85fr]">
        <section>
          <p className="mb-5 inline-flex rounded-full border border-stone-950 bg-amber-200 px-4 py-2 text-sm font-black uppercase tracking-[0.24em] text-stone-950 shadow-[4px_4px_0_#1d4ed8] dark:border-amber-200 dark:bg-amber-300">
            {t("home.badge")}
          </p>
          <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-tight text-stone-950 dark:text-amber-50 sm:text-7xl">
            {t("home.title")}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-700 dark:text-stone-300">
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

        <TiltCard>
          <p className="text-sm font-black uppercase tracking-[0.25em] text-amber-300">
            {t("home.redirectModel")}
          </p>
          <ol className="mt-6 grid gap-4 text-base leading-7">
            <li>1. {t("home.modelOne")}</li>
            <li>2. {t("home.modelTwo")}</li>
            <li>3. {t("home.modelThree")}</li>
            <li>4. {t("home.modelFour")}</li>
          </ol>
        </TiltCard>
      </main>
    </AppShell>
  );
}
