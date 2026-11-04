import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test, expect } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  openNewThread,
  getDesktopState,
  openSettingsSection,
  writeProjectExtension,
} from "../helpers/electron-app";

// Only the model is scripted. Pi loads the actual stdio MCP/codemode factories,
// emits nested tool_call hooks, and runs tools only after renderer confirmation.
const provider = String.raw`
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
export default function(pi) {
  pi.registerProvider("approval-test", {
    baseUrl: "http://127.0.0.1:9/never-contact", apiKey: "LOCAL_FIXTURE", api: "approval-test",
    models: [{ id: "scripted", name: "Approval fixture", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      const index = context.messages.findLastIndex((m) => m.role === "user");
      const prompt = JSON.stringify(context.messages[index]);
      const finished = context.messages.slice(index + 1).some((m) => m.role === "toolResult");
      const direct = prompt.includes("direct");
      const text = "APPROVAL_TURN_COMPLETE";
      const message = {
        role: "assistant",
        content: finished ? [{ type: "text", text }] : [{ type: "toolCall", id: "approval-" + index,
          name: direct ? "mcp__fixture__write_note" : "codemode",
          arguments: direct ? { text: "direct" } : { code: 'const result = await tools.mcp__fixture__write_note({text: "nested"}); text(result);' },
        }],
        api: model.api, provider: model.provider, model: model.id,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: finished ? "stop" : "toolUse", timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: { ...message, content: [] } });
      if (finished) stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
      stream.push({ type: "done", reason: message.stopReason, message });
      return stream;
    },
  });
}
`;

test("MCP read-only claims and codemode cannot bypass per-call confirmation", async () => {
  const profile = await makeUserDataDir();
  const agentDir = join(profile, "agent");
  const workspace = await makeWorkspace("mcp-approval");
  const marker = join(workspace, "writes.ndjson");
  await writeFile(marker, "");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(join(profile, "ui-state.json"), JSON.stringify({ language: "en" }));
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "approval-test",
      defaultModel: "scripted",
      enabledModels: ["approval-test/scripted"],
      defaultTools: ["codemode", "read"],
      compaction: { enabled: false },
    }),
  );
  await writeFile(
    join(agentDir, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: [
            resolve("apps/desktop/tests/fixtures/mcp-approval-server.mjs"),
            marker,
            "--claim-readonly",
          ],
          exposure: "direct",
        },
      },
    }),
  );
  await writeProjectExtension(workspace, "approval-provider.ts", provider);
  const app = await launchDesktop(profile, {
    agentDir,
    initialWorkspaces: [workspace],
    scrubProviderEnv: true,
    testMode: "background",
  });
  try {
    const page = await app.firstWindow();
    const idle = () =>
      expect
        .poll(async () => {
          const state = await getDesktopState(page);
          return state.workspaces
            .flatMap((w) => w.sessions)
            .find((s) => s.id === state.selectedSessionId)?.status;
        })
        .toBe("idle");
    await openNewThread(page);
    await page.getByLabel("New thread prompt").fill("direct call with a false read-only claim");
    await page.getByRole("button", { name: "Start thread", exact: true }).click();
    const dialog = page.getByTestId("extension-dialog");
    await expect(dialog).toContainText("mcp__fixture__write_note");
    await expect(dialog).toContainText("Confirm this tool call");
    expect(await readFile(marker, "utf8")).toBe("");
    await dialog.getByTestId("extension-dialog-cancel").click();
    await expect(page.locator(".process-assistant").last()).toContainText("APPROVAL_TURN_COMPLETE");
    await idle();
    expect(await readFile(marker, "utf8")).toBe("");

    for (const approveNested of [true, false]) {
      await page.getByTestId("composer").fill("nested call " + String(approveNested));
      await page.getByTestId("send").click();
      await expect(dialog).toContainText("codemode");
      await dialog.getByTestId("extension-dialog-confirm").click();
      // Outer approval must not pre-approve the nested tool, even with readOnlyHint.
      await expect(dialog).toContainText("mcp__fixture__write_note");
      await expect(dialog).not.toContainText('"code"');
      await dialog
        .getByTestId(approveNested ? "extension-dialog-confirm" : "extension-dialog-cancel")
        .click();
      await expect(page.locator(".process-assistant").last()).toContainText(
        "APPROVAL_TURN_COMPLETE",
      );
      await idle();
      expect((await readFile(marker, "utf8")).trim().split("\n")).toEqual([
        JSON.stringify({ text: "nested" }),
      ]);
    }
    await page.screenshot({ path: test.info().outputPath("mcp-confirmed-and-cancelled.png") });
  } finally {
    await app.close();
  }
});

test("MCP integrations can be disabled in Settings and stay disabled after restart", async () => {
  const profile = await makeUserDataDir();
  const agentDir = join(profile, "agent");
  const workspace = await makeWorkspace("mcp-switches");
  await seedAgentDir(agentDir, { withOpenAiAuth: false });
  const launch = () =>
    launchDesktop(profile, {
      agentDir,
      initialWorkspaces: [workspace],
      scrubProviderEnv: true,
      testMode: "background",
    });
  for (const initial of [true, false]) {
    const app = await launch();
    try {
      const page = await app.firstWindow();
      if (!(await page.getByTestId("extensions-list").isVisible()))
        await openSettingsSection(page, "Extensions");
      for (const [label, name] of [
        ["MCP", "lancer-mcp"],
        ["Codemode", "lancer-codemode"],
        ["Tool search", "lancer-tool-search"],
      ]) {
        const toggle = page
          .getByTestId("extensions-list")
          .getByRole("switch", { name: "Enable " + label, exact: true });
        if (initial) {
          await expect(toggle).toBeChecked();
          await toggle.click();
        }
        await expect(toggle).not.toBeChecked();
        await expect
          .poll(async () => {
            const state = await getDesktopState(page);
            return Object.values(state.runtimeByWorkspace)
              .flatMap((r) => r.extensions)
              .find((e) => e.path === "<inline:" + name + ">")?.enabled;
          })
          .toBe(false);
      }
      await expect(page.getByRole("switch", { name: /lancer-tool-permissions/ })).toHaveCount(0);
    } finally {
      await app.close();
    }
  }
});
