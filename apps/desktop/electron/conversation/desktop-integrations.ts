import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { BuiltinExtension } from "@lancer/pi-sdk-driver";
import { createToolPermissionsExtension } from "./tool-permissions";

/** Native Pi integrations share the same loader in inventory and real sessions. */
export function requiredDesktopExtensions(): readonly InlineExtension[] {
  return [
    { name: "lancer-tool-permissions", hidden: true, factory: createToolPermissionsExtension() },
  ];
}

export async function builtinDesktopIntegrations(): Promise<readonly BuiltinExtension[]> {
  // Electron's main bundle is CommonJS; Pi publishes an import-only ESM entry.
  const { createCodemodeExtension, createMcpExtension, createToolSearchExtension } =
    await import("@earendil-works/pi-coding-agent");
  return [
    {
      name: "lancer-mcp",
      displayName: "MCP",
      description: "Native Pi MCP integrations",
      factory: createMcpExtension(),
    },
    {
      name: "lancer-codemode",
      displayName: "Codemode",
      description: "Compose tool calls in scripts",
      factory: createCodemodeExtension(),
    },
    {
      name: "lancer-tool-search",
      displayName: "Tool search",
      description: "Discover deferred tools",
      factory: createToolSearchExtension(),
    },
  ];
}
