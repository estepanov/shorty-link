import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AccountTabs } from "@/components/account-tabs";
import {
	Button,
	Card,
	DataRow,
	EmptyState,
	Notice,
	PageHeader,
} from "@/components/ui";
import { useAdminAuthGuard } from "@/lib/admin-auth";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/user/mcp")({
	component: UserMcpGrants,
});

type McpGrant = {
	id: string;
	clientId: string;
	clientName: string;
	scopes: string[];
	createdAt: string | Date;
	updatedAt: string | Date;
};

function UserMcpGrants() {
	const { session, isPending, locale, t } = useAdminAuthGuard();
	const [grants, setGrants] = useState<McpGrant[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);

	async function refresh() {
		setError(null);
		const api = getTreaty();
		setGrants(await unwrap<McpGrant[]>(await api.admin.mcp.grants.get()));
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh when the signed-in user changes
	useEffect(() => {
		if (session) {
			void refresh().catch((nextError: unknown) => {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			});
		}
	}, [session?.user.id]);

	if (isPending) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Card>{t("loading.app")}</Card>
			</div>
		);
	}

	if (!session) {
		return (
			<div className="mx-auto grid w-full max-w-7xl gap-6">
				<Notice tone="error">{t("errors.unauthorized")}</Notice>
			</div>
		);
	}

	async function revoke(id: string) {
		try {
			setBusyId(id);
			setError(null);
			const api = getTreaty();
			await unwrap(await api.admin.mcp.grants({ id }).delete());
			await refresh();
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		} finally {
			setBusyId(null);
		}
	}

	return (
		<div className="mx-auto grid w-full max-w-7xl gap-6">
			<PageHeader
				title={t("mcp.grantsTitle")}
				description={t("mcp.grantsDescription")}
			/>
			<AccountTabs locale={locale} />
			<Card>
				{error ? (
					<div className="mb-4">
						<Notice tone="error">{t(error)}</Notice>
					</div>
				) : null}
				<div className="grid gap-3">
					{grants.length ? (
						grants.map((grant) => (
							<DataRow key={grant.id}>
								<div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
									<div className="min-w-0">
										<p className="font-medium">{grant.clientName}</p>
										<p className="mt-1 text-sm text-muted-foreground">
											<span className="font-mono">{grant.clientId}</span>
											{grant.scopes.length
												? ` · ${grant.scopes.join(", ")}`
												: ""}
										</p>
									</div>
									<Button
										disabled={busyId === grant.id}
										onClick={() => revoke(grant.id)}
										size="sm"
										tone="danger"
										type="button"
									>
										{t("mcp.revoke")}
									</Button>
								</div>
							</DataRow>
						))
					) : (
						<EmptyState description={t("mcp.grantsEmpty")} />
					)}
				</div>
			</Card>
		</div>
	);
}
