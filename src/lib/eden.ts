import { treaty } from "@elysiajs/eden";
import { createIsomorphicFn } from "@tanstack/react-start";

import { app, type App } from "@/server/api/app";

function clientOrigin() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "http://localhost:3000";
}

export const getTreaty = createIsomorphicFn()
  .server(() => treaty(app).api)
  .client(() =>
    treaty<App>(clientOrigin(), {
      fetch: {
        credentials: "include",
      },
    }).api,
  );
