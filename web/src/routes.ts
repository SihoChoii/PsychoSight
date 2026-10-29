export type Route =
  | { name: "picker" }
  | { name: "access" }
  | { name: "optin" }
  | { name: "run"; jobId: string }
  | { name: "report"; jobId: string };

export function parseHash(hash: string): Route {
  const path = (hash.replace(/^#/, "") || "/").split("?")[0];
  if (path === "/" || path === "") return { name: "picker" };
  if (path === "/access") return { name: "access" };
  if (path === "/optin") return { name: "optin" };
  const run = path.match(/^\/run\/([^/]+)$/);
  if (run) return { name: "run", jobId: decodeURIComponent(run[1]) };
  const report = path.match(/^\/report\/([^/]+)$/);
  if (report) return { name: "report", jobId: decodeURIComponent(report[1]) };
  return { name: "picker" };
}
