export const env: Record<string, string | undefined> = {};

export function waitUntil(promise: Promise<unknown>) {
	void promise;
}
