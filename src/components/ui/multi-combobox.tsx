import { Check, ChevronsUpDown, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type MultiComboboxOption = {
	value: string;
	label: string;
};

export function MultiCombobox({
	options,
	selected,
	onChange,
	placeholder,
	searchPlaceholder,
	emptyMessage,
	className,
}: {
	options: MultiComboboxOption[];
	selected: string[];
	onChange: (values: string[]) => void;
	placeholder: string;
	searchPlaceholder?: string;
	emptyMessage?: string;
	className?: string;
}) {
	const [open, setOpen] = useState(false);

	const selectedSet = new Set(selected);
	const selectedOptions = options.filter((o) => selectedSet.has(o.value));

	function toggle(value: string) {
		const next = new Set(selected);
		if (next.has(value)) {
			next.delete(value);
		} else {
			next.add(value);
		}
		onChange([...next]);
	}

	function remove(value: string) {
		const next = new Set(selected);
		next.delete(value);
		onChange([...next]);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className={cn(
						"flex h-auto min-h-10 w-full flex-wrap items-center gap-1 px-2.5 py-1.5 text-left font-normal",
						className,
					)}
				>
					{selectedOptions.length === 0 ? (
						<span className="text-muted-foreground">{placeholder}</span>
					) : (
						<>
							{selectedOptions.slice(0, 2).map((option) => (
								<Badge
									key={option.value}
									variant="secondary"
									className="flex items-center gap-1 pr-1"
								>
									<span className="max-w-[120px] truncate">{option.label}</span>
									<button
										type="button"
										aria-label={`Remove ${option.label}`}
										className="inline-flex rounded-sm opacity-70 hover:opacity-100"
										onClick={(event) => {
											event.stopPropagation();
											remove(option.value);
										}}
									>
										<X className="size-3" />
									</button>
								</Badge>
							))}
							{selectedOptions.length > 2 ? (
								<Badge variant="secondary">
									+{selectedOptions.length - 2} more
								</Badge>
							) : null}
						</>
					)}
					<span className="pointer-events-none ml-auto opacity-50">
						<ChevronsUpDown className="size-4 shrink-0" />
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
				<Command>
					<CommandInput
						placeholder={searchPlaceholder ?? "Search..."}
						className="h-9"
					/>
					<CommandList>
						<CommandEmpty>{emptyMessage ?? "No items found."}</CommandEmpty>
						<CommandGroup>
							{options.map((option) => {
								const isSelected = selectedSet.has(option.value);
								return (
									<CommandItem
										key={option.value}
										value={option.value}
										onSelect={() => toggle(option.value)}
									>
										<span className="flex-1 truncate">{option.label}</span>
										<Check
											className={cn(
												"ml-auto size-4",
												isSelected ? "opacity-100" : "opacity-0",
											)}
										/>
									</CommandItem>
								);
							})}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
