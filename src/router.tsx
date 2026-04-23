import { createRouter, Link } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
	return createRouter({
		defaultNotFoundComponent: DefaultNotFound,
		routeTree,
		scrollRestoration: true,
	});
}

function DefaultNotFound() {
	return (
		<main className="mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-7xl place-items-center px-5 py-10">
			<section className="max-w-xl rounded-4xl border border-stone-950/10 bg-white/70 p-6 text-center shadow-[0_24px_80px_rgba(29,27,22,0.10)] backdrop-blur dark:border-white/10 dark:bg-stone-950/70 dark:shadow-[0_24px_80px_rgba(0,0,0,0.30)]">
				<p className="text-sm font-black uppercase tracking-[0.24em] text-orange-700 dark:text-orange-300">
					Shorty Link
				</p>
				<h1 className="mt-4 text-4xl font-black tracking-tight text-stone-950 dark:text-amber-50">
					Not found
				</h1>
				<p className="mt-4 text-stone-700 dark:text-stone-300">
					This page does not exist.
				</p>
				<Link
					className="mt-6 inline-flex rounded-2xl border border-stone-950 bg-stone-950 px-4 py-3 text-sm font-black text-amber-100 shadow-[5px_5px_0_#f97316] transition hover:-translate-y-0.5 dark:border-amber-200 dark:bg-amber-200 dark:text-stone-950 dark:shadow-[5px_5px_0_#1d4ed8]"
					to="/"
				>
					Go home
				</Link>
			</section>
		</main>
	);
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
