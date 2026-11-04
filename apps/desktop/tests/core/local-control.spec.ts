import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { approveFixtureTool } from "../helpers/tool-approval";
import { stripLancerZonePrefix } from "../../contracts/lancer-zones";
import {
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  selectSession,
  waitForWorkspaceByPath,
  writeProjectExtension,
} from "../helpers/electron-app";

const exec = promisify(execFile);
const cli = resolve("scripts/lancer-ctl.mjs");
test.use({ trace: "on" });

// Real Pi runtime, native session lease and tool execution; no credentials/network or injected events.
function providerFixture(releasePath: string, reasoning = false) {
  return `
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { access } from "node:fs/promises";
export default function localControlFixture(pi) {
  pi.on("input", async (event, ctx) => {
    if (event.text.includes("NEED_APPROVAL")) {
      const allowed = await ctx.ui.confirm("Control permission", "Approve this local-control fixture?");
      if (!allowed) return { action: "handled" };
    }
    return { action: "continue" };
  });
  pi.registerProvider("control-fixture", {
    baseUrl: "http://127.0.0.1:9/never-contact", apiKey: "LOCAL_FIXTURE", api: "control-fixture",
    models: [{ id: "scripted", name: "Local control fixture", reasoning: ${reasoning}, input: ["text"],
      contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context, options) {
      const index = context.messages.findLastIndex((message) => message.role === "user");
      const prompt = context.messages[index]?.content?.filter((part) => part.type === "text").map((part) => part.text).join(" ") || "initial";
      const finishedWrite = context.messages.slice(index + 1).some((message) => message.role === "toolResult");
      const text = "CONTROL_REPLY " + prompt;
      const message = {
        role: "assistant", content: finishedWrite ? [{ type: "text", text }] : [{ type: "toolCall",
          id: "control-write-" + Date.now(), name: "write", arguments: { path: "control-result.txt", content: prompt } }],
        api: model.api, provider: model.provider, model: model.id,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: finishedWrite ? "stop" : "toolUse", timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: { ...message, content: [] } });
      if (prompt.includes("FAIL_PROVIDER")) {
        stream.push({ type: "error", reason: "error", error: { ...message, stopReason: "error", errorMessage: "Fixture provider failure" } });
        return stream;
      }
      (async () => {
        if (prompt.includes("STOP_HOLD")) {
          while (!options?.signal?.aborted) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (prompt.includes("HOLD")) {
          while (true) {
            try { await access(${JSON.stringify(releasePath)}); break; } catch {}
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }
        if (finishedWrite) stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
        stream.push({ type: "done", reason: message.stopReason, message });
      })().catch((error) => stream.push({ type: "error", reason: "error", error: { ...message, stopReason: "error", errorMessage: String(error) } }));
      return stream;
    },
  });
}
`;
}

test("lancer-ctl drives existing Electron session, queues/steers, respects approval and settings", async ({}, testInfo) => {
  test.skip(process.platform === "win32", "Unix transport");
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("local-control");
  const agentDir = join(userDataDir, "agent");
  const releasePath = join(workspacePath, "release-control-fixture");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "control-fixture",
      defaultModel: "scripted",
      enabledModels: ["control-fixture/scripted"],
      packages: [],
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(workspacePath, "control-fixture.ts", providerFixture(releasePath));
  const options = {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background" as const,
  };
  let harness = await launchDesktop(userDataDir, options);
  const ownedPids = [harness.electronApp.process().pid];
  let traceOpen = false;
  const ctl = async (...args: string[]) =>
    exec(process.execPath, [cli, ...args, "--user-data-dir", userDataDir]);
  const json = async (...args: string[]): Promise<Record<string, unknown>> =>
    JSON.parse((await ctl(...args)).stdout) as Record<string, unknown>;
  try {
    await harness.electronApp
      .context()
      .tracing.start({ screenshots: true, snapshots: true, sources: true });
    traceOpen = true;
    let window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window
      .locator(".shell-sidebar")
      .getByRole("button", { name: "New thread", exact: true })
      .click();
    await window.getByLabel("New thread prompt", { exact: true }).fill("fixture initial");
    await window.getByRole("button", { name: "Start thread", exact: true }).click();
    await approveFixtureTool(window, "write");
    await expect(window.locator(".process-assistant .message__content")).toContainText(
      "CONTROL_REPLY fixture initial",
    );
    const initial = await getDesktopState(window);
    const id = initial.selectedSessionId;
    await ctl("wait", id, "--timeout", "10");
    const logs = await json("logs", id, "--since", "0", "--json");
    const events = logs.events as { seq: number; kind: string; text: string }[];
    expect(
      events.some(
        (event) => event.kind === "assistantDelta" && event.text.includes("CONTROL_REPLY"),
      ),
    ).toBe(true);
    expect(events.some((event) => event.kind === "toolStarted")).toBe(true);
    const cursor = events.at(-1)?.seq;
    expect(cursor).toBeGreaterThan(0);
    expect(await json("logs", id, "--since", String(cursor), "--json")).toEqual({ events: [] });
    await ctl("set-stage", id, "--stage", "verifying", "--progress", "0.5");
    const lanes = await json("lanes", "--json");
    expect(lanes.lanes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, stage: "verifying", progress: 0.5, status: "done" }),
      ]),
    );
    await window.getByTestId("composer").fill("Unsent human draft");
    const sent = await json("send", id, "HOLD external task");
    expect(sent.accepted).toBe(true);
    await expect(
      window.locator(".process-user").filter({ hasText: "HOLD external task" }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await getDesktopState(window)).workspaces
            .flatMap((w) => w.sessions)
            .find((s) => s.id === id)?.status,
      )
      .toBe("running");
    await expect(ctl("send", id, "must reject busy send")).rejects.toMatchObject({
      stderr: expect.stringContaining("SESSION_BUSY"),
    });
    await ctl("send", id, "--mode", "queue", "queued external task");
    await ctl("send", id, "--mode", "steer", "steered external task");
    await expect(window.getByTestId("composer")).toHaveValue("Unsent human draft");
    expect(
      await json("wait", id, "--timeout", "0.1").catch((error: unknown) => {
        expect(error).toMatchObject({ code: 2 });
        return { timedOut: true };
      }),
    ).toHaveProperty("timedOut", true);
    await writeFile(releasePath, "release owned fixture\n");
    for (let i = 0; i < 3; i++) await approveFixtureTool(window, "write");
    expect(await json("wait", id, "--timeout", "20")).toMatchObject({
      done: true,
      outcome: "idle",
    });
    const tail = await json("tail", id, "-n", "50", "--json");
    expect(tail.lastAssistant).toBe("CONTROL_REPLY queued external task");
    expect(await readFile(join(workspacePath, "control-result.txt"), "utf8")).toBe(
      "queued external task",
    );
    await expect(
      window
        .locator(".process-assistant .message__content")
        .filter({ hasText: "CONTROL_REPLY queued external task" }),
    ).toBeVisible();
    await expect(window.getByTestId("composer")).toHaveValue("Unsent human draft");
    expect((await getDesktopState(window)).selectedSessionId).toBe(id);
    await window.screenshot({ path: testInfo.outputPath("control-conversation.png") });

    await ctl("send", id, "STOP_HOLD interrupted task");
    await expect
      .poll(async () => {
        const result = await json("lanes", "--json");
        return (result.lanes as { id: string; status: string }[]).find((lane) => lane.id === id)
          ?.status;
      })
      .toBe("running");
    await ctl("stop", id);
    await ctl("stop", id);
    await expect(ctl("wait", id, "--timeout", "10")).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"outcome": "failed"'),
    });
    await expect(window.getByTestId("composer")).toHaveValue("Unsent human draft");

    await ctl("send", id, "NEED_APPROVAL external task");
    await expect(
      window.getByText("Approve this local-control fixture?", { exact: true }),
    ).toBeVisible();
    const listed = await json("sessions", "--json");
    expect(listed.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, status: "waiting", model: "control-fixture/scripted" }),
      ]),
    );
    await window.getByRole("button", { name: "Confirm", exact: true }).click();
    await approveFixtureTool(window, "write");
    expect(await json("wait", id, "--timeout", "20")).toMatchObject({
      done: true,
      outcome: "idle",
    });

    const created = await json(
      "new",
      "--cwd",
      workspacePath,
      "--model",
      "control-fixture/scripted",
      "--zone",
      "research",
      "--name",
      "CLI-created thread",
      "new external task",
    );
    const ref = created.session as { sessionId: string };
    expect(ref.sessionId).not.toBe(id);
    await approveFixtureTool(window, "write");
    await ctl("wait", ref.sessionId, "--timeout", "20");
    await expect(window.locator(".process-assistant .message__content")).toContainText(
      "CONTROL_REPLY new external task",
    );
    await expect(
      window.locator('[data-testid="process-session-row"][aria-current="page"]'),
    ).toContainText("CLI-created thread");
    expect((await json("sessions", "--json")).sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ref.sessionId, zoneId: "research", zone: "竞品调研" }),
      ]),
    );

    await window.getByTestId("composer").fill("Draft in new session");
    const messageFile = join(workspacePath, "external-message.txt");
    await writeFile(messageFile, "background external file task");
    await ctl("send", id, "--file", messageFile);
    expect((await getDesktopState(window)).selectedSessionId).toBe(ref.sessionId);
    // Selecting the pending session opens its modal immediately. Use the palette
    // once, rather than clicking the now-obscured session row a second time.
    await window.keyboard.press(desktopShortcut("K"));
    await window.getByTestId("command-palette-input").fill("fixture initial");
    await window.getByTestId("command-palette-input").press("Enter");
    await approveFixtureTool(window, "write");
    await ctl("wait", id, "--timeout", "20");
    await selectSession(window, "CLI-created thread");
    expect((await getDesktopState(window)).selectedSessionId).toBe(ref.sessionId);
    await expect(window.getByTestId("composer")).toHaveValue("Draft in new session");
    await expect(window.getByTestId("transcript")).not.toContainText(
      "background external file task",
    );
    const original = (await getDesktopState(window)).workspaces
      .flatMap((workspace) => workspace.sessions)
      .find((session) => session.id === id);
    expect(original).toBeDefined();
    await selectSession(window, stripLancerZonePrefix(original!.title));
    expect((await getDesktopState(window)).selectedSessionId).toBe(id);
    await expect(
      window
        .locator(".process-assistant .message__content")
        .filter({ hasText: "CONTROL_REPLY background external file task" }),
    ).toBeVisible();
    await expect(window.getByTestId("composer")).toHaveValue("Unsent human draft");
    await selectSession(window, "CLI-created thread");
    await expect(window.getByTestId("composer")).toHaveValue("Draft in new session");
    const otherWorkspace = await makeWorkspace("local-control-new-cwd");
    await writeProjectExtension(otherWorkspace, "control-fixture.ts", providerFixture(releasePath));
    const other = await json(
      "new",
      "--cwd",
      otherWorkspace,
      "--model",
      "control-fixture/scripted",
      "--zone",
      "video",
      "--name",
      "New workspace task",
      "other workspace task",
    );
    const otherRef = other.session as { sessionId: string };
    await approveFixtureTool(window, "write");
    await ctl("wait", otherRef.sessionId, "--timeout", "20");
    expect(await readFile(join(otherWorkspace, "control-result.txt"), "utf8")).toBe(
      "other workspace task",
    );
    expect((await json("sessions", "--json")).sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: otherRef.sessionId, cwd: otherWorkspace, zoneId: "video" }),
      ]),
    );
    await expect(window.locator(".process-assistant .message__content")).toContainText(
      "CONTROL_REPLY other workspace task",
    );
    await ctl("send", ref.sessionId, "FAIL_PROVIDER task");
    await expect(ctl("wait", ref.sessionId, "--timeout", "20")).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"outcome": "failed"'),
    });
    expect(await json("tail", ref.sessionId, "--json")).toMatchObject({
      error: expect.stringContaining("Fixture provider failure"),
    });

    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "General", exact: true }).click();
    const toggle = window.getByRole("switch", { name: "Allow local control API", exact: true });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect.poll(async () => (await getDesktopState(window)).localControlEnabled).toBe(false);
    await expect
      .poll(async () =>
        ctl("sessions").then(
          () => false,
          () => true,
        ),
      )
      .toBe(true);
    await window.screenshot({ path: testInfo.outputPath("control-settings-disabled.png") });
    await harness.electronApp
      .context()
      .tracing.stop({ path: testInfo.outputPath("electron-conversation.zip") });
    traceOpen = false;
    await harness.close();
    harness = await launchDesktop(userDataDir, options);
    ownedPids.push(harness.electronApp.process().pid);
    await harness.electronApp
      .context()
      .tracing.start({ screenshots: true, snapshots: true, sources: true });
    traceOpen = true;
    window = await harness.firstWindow();
    await expect.poll(async () => (await getDesktopState(window)).localControlEnabled).toBe(false);
    await expect(ctl("sessions")).rejects.toMatchObject({
      stderr: expect.stringContaining("not running or local control is disabled"),
    });
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "General", exact: true }).click();
    await window.getByRole("switch", { name: "Allow local control API", exact: true }).click();
    await expect
      .poll(async () =>
        ctl("sessions", "--json").then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
  } finally {
    // Release only our deterministic provider gate, so teardown never strands an owned run.
    await writeFile(releasePath, "teardown release\n");
    try {
      if (traceOpen)
        await harness.electronApp
          .context()
          .tracing.stop({ path: testInfo.outputPath("electron-restart.zip") });
    } finally {
      await harness.close();
    }
    const alive = (pid: number | undefined) => {
      if (pid === undefined) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (const pid of ownedPids) await expect.poll(() => alive(pid)).toBe(false);
    await testInfo.attach("control-owned-processes", {
      body: JSON.stringify(
        {
          userDataDir,
          workspacePath,
          processes: ownedPids.map((pid) => ({ pid, exited: !alive(pid) })),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  }
});

test("lancer-ctl sets thinking on an existing background session and syncs the chip after restart", async ({}, testInfo) => {
  test.skip(process.platform === "win32", "Unix transport");
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("thinking-control");
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "control-fixture",
      defaultModel: "scripted",
      defaultThinkingLevel: "medium",
      enabledModels: ["control-fixture/scripted"],
      packages: [],
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(
    workspacePath,
    "control-fixture.ts",
    providerFixture(join(workspacePath, "unused-release"), true),
  );
  const settingsBefore = await readFile(join(agentDir, "settings.json"), "utf8");
  const options = {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "foreground" as const,
  };
  let harness = await launchDesktop(userDataDir, options);
  // Exercise the public shell entry point too, not just its .mjs implementation.
  const ctl = (...args: string[]) =>
    exec(resolve("scripts/lancer-ctl"), [...args, "--user-data-dir", userDataDir]);
  try {
    let window = await harness.firstWindow();
    await harness.focusWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    // Provision a real conversation through the deterministic local provider (no network).
    const created = (
      JSON.parse(
        (
          await ctl(
            "new",
            "--cwd",
            workspacePath,
            "--name",
            "Thinking target",
            "thinking fixture initial",
          )
        ).stdout,
      ) as { session: { sessionId: string } }
    ).session;
    await approveFixtureTool(window, "write");
    await ctl("wait", created.sessionId, "--timeout", "20");
    await ctl("new", "--draft", "--cwd", workspacePath, "--name", "Other thinking session");
    await expect(window.getByTestId("thread-title")).toHaveText("Other thinking session");
    const selectedBefore = (await getDesktopState(window)).selectedSessionId;
    const chip = window.locator(".composer").getByRole("button", { name: "medium", exact: true });
    await expect(chip).toBeVisible();
    expect(JSON.parse((await ctl("set-thinking", created.sessionId, "high")).stdout)).toEqual({
      session: {
        workspaceId: (await getDesktopState(window)).selectedWorkspaceId,
        sessionId: created.sessionId,
      },
      thinkingLevel: "high",
    });
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces.flatMap((w) => w.sessions).find((s) => s.id === created.sessionId)
          ?.config?.thinkingLevel;
      })
      .toBe("high");
    expect((await getDesktopState(window)).selectedSessionId).toBe(selectedBefore);
    await expect(chip).toBeVisible();
    await selectSession(window, "Thinking target");
    await expect(
      window.locator(".composer").getByRole("button", { name: "high", exact: true }),
    ).toBeVisible();
    await ctl("set-thinking", "Thinking target", "low");
    await expect(
      window.locator(".composer").getByRole("button", { name: "low", exact: true }),
    ).toBeVisible();
    await ctl("set-thinking", created.sessionId, "high");
    await expect(
      window.locator(".composer").getByRole("button", { name: "high", exact: true }),
    ).toBeVisible();
    expect(await readFile(join(agentDir, "settings.json"), "utf8")).toBe(settingsBefore);
    await window.screenshot({ path: testInfo.outputPath("control-thinking-high.png") });
    await harness.close();
    harness = await launchDesktop(userDataDir, options);
    window = await harness.firstWindow();
    await harness.focusWindow();
    await selectSession(window, "Thinking target");
    await expect(
      window.locator(".composer").getByRole("button", { name: "high", exact: true }),
    ).toBeVisible();
    const listed = JSON.parse((await ctl("sessions", "--json")).stdout) as { sessions: unknown[] };
    expect(listed.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.sessionId, thinkingLevel: "high" }),
      ]),
    );
    await window.screenshot({ path: testInfo.outputPath("control-thinking-restarted.png") });
  } finally {
    await harness.close();
  }
});

test("lancer-ctl creates a grouped pending conversation without sending or running", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("pending-control");
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });
  try {
    await harness.firstWindow();
    const result = await exec(process.execPath, [
      cli,
      "new",
      "--draft",
      "--cwd",
      workspacePath,
      "--zone",
      "video",
      "--name",
      "待办 · 看片抽关键帧",
      "--user-data-dir",
      userDataDir,
    ]);
    const created = JSON.parse(result.stdout) as { sessionId: string; started: boolean };
    expect(created.started).toBe(false);
    const tail = await exec(process.execPath, [
      cli,
      "tail",
      created.sessionId,
      "--json",
      "--user-data-dir",
      userDataDir,
    ]);
    const record = JSON.parse(tail.stdout) as {
      messages: unknown[];
      lastAssistant: unknown;
      session: { title: string; zoneId: string; status: string };
    };
    expect(record.messages).toEqual([]);
    expect(record.lastAssistant).toBeNull();
    expect(record.session).toMatchObject({
      title: "待办 · 看片抽关键帧",
      zoneId: "video",
      status: "idle",
    });
  } finally {
    await harness.close();
  }
});
