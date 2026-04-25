import { type TabItem, Tabs, useText } from "@/components/ui";
import { useAuthContext } from "@/lib/admin-auth";

export function AccountTabs({ locale }: { locale?: string | null }) {
	const t = useText(locale);
	const { hasPermission } = useAuthContext();

	const items: TabItem[] = [
		{ to: "/admin/profile", label: t("nav.profile"), exact: true },
	];

	if (hasPermission("sessions.manage")) {
		items.push({
			to: "/admin/sessions",
			label: t("nav.sessions"),
			exact: true,
		});
	}

	if (hasPermission("apikeys.manage")) {
		items.push({ to: "/admin/api-keys", label: t("nav.apiKeys"), exact: true });
	}

	return <Tabs ariaLabel={t("nav.account")} items={items} />;
}
