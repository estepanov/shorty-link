import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "@/lib/i18n";

const state = vi.hoisted(() => ({
	pending: true,
	authorized: false,
	pathname: "",
}));

vi.mock("@/lib/admin-auth", () => ({
	useAdminAuthGuard: () => ({
		session: {
			user: { id: "admin", name: "Admin", email: "admin@example.com" },
		},
		isPending: false,
		locale: "en",
		t: createTranslator("en"),
	}),
	useAuthContext: () => ({
		isPending: state.pending,
		hasPermission: () => state.authorized,
	}),
	useRequirePermission: () => ({
		isPending: state.pending,
		isAuthorized: state.authorized,
		hasPermission: () => state.authorized,
	}),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useLocation: () => ({ pathname: state.pathname }),
	useRouter: () => ({ navigate: vi.fn() }),
	useNavigate: () => vi.fn(),
}));

const pages = [
	["/admin/links", () => import("@/routes/admin.links")],
	["/admin/links/link-1", () => import("@/routes/admin.links.$id")],
	["/admin/access", () => import("@/routes/admin.access")],
	["/admin/access/users", () => import("@/routes/admin.access.users")],
	["/admin/access/roles", () => import("@/routes/admin.access.roles")],
	["/admin/access/invites", () => import("@/routes/admin.access.invites")],
	["/admin/domains/new", () => import("@/routes/admin.domains.new")],
	[
		"/admin/domains/domain-1/edit",
		() => import("@/routes/admin.domains.$id.edit"),
	],
	["/admin/invites/new", () => import("@/routes/admin.invites.new")],
	["/admin/users", () => import("@/routes/admin.users")],
	["/admin/user/api-keys", () => import("@/routes/admin.user.api-keys")],
	["/admin/user/sessions", () => import("@/routes/admin.user.sessions")],
] as const;

beforeEach(() => {
	state.pending = true;
	state.authorized = false;
});

describe.each(pages)("permission feedback on %s", (pathname, load) => {
	async function renderPage() {
		state.pathname = pathname;
		const { Route } = await load();
		vi.spyOn(Route, "useParams").mockReturnValue({ id: "link-1" });
		vi.spyOn(Route, "useSearch").mockReturnValue({});
		return renderToStaticMarkup(
			createElement(Route.options.component as ComponentType),
		);
	}

	it("shows loading instead of a denial while permissions are unresolved", async () => {
		const html = await renderPage();
		expect(html).not.toContain(
			createTranslator("en")("errors.permissionDenied"),
		);
		expect(html).toContain(createTranslator("en")("loading.app"));
	});

	it("shows denial once permissions resolve without access", async () => {
		state.pending = false;
		const html = await renderPage();
		expect(html).toContain(createTranslator("en")("errors.permissionDenied"));
	});
});
