import { request, type FullConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function sitePassword(): string {
  for (const f of [".dev.vars", ".dev.vars.example"]) {
    if (!fs.existsSync(f)) continue;
    const m = fs.readFileSync(f, "utf8").match(/^SITE_PASSWORD\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1];
  }
  throw new Error("SITE_PASSWORD not found in .dev.vars or .dev.vars.example");
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post("/api/login", { data: { password: sitePassword() } });
  if (!res.ok()) throw new Error(`Login failed: ${res.status()}`);
  const file = path.resolve("e2e/.auth/state.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await ctx.storageState({ path: file });
  await ctx.dispose();
}
