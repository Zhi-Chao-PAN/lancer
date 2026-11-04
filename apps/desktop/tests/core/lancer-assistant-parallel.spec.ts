import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { approveFixtureTool } from "../helpers/tool-approval";
import {
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  seedAgentDir,
  writeProjectExtension,
} from "../helpers/electron-app";

test("assistant ownership, independent parallel runs, live orb output and saved joins", async () => {
  test.setTimeout(120_000);
  const profile = await makeUserDataDir(),
    agentDir = join(profile, "agent"),
    workspace = await makeWorkspace("assistant-parallel");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(profile, "ui-state.json"),
    JSON.stringify({ themeMode: "light", language: "en" }),
  );
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "parallel-fixture",
      defaultModel: "local",
      enabledModels: ["parallel-fixture/local"],
      compaction: { enabled: false },
    }),
  );
  await writeProjectExtension(
    workspace,
    "parallel-fixture.ts",
    `
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";
import { access } from "node:fs/promises";
const release = ${JSON.stringify(join(workspace, "release-parallel"))};
export default function(pi) {
  pi.registerTool({ name: "parallel_probe", label: "Parallel probe", description: "Local deterministic streaming probe", parameters: Type.Object({ tag: Type.String() }),
    async execute(id, params, signal, onUpdate) {
      let output = "";
      let i = 0;
      do {
        if (signal?.aborted) throw new Error("Probe aborted");
        output += params.tag + " line " + i++ + "\\n";
        onUpdate?.({ content: [{ type: "text", text: output }], details: {} });
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (await access(release).then(() => false, () => true));
      return { content: [{ type: "text", text: output }], details: { exitCode: 0 } };
    }
  });
  pi.registerProvider("parallel-fixture", { baseUrl: "http://127.0.0.1:9/unused", apiKey: "LOCAL_FIXTURE", api: "parallel-fixture",
    models: [{ id: "local", name: "Parallel fixture", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      const last = context.messages.at(-1);
      const user = context.messages.filter(m => m.role === "user").at(-1);
      const text = typeof user?.content === "string" ? user.content : (user?.content ?? []).filter(p => p.type === "text").map(p => p.text).join(" ");
      const tool = /worker-[AB]/.test(text) && !text.includes("[return:") && last?.role !== "toolResult";
      const content = tool ? [{ type: "toolCall", id: "probe-" + Date.now(), name: "parallel_probe", arguments: { tag: text.match(/worker-[AB]/)[0] } }] : [{ type: "text", text: text.includes("[return:") ? "RETURN_ACKNOWLEDGED" : "SAVED_REPLY" }];
      const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: tool ? "toolUse" : "stop", timestamp: Date.now() };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: { ...message, content: [] } });
      if (!tool) stream.push({ type: "text_delta", contentIndex: 0, delta: content[0].text, partial: message });
      stream.push({ type: "done", reason: tool ? "toolUse" : "stop", message }); return stream;
    }
  });
}
`,
  );
  let harness = await launchDesktop(profile, {
    agentDir,
    initialWorkspaces: [workspace],
    scrubProviderEnv: true,
    testMode: "foreground",
    envOverrides: { PI_APP_TEST_ORB: "1" },
  });
  try {
    const page = await harness.firstWindow();
    await openNewThread(page);
    await page.getByLabel("New thread prompt").fill("Parent conversation");
    await page.getByRole("button", { name: "Start thread", exact: true }).click();
    await expect(page.locator(".process-assistant")).toContainText("SAVED_REPLY");
    await expect(page.getByPlaceholder("搜索会话")).toHaveCount(0);
    const assistant = page.getByLabel("选择助手：Lancer", { exact: true });
    await assistant.click({ button: "right" });
    await expect(page.getByRole("menu", { name: "Lancer的助手操作" })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "删除", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(assistant).toBeFocused();
    await assistant.press("Shift+F10");
    await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName("重命名 AI 助手");
    await page.getByLabel("名称", { exact: true }).fill("今晚的助手");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByLabel("编辑助手：今晚的助手", { exact: true }).click();
    await page
      .locator('input[type="file"]')
      .setInputFiles(
        resolve("apps/desktop/src/features/conversation/lancer-process/avatars/a0.png"),
      );
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByLabel("选择助手：今晚的助手", { exact: true })).toBeVisible();
    const parent = await getDesktopState(page);
    await page.getByTestId("launch-parallel-tasks").click();
    await page.getByLabel("任务 1", { exact: true }).fill("worker-A");
    await page.getByLabel("任务 2", { exact: true }).fill("worker-B");
    await page.getByRole("button", { name: "并行开始", exact: true }).click();
    await expect
      .poll(async () => (await getDesktopState(page)).orchestrationChildren.length)
      .toBe(2);
    for (const child of (await getDesktopState(page)).orchestrationChildren) {
      await page.locator(`.lhc[data-l="lane:${child.childSessionId}"]`).click();
      await approveFixtureTool(page, "parallel_probe");
    }
    await page.locator(`.lhc[data-l="lane:${parent.selectedSessionId}"]`).click();
    await expect
      .poll(
        async () =>
          (await getDesktopState(page)).orchestrationChildren.filter((c) => c.status === "running")
            .length,
      )
      .toBe(2);
    const running = await getDesktopState(page);
    expect(new Set(running.orchestrationChildren.map((c) => c.childSessionId)).size).toBe(2);
    expect(
      running.orchestrationChildren.every((c) => c.childSessionId !== parent.selectedSessionId),
    ).toBe(true);
    await expect(page.locator('[data-event-type="fork"]')).toHaveCount(2);
    const orb = harness.electronApp.windows().find((p) => p.url().includes("pi-orb.html"))!;
    await expect(orb.locator(".pi-orb")).toHaveClass(/running/);
    await expect
      .poll(() =>
        orb
          .locator(".arcs")
          .evaluate((element) =>
            element.getAnimations().some((animation) => animation.playState === "running"),
          ),
      )
      .toBe(true);
    const hiddenWork = await orb.evaluate(async () => {
      let payloadCount = 0,
        outputCharacters = 0;
      (
        window as unknown as {
          piOrb: { onLanes(callback: (lanes: { output: string }[]) => void): void };
        }
      ).piOrb.onLanes((lanes) => {
        payloadCount++;
        outputCharacters += lanes.reduce((total, lane) => total + lane.output.length, 0);
      });
      let panelMutations = 0,
        ringMutations = 0;
      const panelObserver = new MutationObserver((records) => {
        panelMutations += records.length;
      });
      const ringObserver = new MutationObserver((records) => {
        ringMutations += records.length;
      });
      panelObserver.observe(document.querySelector(".pi-panel")!, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      ringObserver.observe(document.querySelector(".arcs")!, { subtree: true, childList: true });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      panelObserver.disconnect();
      ringObserver.disconnect();
      return { panelMutations, ringMutations, payloadCount, outputCharacters };
    });
    await writeFile(test.info().outputPath("orb-hidden-work.json"), JSON.stringify(hiddenWork));
    expect(hiddenWork).toMatchObject({ panelMutations: 0, ringMutations: 0, outputCharacters: 0 });
    expect(hiddenWork.payloadCount).toBeGreaterThan(0);
    await orb.locator(".pi-orb").click();
    await expect(orb.locator(".pi-panel")).toBeVisible();
    await expect.poll(() => orb.evaluate(() => innerWidth)).toBe(740);
    await expect(orb.locator(".pane")).toHaveCount(3);
    await expect
      .poll(() =>
        orb
          .locator("textarea.log")
          .evaluateAll((nodes) => nodes.map((n) => (n as HTMLTextAreaElement).value).join("\n")),
      )
      .toContain("worker-A line");
    await expect
      .poll(() =>
        orb
          .locator("textarea.log")
          .evaluateAll((nodes) => nodes.map((n) => (n as HTMLTextAreaElement).value).join("\n")),
      )
      .toContain("worker-B line");
    await orb.screenshot({ path: test.info().outputPath("real-parallel-output.png") });
    await expect(orb.getByLabel("任务完成进度")).toHaveAttribute("max", "2");
    await expect(orb.getByLabel("任务完成进度")).toHaveAttribute("value", "0");
    await orb.getByRole("button", { name: "展开代码" }).last().click();
    await expect(orb.locator(".pane")).toHaveCount(1);
    await expect(orb.locator(".log")).toHaveCSS("white-space", "pre-wrap");
    await orb.getByRole("button", { name: "自动换行" }).click();
    await expect(orb.locator(".log")).toHaveCSS("white-space", "pre");
    await orb.screenshot({ path: test.info().outputPath("expanded-cli-output.png") });
    await orb.getByRole("button", { name: "全部分支" }).click();
    await expect(orb.locator(".pane")).toHaveCount(3);
    await orb.getByLabel("收起", { exact: true }).click();
    await writeFile(join(workspace, "release-parallel"), "release");
    // Completion and delivery are distinct runtime phases; observe each separately.
    await expect
      .poll(
        async () =>
          (await getDesktopState(page)).orchestrationChildren.filter((c) => c.status === "complete")
            .length,
      )
      .toBe(2);
    await expect
      .poll(
        async () =>
          (await getDesktopState(page)).orchestrationChildren.flatMap((c) =>
            c.evidence.filter(
              (e) => e.toolName === "lancer-branch-return" && e.status === "accepted",
            ),
          ).length,
      )
      .toBe(2);
    const catalog = JSON.parse(await readFile(join(profile, "catalogs.json"), "utf8")) as {
      sessions: { sessionRef: { sessionId: string }; sessionFilePath: string }[];
    };
    const parentFile = catalog.sessions.find(
      (s) => s.sessionRef.sessionId === parent.selectedSessionId,
    )!.sessionFilePath;
    await expect
      .poll(
        async () =>
          (await readFile(parentFile, "utf8")).split("\n").filter((line) => {
            if (!line) return false;
            const row = JSON.parse(line) as {
              message?: { role: string; content?: { type: string; text?: string }[] };
            };
            return (
              row.message?.role === "assistant" &&
              row.message.content?.some((p) => p.text === "RETURN_ACKNOWLEDGED")
            );
          }).length,
      )
      .toBe(1);
    await orb.locator(".pi-orb").click();
    await expect(orb.getByLabel("任务完成进度")).toHaveAttribute("value", "2");
    await orb.getByLabel("收起", { exact: true }).click();
    const returns = page.getByRole("region", { name: "分支回传", exact: true });
    // The transcript virtualizes offscreen returns; verify the visible card.
    await expect(returns.first()).toBeVisible();
    await expect(returns.first()).not.toContainText("请向用户汇总");
    await expect(returns.first()).not.toContainText("任务：");
    await expect(returns.first()).not.toContainText("[return:");
    await expect(returns.first()).toContainText("SAVED_REPLY");
    await page.screenshot({ path: test.info().outputPath("compact-branch-returns.png") });
    await expect(page.locator('[data-event-type="merge"]')).toHaveCount(2);
    await page.getByTestId("process-focus-tree").click();
    await expect(page.locator(".lhc")).toHaveCount(3);
    await expect(page.locator('[data-event-type="fork"]')).toHaveCount(2);
    await expect(page.locator('[data-event-type="merge"]')).toHaveCount(2);
    await page.screenshot({ path: test.info().outputPath("focused-parallel-tree.png") });
    await page.getByTestId("process-global-flow").click();
    await page.screenshot({ path: test.info().outputPath("saved-parallel-tree.png") });
    const before = await getDesktopState(page);
    await harness.close();
    harness = await launchDesktop(profile, {
      agentDir,
      initialWorkspaces: [workspace],
      scrubProviderEnv: true,
      testMode: "foreground",
    });
    const restarted = await harness.firstWindow();
    await expect(restarted.getByLabel("选择助手：今晚的助手", { exact: true })).toBeVisible();
    await expect(restarted.locator('[data-event-type="merge"]')).toHaveCount(2);
    await expect(restarted.locator("[data-flight-head], [data-flight-landing]")).toHaveCount(0);
    expect((await getDesktopState(restarted)).orchestrationChildren.map((c) => c.id)).toEqual(
      before.orchestrationChildren.map((c) => c.id),
    );
    for (const module of ["视频复刻", "竞品调研", "论文查询", "GitHub 研究"]) {
      await restarted.getByRole("button", { name: module, exact: true }).click();
      await openNewThread(restarted);
      await restarted.getByLabel("New thread prompt").fill(`${module}验收`);
      await restarted.getByRole("button", { name: "Start thread", exact: true }).click();
      await expect(restarted.locator(".process-assistant").last()).toContainText("SAVED_REPLY");
    }
    await expect(restarted.locator(".lhc")).toHaveCount(7);
    await expect(restarted.locator(".rh")).toContainText("5 个会话 · 2 条分支");
    const currentLane = await restarted.locator('.lhc[data-current="true"]').getAttribute("data-l");
    await expect(
      restarted.locator(`[data-event-lane="${currentLane}"][data-event-type="commit"]`).last(),
    ).toHaveAttribute("data-delivery-state", "saved");
    await expect(restarted.locator("[data-flight-head], [data-flight-landing]")).toHaveCount(0);
    // The parent can leave either scroll viewport while its child stays visible.
    // Inspect the actual painted SVG, not a route-planner fixture or telemetry.
    const branch = restarted
      .locator('[data-testid="process-tree"] path[data-curve-kind="reference"]')
      .first();
    await expect(branch).toBeAttached();
    const branchId = await branch.getAttribute("data-curve-id");
    const readBranch = () =>
      branch.evaluate((path) => {
        const source = document.querySelector<HTMLElement>(
          `[data-anchor-key="${path.getAttribute("data-source-key")}"]`,
        )!;
        const target = document.querySelector<HTMLElement>(
          `[data-anchor-key="${path.getAttribute("data-target-key")}"]`,
        )!;
        const horizontal = path.closest(".process-tree-scroll")!.getBoundingClientRect();
        const vertical = path.closest("[data-testid='process-tree']")!.getBoundingClientRect();
        const visible = (point: { x: number; y: number }) =>
          point.x >= horizontal.left &&
          point.x <= horizontal.right &&
          point.y >= vertical.top &&
          point.y <= vertical.bottom;
        const center = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        };
        const svgPath = path as SVGPathElement;
        const matrix = svgPath.getScreenCTM()!;
        const length = svgPath.getTotalLength();
        const from = svgPath.getPointAtLength(0).matrixTransform(matrix);
        const to = svgPath.getPointAtLength(length).matrixTransform(matrix);
        const a = center(source),
          b = center(target);
        return {
          sourceVisible: visible(a),
          targetVisible: visible(b),
          sourceError: Math.hypot(from.x - a.x, from.y - a.y),
          targetError: Math.hypot(to.x - b.x, to.y - b.y),
          visibleCurve: Array.from({ length: 101 }, (_, i) =>
            visible(svgPath.getPointAtLength((length * i) / 100).matrixTransform(matrix)),
          ).some(Boolean),
        };
      });
    await branch.evaluate((path) => {
      const area = path.closest<HTMLElement>(".process-tree-scroll")!;
      const tree = path.closest<HTMLElement>("[data-testid='process-tree']")!;
      const source = document.querySelector<HTMLElement>(
        `[data-anchor-key="${path.getAttribute("data-source-key")}"]`,
      )!;
      tree.scrollTop = 0;
      area.scrollLeft +=
        source.getBoundingClientRect().right - area.getBoundingClientRect().left + 12;
    });
    await expect
      .poll(readBranch)
      .toMatchObject({ sourceVisible: false, targetVisible: true, visibleCurve: true });
    const horizontallyClipped = await readBranch();
    expect(horizontallyClipped.sourceError).toBeLessThan(1);
    expect(horizontallyClipped.targetError).toBeLessThan(1);
    await restarted.screenshot({
      path: test.info().outputPath("branch-parent-offscreen-horizontal.png"),
    });
    expect(await readBranch()).toMatchObject({
      sourceVisible: false,
      targetVisible: true,
      visibleCurve: true,
    });
    await harness.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(1180, 520),
    );
    await branch.evaluate((path) => {
      const area = path.closest<HTMLElement>(".process-tree-scroll")!;
      const tree = path.closest<HTMLElement>("[data-testid='process-tree']")!;
      const source = document.querySelector<HTMLElement>(
        `[data-anchor-key="${path.getAttribute("data-source-key")}"]`,
      )!;
      area.scrollLeft = 0;
      tree.scrollTop = source.offsetTop + 8;
    });
    await expect
      .poll(readBranch)
      .toMatchObject({ sourceVisible: false, targetVisible: true, visibleCurve: true });
    const verticallyClipped = await readBranch();
    expect(verticallyClipped.sourceError).toBeLessThan(1);
    expect(verticallyClipped.targetError).toBeLessThan(1);
    await restarted.screenshot({
      path: test.info().outputPath("branch-parent-offscreen-vertical.png"),
    });
    expect(await readBranch()).toMatchObject({
      sourceVisible: false,
      targetVisible: true,
      visibleCurve: true,
    });
    await expect(restarted.locator(`[data-curve-id="${branchId}"]`)).toHaveCount(1);
    await harness.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900),
    );
    await restarted.getByTestId("process-focus-tree").click();
    await expect(restarted.locator(".lhc")).toHaveCount(1);
    await expect(restarted.locator('[data-curve-kind="reference"]')).toHaveCount(0);
    await restarted.getByTestId("process-global-flow").click();
    await expect(restarted.locator(`[data-curve-id="${branchId}"]`)).toHaveCount(1);
    await restarted.getByLabel("添加 AI 助手", { exact: true }).click();
    await restarted.getByLabel("名称", { exact: true }).fill("临时助手");
    await restarted.getByRole("button", { name: "保存", exact: true }).click();
    await restarted.getByLabel("选择助手：临时助手", { exact: true }).click();
    await expect(restarted.getByLabel("会话所属助手")).toHaveValue(/.+/);
    await expect
      .poll(async () => {
        const state = await getDesktopState(restarted);
        return state.assistants?.owners[`${state.selectedWorkspaceId}:${state.selectedSessionId}`];
      })
      .toBe(
        (await getDesktopState(restarted)).assistants!.profiles.find((p) => p.name === "临时助手")!
          .id,
      );
    const temporaryConversation = (await getDesktopState(restarted)).selectedSessionId;
    await restarted.getByLabel("编辑助手：临时助手", { exact: true }).click({ button: "right" });
    await restarted.screenshot({ path: test.info().outputPath("assistant-context-menu.png") });
    await restarted.getByRole("menuitem", { name: "删除", exact: true }).click();
    await expect(restarted.getByRole("dialog")).toHaveAccessibleName("删除 AI 助手");
    await restarted.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(restarted.getByLabel("选择助手：临时助手", { exact: true })).toBeVisible();
    await restarted.getByLabel("选择助手：临时助手", { exact: true }).click({ button: "right" });
    await restarted.getByRole("menuitem", { name: "删除", exact: true }).click();
    await restarted.getByLabel("接收会话的助手").selectOption("lancer");
    await restarted.getByRole("button", { name: "转交并删除助手", exact: true }).click();
    await expect(restarted.getByLabel("选择助手：临时助手", { exact: true })).toHaveCount(0);
    const transferred = await getDesktopState(restarted);
    expect(
      transferred.workspaces.flatMap((w) => w.sessions).some((s) => s.id === temporaryConversation),
    ).toBe(true);
    expect(
      transferred.assistants!.owners[`${transferred.selectedWorkspaceId}:${temporaryConversation}`],
    ).toBe("lancer");
    await restarted.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    await restarted.getByRole("button", { name: "Appearance", exact: true }).click();
    await restarted.getByRole("radio", { name: "Dark", exact: true }).click();
    await restarted.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(restarted.getByTestId("lancer-process-surface")).toBeVisible();
    await expect(restarted.locator("html")).toHaveClass(/dark/);
    await expect(restarted.locator(".lhc")).toHaveCount(8);
    await restarted.screenshot({ path: test.info().outputPath("four-modules-dark.png") });
    await restarted.getByTestId("sidebar-toggle").click();
    await expect(restarted.locator(".shell-sidebar")).toBeHidden();
    await expect(restarted.getByTestId("session-trajectory-panel")).toBeVisible();
    await expect(restarted.getByTestId("lancer-process-surface")).toBeVisible();
    await restarted.screenshot({ path: test.info().outputPath("collapsed-same-layout.png") });
  } finally {
    await harness.close();
  }
});
