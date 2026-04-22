import type { Treaty } from "@elysiajs/eden";

import type { App } from "@/server/api/app";

type Api = Treaty.Create<App>["api"];
type AdminApi = Api["admin"];
type LinkByIdApi = ReturnType<AdminApi["links"]>;
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
