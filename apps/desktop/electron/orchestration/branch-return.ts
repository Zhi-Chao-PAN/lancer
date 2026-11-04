import type { SessionDriverEvent } from "@lancer/session-driver";
import type {
  OrchestrationChildThread,
  OrchestrationEvidenceRecord,
} from "../../contracts/desktop-state";

export const BRANCH_RETURN_TOOL = "lancer-branch-return";
// Shared with legacy persisted-report recovery; display copy must stay in sync.
export const FAILED_BRANCH_RETURN_TITLE = "分支失败回传";
export function branchReturnEvidence(
  child: OrchestrationChildThread,
  event: SessionDriverEvent,
): OrchestrationEvidenceRecord | undefined {
  if (event.type !== "runCompleted" && event.type !== "runFailed") return;
  if (
    child.childSessionId !== event.sessionRef.sessionId ||
    child.childWorkspaceId !== event.sessionRef.workspaceId
  )
    return;
  if (event.type === "runCompleted" && event.outcome === "aborted") return;
  if (child.supervisionLoop?.gate === "stop") return;
  const id = `return:${child.id}:${event.runId ?? event.timestamp}`;
  if (child.evidence.some((e) => e.id === id)) return;
  const failed = event.type === "runFailed";
  const result = failed ? event.error.message : child.latestTranscript;
  return {
    id,
    childThreadId: child.id,
    kind: "worker_report",
    source: "worker-reported",
    status: "reported",
    title: failed ? FAILED_BRANCH_RETURN_TITLE : "分支完成回传",
    toolName: BRANCH_RETURN_TOOL,
    detail: `[${id}]\n并行分支「${child.title}」${failed ? "失败" : "已完成"}。\n任务：${child.goal}\n结果（分支报告，需核对）：\n${result}\n\n请向用户汇总前，先核对此分支的交付物，并继续完成你在当前会话中已获授权的原任务，包括要求生成的汇总文件。尚有依赖未完成时说明进展；依赖齐备后完成原定交付。不要因为这条回传自动重试或创建额外任务。`,
    parentSessionId: child.parentSessionId,
    childSessionId: child.childSessionId,
    createdAt: event.timestamp,
  };
}
