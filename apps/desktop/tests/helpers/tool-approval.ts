import { expect, type Page } from "@playwright/test";

/** Explicit user approval for a known synthetic fixture call; never bypasses the hook. */
export async function approveFixtureTool(page: Page, tool: string): Promise<void> {
  const dialog = page.getByTestId("extension-dialog");
  await expect(dialog).toContainText(tool);
  await dialog.getByTestId("extension-dialog-confirm").click();
}
