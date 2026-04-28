import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { getTreaty } from "@/lib/eden";
import { createTranslator, defaultLocale } from "@/lib/i18n";
import type { Permission } from "@/lib/permissions";

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

export type AuthContext = {
	role: { id: string; name: string; isSystem: boolean };
	permissions: Permission[];
};

export function useAuthContext(): {
	authContext: AuthContext | null;
	isPending: boolean;
	hasPermission: (permission: Permission | Permission[]) => boolean;
} {
	const { data: session, isPending: isSessionPending } =
		authClient.useSession();
	const sessionUserId = session?.user.id ?? null;
	const [authContext, setAuthContext] = useState<AuthContext | null>(null);
	const [isPending, setIsPending] = useState(true);

	useEffect(() => {
		let cancelled = false;

		if (isSessionPending) {
			setIsPending(true);
			return () => {
				cancelled = true;
			};
		}

		if (!sessionUserId) {
			setAuthContext(null);
			setIsPending(false);
			return () => {
				cancelled = true;
			};
		}

		async function load() {
			setIsPending(true);
			try {
				const result = await getTreaty().admin["auth-context"].get();
				const data = (result as { data?: unknown; error?: unknown }).data;
				if (!cancelled && data) {
					setAuthContext(data as AuthContext);
				} else if (!cancelled) {
					setAuthContext(null);
				}
			} catch {
				if (!cancelled) {
					setAuthContext(null);
				}
			} finally {
				if (!cancelled) {
					setIsPending(false);
				}
			}
		}
		load();
		return () => {
			cancelled = true;
		};
	}, [isSessionPending, sessionUserId]);

	function hasPermission(permission: Permission | Permission[]): boolean {
		if (!authContext) return false;
		const required = Array.isArray(permission) ? permission : [permission];
		return required.every((p) => authContext.permissions.includes(p));
	}

	return { authContext, isPending, hasPermission };
}

export function useRequirePermission(...permissions: Permission[]): {
	isAuthorized: boolean;
	isPending: boolean;
	hasPermission: (permission: Permission | Permission[]) => boolean;
} {
	const ctx = useAuthContext();
	if (ctx.isPending)
		return { isAuthorized: false, isPending: true, hasPermission: () => false };
	return {
		isAuthorized: ctx.hasPermission(permissions),
		isPending: false,
		hasPermission: ctx.hasPermission,
	};
}
