import type { ExtensionFactory, ToolAnnotations } from "@earendil-works/pi-coding-agent";

const localReadTools = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "list_threads",
  "read_thread",
  "wait_threads",
  "create_child_thread",
  "send_message_to_thread",
  "list_scheduled_tasks",
  "codemode",
  "tool_search",
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
]);

export function requiresToolConfirmation(name: string, hints?: ToolAnnotations): boolean {
  if (localReadTools.has(name)) return false;
  return hints?.readOnlyHint !== true || hints.destructiveHint === true;
}

export function approvalParameters(input: unknown): string {
  const result =
    JSON.stringify(
      input,
      (key, value: unknown) =>
        /password|secret|token|api.?key|authorization|cookie/i.test(key) ? "[REDACTED]" : value,
      2,
    ) ?? "{}";
  if (result.length > 16_000) throw new Error("参数超过确认窗口上限，请拆成较小操作后重新请求。");
  return result.replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]");
}

export function createToolPermissionsExtension(): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event, ctx) => {
      const hints = pi.getAllTools().find((tool) => tool.name === event.toolName)?.annotations;
      if (!requiresToolConfirmation(event.toolName, hints)) return;
      if (!ctx.hasUI)
        return { block: true, reason: "此操作需要在 Lancer 窗口逐次确认；当前没有可用确认界面。" };
      let parameters: string;
      try {
        parameters = approvalParameters(event.input);
      } catch (error) {
        return { block: true, reason: error instanceof Error ? error.message : String(error) };
      }
      const allowed = await ctx.ui.confirm(
        "确认本次工具操作",
        `${event.toolName}\n\n${parameters}\n\n仅批准本次调用；不会保存为始终允许。`,
      );
      if (!allowed)
        return {
          block: true,
          reason: "用户未批准本次操作。保留现状，不要通过其他工具重试同一操作。",
        };
    });
  };
}
