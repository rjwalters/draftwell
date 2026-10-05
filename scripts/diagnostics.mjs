import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const requestId = args.find((arg) => !arg.startsWith("--"));
if (args.some((arg) => arg.startsWith("--") && arg !== "--local") ||
  (requestId && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(requestId))) {
  console.error("Usage: npm run diagnostics -- [request-id] [--local]");
  process.exit(1);
}
const query = requestId
  ? `SELECT * FROM request_diagnostics WHERE request_id = '${requestId}';`
  : "SELECT request_id, created_at, method, route, status, duration_ms, error_kind FROM request_diagnostics ORDER BY created_at DESC LIMIT 20;";
const result = spawnSync("npx", ["wrangler", "d1", "execute", "draftwell-db", args.includes("--local") ? "--local" : "--remote", "--command", query, "--json"], { encoding: "utf8" });
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "Could not read diagnostics.\n");
  process.exit(result.status ?? 1);
}
const rows = JSON.parse(result.stdout).flatMap((entry) => entry.results ?? []);
console.log(JSON.stringify(rows.map(({ events_json, ...row }) => events_json ? { ...row, events: JSON.parse(events_json) } : row), null, 2));
