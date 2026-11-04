import type { AnimationSnapshot } from "../../../../contracts/code-animation";
import type { VideoLearnSnapshot } from "../../../../contracts/video-learn";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionRef } from "@lancer/session-driver/types";
import type { DoubaoAppSnapshot } from "../../../../contracts/doubao-app";
import type { PiDesktopApi } from "../../../../contracts/ipc";
import type { DesktopAppState } from "../../../../contracts/desktop-state";

export function useDoubaoApp(api: PiDesktopApi | undefined, target: SessionRef | undefined) {
  const key = target ? `${target.workspaceId}:${target.sessionId}` : "";
  const stableTarget = useMemo(() => target, [key]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const [learningEntry, setLearningEntry] = useState<{
    key: string;
    value: VideoLearnSnapshot | null;
  }>();
  const [learningPending, setLearningPending] = useState(false);
  const learningLock = useRef(false);
  const learning = learningEntry?.key === key ? learningEntry.value : null;
  const [entry, setEntry] = useState<{ key: string; value: DoubaoAppSnapshot }>();
  const [attemptedKey, setAttemptedKey] = useState("");
  const [pendingKey, setPendingKey] = useState("");
  const [error, setError] = useState<{ key: string; text: string }>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());
  const state = entry?.key === key ? entry.value : undefined;
  const run = useCallback(
    async (operation: () => Promise<DoubaoAppSnapshot>, operationKey = key) => {
      if (!operationKey || inFlight.current.has(operationKey)) return;
      inFlight.current.add(operationKey);
      setPendingKey(operationKey);
      try {
        const next = await operation();
        if (currentKey.current === operationKey) {
          setEntry({ key: operationKey, value: next });
          setError(undefined);
        }
        return next;
      } catch (cause) {
        if (currentKey.current === operationKey)
          setError({
            key: operationKey,
            text: cause instanceof Error ? cause.message : String(cause),
          });
        return undefined;
      } finally {
        inFlight.current.delete(operationKey);
        setPendingKey((current) => (current === operationKey ? "" : current));
      }
    },
    [key],
  );

  useEffect(() => {
    if (!api || !stableTarget) return;
    let disposed = false;
    void api
      .doubaoAppStatus(stableTarget)
      .then((value) => {
        if (!disposed)
          setEntry((current) =>
            current?.key === key && current.value.error && !value.binding
              ? current
              : { key, value },
          );
      })
      .catch((cause: unknown) => {
        if (!disposed)
          setError({ key, text: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => {
      disposed = true;
    };
  }, [api, key, stableTarget]);

  useEffect(() => {
    if (!api || !stableTarget || !state?.enabled || !state.binding) return;
    const timer = setInterval(() => {
      if (!inFlight.current.has(key))
        void run(() => api.doubaoAppRefresh(stableTarget)).catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [api, key, run, stableTarget, state?.enabled, state?.binding?.conversationId]);

  useEffect(() => {
    if (!api || !stableTarget || !state?.enabled) return;
    let disposed = false;
    let pending = false;
    const update = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await api.videoLearnStatus({ workspaceId: stableTarget.workspaceId });
        if (!disposed)
          setLearningEntry({
            key,
            value: value?.sessions?.some(
              (session) =>
                session.workspaceId === stableTarget.workspaceId &&
                session.sessionId === stableTarget.sessionId,
            )
              ? value
              : null,
          });
      } catch {
        if (!disposed) setError({ key, text: "无法读取学片状态，请稍后重试。" });
      } finally {
        pending = false;
      }
    };
    void update().catch(() => undefined);
    const timer = setInterval(() => {
      void update().catch(() => undefined);
    }, 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [api, key, stableTarget, state?.enabled]);
  const learnVideo = async (videoId: string) => {
    if (!api || !stableTarget || learningLock.current || learning?.busy) return;
    learningLock.current = true;
    setLearningPending(true);
    try {
      const value = await api.videoLearnRun({
        workspaceId: stableTarget.workspaceId,
        received: { sessionId: stableTarget.sessionId, videoId },
      });
      if (currentKey.current === key) setLearningEntry({ key, value });
    } catch (cause) {
      if (currentKey.current === key)
        setError({ key, text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      learningLock.current = false;
      setLearningPending(false);
    }
  };
  const [animation, setAnimation] = useState<AnimationSnapshot | null>(null);
  const [animationPending, setAnimationPending] = useState(false);
  const animationLock = useRef(false);
  const animationVideoId = learning?.videoId;
  const mediaReady = learning?.stages.some((stage) => stage.id === "media" && stage.ok) ?? false;
  useEffect(() => {
    setAnimation(null);
    if (!api || !stableTarget || !animationVideoId || !mediaReady) return;
    let disposed = false;
    void api
      .animationRead({ workspaceId: stableTarget.workspaceId, videoId: animationVideoId })
      .then((value) => {
        if (!disposed) setAnimation(value);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [api, stableTarget, animationVideoId, mediaReady]);
  useEffect(() => {
    if (
      !api ||
      !stableTarget ||
      !animationVideoId ||
      animation?.status !== "running" ||
      animationPending
    )
      return;
    let disposed = false;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void api
        .animationRead({ workspaceId: stableTarget.workspaceId, videoId: animationVideoId })
        .then((value) => {
          if (!disposed) setAnimation(value);
        })
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    }, 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [api, stableTarget, animationVideoId, animation?.status, animationPending]);
  const runAnimation = async (action: "create" | "export", startMs = 120000, idea = "") => {
    if (!api || !stableTarget || !animationVideoId || animationLock.current) return;
    animationLock.current = true;
    setAnimationPending(true);
    setAnimation((current) =>
      current
        ? {
            ...current,
            status: "running",
            stage: action === "create" ? "Terra 正在编排代码动画" : "正在渲染并导出 MP4",
            error: null,
            scene: action === "create" ? null : current.scene,
            summary: action === "create" ? null : current.summary,
            exportPath: null,
          }
        : current,
    );
    const input = {
      workspaceId: stableTarget.workspaceId,
      videoId: animationVideoId,
      startMs,
      idea,
    };
    let pollPending = false;
    let settled = false;
    const timer = setInterval(() => {
      if (pollPending) return;
      pollPending = true;
      void api
        .animationRead(input)
        .then((value) => {
          if (!settled && currentKey.current === key) setAnimation(value);
        })
        .catch(() => undefined)
        .finally(() => {
          pollPending = false;
        });
    }, 1500);
    try {
      const value = await (action === "create"
        ? api.animationCreate(input)
        : api.animationExport(input));
      if (currentKey.current === key) setAnimation(value);
    } catch (cause) {
      setAnimation((current) =>
        current
          ? {
              ...current,
              status: "failed",
              stage: "操作失败，请重试",
              error: "E_ANIMATION_REQUEST",
            }
          : current,
      );
      if (currentKey.current === key)
        setError({ key, text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      settled = true;
      clearInterval(timer);
      animationLock.current = false;
      setAnimationPending(false);
    }
  };
  const choose = () => {
    if (!api || !stableTarget) return;
    setAttemptedKey(key);
    void run(() =>
      state?.binding
        ? api.doubaoAppSetEnabled({ target: stableTarget, enabled: true })
        : api.doubaoAppBind({ target: stableTarget }),
    ).catch(() => undefined);
  };
  const leave = async () => {
    if (inFlight.current.has(key)) return false;
    if (!api || !stableTarget || !state?.enabled) {
      setAttemptedKey("");
      return true;
    }
    const result = await run(() =>
      api.doubaoAppSetEnabled({ target: stableTarget, enabled: false }),
    );
    if (!result || result.errorCode || result.enabled) return false;
    setAttemptedKey("");
    return true;
  };
  const send = async (download: boolean) => {
    const text = drafts[key]?.trim();
    if (!api || !stableTarget || !text || state?.busy || inFlight.current.has(key)) return;
    const result = await run(() => api.doubaoAppSend({ target: stableTarget, text, download }));
    if (result && !result.errorCode) setDrafts((current) => ({ ...current, [key]: "" }));
  };
  const create = async (workspaceId: string, onState: (state: DesktopAppState) => void) => {
    if (!api || !workspaceId || inFlight.current.has("new")) return;
    inFlight.current.add("new");
    try {
      const next = await api.createSession({ workspaceId, title: "豆包 App" });
      if (next.lastError || !next.selectedSessionId)
        throw new Error(next.lastError || "会话创建失败");
      const created = { workspaceId: next.selectedWorkspaceId, sessionId: next.selectedSessionId };
      const value = await api.doubaoAppBind({ target: created });
      const createdKey = `${created.workspaceId}:${created.sessionId}`;
      setEntry({ key: createdKey, value });
      setAttemptedKey(createdKey);
      onState(next);
    } catch (cause) {
      setError({ key, text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      inFlight.current.delete("new");
    }
  };
  const animationBusy = animationPending || animation?.status === "running";
  const visibleLearning: VideoLearnSnapshot | null =
    learning && animation && animation.status !== "idle"
      ? {
          ...learning,
          busy: animationBusy,
          errorCode: animation.error,
          guiStatus: animationBusy
            ? "RUNNING"
            : animation.status === "failed"
              ? "FAILED"
              : "HANDED_OFF",
          stages: [
            ...learning.stages.filter((stage) => stage.id === "download" || stage.id === "media"),
            {
              id: "analysis",
              actor: "gateway",
              model: "gpt-6.1-terra",
              guiLabel: animation.scene ? "代码动画已编排" : animation.stage,
              statusCode: animation.scene
                ? "animation.scene.ok"
                : animationBusy
                  ? "animation.scene.running"
                  : "animation.scene.fail",
              ok: Boolean(animation.scene),
              running: animationBusy && !animation.scene,
            },
            ...(animation.scene
              ? [
                  {
                    id: "handoff" as const,
                    actor: "gateway" as const,
                    model: "gpt-6.1-sol",
                    guiLabel: animation.summary ? "复刻说明已完成" : animation.stage,
                    statusCode: animation.summary
                      ? "animation.summary.ok"
                      : animationBusy
                        ? "animation.summary.running"
                        : "animation.summary.fail",
                    ok: Boolean(animation.summary),
                    running: animationBusy && !animation.summary,
                  },
                ]
              : []),
            ...(animation.exportPath || animation.stage.includes("导出")
              ? [
                  {
                    id: "remake" as const,
                    actor: "local" as const,
                    guiLabel: animation.stage,
                    statusCode: animation.error
                      ? "remake.fail"
                      : animationBusy
                        ? "remake.running"
                        : "remake.ok",
                    ok: Boolean(animation.exportPath) && !animation.error && !animationBusy,
                    running: animationBusy,
                  },
                ]
              : []),
          ],
        }
      : learning;
  return {
    animation,
    animationPending,
    runAnimation,
    learning: visibleLearning,
    sourceLearning: learning,
    learningPending,
    learnVideo,
    state,
    ready: Boolean(state),
    createHandler: (workspaceId: string, onState: (state: DesktopAppState) => void) =>
      api?.doubaoAppAvailable
        ? () => {
            void create(workspaceId, onState).catch(() => undefined);
          }
        : undefined,
    enabled: state?.enabled === true || (Boolean(key) && attemptedKey === key),
    pending: pendingKey === key,
    error: error?.key === key ? error.text : state?.error,
    draft: drafts[key] ?? "",
    setDraft: (text: string) => setDrafts((current) => ({ ...current, [key]: text })),
    choose,
    leave,
    send,
    create,
    refresh: () => {
      if (api && stableTarget)
        void run(() => api.doubaoAppRefresh(stableTarget)).catch(() => undefined);
    },
    select: () => {
      if (api && stableTarget)
        void run(() => api.doubaoAppSelect(stableTarget)).catch(() => undefined);
    },
    bind: () => {
      if (api && stableTarget)
        void run(() => api.doubaoAppBind({ target: stableTarget })).catch(() => undefined);
    },
    openVideo: (videoId: string) => {
      if (api && stableTarget)
        void api
          .doubaoAppOpenVideo({ target: stableTarget, videoId })
          .catch((cause: unknown) =>
            setError({ key, text: cause instanceof Error ? cause.message : String(cause) }),
          );
    },
    openAccessibility: () => {
      if (api)
        void api
          .doubaoAppOpenAccessibilitySettings()
          .catch((cause: unknown) =>
            setError({ key, text: cause instanceof Error ? cause.message : String(cause) }),
          );
    },
  };
}
export type DoubaoAppController = ReturnType<typeof useDoubaoApp>;
