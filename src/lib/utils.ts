type ClassValue =
	| string
	| number
	| null
	| false
	| undefined
	| ClassValue[]
	| { [key: string]: unknown };

function flatten(value: ClassValue, out: string[]): void {
	if (!value) return;
	if (typeof value === "string" || typeof value === "number") {
		out.push(String(value));
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) flatten(item, out);
		return;
	}
	if (typeof value === "object") {
		for (const key in value) {
			if (value[key]) out.push(key);
		}
	}
}

export function cn(...inputs: ClassValue[]): string {
	const out: string[] = [];
	for (const input of inputs) flatten(input, out);
	return out.join(" ").replace(/\s+/g, " ").trim();
}
