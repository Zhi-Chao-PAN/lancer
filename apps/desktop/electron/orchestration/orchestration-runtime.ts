import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export const createChildThreadToolName = "create_child_thread";
export const createChildThreadAction = "pi_gui_create_child_thread";
export const listThreadsToolName = "list_threads";
export const listThreadsAction = "pi_gui_list_threads";
export const readThreadToolName = "read_thread";
export const readThreadAction = "pi_gui_read_thread";
export const sendMessageToThreadToolName = "send_message_to_thread";
export const sendMessageToThreadAction = "pi_gui_send_message_to_thread";
export interface WaitThreadsInput {
  readonly timeoutMs?: number;
  /** Internal inspection parking must not consume reports it does not return. */
  readonly acceptReports?: boolean;
}
export interface WaitThreadsToolDetails {
  readonly action: "pi_gui_wait_threads";
  readonly timedOut: boolean;
  readonly threads: readonly {
    readonly threadId: string;
    readonly title: string;
    readonly status: string;
    readonly result: string;
  }[];
}

export interface CreateChildThreadToolDetails {
  readonly action: typeof createChildThreadAction;
  readonly prompt: string;
  readonly childThreadId?: string;
  readonly childWorkspaceId?: string;
  readonly childSessionId?: string;
  readonly title?: string;
  readonly deliveryStatus?: "running" | "responded";
  readonly error?: string;
}

export interface OrchestrationThreadListEntry {
  readonly threadId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly status: string;
  readonly relationship: "current" | "child" | "workspace";
  readonly updatedAt: string;
  readonly preview: string;
  readonly childThreadId?: string;
  readonly supervisionGate?: "continue" | "wake" | "stop";
  readonly supervisionReason?: string;
  readonly nextSupervisionRunAt?: string;
}

export interface OrchestrationThreadTranscriptMessage {
  readonly id: string;
  readonly role: "parent" | "child" | "system";
  readonly text: string;
  readonly createdAt: string;
}

export interface ListThreadsToolDetails {
  readonly action: typeof listThreadsAction;
  readonly threads?: readonly OrchestrationThreadListEntry[];
  readonly error?: string;
}

export interface ReadThreadToolDetails {
  readonly action: typeof readThreadAction;
  readonly threadId: string;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly title?: string;
  readonly status?: string;
  readonly childThreadId?: string;
  readonly goal?: string;
  readonly messages?: readonly OrchestrationThreadTranscriptMessage[];
  readonly error?: string;
}

export interface SendMessageToThreadToolDetails {
  readonly action: typeof sendMessageToThreadAction;
  readonly threadId: string;
  readonly message: string;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly status?: "queued" | "sent";
  readonly queuedMessageCount?: number;
  readonly error?: string;
}

export interface OrchestrationRuntimeBridge {
  readonly waitThreads?: (
    ctx: ExtensionContext,
    input: WaitThreadsInput,
    signal?: AbortSignal,
  ) => Promise<AgentToolResult<WaitThreadsToolDetails>>;
  readonly createChildThread: (
    ctx: ExtensionContext,
    input: { readonly prompt: string; readonly toolCallId: string },
  ) => Promise<AgentToolResult<CreateChildThreadToolDetails>>;
  readonly listThreads: (ctx: ExtensionContext) => Promise<AgentToolResult<ListThreadsToolDetails>>;
  readonly readThread: (
    ctx: ExtensionContext,
    threadId: string,
  ) => Promise<AgentToolResult<ReadThreadToolDetails>>;
  readonly sendMessageToThread: (
    ctx: ExtensionContext,
    input: { readonly threadId: string; readonly message: string },
  ) => Promise<AgentToolResult<SendMessageToThreadToolDetails>>;
}

type OrchestrationToolDetails =
  | WaitThreadsToolDetails
  | CreateChildThreadToolDetails
  | ListThreadsToolDetails
  | ReadThreadToolDetails
  | SendMessageToThreadToolDetails;

interface ThreadInspectionState {
  listed?: string;
  readonly children: Set<string>;
  readonly reads: Map<string, string>;
}
const unfinished = (status: string | undefined) =>
  status !== undefined && ["running", "queued", "waiting"].includes(status);

function createCreateChildThreadTool(
  bridge: OrchestrationRuntimeBridge,
  inspection: ThreadInspectionState,
): ToolDefinition<any, OrchestrationToolDetails> {
  return {
    name: createChildThreadToolName,
    label: "Create child thread",
    description:
      "Start a separate Lancer child thread for a delegated investigation or implementation task.",
    promptSnippet: "Start a separate Lancer child thread for delegated work.",
    promptGuidelines: [
      "Use create_child_thread when the user asks you to spin up, delegate to, or run a separate child thread.",
      "Keep the child prompt self-contained: objective, relevant file paths, constraints and acceptance criteria. Never paste the full parent transcript. Child threads start without parent history; results are batched after siblings settle.",
      "After starting child tasks, use wait_threads once to wait for their reports. Do not poll list_threads/read_thread; waiting uses application events without extra model requests.",
    ],
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Concrete instructions for the child thread.",
        },
      },
      required: ["prompt"],
    },
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const prompt = createChildThreadPromptFromParams(params);
      if (!prompt) {
        throw new Error("create_child_thread requires a non-empty prompt.");
      }
      const result = await bridge.createChildThread(ctx, { prompt, toolCallId });
      if (result.details.childThreadId) inspection.children.add(result.details.childThreadId);
      return result;
    },
  };
}

function createListThreadsTool(
  bridge: OrchestrationRuntimeBridge,
  inspection: ThreadInspectionState,
): ToolDefinition<any, OrchestrationToolDetails> {
  return {
    name: listThreadsToolName,
    label: "List threads",
    description:
      "List Lancer threads visible to the current workspace and parent thread. Repeated unchanged child inspection waits for an event, then returns a fresh thread list.",
    promptSnippet: "List relevant Lancer threads for the current workspace and parent context.",
    promptGuidelines: [
      "Use list_threads before reading or messaging another Lancer thread when you need the exact thread id.",
      "Use the returned thread id with read_thread or send_message_to_thread.",
    ],
    parameters: {
      type: "object",
      properties: {},
    },
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      const result = await bridge.listThreads(ctx);
      const children = result.details.threads?.filter((t) => t.relationship === "child") ?? [];
      for (const child of children) inspection.children.add(child.childThreadId ?? child.threadId);
      const fingerprint = JSON.stringify(children.map((c) => [c.threadId, c.status]).sort());
      if (
        bridge.waitThreads &&
        children.some((c) => unfinished(c.status)) &&
        inspection.listed === fingerprint
      ) {
        await bridge.waitThreads(ctx, { acceptReports: false }, signal);
        return bridge.listThreads(ctx);
      }
      inspection.listed = fingerprint;
      return result;
    },
  };
}

function createReadThreadTool(
  bridge: OrchestrationRuntimeBridge,
  inspection: ThreadInspectionState,
): ToolDefinition<any, OrchestrationToolDetails> {
  return {
    name: readThreadToolName,
    label: "Read thread",
    description:
      "Read a Lancer thread transcript or child thread summary by id. Repeated unchanged child inspection waits for an event, then returns that thread's current transcript.",
    promptSnippet: "Read a Lancer thread transcript by id.",
    promptGuidelines: [
      "Use read_thread with a thread id returned by list_threads or create_child_thread.",
      "Prefer reading a child thread before summarizing its status back to the parent.",
    ],
    parameters: {
      type: "object",
      properties: {
        thread_id: {
          type: "string",
          description: "Thread id, child thread id, or session id to read.",
        },
      },
      required: ["thread_id"],
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const threadId = threadIdFromParams(params);
      if (!threadId) {
        return {
          content: [{ type: "text", text: "read_thread requires a thread_id." }],
          details: {
            action: readThreadAction,
            threadId: "",
            error: "read_thread requires a thread_id.",
          },
        };
      }
      const result = await bridge.readThread(ctx, threadId);
      const childId = result.details.childThreadId;
      if (
        bridge.waitThreads &&
        childId &&
        inspection.children.has(childId) &&
        unfinished(result.details.status) &&
        inspection.reads.get(childId) === result.details.status
      ) {
        await bridge.waitThreads(ctx, { acceptReports: false }, signal);
        return bridge.readThread(ctx, threadId);
      }
      if (childId && result.details.status) inspection.reads.set(childId, result.details.status);
      return result;
    },
  };
}

function createSendMessageToThreadTool(
  bridge: OrchestrationRuntimeBridge,
): ToolDefinition<any, OrchestrationToolDetails> {
  return {
    name: sendMessageToThreadToolName,
    label: "Send message to thread",
    description: "Send a follow-up message to an existing Lancer thread.",
    promptSnippet: "Send a follow-up to an existing Lancer thread.",
    promptGuidelines: [
      "Use send_message_to_thread to follow up with an existing child or sibling Lancer thread.",
      "Use a thread id returned by list_threads or create_child_thread.",
    ],
    parameters: {
      type: "object",
      properties: {
        thread_id: {
          type: "string",
          description: "Thread id, child thread id, or session id to message.",
        },
        message: {
          type: "string",
          description: "Follow-up message to send.",
        },
      },
      required: ["thread_id", "message"],
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const threadId = threadIdFromParams(params);
      const message = messageFromParams(params);
      if (!threadId || !message) {
        return {
          content: [
            { type: "text", text: "send_message_to_thread requires thread_id and message." },
          ],
          details: {
            action: sendMessageToThreadAction,
            threadId: threadId ?? "",
            message: message ?? "",
            error: "send_message_to_thread requires thread_id and message.",
          },
        };
      }
      return bridge.sendMessageToThread(ctx, { threadId, message });
    },
  };
}

export function createOrchestrationRuntimeTools(
  bridge: OrchestrationRuntimeBridge,
): readonly ToolDefinition<any, OrchestrationToolDetails>[] {
  const inspection: ThreadInspectionState = { children: new Set(), reads: new Map() };
  return [
    createCreateChildThreadTool(bridge, inspection),
    createListThreadsTool(bridge, inspection),
    createReadThreadTool(bridge, inspection),
    createSendMessageToThreadTool(bridge),
    ...(bridge.waitThreads
      ? [
          {
            name: "wait_threads",
            label: "Wait for child threads",
            description:
              "Wait for this thread's child tasks using native events, without polling or model requests. Returns each final report and consumes its automatic return once. If timed out, reports remain pending; call again or end the turn to receive an automatic return.",
            promptSnippet:
              "Wait efficiently for delegated child tasks and receive their final reports.",
            parameters: {
              type: "object",
              properties: {
                timeout_ms: {
                  type: "integer",
                  minimum: 1,
                  maximum: 120000,
                  description: "Maximum native wait; defaults to 60000 ms.",
                },
              },
            },
            async execute(
              _id: string,
              params: unknown,
              signal: AbortSignal | undefined,
              _update: unknown,
              ctx: ExtensionContext,
            ) {
              const timeoutMs =
                isRecord(params) && typeof params.timeout_ms === "number"
                  ? params.timeout_ms
                  : 60_000;
              if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
                throw new Error("timeout_ms must be 1–120000");
              return bridge.waitThreads!(ctx, { timeoutMs }, signal);
            },
          } satisfies ToolDefinition<any, OrchestrationToolDetails>,
        ]
      : []),
  ];
}

export function createOrchestrationRuntimeExtension(
  bridge: OrchestrationRuntimeBridge,
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    for (const tool of createOrchestrationRuntimeTools(bridge)) {
      pi.registerTool(tool);
    }
  };
}

export function createChildThreadPromptFromParams(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  return prompt || undefined;
}

export function createChildThreadPromptFromToolOutput(output: unknown): string | undefined {
  if (!isRecord(output) || !isRecord(output.details)) {
    return undefined;
  }
  if (output.details.action !== createChildThreadAction) {
    return undefined;
  }
  return createChildThreadPromptFromParams(output.details);
}

export function listThreadsRequestedFromToolOutput(output: unknown): boolean {
  return toolOutputDetails(output)?.action === listThreadsAction;
}

export function readThreadIdFromToolOutput(output: unknown): string | undefined {
  const details = toolOutputDetails(output);
  if (details?.action !== readThreadAction) {
    return undefined;
  }
  return threadIdFromParams(details);
}

export function sendMessageToThreadFromToolOutput(
  output: unknown,
): { readonly threadId: string; readonly message: string } | undefined {
  const details = toolOutputDetails(output);
  if (details?.action !== sendMessageToThreadAction) {
    return undefined;
  }
  const threadId = threadIdFromParams(details);
  const message = messageFromParams(details);
  if (!threadId || !message) {
    return undefined;
  }
  return { threadId, message };
}

function toolOutputDetails(output: unknown): Record<string, unknown> | undefined {
  if (!isRecord(output) || !isRecord(output.details)) {
    return undefined;
  }
  return output.details;
}

function threadIdFromParams(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const threadId =
    stringParam(params, "thread_id") ??
    stringParam(params, "threadId") ??
    stringParam(params, "id");
  return threadId || undefined;
}

function messageFromParams(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const message = stringParam(params, "message") ?? stringParam(params, "text");
  return message || undefined;
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
