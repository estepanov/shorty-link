import { RouteTabs, type TabItem } from "@/components/route-tabs";
import { useText } from "@/components/ui";
import { useAuthContext } from "@/lib/admin-auth";

export function AccountTabs({ locale }: { locale?: string | null }) {
	const t = useText(locale);
	const { hasPermission } = useAuthContext();

	const items: TabItem[] = [
		{ to: "/admin/user/profile", label: t("nav.profile"), exact: true },
	];

	if (hasPermission("sessions.manage")) {
		items.push({
			to: "/admin/user/sessions",
			label: t("nav.sessions"),
			exact: true,
		});
	}

	if (hasPermission("apikeys.manage")) {
		items.push({
			to: "/admin/user/api-keys",
			label: t("nav.apiKeys"),
			exact: true,
		});
	}

	return <RouteTabs ariaLabel={t("nav.account")} items={items} />;
}
