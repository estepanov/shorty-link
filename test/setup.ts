import { mkdirSync } from "node:fs";
import { join } from "node:path";

const wranglerHome = "/tmp/shorty-link-wrangler-home";
const wranglerLogs = join(wranglerHome, "logs");

mkdirSync(wranglerLogs, { recursive: true });

process.env.HOME = wranglerHome;
process.env.WRANGLER_LOG = "error";
process.env.WRANGLER_LOG_PATH = wranglerLogs;
