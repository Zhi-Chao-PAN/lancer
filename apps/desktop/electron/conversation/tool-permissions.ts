import type { ExtensionFactory, ToolAnnotations } from "@earendil-works/pi-coding-agent";
import { t } from "../../contracts/i18n";

const localReadTools = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "list_threads",
  "read_thread",
  "wait_threads",
  "list_scheduled_tasks",
  "tool_search",
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
]);

export function requiresToolConfirmation(name: string, hints?: ToolAnnotations): boolean {
  // Server annotations are advisory, not a user-granted trust decision. Only
  // known native inspection tools are exempt; unknown/MCP tools always confirm.
  return hints?.destructiveHint === true || !localReadTools.has(name);
}

function redactValue(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
    .replace(
      /([?&](?:api[_-]?key|key|token|access_token|secret|password)=)[^&#\s"']*/gi,
      "$1[REDACTED]",
    )
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1[REDACTED]@");
}

export function approvalParameters(input: unknown): string {
  const result =
    JSON.stringify(
      input,
      (key, value: unknown) =>
        /password|secret|token|api.?key|authorization|cookie/i.test(key)
          ? "[REDACTED]"
          : typeof value === "string"
            ? redactValue(value)
            : value,
      2,
    ) ?? "{}";
  if (result.length > 16_000) throw new Error(t("extensions.approval.tooLarge"));
  return result;
}

export function createToolPermissionsExtension(): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event, ctx) => {
      const hints = pi.getAllTools().find((tool) => tool.name === event.toolName)?.annotations;
      if (!requiresToolConfirmation(event.toolName, hints)) return;
      if (ctx.signal?.aborted) return { block: true, reason: t("extensions.approval.denied") };
      if (!ctx.hasUI) return { block: true, reason: t("extensions.approval.noUI") };
      let parameters: string;
      try {
        parameters = approvalParameters(event.input);
      } catch (error) {
        return { block: true, reason: error instanceof Error ? error.message : String(error) };
      }
      let allowed = false;
      try {
        allowed = await ctx.ui.confirm(
          t("extensions.approval.title"),
          `${event.toolName}\n\n${parameters}\n\n${t("extensions.approval.once")}`,
          { signal: ctx.signal },
        );
      } catch {
        // A destroyed/disconnected dialog is not approval. Do not let a hook
        // exception fall through to the extension runner's error handling.
        return { block: true, reason: t("extensions.approval.noUI") };
      }
      if (!allowed)
        return {
          block: true,
          reason: t("extensions.approval.denied"),
        };
    });
  };
}
