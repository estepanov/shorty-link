import { env } from "cloudflare:workers";
import { isLocalHostname } from "./security";

const LOCAL_DEVELOPMENT_SECRET =
	"shorty-link-local-development-secret-change-me";

const runtimeEnv = env as typeof env & {
	BETTER_AUTH_SECRET?: string;
};

export function getAuthSecret(request?: Request) {
	if (runtimeEnv.BETTER_AUTH_SECRET) {
		return runtimeEnv.BETTER_AUTH_SECRET;
	}

	if (request && isLocalHostname(new URL(request.url).hostname)) {
		return LOCAL_DEVELOPMENT_SECRET;
	}

	throw new Error("BETTER_AUTH_SECRET is required outside local development");
}
