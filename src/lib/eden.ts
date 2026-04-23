import { treaty } from "@elysiajs/eden";
import { createIsomorphicFn } from "@tanstack/react-start";

import { type App, app } from "@/server/api/app";

function clientOrigin() {
	if (typeof window !== "undefined") {
		return window.location.origin;
	}

	return "http://localhost:3000";
}

export const getTreaty = createIsomorphicFn()
	.server(() => treaty(app).api)
	.client(
		() =>
			treaty<App>(clientOrigin(), {
				fetch: {
					credentials: "include",
				},
			}).api,
	);

type EdenResponse = {
	data: unknown;
	error: unknown;
};

function getErrorMessage(error: unknown) {
	if (typeof error === "object" && error !== null) {
		if (
			"value" in error &&
			typeof error.value === "object" &&
			error.value !== null &&
			"message" in error.value &&
			typeof error.value.message === "string"
		) {
			return error.value.message;
		}

		if ("message" in error && typeof error.message === "string") {
			return error.message;
		}
	}

	return "errors.unknown";
}

export async function unwrap<T>(
	response: Promise<EdenResponse> | EdenResponse,
) {
	const resolved = await response;

	if (resolved.error) {
		throw new Error(getErrorMessage(resolved.error));
	}

	if (resolved.data instanceof Response) {
		throw new Error(await resolved.data.text().catch(() => "errors.unknown"));
	}

	return resolved.data as T;
}
