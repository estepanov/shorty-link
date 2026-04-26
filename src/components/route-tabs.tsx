import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type TabItem = {
	to: string;
	label: ReactNode;
	exact?: boolean;
};

export function RouteTabs({
	items,
	ariaLabel,
	className,
}: {
	items: TabItem[];
	ariaLabel?: string;
	className?: string;
}) {
	const location = useLocation();

	if (items.length === 0) return null;

	const activeValue =
		items.find((tab) =>
			(tab.exact ?? true)
				? location.pathname === tab.to
				: location.pathname === tab.to ||
					location.pathname.startsWith(`${tab.to}/`),
		)?.to ?? "";

	return (
		<nav
			aria-label={ariaLabel}
			className={cn("overflow-x-auto overflow-y-hidden pb-1", className)}
		>
			<Tabs value={activeValue} activationMode="manual">
				<TabsList
					aria-label={ariaLabel}
					className="min-w-full justify-start"
					variant="line"
				>
					{items.map((tab) => (
						<TabsTrigger asChild key={tab.to} value={tab.to}>
							<Link
								to={tab.to}
								activeOptions={{ exact: tab.exact ?? true }}
								className="min-w-24 flex-none px-3 py-2 after:inset-x-0 after:bottom-[-5px] after:h-0.5 data-[state=active]:after:opacity-100"
							>
								{tab.label}
							</Link>
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>
		</nav>
	);
}
