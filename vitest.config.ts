import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tsconfigPaths()],
	resolve: {
		alias: {
			"cloudflare:workers": new URL(
				"./test/cloudflare-workers-mock.ts",
				import.meta.url,
			).pathname,
		},
	},
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
});
