import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	server: {
		port: 3000,
	},
	plugins: [
		cloudflare({
			viteEnvironment: { name: "ssr" },
			remoteBindings: !!process.env.CLOUDFLARE_API_TOKEN,
		}),
		tanstackStart(),
		tailwindcss(),
		react(),
	],
});
