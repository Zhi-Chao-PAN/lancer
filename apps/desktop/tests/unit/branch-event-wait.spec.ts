import { test, expect } from "@playwright/test";
import type { OrchestrationChildThread, TranscriptMessage } from "../../contracts/desktop-state";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SessionRuntimeMetadata } from "@lancer/session-driver";
import { createOrchestrationOwner } from "../../electron/orchestration/app-store-orchestration";
import {
  createOrchestrationRuntimeTools,
  type OrchestrationRuntimeBridge,
} from "../../electron/orchestration/orchestration-runtime";
const ref = { workspaceId: "w", sessionId: "root" };
const now = "2026-11-02T00:00:00.000Z";
function fixture(
  status: OrchestrationChildThread["status"] = "running",
  loaded = true,
  lastRunOutcome?: SessionRuntimeMetadata["lastRunOutcome"],
) {
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
    sessionFromState: () => ({
      title: "Worker",
      status: runtimeStatus,
      updatedAt: now,
      lastRunOutcome,
    }),
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

test("cold history uses persisted outcomes and preserves unknown legacy state", () => {
  const completed = fixture("complete", false);
  expect(completed.owner.projectOrchestrationChildren()[0].status).toBe("complete");
  for (const outcome of ["completed", "cancelled", "failed", "interrupted"] as const) {
    const restored = fixture("running", false, outcome);
    restored.cold();
    expect(restored.owner.projectOrchestrationChildren()[0].status).toBe(
      outcome === "completed" ? "complete" : "failed",
    );
  }
  const unknown = fixture("running", false);
  unknown.cold();
  expect(unknown.owner.projectOrchestrationChildren()[0].status).toBe("running");
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

test("inspection parking leaves reports pending for explicit wait or automatic delivery", async () => {
  const f = fixture();
  const parked = f.owner.waitThreadsToolResult(ref, { timeoutMs: 10_000, acceptReports: false });
  await f.finish();
  expect((await parked).details.timedOut).toBe(false);
  expect(f.children()[0].evidence[0].status).toBe("reported");
  expect((await f.owner.waitThreadsToolResult(ref, {})).details.timedOut).toBe(false);
  expect(f.children()[0].evidence[0].status).toBe("accepted");
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
  const second = Promise.resolve(tool.execute("second", {}, undefined, undefined, ctx)).then(
    (r) => {
      resolved = true;
      return r;
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(waits).toBe(1);
  expect(resolved).toBe(false);
  release!();
  expect((await second).details.action).toBe("pi_gui_list_threads");
  expect(resolved).toBe(true);
});

test("repeated read waits but returns a fresh read result, including after timeout", async () => {
  let status = "running";
  let waits = 0;
  const bridge = {
    listThreads: () =>
      Promise.resolve({
        content: [],
        details: {
          action: "pi_gui_list_threads",
          threads: [{ threadId: "c", childThreadId: "c", relationship: "child", status }],
        },
      }),
    readThread: () =>
      Promise.resolve({
        content: [],
        details: { action: "pi_gui_read_thread", threadId: "c", childThreadId: "c", status },
      }),
    waitThreads: () => {
      waits++;
      if (waits === 2) status = "complete";
      return Promise.resolve({
        content: [],
        details: { action: "pi_gui_wait_threads", timedOut: waits === 1, threads: [] },
      });
    },
  } as unknown as OrchestrationRuntimeBridge;
  const tools = createOrchestrationRuntimeTools(bridge);
  const ctx = {} as ExtensionContext;
  await tools
    .find((t) => t.name === "list_threads")!
    .execute("list", {}, undefined, undefined, ctx);
  const read = tools.find((t) => t.name === "read_thread")!;
  await read.execute("first", { thread_id: "c" }, undefined, undefined, ctx);
  const timedOut = await read.execute("second", { thread_id: "c" }, undefined, undefined, ctx);
  expect(timedOut.details).toMatchObject({
    action: "pi_gui_read_thread",
    threadId: "c",
    status: "running",
  });
  const completed = await read.execute("third", { thread_id: "c" }, undefined, undefined, ctx);
  expect(completed.details).toMatchObject({
    action: "pi_gui_read_thread",
    threadId: "c",
    status: "complete",
  });
  expect(waits).toBe(2);
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
