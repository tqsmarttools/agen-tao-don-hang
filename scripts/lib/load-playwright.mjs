import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const fallbackNodeModules = [
  process.env.CODEX_NODE_MODULES || "",
  "C:/Users/Admin/AppData/Local/OpenAI/Codex/runtimes/cua_node/1b23c930bdf84ed6/bin/node_modules",
  "C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules",
];

export async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // Fall through to explicit bundle lookup.
  }

  for (const nodeModulesDir of fallbackNodeModules) {
    if (!nodeModulesDir) {
      continue;
    }

    const packageDir = path.join(nodeModulesDir, "playwright");
    if (!existsSync(packageDir)) {
      continue;
    }

    const packageRequire = createRequire(path.join(packageDir, "package.json"));
    return packageRequire("playwright");
  }

  throw new Error(
    "Could not resolve the playwright package. Set CODEX_NODE_MODULES or use the bundled Codex runtime dependencies.",
  );
}
