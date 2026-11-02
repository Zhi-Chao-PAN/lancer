import { test, expect } from "@playwright/test";
import type { OrchestrationChildThread, TranscriptMessage } from "../../contracts/desktop-state";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createOrchestrationOwner } from "../../electron/orchestration/app-store-orchestration";
import {
  createOrchestrationRuntimeTools,
  type OrchestrationRuntimeBridge,
} from "../../electron/orchestration/orchestration-runtime";
const ref = { workspaceId: "w", sessionId: "root" };
const now = "2026-11-02T00:00:00.000Z";
function fixture(status: OrchestrationChildThread["status"] = "running", loaded = true) {
  let children: OrchestrationChildThread[] = [
    {
      id: "c",
      parentWorkspaceId: "w",
      parentSessionId: "root",
      childWorkspaceId: "w",
      childSessionId: "worker",
      title: "Worker",
      goal: "Readonly",
      status,
      latestTranscript: "Final report",
      transcript: [],
      evidence: [],
      createdAt: now,
      updatedAt: now,
    },
  ];
  let transcript: TranscriptMessage[] = [];
  let runtimeStatus = status === "running" ? "running" : "idle";
  const listeners = new Set<() => void | Promise<void>>();
  const host = {
    orchestrationState: () => ({ workspaces: [], orchestrationChildren: children }),
    replaceOrchestrationChildren: (next: readonly OrchestrationChildThread[]) => {
      children = [...next];
    },
    sessionFromState: () => ({ title: "Worker", status: runtimeStatus, updatedAt: now }),
    isTranscriptLoaded: () => loaded,
    getQueuedComposerMessages: () => [],
    transcriptFor: () => transcript,
    transcriptForKey: () => [],
    subscribeToSessionEvents: (listener: () => void | Promise<void>) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    persistUiState: () => Promise.resolve(),
    emit: () => ({}),
  } as unknown as Parameters<typeof createOrchestrationOwner>[0];
  return {
    owner: createOrchestrationOwner(host),
    listeners,
    children: () => children,
    cold: () => {
      runtimeStatus = "idle";
    },
    finish: async () => {
      runtimeStatus = "idle";
      transcript = [
        {
          kind: "message",
          id: "answer",
          role: "assistant",
          text: "Verified result",
          createdAt: now,
        },
      ];
      children = children.map((c) => ({
        ...c,
        status: "complete",
        evidence: [
          {
            id: "return:c",
            childThreadId: "c",
            kind: "worker_report",
            source: "worker-reported",
            status: "reported",
            title: "Report",
            toolName: "lancer-branch-return",
            detail: "Verified result",
            createdAt: now,
          },
        ],
      }));
      for (const listener of listeners) await listener();
    },
  };
}

test("cold history preserves terminal child status; interrupted workers do not remain running", () => {
  const completed = fixture("complete", false);
  expect(completed.owner.projectOrchestrationChildren()[0].status).toBe("complete");
  const interrupted = fixture("running", false);
  interrupted.cold();
  expect(interrupted.owner.projectOrchestrationChildren()[0].status).toBe("failed");
});

test("wait holds on native events and consumes the delivered report exactly once", async () => {
  const f = fixture();
  let returned = false;
  const promise = f.owner.waitThreadsToolResult(ref, { timeoutMs: 10_000 }).then((r) => {
    returned = true;
    return r;
  });
  await Promise.resolve();
  expect(returned).toBe(false);
  expect(f.listeners.size).toBe(1);
  await f.finish();
  const result = await promise;
  expect(result.details).toMatchObject({
    timedOut: false,
    threads: [{ status: "complete", result: "Verified result" }],
  });
  expect(f.children()[0].evidence[0].status).toBe("accepted");
  expect(f.listeners.size).toBe(0);
});

test("repeated unchanged thread inspection parks on native waiting instead of returning another polling turn", async () => {
  let release: (() => void) | undefined;
  let waits = 0;
  const bridge = {
    listThreads: () =>
      Promise.resolve({
        content: [],
        details: {
          action: "pi_gui_list_threads",
          threads: [
            { threadId: "c", childThreadId: "c", relationship: "child", status: "running" },
          ],
        },
      }),
    waitThreads: async () => {
      waits++;
      await new Promise<void>((r) => {
        release = r;
      });
      return {
        content: [],
        details: { action: "pi_gui_wait_threads", timedOut: false, threads: [] },
      };
    },
  } as unknown as OrchestrationRuntimeBridge;
  const tool = createOrchestrationRuntimeTools(bridge).find((t) => t.name === "list_threads")!;
  const ctx = {} as ExtensionContext;
  await tool.execute("first", {}, undefined, undefined, ctx);
  let resolved = false;
  const second = Promise.resolve(tool.execute("second", {}, undefined, undefined, ctx)).then(() => {
    resolved = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(waits).toBe(1);
  expect(resolved).toBe(false);
  release!();
  await second;
  expect(resolved).toBe(true);
});

test("timeout and cancellation release the listener without consuming results", async () => {
  const f = fixture();
  expect((await f.owner.waitThreadsToolResult(ref, { timeoutMs: 1 })).details.timedOut).toBe(true);
  expect(f.listeners.size).toBe(0);
  const controller = new AbortController();
  const pending = f.owner.waitThreadsToolResult(ref, { timeoutMs: 10_000 }, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
  expect(f.listeners.size).toBe(0);
  expect(f.children()[0].evidence).toEqual([]);
});
