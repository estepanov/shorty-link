import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const BASE = process.env.DOCS_URL ?? "http://127.0.0.1:4321";
const PAGES = [
	"/",
	"/roadmap/",
	"/analytics/",
	"/configuration/",
	"/mcp/",
	"/admin-api/",
];
const WIDTHS = [320, 390, 768, 1024, 1280];

function send(socket, state, method, params = {}, sessionId) {
	const id = ++state.id;
	return new Promise((resolve, reject) => {
		state.pending.set(id, (message) => {
			if (message.error) reject(new Error(JSON.stringify(message.error)));
			else resolve(message.result);
		});
		socket.send(JSON.stringify({ id, method, params, sessionId }));
	});
}

async function connect() {
	const version = await fetch("http://127.0.0.1:9222/json/version").then((r) =>
		r.json(),
	);
	const socket = new WebSocket(version.webSocketDebuggerUrl);
	const state = { id: 0, pending: new Map() };
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (message.id && state.pending.has(message.id)) {
			state.pending.get(message.id)(message);
			state.pending.delete(message.id);
		}
	});
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve);
		socket.addEventListener("error", reject);
	});
	const { targetId } = await send(socket, state, "Target.createTarget", {
		url: "about:blank",
	});
	const { sessionId } = await send(socket, state, "Target.attachToTarget", {
		targetId,
		flatten: true,
	});
	await send(socket, state, "Page.enable", {}, sessionId);
	await send(socket, state, "Runtime.enable", {}, sessionId);
	return {
		sessionId,
		async evaluate(expression) {
			const { result, exceptionDetails } = await send(
				socket,
				state,
				"Runtime.evaluate",
				{ expression, returnByValue: true, awaitPromise: true },
				sessionId,
			);
			if (exceptionDetails) {
				throw new Error(exceptionDetails.text || "page evaluation failed");
			}
			return result.value;
		},
		async setWidth(width) {
			await send(
				socket,
				state,
				"Emulation.setDeviceMetricsOverride",
				{
					width,
					height: 900,
					deviceScaleFactor: 1,
					mobile: width < 768,
				},
				sessionId,
			);
		},
		async open(path) {
			await send(
				socket,
				state,
				"Page.navigate",
				{ url: `${BASE}${path}` },
				sessionId,
			);
			await new Promise((resolve) => setTimeout(resolve, 500));
		},
		close() {
			socket.close();
		},
	};
}

test("docs server is reachable", async () => {
	const response = await fetch(BASE);
	assert.equal(response.status, 200);
});

test("pages reflow without horizontal page scroll", async (t) => {
	const page = await connect();
	t.after(() => page.close());
	for (const path of PAGES) {
		for (const width of WIDTHS) {
			await page.setWidth(width);
			await page.open(path);
			const box = await page.evaluate(`(() => {
				const doc = document.documentElement;
				return { scroll: doc.scrollWidth, client: doc.clientWidth };
			})()`);
			assert.ok(
				box.scroll <= box.client + 1,
				`${path} at ${width}px scrolls horizontally (${box.scroll} > ${box.client})`,
			);
		}
	}
});

test("wide code and tables stay reachable inside the page", async (t) => {
	const page = await connect();
	t.after(() => page.close());
	await page.setWidth(390);
	await page.open("/analytics/");
	const metrics = await page.evaluate(`(() => {
		const doc = document.documentElement;
		const pres = [...document.querySelectorAll("pre")].map((el) => ({
			client: el.clientWidth,
			scroll: el.scrollWidth,
			tabIndex: el.tabIndex,
			label: el.getAttribute("aria-label"),
		}));
		const tables = [...document.querySelectorAll(".table-scroll")].map((el) => ({
			client: el.clientWidth,
			scroll: el.scrollWidth,
			tabIndex: el.tabIndex,
			label: el.getAttribute("aria-label"),
		}));
		return {
			viewport: doc.clientWidth,
			pres,
			tables,
			skip: Boolean(document.querySelector('a.skip-link[href="#content"]')),
			main: Boolean(document.querySelector("main#content")),
			menu: document.getElementById("nav-toggle")?.getAttribute("aria-controls"),
			menuExpanded: document.getElementById("nav-toggle")?.getAttribute("aria-expanded"),
			navLabel: document.getElementById("docs-nav")?.getAttribute("aria-label"),
			themePressed: document.querySelector(".theme-toggle")?.getAttribute("aria-pressed"),
			viewportMeta: document.querySelector('meta[name="viewport"]')?.content ?? "",
			lang: document.documentElement.lang,
			h1Top: Math.round(document.querySelector("main h1").getBoundingClientRect().top),
		};
	})()`);
	assert.ok(
		metrics.h1Top < 320,
		`article heading should start near the top on mobile, was ${metrics.h1Top}px`,
	);
	assert.equal(metrics.lang, "en");
	assert.match(metrics.viewportMeta, /width=device-width/);
	assert.doesNotMatch(metrics.viewportMeta, /user-scalable\s*=\s*no/);
	assert.doesNotMatch(metrics.viewportMeta, /maximum-scale\s*=\s*1\b/);
	assert.equal(metrics.skip, true);
	assert.equal(metrics.main, true);
	assert.equal(metrics.menu, "docs-nav");
	assert.equal(metrics.menuExpanded, "false");
	assert.equal(metrics.navLabel, "Documentation");
	assert.ok(
		metrics.themePressed === "true" || metrics.themePressed === "false",
	);
	const wideCode = metrics.pres.find((pre) => pre.scroll > pre.client + 8);
	assert.ok(wideCode, "expected a code block to scroll internally");
	assert.ok(wideCode.client <= metrics.viewport);
	assert.equal(wideCode.tabIndex, 0);
	assert.match(wideCode.label, /code/i);
	assert.ok(metrics.tables.length > 0, "expected a scrollable table region");
	for (const table of metrics.tables) {
		assert.ok(table.client <= metrics.viewport);
		assert.equal(table.label, "Scrollable table");
		if (table.scroll > table.client + 8) assert.equal(table.tabIndex, 0);
	}
});

test("mobile menu traps focus and closes with Escape", async (t) => {
	const page = await connect();
	t.after(() => page.close());
	await page.setWidth(390);
	await page.open("/roadmap/");
	const opened = await page.evaluate(`(() => {
		document.getElementById("nav-toggle").click();
		const nav = document.getElementById("docs-nav");
		return {
			expanded: document.getElementById("nav-toggle").getAttribute("aria-expanded"),
			open: nav.classList.contains("is-open"),
			focusInside: nav.contains(document.activeElement),
			modal: nav.getAttribute("aria-modal"),
		};
	})()`);
	assert.equal(opened.expanded, "true");
	assert.equal(opened.open, true);
	assert.equal(opened.focusInside, true);
	assert.equal(opened.modal, "true");
	const closed = await page.evaluate(`(() => {
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		return {
			expanded: document.getElementById("nav-toggle").getAttribute("aria-expanded"),
			open: document.getElementById("docs-nav").classList.contains("is-open"),
			focusOnToggle: document.activeElement === document.getElementById("nav-toggle"),
		};
	})()`);
	assert.equal(closed.expanded, "false");
	assert.equal(closed.open, false);
	assert.equal(closed.focusOnToggle, true);
});

test("chrome is available for layout checks", () => {
	const chrome = spawn("google-chrome", ["--version"]);
	return new Promise((resolve, reject) => {
		chrome.on("error", reject);
		chrome.on("exit", (code) => {
			assert.equal(code, 0);
			resolve();
		});
	});
});
