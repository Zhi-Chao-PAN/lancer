import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { createToolPermissionsExtension } from "./tool-permissions";

/** Native Pi integrations share the same loader in inventory and real sessions. */
export async function requiredDesktopExtensions(): Promise<readonly InlineExtension[]> {
  // Electron's main bundle is CommonJS; Pi publishes an import-only ESM entry.
  const { createCodemodeExtension, createMcpExtension, createToolSearchExtension } =
    await import("@earendil-works/pi-coding-agent");
  return [
    { name: "lancer-mcp", hidden: true, factory: createMcpExtension() },
    { name: "lancer-codemode", hidden: true, factory: createCodemodeExtension() },
    { name: "lancer-tool-search", hidden: true, factory: createToolSearchExtension() },
    { name: "lancer-tool-permissions", hidden: true, factory: createToolPermissionsExtension() },
  ];
}
