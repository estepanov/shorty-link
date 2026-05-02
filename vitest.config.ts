import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: {
			"cloudflare:workers": new URL(
				"./test/cloudflare-workers-mock.ts",
				import.meta.url,
			).pathname,
		},
	},
	test: {
		environment: "node",
		hookTimeout: 30_000,
		include: ["test/**/*.test.ts"],
		setupFiles: ["./test/setup.ts"],
		testTimeout: 30_000,
	},
});
