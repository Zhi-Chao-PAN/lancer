import { expect, test } from "@playwright/test";
import { approveFixtureTool } from "../helpers/tool-approval";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { desktopIpc } from "../../contracts/ipc";
import {
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  pasteTinyPng,
  seedAgentDir,
  startThreadFromSurface,
  writeProjectExtension,
} from "../helpers/electron-app";

test("Lancer composer sends, steers and queues with drafts preserved and no redundant header actions", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("lancer-actions");
  const release = join(workspacePath, "release-actions");
  const streamRelease = join(workspacePath, "release-stream");
  const toolRelease = join(workspacePath, "release-tool");
  const toolCommand = `while [ ! -f ${JSON.stringify(toolRelease)} ]; do sleep 0.05; done; printf 'focus fixture complete'`;
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "actions-fixture",
      defaultModel: "scripted",
      enabledModels: ["actions-fixture/scripted"],
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(
    workspacePath,
    "actions-fixture.ts",
    `
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { access } from "node:fs/promises";
export default function actionsFixture(pi) {
  pi.registerProvider("actions-fixture", {
    baseUrl: "http://127.0.0.1:9/never-contact", apiKey: "LOCAL_FIXTURE", api: "actions-fixture",
    models: [{ id: "scripted", name: "Actions fixture", reasoning: false, input: ["text", "image"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      const index = context.messages.findLastIndex((message) => message.role === "user");
      const user = context.messages[index];
      const prompt = user?.content.filter((part) => part.type === "text").map((part) => part.text).join(" ") || "";
      const needsTool = prompt === "TOOL_ACTION" && !context.messages.slice(index + 1).some((message) => message.role === "toolResult");
      const text = "ACTION_REPLY " + prompt;
      const message = { role: "assistant", content: needsTool ? [{ type: "toolCall", id: "focus-tool", name: "bash", arguments: { command: ${JSON.stringify(toolCommand)} } }] : [{ type: "text", text }], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: needsTool ? "toolUse" : "stop", timestamp: Date.now() };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: { ...message, content: [] } });
      (async () => {
        if (prompt === "HOLD_ACTION") {
          while (true) { try { await access(${JSON.stringify(release)}); break; } catch {} await new Promise((resolve) => setTimeout(resolve, 25)); }
        }
        if (prompt === "FAIL_ACTION") { stream.push({ type: "error", reason: "error", error: { ...message, stopReason: "error", errorMessage: "Action fixture rejected" } }); return; }
        if (!needsTool) stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
        if (prompt === "STREAM_ACTION") {
          while (true) { try { await access(${JSON.stringify(streamRelease)}); break; } catch {} await new Promise((resolve) => setTimeout(resolve, 25)); }
        }
        stream.push({ type: "done", reason: message.stopReason, message });
      })().catch((error) => stream.push({ type: "error", reason: "error", error: { ...message, stopReason: "error", errorMessage: String(error) } }));
      return stream;
    },
  });
}
`,
  );
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    scrubProviderEnv: true,
  });
  try {
    const window = await harness.firstWindow();
    await openNewThread(window);
    await expect(window.getByTestId("lancer-process-surface")).toBeVisible();
    await expect(window.locator(".shell")).toHaveCount(0);
    await expect(window.getByTestId("new-thread-composer")).toBeFocused();
    await startThreadFromSurface(window, { prompt: "INITIAL_ACTION" });
    const composer = window.getByTestId("composer");
    await expect(window.locator(".lancer-chat-header-actions__launch")).toHaveCount(0);
    const send = window.getByTestId("send");
    await expect(window.locator(".lancer-chat-header-actions__continue")).toHaveCount(0);
    const idle = async () =>
      expect
        .poll(async () => {
          const state = await getDesktopState(window);
          return state.workspaces
            .flatMap((workspace) => workspace.sessions)
            .find((session) => session.id === state.selectedSessionId)?.status;
        })
        .toBe("idle");
    const assistant = window.locator(".process-assistant");
    await expect(assistant).toContainText(["ACTION_REPLY INITIAL_ACTION"]);
    await idle();
    await expect(window.locator(".chat-header__status")).toHaveCount(0);
    // Idle history must not keep reconstructing the animation SVG.
    await expect(window.locator("[data-flight-head], [data-flight-landing]")).toHaveCount(0);
    const idlePaints = await window.getByTestId("process-curves").evaluate(async (svg) => {
      const start = Number(svg.getAttribute("data-revision"));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return Number(svg.getAttribute("data-revision")) - start;
    });
    await writeFile(test.info().outputPath("idle-paints.json"), JSON.stringify({ idlePaints }));
    expect(idlePaints).toBeLessThanOrEqual(2);
    await harness.electronApp.evaluate(({ ipcMain }, channel) => {
      type Handler = (...args: unknown[]) => unknown;
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })
        ._invokeHandlers;
      const original = handlers.get(channel)!;
      Object.assign(globalThis, { trajectoryReads: 0 });
      handlers.set(channel, (...args) => {
        (globalThis as typeof globalThis & { trajectoryReads: number }).trajectoryReads++;
        return original(...args);
      });
    }, desktopIpc.getSessionTree);
    await composer.fill("UNSENT_ACTION");
    await window.waitForTimeout(1100); // Measure a complete tree-refresh window after typing.
    expect(
      await harness.electronApp.evaluate(
        () => (globalThis as typeof globalThis & { trajectoryReads: number }).trajectoryReads,
      ),
    ).toBe(0);
    await composer.fill("STREAM_ACTION");
    await send.click();
    const runningBubble = window.locator('.process-assistant[data-running="true"]');
    await expect(runningBubble).toContainText("ACTION_REPLY STREAM_ACTION");
    await expect(window.locator(".chat-header__status")).toHaveCount(0);
    await expect(window.locator(".composer__hint")).toBeVisible();
    await expect(runningBubble).toHaveCSS("border-radius", "6px");
    await expect(runningBubble).toHaveCSS("padding", "6px 8px");
    const bubbleBorder = runningBubble.locator(".process-running-border rect");
    await expect(bubbleBorder).toBeVisible();
    const bubbleOffset = await bubbleBorder.evaluate((el) => getComputedStyle(el).strokeDashoffset);
    await expect
      .poll(() => bubbleBorder.evaluate((el) => getComputedStyle(el).strokeDashoffset))
      .not.toBe(bubbleOffset);
    await window.screenshot({ path: test.info().outputPath("running-assistant-bubble.png") });
    await writeFile(streamRelease, "complete owned stream");
    await idle();
    await expect(runningBubble).toHaveCount(0);
    await expect(assistant.last()).toHaveCSS("border-radius", "6px");
    await composer.fill("UNSENT_ACTION");
    await pasteTinyPng(window);
    await expect(window.locator(".composer-attachment")).toHaveCount(1);
    // Opening header actions must not consume the composer draft or attachment.
    await window.getByTestId("thread-header-menu").click();
    await expect(window.getByTestId("thread-header-menu")).toHaveAttribute("aria-expanded", "true");
    await window.getByTestId("thread-header-menu").click();
    await expect(composer).toHaveValue("UNSENT_ACTION");
    expect((await getDesktopState(window)).composerAttachments).toHaveLength(1);
    await send.click();
    await expect(assistant.last()).toContainText("ACTION_REPLY UNSENT_ACTION");
    await idle();
    await expect(composer).toHaveValue("");
    expect((await getDesktopState(window)).composerAttachments).toHaveLength(0);
    await composer.fill("HOLD_ACTION");
    await send.click();
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces
          .flatMap((workspace) => workspace.sessions)
          .find((session) => session.id === state.selectedSessionId)?.status;
      })
      .toBe("running");
    await composer.fill("STEER_ACTION");
    await composer.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    // Steering is optimistically published into the transcript (not the follow-up queue).
    await expect(window.locator(".process-user").last()).toContainText("STEER_ACTION");
    await expect(composer).toHaveValue("");
    await composer.fill("FOLLOWUP_ACTION");
    await send.click();
    await expect
      .poll(async () =>
        (await getDesktopState(window)).queuedComposerMessages.map((message) => ({
          text: message.text,
          mode: message.mode,
        })),
      )
      .toContainEqual({ text: "FOLLOWUP_ACTION", mode: "followUp" });
    await expect(composer).toHaveValue("");
    await composer.fill("KEEP_DURING_RUN");
    await writeFile(release, "release owned fixture");
    await idle();
    const transcript = (await getSelectedTranscript(window))!.transcript;
    expect(
      transcript
        .filter((item) => item.kind === "message" && item.role === "assistant")
        .map((item) => ("text" in item ? item.text : "")),
    ).toEqual(
      expect.arrayContaining(["ACTION_REPLY STEER_ACTION", "ACTION_REPLY FOLLOWUP_ACTION"]),
    );
    await expect(composer).toHaveValue("KEEP_DURING_RUN");
    await composer.fill("FAIL_ACTION");
    await send.click();
    await expect(
      window.getByText("Action fixture rejected", { exact: false }).first(),
    ).toBeVisible();
    // The runtime accepted the user turn before the provider failed: retain the sent turn,
    // not a second unsent copy that would accidentally replay it.
    await expect(window.locator(".process-user").last()).toContainText("FAIL_ACTION");
    await expect(composer).toHaveValue("");
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces
          .flatMap((workspace) => workspace.sessions)
          .find((session) => session.id === state.selectedSessionId)?.status;
      })
      .not.toBe("running");
    await composer.fill("RECOVER_AFTER_FAILURE");
    await send.click();
    await expect(assistant.last()).toContainText("ACTION_REPLY RECOVER_AFTER_FAILURE");
    await idle();
    await expect(composer).toHaveValue("");
    await composer.fill("TOOL_ACTION");
    await send.click();
    await approveFixtureTool(window, "bash");
    await expect(window.locator(".process-stage__status--running")).toBeVisible();
    const border = window.locator(
      '.process-stage__head[data-running="true"] .process-running-border rect',
    );
    await expect(border).toBeVisible();
    const colors = await border.evaluate((el) => ({
      actual: getComputedStyle(el).stroke,
      lane: getComputedStyle(el.closest(".process-stage__head")!).getPropertyValue("--lc").trim(),
    }));
    await expect(border).toHaveCSS(
      "stroke",
      await border.evaluate((el, color) => {
        const probe = document.createElement("span");
        probe.style.color = color;
        el.parentElement!.append(probe);
        const rgb = getComputedStyle(probe).color;
        probe.remove();
        return rgb;
      }, colors.lane),
    );
    const offset = await border.evaluate((el) => getComputedStyle(el).strokeDashoffset);
    await expect
      .poll(() => border.evaluate((el) => getComputedStyle(el).strokeDashoffset))
      .not.toBe(offset);
    await window.screenshot({ path: test.info().outputPath("running-blue-border.png") });
    await window.emulateMedia({ reducedMotion: "reduce" });
    await expect(border).toHaveCSS("animation-name", "none");
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await expect(window.getByTestId("process-curves")).toHaveAttribute("data-endpoints", "[]");
    await writeFile(toolRelease, "complete owned real shell tool");
    await idle();
    await expect(assistant.last()).toContainText("ACTION_REPLY TOOL_ACTION");
    await expect(window.locator(".process-running-border")).toHaveCount(0);
    await expect(window.locator(".process-stage--hl")).toBeInViewport();
    await expect
      .poll(() => window.getByTestId("process-curves").getAttribute("data-endpoints"))
      .not.toBe("[]");
    await window.screenshot({ path: test.info().outputPath("completed-tool-focus.png") });
    // A real nativeBody must not force the inner disclosure permanently open.
    const outer = window.locator(".process-stage").filter({ hasText: "bash" }).last();
    if ((await outer.locator(".sgp").count()) === 0)
      await outer.locator(".process-stage__head").click();
    const group = outer.locator(".sgp");
    await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await group.click();
    const step = outer.locator(".process-tool-step").first();
    await step.locator(".process-tool-step__head").click();
    await expect(step.locator(".process-tool-step__command")).toContainText(toolCommand);
  } finally {
    await writeFile(streamRelease, "release owned stream for teardown");
    await writeFile(toolRelease, "release owned tool for teardown");
    await writeFile(release, "release owned fixture for teardown");
    await harness.close();
  }
});
