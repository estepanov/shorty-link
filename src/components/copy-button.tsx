import { useState } from "react";

import { Button } from "@/components/ui";

export function CopyButton({
	text,
	label = "Copy",
	copiedLabel = "Copied!",
	className,
	onCopied,
}: {
	text: string;
	label?: string;
	copiedLabel?: string;
	className?: string;
	onCopied?: () => void;
}) {
	const [copied, setCopied] = useState(false);

	async function handleCopy() {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		onCopied?.();
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<Button
			aria-label={copied ? copiedLabel : label}
			className={className}
			disabled={copied}
			onClick={handleCopy}
			tone="secondary"
			type="button"
		>
			{copied ? (
				<svg
					aria-hidden="true"
					className="size-4"
					fill="none"
					stroke="currentColor"
					strokeWidth={2}
					viewBox="0 0 24 24"
				>
					<path
						d="M5 13l4 4L19 7"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			) : (
				<svg
					aria-hidden="true"
					className="size-4"
					fill="none"
					stroke="currentColor"
					strokeWidth={2}
					viewBox="0 0 24 24"
				>
					<path
						d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			)}
		</Button>
	);
}
