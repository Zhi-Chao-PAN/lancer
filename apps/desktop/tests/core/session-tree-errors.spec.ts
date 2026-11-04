import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import {
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedNamedTextSessionFixture,
} from "../helpers/electron-app";
import { desktopIpc } from "../../contracts/ipc";

test("a failed tree stays on its conversation and node while neighboring trees remain usable", async () => {
  const profile = await makeUserDataDir(),
    agentDir = join(profile, "agent"),
    workspace = await makeWorkspace("tree-errors");
  await seedAgentDir(agentDir, { withOpenAiAuth: false });
  await writeFile(
    join(profile, "ui-state.json"),
    JSON.stringify({ language: "en", themeMode: "light" }),
  );
  const failed = await seedNamedTextSessionFixture(agentDir, workspace, {
    title: "lancer-zone:research|资料核验",
    userText: "核验来源",
    assistantText: "资料已收集。",
  });
  const healthy = await seedNamedTextSessionFixture(agentDir, workspace, {
    title: "lancer-zone:github|代码研究",
    userText: "阅读仓库",
    assistantText: "代码研究仍然可用。",
  });
  const harness = await launchDesktop(profile, {
    agentDir,
    initialWorkspaces: [workspace],
    scrubProviderEnv: true,
  });
  try {
    const page = await harness.firstWindow();
    await page.getByRole("button", { name: "GitHub 研究", exact: true }).click();
    await expect
      .poll(async () => (await getDesktopState(page)).selectedSessionId)
      .toBe(healthy.sessionId);
    await expect(page.locator("[data-tree-rail]")).toHaveCount(2);
    // Inject a backend read failure, keeping the real Electron bridge and renderer.
    await harness.electronApp.evaluate(
      ({ ipcMain }, { channel, id }) => {
        type Handler = (...args: unknown[]) => unknown;
        const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers?: Map<string, Handler> })
          ._invokeHandlers;
        const original = handlers?.get(channel);
        if (!original) throw new Error("Missing tree handler");
        const control = { fail: true };
        (globalThis as typeof globalThis & { treeReadFault?: typeof control }).treeReadFault =
          control;
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (...args) => {
          const target = args[1] as { sessionId?: string };
          if (control.fail && target.sessionId === id)
            throw new Error("History fixture temporarily unavailable");
          return original(...args);
        });
      },
      { channel: desktopIpc.getSessionTree, id: failed.sessionId },
    );
    // Visible windows read every lane during the first paint. Reload so the
    // next read happens after the fault is installed.
    await page.reload();
    await expect(page.getByRole("button", { name: "竞品调研", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "竞品调研", exact: true }).click();
    await expect(page.locator('.lhc[data-tree-error="true"]')).toHaveCount(1);
    await expect(page.locator(".conversation-tree-error")).toContainText(
      "这个会话的历史树暂时无法读取",
    );
    await expect(
      page.getByRole("button", { name: "错误 · 历史读取失败", exact: true }),
    ).toHaveCount(1);
    await expect(page.locator(".rp2 .tree-load-notice")).toHaveCount(0);
    await page.locator(".conversation-tree-error summary").click();
    await page.screenshot({ path: test.info().outputPath("local-tree-error.png") });
    await page.getByRole("button", { name: "GitHub 研究", exact: true }).click();
    await expect(page.locator(".conversation-tree-error")).toHaveCount(0);
    await expect(page.locator(".process-assistant").last()).toContainText("代码研究仍然可用");
    expect((await getDesktopState(page)).selectedSessionId).toBe(healthy.sessionId);
    await expect(page.locator('.lhc[data-tree-error="true"]')).toHaveCount(1);
    await page.getByRole("button", { name: "竞品调研", exact: true }).click();
    await expect(page.locator(".conversation-tree-error")).toBeVisible();
    await harness.electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & { treeReadFault?: { fail: boolean } })
        .treeReadFault;
      if (control) control.fail = false;
    });
    await page.getByRole("button", { name: "重新读取", exact: true }).click();
    await expect(page.locator(".conversation-tree-error")).toHaveCount(0);
    await expect(page.locator('.lhc[data-tree-error="true"]')).toHaveCount(0);
    await expect(page.locator("[data-tree-rail]")).toHaveCount(2);
  } finally {
    await harness.close();
  }
});
