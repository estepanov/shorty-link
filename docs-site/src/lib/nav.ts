import { type CollectionEntry, getCollection } from "astro:content";

type OrderEntry = string | { slug: string; children: string[] };

const ORDER: readonly OrderEntry[] = [
	{ slug: "overview", children: ["usage"] },
	"self-hosting",
	"configuration",
	"admin-api",
	{ slug: "roadmap", children: ["roadmap/multi-service-architecture"] },
	"upgrading",
	"releases",
];

export type NavItem = {
	slug: string;
	title: string;
	href: string;
	children?: NavItem[];
};

export function extractTitle(entry: CollectionEntry<"docs">): string {
	if (entry.data?.title) return entry.data.title;
	const match = entry.body?.match(/^#\s+(.+)$/m);
	return match?.[1]?.trim() ?? entry.id;
}

function toItem(entry: CollectionEntry<"docs">): NavItem {
	return {
		slug: entry.id,
		title: extractTitle(entry),
		href: `/${entry.id}/`,
	};
}

function listedSlugs(): Set<string> {
	const set = new Set<string>();
	for (const o of ORDER) {
		if (typeof o === "string") set.add(o);
		else {
			set.add(o.slug);
			for (const c of o.children) set.add(c);
		}
	}
	return set;
}

export async function getNav(): Promise<NavItem[]> {
	const entries = await getCollection("docs");
	const bySlug = new Map(entries.map((e) => [e.id, e]));
	const items: NavItem[] = [];
	for (const o of ORDER) {
		if (typeof o === "string") {
			const entry = bySlug.get(o);
			if (entry) items.push(toItem(entry));
		} else {
			const parent = bySlug.get(o.slug);
			if (!parent) continue;
			const children = o.children.flatMap((c) => {
				const child = bySlug.get(c);
				return child ? [toItem(child)] : [];
			});
			items.push({ ...toItem(parent), children });
		}
	}
	const known = listedSlugs();
	for (const entry of entries) {
		if (!known.has(entry.id)) items.push(toItem(entry));
	}
	return items;
}

export function findActivePath(items: NavItem[], slug: string): string[] {
	for (const item of items) {
		if (item.slug === slug) return [item.slug];
		if (item.children) {
			const childPath = findActivePath(item.children, slug);
			if (childPath.length > 0) return [item.slug, ...childPath];
		}
	}
	return [];
}
