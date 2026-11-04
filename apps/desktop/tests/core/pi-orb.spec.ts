import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, seedAgentDir } from "../helpers/electron-app";
import { makeLancerScreenshotFixture } from "../helpers/lancer-screenshot-fixture";

test("desktop orb expands, opens a session and keeps monitoring on outside focus", async () => {
  test.setTimeout(90_000);
  const output = process.env.LANCER_ORB_OUTPUT ?? test.info().outputPath("orb");
  await mkdir(output, { recursive: true });
  const profile = await makeUserDataDir();
  const agentDir = join(profile, "agent");
  await seedAgentDir(agentDir, { withOpenAiAuth: false });
  const fixture = await makeLancerScreenshotFixture(agentDir, profile);
  const harness = await launchDesktop(profile, {
    agentDir,
    initialWorkspaces: fixture.initialWorkspaces,
    testMode: "foreground",
    envOverrides: { PI_APP_TEST_ORB: "1" },
  });
  try {
    await expect
      .poll(() =>
        harness.electronApp
          .windows()
          .find((page) => page.url().includes("pi-orb.html"))
          ?.url(),
      )
      .toContain("pi-orb.html");
    const orb = harness.electronApp.windows().find((page) => page.url().includes("pi-orb.html"))!;
    await expect
      .poll(() =>
        harness.electronApp
          .windows()
          .find((page) => page !== orb && page.url().includes("index.html"))
          ?.url(),
      )
      .toContain("index.html");
    await expect(orb.locator(".pi-orb")).toBeVisible();
    const animations = await Promise.all(
      harness.electronApp.windows().map(async (page) => ({
        url: page.url(),
        animations: await page.evaluate(() =>
          document.getAnimations().map((animation) => ({
            name: animation instanceof CSSAnimation ? animation.animationName : "transition",
            target: (animation.effect as KeyframeEffect)?.target?.outerHTML.slice(0, 200),
            state: animation.playState,
            iterations: animation.effect?.getTiming().iterations,
          })),
        ),
      })),
    );
    await writeFile(join(output, "animations.json"), JSON.stringify(animations, null, 2));

    await expect
      .poll(() =>
        orb.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" &&
                  animation.effect?.getTiming().iterations === Infinity,
              ).length,
        ),
      )
      .toBe(0);
    await orb.screenshot({ path: join(output, "orb-collapsed.png"), omitBackground: true });
    await orb.locator(".pi-orb").click();
    await expect(orb.locator(".pi-panel")).not.toHaveClass(/closed/);
    await expect(orb.locator(".pane").first()).toBeVisible();
    await orb.screenshot({ path: join(output, "orb-panel.png"), omitBackground: true });
    await orb.locator(".pane .t").first().click();
    await expect(orb.locator(".pi-panes")).toHaveClass(/solo/);
    await orb.locator("[data-open]").click();
    await expect(orb.locator(".pi-panel")).toHaveClass(/closed/);
    await orb.locator(".pi-orb").click();
    await expect(orb.locator(".pi-panel")).not.toHaveClass(/closed/);
    // Drive and observe the owned renderer windows. Global main-process focus
    // polling races the inspector execution context while Electron activates a window.
    const mainWindow = harness.electronApp
      .windows()
      .find((page) => page.url().includes("index.html"))!;
    await orb.bringToFront();
    await expect.poll(() => orb.evaluate(() => document.hasFocus())).toBe(true);
    await mainWindow.bringToFront();
    await expect.poll(() => mainWindow.evaluate(() => document.hasFocus())).toBe(true);
    await expect(orb.locator(".pi-panel")).not.toHaveClass(/closed/);
    await expect.poll(() => orb.evaluate(() => innerWidth)).toBe(740);
    await orb.getByLabel("收起", { exact: true }).click();
    await expect(orb.locator(".pi-panel")).toHaveClass(/closed/);
  } finally {
    await harness.close();
  }
});
