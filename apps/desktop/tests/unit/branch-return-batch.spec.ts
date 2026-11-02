import { test, expect } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OrchestrationChildThread } from "../../contracts/desktop-state";
import { branchReturnEvidence } from "../../electron/orchestration/branch-return";
import {
  collectBranchReturnBatches,
  collectLiveBranchReturnBatches,
  delegatedTaskPrompt,
  prepareBranchReturnBatch,
} from "../../electron/orchestration/branch-return-batch";

function child(
  id: string,
  parent = "root",
  result = "完成，见 [交付](result.md)",
): OrchestrationChildThread {
  const c: OrchestrationChildThread = {
    id,
    parentWorkspaceId: "w",
    parentSessionId: parent,
    childWorkspaceId: "w",
    childSessionId: id,
    title: id,
    goal: "only this task",
    status: "complete",
    latestTranscript: result,
    transcript: [],
    evidence: [],
    createdAt: "2026-10-29T10:00:00Z",
    updatedAt: "2026-10-29T10:01:00Z",
  };
  const evidence = branchReturnEvidence(c, {
    type: "runFailed",
    sessionRef: { workspaceId: "w", sessionId: id },
    runId: id,
    timestamp: c.updatedAt,
    error: { message: result },
  })!;
  return { ...c, evidence: [evidence] };
}
test("restored pending reports do not replay model work on startup", () => {
  const old = child("restored"),
    live = child("new");
  expect(collectLiveBranchReturnBatches([old], new Set())).toEqual([]);
  const batches = collectLiveBranchReturnBatches(
    [old, live],
    new Set(live.evidence.map((e) => e.id)),
  );
  expect(batches).toHaveLength(1);
  expect(batches[0].entries.map((e) => e.child.id)).toEqual(["new"]);
});

test("siblings wait for every active dependency and return once as a group", () => {
  const a = child("a"),
    b = child("b");
  for (const status of ["running", "queued", "waiting"] as const)
    expect(collectBranchReturnBatches([a, { ...b, status }])).toEqual([]);
  const batches = collectBranchReturnBatches([a, b]);
  expect(batches).toHaveLength(1);
  expect(batches[0].entries).toHaveLength(2);
  const accepted = [a, b].map((c) => ({
    ...c,
    evidence: c.evidence.map((e) => ({ ...e, status: "accepted" as const })),
  }));
  expect(
    collectBranchReturnBatches(JSON.parse(JSON.stringify(accepted)) as OrchestrationChildThread[]),
  ).toEqual([]);
});
test("grandchildren notify only their direct parent before any ancestor", () => {
  const a = child("a"),
    b = child("b"),
    g = child("g", "a");
  expect(collectBranchReturnBatches([a, b, g]).map((b) => b.target.sessionId)).toEqual(["a"]);
  const consumed = {
    ...g,
    evidence: g.evidence.map((e) => ({ ...e, status: "accepted" as const })),
  };
  expect(collectBranchReturnBatches([{ ...a, status: "running" }, b, consumed])).toEqual([]);
  expect(collectBranchReturnBatches([a, b, consumed]).map((b) => b.target.sessionId)).toEqual([
    "root",
  ]);
});
test("progress events never create a return or model wakeup", () => {
  const c = child("a");
  expect(
    branchReturnEvidence(c, {
      type: "runStarted",
      sessionRef: { workspaceId: "w", sessionId: "a" },
      timestamp: c.updatedAt,
    }),
  ).toBeUndefined();
});
test("large reports stay on disk while summary and deliverables stay bounded", async () => {
  const root = await mkdtemp(join(tmpdir(), "lancer-return-batch-"));
  const result = "SAVED_REPLY " + "long log ".repeat(10000) + "\n[交付](result.md)";
  const batch = collectBranchReturnBatches([child("a", "root", result), child("b")])[0];
  const text = await prepareBranchReturnBatch(root, batch);
  expect(text.length).toBeLessThan(2500);
  expect(text).toContain("result.md");
  expect(text).toContain("[return:a:a]");
  expect(text).toContain("[return:b:b]");
  const files = [...text.matchAll(/\[完整分支报告\]\(([^)]+)\)/g)];
  expect(files).toHaveLength(2);
  expect(await readFile(join(root, files[0][1]), "utf8")).toContain("long log ".repeat(100));
  expect(await prepareBranchReturnBatch(root, batch)).toBe(text);
});
test("delegated task carries only the supplied brief and a short delivery contract", () => {
  const prompt = delegatedTaskPrompt("读取指定文件，交付建议.md");
  expect(prompt).toContain("读取指定文件，交付建议.md");
  expect(prompt).toContain("不自行读取无关会话历史");
  expect(prompt.length).toBeLessThan(500);
});
