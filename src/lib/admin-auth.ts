import { authClient } from "@/lib/auth-client";
import { createTranslator, defaultLocale } from "@/lib/i18n";

export function useAdminAuthGuard() {
	const sessionQuery = authClient.useSession();
	const { data: session, isPending } = sessionQuery;
	const locale =
		(session?.user as { locale?: string } | undefined)?.locale ?? defaultLocale;

	return {
		...sessionQuery,
		isPending,
		locale,
		session,
		t: createTranslator(locale),
	};
}
