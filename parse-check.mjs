import { parse } from "acorn";
import { readFileSync } from "fs";
const src = readFileSync("/sessions/trusting-eager-darwin/mnt/CLAUDE PROJECTS--AI PATHFINDER DM/src/services/worldTree.js", "utf8");
try {
  parse(src, { ecmaVersion: "latest", sourceType: "module" });
  console.log("OK — parsed", src.length, "bytes,", src.split("\n").length, "lines");
} catch (e) {
  console.log("PARSE ERROR:", e.message);
  const loc = e.loc;
  if (loc) {
    const lines = src.split("\n");
    for (let i = Math.max(0, loc.line - 3); i < Math.min(lines.length, loc.line + 3); i++) {
      console.log((i + 1) + ":  " + lines[i]);
    }
  }
}
