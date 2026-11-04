import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  desktopShortcut,
  getDesktopState,
  getSelectedTranscript,
  stubNextOpenDialogResult,
  stubNextOpenDialog,
  getOpenDialogInvocationCount,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  pasteTinyPng,
  seedAgentDir,
} from "../helpers/electron-app";

test("new thread opens directly into the focused composer", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-composer-workspace");
  const secondWorkspace = await makeWorkspace("new-thread-second-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath, secondWorkspace],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);
    await expect(window.getByTestId("new-thread-composer")).toBeFocused();
    const picker = window.locator(".new-thread__workspace");
    await expect(picker).toBeVisible();
    await picker.selectOption(secondWorkspace);
    await window.getByTestId("new-thread-composer").fill("Keep my workspace selection");
    await expect(picker).toHaveValue(secondWorkspace);
    await stubNextOpenDialogResult(harness, { canceled: true, filePaths: [] });
    await window.getByRole("button", { name: "Open Folder…", exact: true }).click();
    await expect.poll(() => getOpenDialogInvocationCount(harness)).toBe(1);
    await expect(picker).toHaveValue(secondWorkspace);
    await expect(window.getByTestId("new-thread-composer")).toHaveValue(
      "Keep my workspace selection",
    );
    const addedWorkspace = await makeWorkspace("new-thread-picked-workspace");
    await stubNextOpenDialog(harness, [addedWorkspace]);
    await window.getByRole("button", { name: "Open Folder…", exact: true }).click();
    await expect(picker).toHaveValue(addedWorkspace);

    await expect(window.getByRole("button", { name: "Open Folder…", exact: true })).toBeVisible();
    await expect(
      window.locator(".tright").getByRole("button", { name: "Workspace tools" }),
    ).toHaveCount(0);
    await expect(window.locator("img.shell-sidebar__local")).toBeVisible();
    await picker.selectOption(secondWorkspace);

    const composer = window.getByTestId("new-thread-composer");
    await expect(window.getByTestId("new-thread-logo")).toHaveCount(0);
    await expect(window.getByRole("heading", { name: "Let's build" })).toHaveCount(0);
    await expect(window.locator(".new-thread__workspace-picker")).toBeVisible();
    await expect(composer).toHaveAttribute(
      "placeholder",
      "Ask Lancer anything, use / for commands and skills",
    );

    const modelBadge = window.locator(".new-thread__hint .model-selector__badge").first();
    await expect(modelBadge).toBeVisible();
    await expect(window.locator('.new-thread input[type="file"]')).toBeHidden();

    await composer.fill("/stat");
    const slashMenu = window.getByTestId("slash-menu");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("Status");
    await composer.press("Tab");
    await expect(slashMenu).toHaveCount(0);
    await expect(composer).toHaveValue("/status");

    await composer.fill("Outline next steps /stat");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("Status");
    await composer.press("Tab");
    await expect(slashMenu).toHaveCount(0);
    await expect(composer).toHaveValue("Outline next steps /status");

    await composer.fill("");
    await pasteTinyPng(window, "new-thread-image.png", "new-thread-composer");
    const chip = window.locator(".composer-attachment");
    await expect(chip).toBeVisible();
    await expect(chip.locator(".composer-attachment__preview")).toHaveAttribute(
      "title",
      "new-thread-image.png",
    );
    await expect(chip.locator(".composer-attachment__name")).toHaveCount(0);

    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        async () => {
          const transcript = await getSelectedTranscript(window);
          const userMessage = transcript?.transcript.find(
            (entry): entry is Extract<typeof entry, { kind: "message" }> =>
              entry.kind === "message" && entry.role === "user",
          );
          return userMessage?.attachments?.map((attachment) => attachment.kind).join(",") ?? "";
        },
        { timeout: 15_000 },
      )
      .toBe("image");
    expect((await getDesktopState(window)).selectedWorkspaceId).toBe(secondWorkspace);
    await window.screenshot({ path: test.info().outputPath("workspace-selected.png") });
    const sentImage = window.getByRole("button", { name: "View new-thread-image.png" });
    await expect(sentImage).toBeVisible({ timeout: 15_000 });
    await expect(window.locator(".composer-attachment")).toHaveCount(0);
    await sentImage.click();
    await expect(window.getByTestId("image-viewer")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("image-viewer")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("new thread hides the onboarding notice after picking a thread model", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-no-default-workspace");
  await seedAgentDir(agentDir, { withDefaultModel: false });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const notice = window.getByTestId("model-onboarding-notice");
    const startButton = window.getByRole("button", { name: "Start thread" });
    const modelBadge = window.locator(".new-thread__hint .model-selector__badge").first();

    await window.getByTestId("new-thread-composer").fill("start a thread without a default");
    await expect(notice).toContainText("No default model set");
    await expect(modelBadge).toHaveText("Pick a model");
    await expect(startButton).toBeDisabled();

    await modelBadge.click();
    const dropdown = window.locator(".new-thread__hint .model-selector__dropdown").first();
    await expect(dropdown).toContainText("GPT-5");
    await expect(dropdown).toContainText("GPT-4o");
    const modelFilter = dropdown.locator(".model-selector__filter-input");
    await expect(modelFilter).toBeFocused();
    await modelFilter.fill("definitely-no-model");
    await expect(dropdown).toContainText("No matching models");
    await expect(modelBadge).toHaveText("Pick a model");
    await modelFilter.fill("4o");
    await expect(dropdown).toContainText("GPT-4o");
    await expect(dropdown).not.toContainText("GPT-5");
    await dropdown.getByRole("button", { name: /GPT-4o/ }).click();

    await expect(modelBadge).toHaveText("openai:gpt-4o");
    await expect(startButton).toBeEnabled();
    await expect(notice).toHaveCount(0);

    await startButton.click();

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId("model-onboarding-notice")).toHaveCount(0);

    const composer = window.getByTestId("composer");
    // This credential-free fixture settles with an error. Do not race the first
    // turn's transition from its initial idle state into running/failed.
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces
          .flatMap((workspace) => workspace.sessions)
          .find((session) => session.id === state.selectedSessionId)?.status;
      })
      .toBe("failed");
    const conversationBadges = window.locator(".composer .model-selector__badge");
    await expect(conversationBadges.first()).toBeEnabled();
    await conversationBadges.first().click();
    const conversationMenu = window.locator(".model-selector__dropdown:popover-open");
    await expect(conversationMenu).toBeVisible();
    await conversationMenu.locator("input").fill("GPT-5");
    await conversationMenu.getByRole("button", { name: /GPT-5/ }).first().click();
    await expect(conversationBadges.first()).toHaveText("openai:gpt-5");
    await composer.fill("continue");
    await expect(window.getByTestId("send")).toBeEnabled();
  } finally {
    await harness.close();
  }
});

test("new thread routes disabled-model recovery to settings models", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-empty-models-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const selectedWorkspaceId = (await getDesktopState(window)).selectedWorkspaceId;
    expect(selectedWorkspaceId).toBeTruthy();

    await window.evaluate(
      async ({ workspaceId }) => {
        const app = globalThis.window.piApp;
        if (!app) {
          throw new Error("piApp IPC bridge is unavailable");
        }
        await app.setScopedModelPatterns(workspaceId, ["fake-provider/fake-model"]);
      },
      { workspaceId: selectedWorkspaceId },
    );

    await window.getByTestId("new-thread-composer").fill("try to start with all models disabled");
    const modelBadge = window.locator(".new-thread__hint .model-selector__badge").first();
    await expect(modelBadge).toBeVisible();
    await expect(modelBadge).toHaveText("No models available");
    await expect(window.getByTestId("model-onboarding-notice")).toContainText("Settings > Models");
    await expect(window.getByRole("button", { name: "Start thread" })).toBeDisabled();

    await modelBadge.click();
    const dropdown = window.locator(".new-thread__hint .model-selector__dropdown").first();
    await expect(dropdown).toBeVisible();
    await expect(dropdown).toContainText("No models available");
    await expect(dropdown).not.toContainText("Open Settings > Models");
    await window.keyboard.press("Escape");
    await expect(dropdown).toBeHidden();

    await window
      .getByTestId("model-onboarding-notice")
      .getByRole("button", { name: "Open Settings > Models" })
      .click();
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await expect(window.locator(".view-header__title")).toHaveText("Models");
  } finally {
    await harness.close();
  }
});

test("refreshing after a provider becomes available auto-enables that provider's models", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-provider-connect-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["fake-provider/fake-model"],
  });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    scrubProviderEnv: true,
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const composer = window.getByTestId("new-thread-composer");
    const notice = window.getByTestId("model-onboarding-notice");
    const modelBadge = window.locator(".new-thread__hint .model-selector__badge").first();
    await composer.fill("connect provider");
    await expect(modelBadge).toHaveText("No models available");
    await expect(notice).toContainText("Open Settings > Providers");

    await writeFile(
      join(agentDir, "auth.json"),
      `${JSON.stringify({ openai: { type: "api_key", key: "test-openai-key" } }, null, 2)}\n`,
      "utf8",
    );

    const selectedWorkspaceId = (await getDesktopState(window)).selectedWorkspaceId;
    expect(selectedWorkspaceId).toBeTruthy();
    await window.evaluate(
      async ({ workspaceId }) => {
        const app = globalThis.window.piApp;
        if (!app) {
          throw new Error("piApp IPC bridge is unavailable");
        }
        await app.refreshRuntime(workspaceId);
      },
      { workspaceId: selectedWorkspaceId },
    );

    await expect(modelBadge).toHaveText("Pick a model");
    await expect(notice).toContainText("No default model set");

    await modelBadge.click();
    const dropdown = window.locator(".new-thread__hint .model-selector__dropdown").first();
    await expect(dropdown).toContainText("GPT-5");
    await expect(dropdown).toContainText("GPT-4o");
  } finally {
    await harness.close();
  }
});

test("settings do not show stale enabled-model pills when no providers are connected", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-no-provider-settings-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["openai/gpt-5", "openai/gpt-4o"],
  });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    scrubProviderEnv: true,
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    await window.getByTestId("new-thread-composer").fill("check no provider settings");
    await expect(window.getByTestId("model-onboarding-notice")).toContainText(
      "Open Settings > Providers",
    );

    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Models", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Models");

    const enabledModelsSection = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Enabled models" }),
    });
    await expect(enabledModelsSection).toContainText("No connected models available yet.");
    await expect(enabledModelsSection).not.toContainText("openai/gpt-5");
    await expect(enabledModelsSection).not.toContainText("openai/gpt-4o");
    await expect(enabledModelsSection.locator(".settings-section__title")).toContainText("0 of 0");
  } finally {
    await harness.close();
  }
});

test("new thread starts once when Enter is pressed twice before it opens", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-double-submit-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const sessionCount = async () =>
      (await getDesktopState(window)).workspaces.reduce(
        (count, workspace) => count + workspace.sessions.length,
        0,
      );
    const before = await sessionCount();
    await openNewThread(window);

    const composer = window.getByTestId("new-thread-composer");
    await composer.fill("start exactly one thread");
    // Both key presses land before the first start returns, as a fast double Enter does.
    await composer.evaluate((element) => {
      for (let press = 0; press < 2; press += 1) {
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      }
    });

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect.poll(sessionCount, { timeout: 5_000 }).toBe(before + 1);
    // Give a late second start time to land before asserting it never did.
    await window.waitForTimeout(1_000);
    expect(await sessionCount()).toBe(before + 1);
  } finally {
    await harness.close();
  }
});

test("bottom model and thinking menus stay visible and selectable after resizing", async () => {
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [await makeWorkspace("composer-menus")],
    testMode: "background",
  });
  try {
    const page = await harness.firstWindow();
    await openNewThread(page);
    const badges = page.locator(".new-thread__hint .model-selector__badge");
    for (const [width, height] of [
      [1480, 980],
      [1000, 600],
      [1000, 300],
    ]) {
      await harness.electronApp.evaluate(
        ({ BrowserWindow }, size) => {
          const window = BrowserWindow.getAllWindows()[0]!;
          window.setMinimumSize(800, 250);
          window.setContentSize(size.width, size.height);
        },
        { width, height },
      );
      for (const index of [0, 1]) {
        await badges.nth(index).click();
        const menu = page.locator(".model-selector__dropdown:popover-open");
        await expect(menu).toBeVisible();
        await expect
          .poll(async () =>
            menu.evaluate((element) => {
              const box = element.getBoundingClientRect();
              const anchor = element.parentElement!.getBoundingClientRect();
              return (
                box.top >= 0 &&
                box.left >= 0 &&
                box.right <= innerWidth &&
                box.bottom <= innerHeight &&
                box.bottom <= anchor.top
              );
            }),
          )
          .toBe(true);
        await page.screenshot({
          path: test.info().outputPath(`menu-${width}-${height}-${index}.png`),
        });
        if (height === 300 && index === 1) {
          await expect
            .poll(() => menu.evaluate((element) => element.scrollHeight > element.clientHeight))
            .toBe(true);
          await menu.hover();
          await page.mouse.wheel(0, 400);
          await expect.poll(() => menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        }
        if (index === 0) {
          await menu.locator("input").fill("GPT-5");
          await menu.getByRole("button", { name: /GPT-5/, exact: false }).first().click();
          await expect(badges.first()).toHaveText("openai:gpt-5");
        } else {
          await menu
            .locator(".model-selector__item")
            .filter({ has: page.locator(".model-selector__item-label", { hasText: /^High$/ }) })
            .click();
          await expect(badges.nth(1)).toHaveText("high");
        }
        await expect(menu).toHaveCount(0);
      }
    }
  } finally {
    await harness.close();
  }
});

test("keeps an unsent new-thread draft across Settings and New thread", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [await makeWorkspace("new-thread-draft-workspace")],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);
    const composer = window.getByTestId("new-thread-composer");
    await composer.fill("unsent draft survives view switches");

    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();

    await window.keyboard.press(desktopShortcut("N"));
    await expect(composer).toBeVisible();
    await expect(composer).toHaveValue("unsent draft survives view switches");
  } finally {
    await harness.close();
  }
});
