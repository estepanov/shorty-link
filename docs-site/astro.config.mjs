import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
	output: "static",
	outDir: "../dist-docs",
	site: "https://example.com",
	markdown: {
		shikiConfig: {
			themes: { light: "github-light", dark: "github-dark-default" },
			wrap: false,
		},
	},
	vite: {
		plugins: [tailwindcss()],
	},
});
