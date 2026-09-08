import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const blocked = tracked.filter((path) => /^(?:\.env(?:\..*)?|work\/(?:source\.csv|prizes\.(?:csv|xlsx))|.*\.local\.json)$/.test(path) && path !== ".env.example"
  || /^(?:work\/data|netlify\/data)\//.test(path) && !path.endsWith("/.gitkeep"));
if (blocked.length) throw new Error(`Sensitive files tracked by Git: ${blocked.join(", ")}`);
console.log("Repository hygiene verified.");
