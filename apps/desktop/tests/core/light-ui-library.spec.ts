import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { launchDesktop, makeUserDataDir } from "../helpers/electron-app";

test("standalone light layer preserves anchors, pauses, cancels and cleans up without an idle loop", async () => {
  const harness = await launchDesktop(await makeUserDataDir(), { scrubProviderEnv: true });
  try {
    await harness.firstWindow();
    const next = harness.electronApp.waitForEvent("window");
    await harness.electronApp.evaluate(
      async ({ BrowserWindow }, url) => {
        const window = new BrowserWindow({
          width: 1200,
          height: 800,
          show: false,
          webPreferences: { sandbox: true },
        });
        await window.loadURL(url);
        // Unmapped X11 windows make Playwright captureScreenshot time out.
        window.showInactive();
      },
      pathToFileURL(resolve("packages/light-ui/demo/verify.html")).href,
    );
    const page = await next;
    await expect(page.locator("#result")).toHaveAttribute("data-status", "passed");
    await expect(page.locator("#result")).toContainText("12 checks passed");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await page.evaluate(
      async (url) => {
        const { createLightLayer } = (await import(url)) as typeof import("@lancer/light-ui");
        const layer = createLightLayer();
        const result = await layer.emit({
          id: "reduced",
          source: { x: 10, y: 10 },
          target: { x: 200, y: 200 },
          color: "#2789c3",
        }).finished;
        const value = {
          result,
          count: layer.activeCount,
          heads: document.querySelectorAll("[data-flight-head]").length,
        };
        layer.destroy();
        return value;
      },
      pathToFileURL(resolve("packages/light-ui/dist/index.js")).href,
    );
    expect(reduced).toEqual({ result: "arrived", count: 0, heads: 0 });
  } finally {
    await harness.close();
  }
});

test("standalone demo creates multiple trees, forks, merges and downloadable deliveries", async () => {
  const harness = await launchDesktop(await makeUserDataDir(), { scrubProviderEnv: true });
  try {
    await harness.firstWindow();
    const next = harness.electronApp.waitForEvent("window");
    await harness.electronApp.evaluate(
      async ({ BrowserWindow }, url) => {
        const window = new BrowserWindow({
          width: 1440,
          height: 900,
          show: false,
          webPreferences: { sandbox: true },
        });
        await window.loadURL(url);
        window.showInactive();
      },
      pathToFileURL(resolve("packages/light-ui/demo/index.html")).href,
    );
    const page = await next;
    await page.locator('[data-scenario="parallel"]').click();
    await page.getByRole("button", { name: "开始演示" }).click();
    await expect(page.locator("[data-flight-head]")).not.toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("light-ui-running.png") });
    // Wait for each actual business stage, not an entire eight-second presentation
    // against the five-second default assertion window.
    await expect(page.locator('.node[data-event="fork"]')).toHaveCount(3);
    await expect(page.locator('.node[data-event="a"],.node[data-event="b"]')).toHaveCount(6);
    await expect(page.locator('.node[data-kind="merge"]')).toHaveCount(3);
    await expect(page.locator('.node[data-kind="delivery"]')).toHaveCount(3);
    await expect(page.locator("#status")).toHaveText("交付完成");
    await expect(page.locator(".delivery")).toHaveCount(3);
    await expect(page.locator(".node[data-kind=merge]")).toHaveCount(3);
    await expect(page.locator(".node[data-kind=delivery][data-state=arrived]")).toHaveCount(3);
    await expect(page.locator("#edges path")).toHaveCount(18);
    await page.getByRole("button", { name: "聚焦当前" }).click();
    await expect(page.locator(".node:visible")).toHaveCount(6);
    await page.getByRole("button", { name: "全部会话", exact: true }).click();
    await expect(page.locator(".node:visible")).toHaveCount(18);
    await page.screenshot({ path: test.info().outputPath("light-ui-delivered.png") });
    await page.getByRole("button", { name: "重置", exact: true }).click();
    await expect(page.locator(".node")).toHaveCount(0);
    await expect(page.locator("[data-flight-head],[data-flight-landing]")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
