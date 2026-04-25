type ApiKeyPreviewFields = {
	prefix?: string | null;
	start?: string | null;
};

export function formatApiKeyPreview({
	prefix,
	start,
}: ApiKeyPreviewFields): string {
	if (!start) {
		return `${prefix ?? "sl_"}••••`;
	}

	if (!prefix || start.startsWith(prefix)) {
		return start;
	}

	return `${prefix}${start}`;
}
