import { satteri } from "@astrojs/markdown-satteri";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { docsHastPlugin } from "./src/lib/rehype-docs.mjs";

export default defineConfig({
	output: "static",
	outDir: "../dist-docs",
	site: "https://example.com",
	markdown: {
		processor: satteri({
			hastPlugins: [docsHastPlugin],
		}),
		shikiConfig: {
			themes: { light: "github-light", dark: "github-dark-default" },
			wrap: false,
		},
	},
	vite: {
		plugins: [tailwindcss()],
	},
});
