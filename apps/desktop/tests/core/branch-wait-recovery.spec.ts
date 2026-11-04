import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import {
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  openNewThread,
  writeProjectExtension,
} from "../helpers/electron-app";

test("native child waiting completes and cold restart preserves outcomes without replay", async () => {
  const profile = await makeUserDataDir();
  const agentDir = join(profile, "agent");
  const workspace = await makeWorkspace("wait-recovery");
  const requests = join(workspace, "provider-calls.ndjson");
  await writeFile(requests, "");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(join(profile, "ui-state.json"), JSON.stringify({ language: "en" }));
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "wait-test",
      defaultModel: "scripted",
      enabledModels: ["wait-test/scripted"],
      compaction: { enabled: false },
    }),
  );
  // Script only the local model. Actual orchestration tools, driver outcomes,
  // session persistence and renderer are exercised without injected events.
  await writeProjectExtension(
    workspace,
    "wait-provider.ts",
    `
import { appendFileSync } from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
export default function(pi) {
  pi.registerProvider("wait-test", {
    baseUrl: "http://127.0.0.1:9/never-contact", apiKey: "LOCAL_FIXTURE", api: "wait-test",
    models: [{ id: "scripted", name: "Wait fixture", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      appendFileSync(${JSON.stringify(requests)}, JSON.stringify({ called: true }) + "\\n");
      const parent = JSON.stringify(context.messages.find((m) => m.role === "user")).includes("PARENT_WAIT_FIXTURE");
      const results = context.messages.filter((m) => m.role === "toolResult");
      let content = [{ type: "text", text: parent ? "PARENT_WAIT_COMPLETE" : "CHILD_WAIT_COMPLETE" }];
      if (parent && !results.some((m) => m.toolName === "create_child_thread"))
        content = [{ type: "toolCall", id: "create-wait-child", name: "create_child_thread", arguments: { prompt: "CHILD_WAIT_FIXTURE: report CHILD_WAIT_COMPLETE without tools." } }];
      else if (parent && !results.some((m) => m.toolName === "wait_threads"))
        content = [{ type: "toolCall", id: "wait-child", name: "wait_threads", arguments: { timeout_ms: 10000 } }];
      const tool = content[0].type === "toolCall";
      const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: tool ? "toolUse" : "stop", timestamp: Date.now() };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: { ...message, content: [] } });
      if (!tool) stream.push({ type: "text_delta", contentIndex: 0, delta: content[0].text, partial: message });
      stream.push({ type: "done", reason: message.stopReason, message });
      return stream;
    },
  });
}
`,
  );
  const launch = () =>
    launchDesktop(profile, {
      agentDir,
      initialWorkspaces: [workspace],
      scrubProviderEnv: true,
      testMode: "background",
    });
  const first = await launch();
  let parentId = "";
  let beforeCalls = "";
  try {
    const page = await first.firstWindow();
    await openNewThread(page);
    await page
      .getByLabel("New thread prompt")
      .fill("PARENT_WAIT_FIXTURE: delegate then wait and summarize.");
    await page.getByRole("button", { name: "Start thread", exact: true }).click();
    await expect(page.locator(".process-assistant").last()).toContainText("PARENT_WAIT_COMPLETE");
    await expect
      .poll(async () => (await getDesktopState(page)).orchestrationChildren.map((c) => c.status))
      .toEqual(["complete"]);
    const transcript = JSON.stringify(await getSelectedTranscript(page));
    expect(transcript).toContain("wait_threads");
    expect(transcript).not.toContain('"toolName":"list_threads"');
    expect(transcript).not.toContain('"toolName":"read_thread"');
    parentId = (await getDesktopState(page)).selectedSessionId;
    beforeCalls = await readFile(requests, "utf8");
    await page.screenshot({ path: test.info().outputPath("child-complete.png") });
  } finally {
    await first.close();
  }
  const second = await launch();
  try {
    const page = await second.firstWindow();
    await expect
      .poll(async () => {
        const state = await getDesktopState(page);
        const child = state.orchestrationChildren[0];
        return {
          parent: state.selectedSessionId,
          child: child?.status,
          outcome: state.workspaces
            .flatMap((w) => w.sessions)
            .find((s) => s.id === child?.childSessionId)?.lastRunOutcome,
        };
      })
      .toEqual({ parent: parentId, child: "complete", outcome: "completed" });
    await expect(page.locator(".process-assistant").last()).toContainText("PARENT_WAIT_COMPLETE");
    await page.screenshot({ path: test.info().outputPath("cold-recovery.png") });
    expect(await readFile(requests, "utf8")).toBe(beforeCalls);
  } finally {
    await second.close();
  }
});
