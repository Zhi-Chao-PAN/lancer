import { expect, test } from "@playwright/test";
import { shouldKeepNewThreadDraft } from "../../src/features/threads/new-thread-draft";

test("returning to the same workspace keeps the unsent draft", () => {
  expect(shouldKeepNewThreadDraft("workspace-a", "workspace-a")).toBe(true);
});

test("switching to another workspace clears the draft", () => {
  expect(shouldKeepNewThreadDraft("workspace-b", "workspace-a")).toBe(false);
});

test("a surface without a resolved workspace keeps nothing", () => {
  expect(shouldKeepNewThreadDraft(undefined, "workspace-a")).toBe(false);
  expect(shouldKeepNewThreadDraft("", "")).toBe(false);
  expect(shouldKeepNewThreadDraft("", undefined)).toBe(false);
});
