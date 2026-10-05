import assert from "node:assert/strict";
import test from "node:test";
import { rehypeDocs } from "../src/lib/rehype-docs.mjs";

function run(tree) {
	rehypeDocs()(tree);
	return tree;
}

test("wraps markdown tables in a keyboard-scrollable region", () => {
	const tree = run({
		type: "root",
		children: [
			{
				type: "element",
				tagName: "table",
				properties: {},
				children: [],
			},
		],
	});
	const wrap = tree.children[0];
	assert.equal(wrap.tagName, "div");
	assert.ok(wrap.properties.className.includes("table-scroll"));
	assert.equal(wrap.properties.tabIndex, 0);
	assert.equal(wrap.properties.ariaLabel, "Scrollable table");
	assert.equal(wrap.children[0].tagName, "table");
});

test("labels external links that open a new tab", () => {
	const tree = run({
		type: "root",
		children: [
			{
				type: "element",
				tagName: "a",
				properties: { href: "https://github.com/estepanov/shorty-link" },
				children: [{ type: "text", value: "GitHub" }],
			},
			{
				type: "element",
				tagName: "a",
				properties: { href: "/configuration/" },
				children: [{ type: "text", value: "Configuration" }],
			},
		],
	});
	const external = tree.children[0];
	assert.equal(external.properties.target, "_blank");
	assert.match(String(external.properties.rel), /noopener/);
	assert.match(String(external.properties.rel), /noreferrer/);
	const note = external.children.find((child) => child.tagName === "span");
	assert.equal(note.properties.className.includes("sr-only"), true);
	assert.match(note.children[0].value, /new tab/);
	const internal = tree.children[1];
	assert.equal(internal.properties.target, undefined);
	assert.equal(
		internal.children.some((child) => child.tagName === "span"),
		false,
	);
});

test("makes code blocks keyboard scrollable without turning them into landmarks", () => {
	const tree = run({
		type: "root",
		children: [
			{
				type: "element",
				tagName: "pre",
				properties: { className: ["astro-code"] },
				children: [],
			},
		],
	});
	const pre = tree.children[0];
	assert.equal(pre.properties.tabIndex, 0);
	assert.equal(pre.properties.ariaLabel, "Scrollable code block");
	assert.equal(pre.properties.role, undefined);
});
