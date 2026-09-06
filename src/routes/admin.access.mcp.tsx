import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	AdminFormRoot,
	FormFooter,
	ToggleTile,
} from "@/components/admin-forms";
import { CopyButton } from "@/components/copy-button";
import { Button, Card, DataRow, Notice } from "@/components/ui";
import { useAdminAuthGuard, useRequirePermission } from "@/lib/admin-auth";
import { getTreaty, unwrap } from "@/lib/eden";

export const Route = createFileRoute("/admin/access/mcp")({
	component: McpSettingsPage,
});

type McpSettings = {
	enabled: boolean;
	mcpUrl: string;
	authorizationServerUrl: string;
	protectedResourceUrl: string;
};

function McpSettingsPage() {
	const { session, isPending, t } = useAdminAuthGuard();
	const { isAuthorized, isPending: isPermissionPending } =
		useRequirePermission("mcp.manage");
	const [settings, setSettings] = useState<McpSettings | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	async function load() {
		setError(null);
		const api = getTreaty();
		setSettings(await unwrap<McpSettings>(await api.admin.mcp.settings.get()));
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload when the signed-in user changes
	useEffect(() => {
		if (!session || isPermissionPending || !isAuthorized) {
			return;
		}
		void load().catch((nextError: unknown) => {
			setError(
				nextError instanceof Error ? nextError.message : "errors.unknown",
			);
		});
	}, [isAuthorized, isPermissionPending, session?.user.id]);

	if (isPending || isPermissionPending) {
		return <Card>{t("loading.app")}</Card>;
	}

	if (!session) {
		return <Notice tone="error">{t("errors.unauthorized")}</Notice>;
	}

	if (!isAuthorized) {
		return <Notice tone="error">{t("errors.permissionDenied")}</Notice>;
	}

	return (
		<Card>
			<h2 className="text-2xl font-medium">{t("mcp.settingsTitle")}</h2>
			<p className="mt-2 text-sm text-muted-foreground">
				{t("mcp.settingsDescription")}
			</p>
			{error ? (
				<div className="mt-4">
					<Notice tone="error">{t(error)}</Notice>
				</div>
			) : null}
			{saved ? (
				<div className="mt-4">
					<Notice tone="success">{t("mcp.saved")}</Notice>
				</div>
			) : null}
			{settings ? (
				<>
					<McpSettingsForm
						settings={settings}
						onError={setError}
						onSaved={async (next) => {
							setSaved(true);
							setSettings(next);
						}}
					/>
					<div className="mt-6 grid gap-3">
						<DataRow>
							<div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
								<div className="min-w-0">
									<p className="font-medium">{t("mcp.connectorUrl")}</p>
									<p className="mt-1 break-all font-mono text-sm text-muted-foreground">
										{settings.mcpUrl}
									</p>
								</div>
								<CopyButton text={settings.mcpUrl} />
							</div>
						</DataRow>
						<DataRow>
							<div>
								<p className="font-medium">{t("mcp.discoveryUrl")}</p>
								<p className="mt-1 break-all font-mono text-sm text-muted-foreground">
									{settings.protectedResourceUrl}
								</p>
							</div>
						</DataRow>
					</div>
				</>
			) : (
				<p className="mt-6 text-muted-foreground">{t("loading.dashboard")}</p>
			)}
		</Card>
	);
}

function McpSettingsForm({
	settings,
	onError,
	onSaved,
}: {
	settings: McpSettings;
	onError: (message: string | null) => void;
	onSaved: (settings: McpSettings) => Promise<void>;
}) {
	const { t } = useAdminAuthGuard();
	const form = useForm({
		defaultValues: {
			enabled: settings.enabled,
		},
		onSubmit: async ({ value }) => {
			onError(null);
			try {
				const api = getTreaty();
				const next = await unwrap<McpSettings>(
					await api.admin.mcp.settings.put({ enabled: value.enabled }),
				);
				await onSaved(next);
			} catch (nextError) {
				onError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});

	return (
		<AdminFormRoot
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="enabled">
				{(field) => (
					<ToggleTile
						checked={field.state.value}
						onCheckedChange={field.handleChange}
						tone="green"
					>
						{t("mcp.serverEnabled")}
					</ToggleTile>
				)}
			</form.Field>
			<FormFooter>
				<Button className="sm:min-w-32" type="submit">
					{t("forms.save")}
				</Button>
			</FormFooter>
		</AdminFormRoot>
	);
}
