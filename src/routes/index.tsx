import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";

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

		const rotateX = ((y - centerY) / centerY) * -4;
		const rotateY = ((x - centerX) / centerX) * 4;

		setTransform(
			`perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.01, 1.01, 1.01)`,
		);
		setGlowPosition({
			x: (x / rect.width) * 100,
			y: (y / rect.height) * 100,
		});
	};

	const handleMouseLeave = () => {
		setTransform(
			"perspective(900px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)",
		);
		setGlowPosition({ x: 50, y: 50 });
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: visual-only 3D tilt effect; mouse handlers are decorative and do not provide interactive functionality.
		<div
			ref={ref}
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			className="[transform-style:preserve-3d] transition-transform duration-200 ease-out will-change-transform"
			style={{ transform }}
		>
			<Card variant="feature" className="relative overflow-hidden p-8">
				<div
					className="pointer-events-none absolute inset-0 opacity-60 transition-opacity duration-300"
					style={{
						background: `radial-gradient(circle 320px at ${glowPosition.x}% ${glowPosition.y}%, color-mix(in oklab, var(--accent) 35%, transparent), transparent 60%)`,
					}}
				/>
				<div
					className="pointer-events-none absolute inset-0 opacity-30"
					style={{
						backgroundImage:
							"linear-gradient(color-mix(in oklab, var(--background) 8%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--background) 8%, transparent) 1px, transparent 1px)",
						backgroundSize: "32px 32px",
					}}
				/>
				<div className="relative">{children}</div>
			</Card>
		</div>
	);
}

function Home() {
	const t = createTranslator(defaultLocale);

	return (
		<AppShell>
			<main className="mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-7xl items-center gap-12 px-5 py-16 lg:grid-cols-[1.15fr_0.85fr]">
				<section className="animate-fade-up">
					<p className="eyebrow inline-flex items-center gap-2 text-foreground">
						<span
							aria-hidden="true"
							className="inline-block size-1.5 rounded-full bg-accent"
						/>
						{t("home.badge")}
					</p>
					<h1 className="mt-6 max-w-4xl font-display text-5xl leading-[1.02] tracking-[-0.025em] text-foreground sm:text-7xl">
						{t("home.title")}
					</h1>
					<p className="mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground">
						{t("home.description")}
					</p>
					<div className="mt-9 flex flex-wrap gap-3">
						<Link to="/admin">
							<Button size="lg">{t("home.openAdmin")}</Button>
						</Link>
						<a href="https://github.com/estepanov/shorty-link" rel="noreferrer">
							<Button size="lg" tone="secondary">
								{t("home.docs")}
							</Button>
						</a>
					</div>
				</section>

				<TiltCard>
					<p className="eyebrow text-background/70">
						{t("home.redirectModel")}
					</p>
					<ol className="mt-6 grid gap-4 font-mono text-sm leading-7 text-background/90">
						<li className="flex gap-4">
							<span className="text-accent">01</span>
							<span>{t("home.modelOne")}</span>
						</li>
						<li className="flex gap-4">
							<span className="text-accent">02</span>
							<span>{t("home.modelTwo")}</span>
						</li>
						<li className="flex gap-4">
							<span className="text-accent">03</span>
							<span>{t("home.modelThree")}</span>
						</li>
						<li className="flex gap-4">
							<span className="text-accent">04</span>
							<span>{t("home.modelFour")}</span>
						</li>
					</ol>
				</TiltCard>
			</main>
		</AppShell>
	);
}
