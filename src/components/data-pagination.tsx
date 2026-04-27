import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

type DataPaginationProps = {
	page: number;
	totalPages: number;
	onPageChange: (page: number) => void;
	disabled?: boolean;
	siblingCount?: number;
	previousLabel?: string;
	nextLabel?: string;
	className?: string;
};

function buildPageRange(
	current: number,
	total: number,
	siblings: number,
): Array<number | "ellipsis-start" | "ellipsis-end"> {
	if (total <= 1) return [1];
	const totalNumbers = siblings * 2 + 5;
	if (total <= totalNumbers) {
		return Array.from({ length: total }, (_, i) => i + 1);
	}
	const left = Math.max(current - siblings, 2);
	const right = Math.min(current + siblings, total - 1);
	const showLeftEllipsis = left > 2;
	const showRightEllipsis = right < total - 1;
	const middle: Array<number> = [];
	for (let i = left; i <= right; i++) middle.push(i);
	return [
		1,
		...(showLeftEllipsis ? (["ellipsis-start"] as const) : []),
		...middle,
		...(showRightEllipsis ? (["ellipsis-end"] as const) : []),
		total,
	];
}

export function DataPagination({
	page,
	totalPages,
	onPageChange,
	disabled,
	siblingCount = 1,
	previousLabel,
	nextLabel,
	className,
}: DataPaginationProps) {
	const safeTotal = Math.max(1, totalPages);
	const safePage = Math.min(Math.max(1, page), safeTotal);
	const isPrevDisabled = disabled || safePage <= 1;
	const isNextDisabled = disabled || safePage >= safeTotal;

	const go = (target: number) => (e: React.MouseEvent) => {
		e.preventDefault();
		if (disabled) return;
		const next = Math.min(Math.max(1, target), safeTotal);
		if (next !== page) onPageChange(next);
	};

	const items = buildPageRange(safePage, safeTotal, siblingCount);

	return (
		<Pagination className={cn("mx-0 w-auto justify-end", className)}>
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious
						href="#"
						aria-disabled={isPrevDisabled}
						tabIndex={isPrevDisabled ? -1 : undefined}
						className={cn(isPrevDisabled && "pointer-events-none opacity-50")}
						onClick={go(safePage - 1)}
						{...(previousLabel ? { text: previousLabel } : {})}
					/>
				</PaginationItem>
				{items.map((item) => {
					if (item === "ellipsis-start" || item === "ellipsis-end") {
						return (
							<PaginationItem key={item}>
								<PaginationEllipsis />
							</PaginationItem>
						);
					}
					const isActive = item === safePage;
					return (
						<PaginationItem key={item}>
							<PaginationLink
								href="#"
								isActive={isActive}
								aria-disabled={disabled}
								tabIndex={disabled ? -1 : undefined}
								className={cn(disabled && "pointer-events-none opacity-50")}
								onClick={go(item)}
							>
								{item}
							</PaginationLink>
						</PaginationItem>
					);
				})}
				<PaginationItem>
					<PaginationNext
						href="#"
						aria-disabled={isNextDisabled}
						tabIndex={isNextDisabled ? -1 : undefined}
						className={cn(isNextDisabled && "pointer-events-none opacity-50")}
						onClick={go(safePage + 1)}
						{...(nextLabel ? { text: nextLabel } : {})}
					/>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}
