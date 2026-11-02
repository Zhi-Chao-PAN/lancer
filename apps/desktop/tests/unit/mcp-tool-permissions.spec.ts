import { test, expect } from "@playwright/test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import {
  approvalParameters,
  requiresToolConfirmation,
  createToolPermissionsExtension,
} from "../../electron/conversation/tool-permissions";
test("mutations and unknown tools require per-call approval, including nested MCP calls", async () => {
  expect(requiresToolConfirmation("mcp__shared__get", { readOnlyHint: true })).toBe(false);
  expect(requiresToolConfirmation("mcp__shared__write", { readOnlyHint: false })).toBe(true);
  expect(requiresToolConfirmation("unknown")).toBe(true);
  expect(requiresToolConfirmation("write", { readOnlyHint: true, destructiveHint: true })).toBe(
    true,
  );
  expect(approvalParameters({ token: "DO_NOT_SHOW", page_id: "page-1" })).not.toContain(
    "DO_NOT_SHOW",
  );
  let handler: ((event: ToolCallEvent, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const pi = {
    on: (_name: string, callback: typeof handler) => {
      handler = callback;
    },
    getAllTools: () => [{ name: "mcp__fixture__write_note", annotations: { readOnlyHint: false } }],
  } as unknown as ExtensionAPI;
  await createToolPermissionsExtension()(pi);
  let confirmations = 0;
  const ctx = {
    hasUI: true,
    ui: {
      confirm: () => {
        confirmations++;
        return Promise.resolve(false);
      },
    },
  } as unknown as ExtensionContext;
  const call = {
    type: "tool_call",
    toolName: "mcp__fixture__write_note",
    input: { text: "only after approval" },
    toolCallId: "outer/1",
    parentToolCallId: "outer",
  } as ToolCallEvent;
  expect(await handler!(call, ctx)).toMatchObject({ block: true });
  expect(await handler!(call, ctx)).toMatchObject({ block: true });
  expect(confirmations).toBe(2);
  expect(await handler!(call, { ...ctx, hasUI: false })).toMatchObject({ block: true });
});
