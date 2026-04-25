import type { Treaty } from "@elysiajs/eden";

import type { App } from "@/server/api/app";

type Api = Treaty.Create<App>["api"];
type AdminApi = Api["admin"];
type LinkByIdApi = ReturnType<AdminApi["links"]>;
type ApiKeyByIdApi = ReturnType<AdminApi["api-keys"]>;
// biome-ignore lint/suspicious/noExplicitAny: Eden Treaty helpers are structurally typed; the params/return are opaque here and are narrowed by Treaty.Data<T>.
type ApiData<T extends (...args: Array<any>) => any> = Exclude<
	Treaty.Data<T>,
	Response
>;

export type AdminDomain = ApiData<AdminApi["domains"]["get"]>[number];
export type AdminLink = ApiData<LinkByIdApi["get"]>;
export type LinkListData = ApiData<AdminApi["links"]["get"]>;
export type LinkListItem = LinkListData["items"][number];
export type LinkStatsResponse = ApiData<LinkByIdApi["stats"]["get"]>;
export type LinkStats = LinkStatsResponse["stats"];
export type UtmDimension = keyof LinkStats["breakdowns"] & string;

export type AdminUser = ApiData<AdminApi["users"]["get"]>[number];
export type AdminInviteList = ApiData<AdminApi["invites"]["get"]>;
export type AdminInvite = AdminInviteList[number];
export type AdminSession = ApiData<AdminApi["sessions"]["get"]>[number];
export type AdminApiKeyList = ApiData<AdminApi["api-keys"]["get"]>;
export type AdminApiKey = AdminApiKeyList["apiKeys"][number];
export type AdminCreatedApiKey = ApiData<AdminApi["api-keys"]["post"]>;
export type AdminUpdatedApiKey = ApiData<ApiKeyByIdApi["patch"]>;

type RoleByIdApi = ReturnType<AdminApi["roles"]>;
export type AdminRole = ApiData<AdminApi["roles"]["get"]>[number];
export type AdminRoleDetail = ApiData<RoleByIdApi["get"]>;
export type AssignableRole = ApiData<
	AdminApi["roles"]["assignable"]["get"]
>[number];
export type PermissionCatalog = ApiData<AdminApi["permissions"]["get"]>;
