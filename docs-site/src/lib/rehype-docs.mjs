function classNames(value) {
	if (Array.isArray(value))
		return value.filter((item) => typeof item === "string");
	if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
	return [];
}

function hrefOf(properties) {
	const href = properties?.href;
	return typeof href === "string" ? href : "";
}

function isExternal(href) {
	return /^https?:\/\//i.test(href);
}

function markExternalLink(node) {
	const properties = node.properties ?? {};
	if (!isExternal(hrefOf(properties))) return node;
	const rel = new Set(
		String(properties.rel ?? "")
			.split(/\s+/)
			.filter(Boolean),
	);
	rel.add("noopener");
	rel.add("noreferrer");
	properties.target = "_blank";
	properties.rel = [...rel].join(" ");
	node.properties = properties;
	const alreadyLabeled = (node.children ?? []).some(
		(child) =>
			child.type === "element" &&
			child.tagName === "span" &&
			classNames(child.properties?.className).includes("sr-only"),
	);
	if (!alreadyLabeled) {
		node.children = [
			...(node.children ?? []),
			{
				type: "element",
				tagName: "span",
				properties: { className: ["sr-only"] },
				children: [{ type: "text", value: " (opens in a new tab)" }],
			},
		];
	}
	return node;
}

function markCodeBlock(node) {
	const properties = node.properties ?? {};
	properties.tabIndex = 0;
	properties.ariaLabel = properties.ariaLabel ?? "Scrollable code block";
	node.properties = properties;
	return node;
}

function wrapTable(node) {
	return {
		type: "element",
		tagName: "div",
		properties: {
			className: ["table-scroll"],
			tabIndex: 0,
			ariaLabel: "Scrollable table",
		},
		children: [node],
	};
}

function visit(node) {
	if (!node?.children) return;
	for (const child of node.children) visit(child);
	node.children = node.children.map((child) => {
		if (child.type !== "element") return child;
		if (child.tagName === "table") return wrapTable(child);
		if (child.tagName === "pre") return markCodeBlock(child);
		if (child.tagName === "a") return markExternalLink(child);
		return child;
	});
}

export function rehypeDocs() {
	return (tree) => {
		visit(tree);
	};
}

function classNameIncludes(value, name) {
	return classNames(value).includes(name);
}

export const docsHastPlugin = {
	name: "docs-responsive",
	element: [
		{
			filter: ["table"],
			visit(node, ctx) {
				const parent = ctx.parent(node);
				if (
					parent?.type === "element" &&
					parent.tagName === "div" &&
					classNameIncludes(parent.properties?.className, "table-scroll")
				) {
					return;
				}
				ctx.wrapNode(node, {
					type: "element",
					tagName: "div",
					properties: {
						className: ["table-scroll"],
						tabIndex: 0,
						ariaLabel: "Scrollable table",
					},
					children: [],
				});
			},
		},
		{
			filter: ["pre"],
			visit(node, ctx) {
				if (!node.properties?.ariaLabel) {
					ctx.setProperty(node, "ariaLabel", "Scrollable code block");
				}
			},
		},
		{
			filter: ["a"],
			visit(node, ctx) {
				const href = hrefOf(node.properties ?? {});
				if (!isExternal(href)) return;
				const rel = new Set(
					String(node.properties?.rel ?? "")
						.split(/\s+/)
						.filter(Boolean),
				);
				rel.add("noopener");
				rel.add("noreferrer");
				ctx.setProperty(node, "target", "_blank");
				ctx.setProperty(node, "rel", [...rel].join(" "));
				const labeled = (node.children ?? []).some(
					(child) =>
						child.type === "element" &&
						child.tagName === "span" &&
						classNameIncludes(child.properties?.className, "sr-only"),
				);
				if (labeled) return;
				ctx.appendChild(node, {
					type: "element",
					tagName: "span",
					properties: { className: ["sr-only"] },
					children: [{ type: "text", value: " (opens in a new tab)" }],
				});
			},
		},
	],
};
