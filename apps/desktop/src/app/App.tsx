import { useAssistantScope } from "../features/conversation/lancer-process/use-assistant-scope";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeSnapshot } from "@lancer/session-driver/runtime-types";
import {
  getSelectedSession,
  type AppView,
  type CreateScheduledTaskInput,
} from "../../contracts/desktop-state";
import {
  nonCompletedBindingForSession,
  scheduledOriginsByMessageId,
} from "../../contracts/scheduled-tasks";
import { t } from "../../contracts/i18n";
import { updateSnapshot, useDesktopAppState } from "./desktop-app-state";
import { DesktopStartupSurface, toStartupSurfaceState } from "./desktop-recovery";
import { buildFileWorkbenchContexts } from "./file-workbench-contexts";
import { canTogglePrimarySidebar } from "./app-shell-utils";
import { useDesktopCommands } from "./use-desktop-commands";
import { useRunningLabel } from "../features/conversation/hooks/use-running-label";
import { useTimelineViewport } from "../features/conversation/hooks/use-timeline-viewport";
import {
  buildProcessBlocks,
  processViewportRows,
} from "../features/conversation/process-timeline/build-process-blocks";
import { buildDisplayTimelineItems } from "../features/conversation/timeline-turns";
import { useTurnChanges } from "../features/conversation/hooks/use-turn-changes";
import { restoreTopmostDialogFocus } from "../ui/dialog-focus";
import { useDoubaoApp } from "../features/conversation/doubao-app/use-doubao-app";
import {
  DoubaoAppComposer,
  DoubaoAppTranscript,
} from "../features/conversation/doubao-app/doubao-app-surface";
import { ComposerPanel } from "../features/conversation/composer-panel";
import { SchemaSkewNotice } from "../features/conversation/schema-skew-notice";
import type { DiffPanelFileRequest } from "../features/workbench/diff-panel-types";
import { useWorkbench } from "../features/workbench/use-workbench";
import type { ExtensionViewTheme } from "../features/extensions/extension-view-panel";
import { useExtensionViews } from "../features/extensions/use-extension-views";
import { useExtensionHostActions } from "../features/extensions/use-extension-host-actions";
import { useSidePanelTabHintsVisible } from "../features/workbench/side-panel-tab-hints";
import { Workbench } from "../features/workbench/workbench";
import { useWorkbenchWidth } from "../features/workbench/use-workbench-width";
import { useConversationFileActions } from "./use-conversation-file-actions";
import { buildModelOptions } from "../features/conversation/composer-commands";
import { getDesktopShortcutLabel } from "../../contracts/ipc";
import { CommandPaletteSurface } from "../features/command-palette/command-palette-surface";
import { deriveModelOnboardingState } from "../features/settings/model-onboarding";
import type { SettingsSection } from "../features/settings/settings-view";
import { SecondarySurfaces } from "./secondary-surfaces";
import { NewThreadEntry } from "../features/threads/new-thread-entry";
import {
  buildThreadSidebarModel,
  sessionThreadKey,
  type ThreadListEntry,
} from "../features/threads/thread-groups";
import { Sidebar } from "../features/threads/sidebar";
import { ThreadSwitcher } from "../features/threads/thread-switcher";
import {
  loadThreadSwitcherOrder,
  orderThreadSwitcherEntries,
  saveThreadSwitcherOrder,
  touchThreadSwitcherOrder,
} from "../features/threads/thread-switcher-order";
import { useThreadSwitcher } from "../features/threads/hooks/use-thread-switcher";
import { SidebarToggleButton } from "../features/threads/sidebar-toggle-button";
import { guardComposerAction, sessionModelActions } from "./session-model-actions";
import { ThreadDialogs } from "./thread-dialogs";
import { Topbar } from "./topbar";
import { ThreadToolPanel } from "./thread-tool-panel";
import { ConversationTimeline } from "../features/conversation/conversation-timeline";
import { TrajectoryPanel } from "../features/conversation/session-trajectory/trajectory-panel";
import { StartupDiagnostics } from "./startup-diagnostics";
import { ThreadEmptySurface } from "./thread-empty-surface";
import { LancerLiveSurface } from "../features/conversation/lancer-process/live-surface";
import { useLancerTrajectory } from "../features/conversation/session-trajectory/use-lancer-trajectory";
import { TrajectoryFocusCurve } from "../features/conversation/session-trajectory/trajectory-focus-curve";
import { LancerRecentThreads } from "../features/threads/lancer-recent-threads";
import { ModelReel } from "../features/conversation/model-reel";
import { ThreadHeaderControls } from "./thread-header-controls";
import { LancerLaneOverview } from "../features/conversation/lancer-lane-overview";
import { LANCER_PROTOTYPE_UI } from "../../contracts/lancer-ui";
import { conversationModule } from "../../contracts/lancer-modules";
import type { VideoLearnSnapshot } from "../../contracts/video-learn";
import { VideoLearnBar } from "../features/conversation/video-learn-bar";
import { ScheduledTasksView } from "../features/scheduled-tasks/scheduled-tasks-view";
import {
  ScheduledTaskEditor,
  type ScheduledEditorState,
} from "../features/scheduled-tasks/scheduled-task-editor";
import { ScheduledTaskChip } from "../features/scheduled-tasks/scheduled-task-chip";
import { useSlashMenu } from "../features/conversation/hooks/use-slash-menu";
import { useMentionMenu } from "../features/conversation/hooks/use-mention-menu";
import { useThreadSearch } from "../features/conversation/hooks/use-thread-search";
import { useWorkspaceMenu } from "../features/threads/hooks/use-workspace-menu";
import { useThreadActions } from "../features/threads/hooks/use-thread-actions";
import { useNewThreadController } from "../features/threads/hooks/use-new-thread-controller";
import {
  buildExtensionDockModel,
  hasExtensionDockContent,
} from "../features/extensions/extension-session-ui";
import { getEffectiveModelRuntime } from "../features/settings/model-settings";
import { applyTheme, getActiveTheme, useActiveTheme } from "../ui/active-theme";
import { deriveWorkspaceContext } from "./workspace-context";
import { useTreeForkModals } from "../features/conversation/hooks/use-tree-fork-modals";
import { useComposerDraftSync } from "../features/conversation/hooks/use-composer-draft-sync";
import { useSessionComposer } from "../features/conversation/hooks/use-session-composer";

export default function App() {
  const desktop = useDesktopAppState();
  const workbenchWidth = useWorkbenchWidth();
  const snapshot = desktop.snapshot;
  const setSnapshot = desktop.setSnapshot;
  const selectedTranscript = desktop.selectedTranscript;
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState("");
  const [skillsWorkspaceId, setSkillsWorkspaceId] = useState("");
  const [extensionsWorkspaceId, setExtensionsWorkspaceId] = useState("");
  // Unknown until main answers; until then the theme from the last launch stays.
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark" | null>(null);
  const [dockExpandedBySession, setDockExpandedBySession] = useState<Record<string, string>>({});
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const timelinePaneRef = useRef<HTMLDivElement | null>(null);
  const [dismissedSchemaSkewSessionKeys, setDismissedSchemaSkewSessionKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const selectThreadRef = useRef<(target: { workspaceId: string; sessionId: string }) => void>(
    () => {},
  );
  const [diffFileRequest, setDiffFileRequest] = useState<{
    readonly sessionKey: string;
    readonly request: DiffPanelFileRequest;
  } | null>(null);
  const [scheduledEditor, setScheduledEditor] = useState<ScheduledEditorState | null>(null);
  const api = window.piApp;

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi) return;

    void piApi
      .getResolvedTheme()
      .then((theme) => {
        setResolvedTheme(theme);
      })
      .catch((error: unknown) => {
        console.error("[renderer] getResolvedTheme failed", error);
        // Keep the variant painted at startup so preset changes still apply.
        setResolvedTheme((current) => current ?? getActiveTheme().variant);
      });

    const unsub = piApi.onThemeChanged((theme) => {
      setResolvedTheme(theme);
    });

    return unsub;
  }, []);

  useEffect(() => {
    const themePresetId = snapshot?.themePresetId;
    if (!resolvedTheme || !themePresetId) return;
    applyTheme(themePresetId, resolvedTheme);
  }, [resolvedTheme, snapshot?.themePresetId]);

  useEffect(() => {
    document.documentElement.classList.toggle(
      "enable-transparency",
      snapshot?.enableTransparency ?? false,
    );
  }, [snapshot?.enableTransparency]);

  const activeTheme = useActiveTheme();
  const extensionViewTheme = useMemo<ExtensionViewTheme>(
    () => ({
      mode: activeTheme.variant,
      background: activeTheme.tokens["--main"] ?? "",
      foreground: activeTheme.tokens["--text"] ?? "",
      accent: activeTheme.tokens["--accent"] ?? "",
    }),
    [activeTheme],
  );

  const {
    activeWorktrees,
    linkedWorktreeByWorkspaceId,
    rootWorkspace,
    rootWorkspaceOptions,
    selectedWorkspace,
    visibleWorkspaces,
  } = useMemo(() => deriveWorkspaceContext(snapshot), [snapshot]);
  const selectedSession = snapshot
    ? (getSelectedSession(snapshot) ?? selectedWorkspace?.sessions[0])
    : undefined;
  const doubao = useDoubaoApp(
    api,
    selectedWorkspace && selectedSession
      ? { workspaceId: selectedWorkspace.id, sessionId: selectedSession.id }
      : undefined,
  );
  const selectDoubao = api?.doubaoAppAvailable ? doubao.choose : undefined;
  const selectedRuntime = selectedWorkspace
    ? snapshot?.runtimeByWorkspace[selectedWorkspace.id]
    : undefined;
  const selectedModelRuntime = snapshot
    ? getEffectiveModelRuntime(snapshot, selectedWorkspace)
    : undefined;
  const selectedWorktree = selectedWorkspace
    ? linkedWorktreeByWorkspaceId.get(selectedWorkspace.id)
    : undefined;
  const selectedModelOptions = buildModelOptions(selectedModelRuntime);
  const selectedDefaultEnabled = selectedModelOptions.some(
    (m) =>
      m.providerId === selectedModelRuntime?.settings.defaultProvider &&
      m.modelId === selectedModelRuntime?.settings.defaultModelId,
  );
  const resolvedSessionProvider =
    selectedSession?.config?.provider ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultProvider : undefined);
  const resolvedSessionModelId =
    selectedSession?.config?.modelId ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultModelId : undefined);
  const resolvedSessionThinkingLevel =
    selectedSession?.config?.thinkingLevel ?? selectedModelRuntime?.settings.defaultThinkingLevel;
  const selectedSessionModelOnboarding = deriveModelOnboardingState(selectedModelRuntime, {
    provider: resolvedSessionProvider,
    modelId: resolvedSessionModelId,
  });
  const queuedComposerMessages = snapshot?.queuedComposerMessages ?? [];
  const editingQueuedMessageId = snapshot?.editingQueuedMessageId;
  const runningLabel = useRunningLabel(
    selectedSession?.status === "running" ? selectedSession.runningSince : undefined,
  );
  const selectedSessionKey =
    selectedWorkspace && selectedSession ? `${selectedWorkspace.id}:${selectedSession.id}` : "";
  const [videoLearn, setVideoLearn] = useState<VideoLearnSnapshot | null>(null);
  const workbenchTarget = useMemo(
    () =>
      selectedWorkspace && selectedSession
        ? { workspaceId: selectedWorkspace.id, sessionId: selectedSession.id }
        : null,
    [selectedWorkspace?.id, selectedSession?.id],
  );
  const {
    composerDraft,
    setComposerDraft,
    composerDraftRef,
    flushComposerDraft,
    flushComposerDraftAsync,
  } = useComposerDraftSync({ api, snapshot, selectedSession: workbenchTarget });
  const extensionViews = useExtensionViews({ api, target: workbenchTarget });
  const workbench = useWorkbench({ api, target: workbenchTarget });
  // Tracked while the panel is closed too, so a chord that opens it shows the hints.
  const sidePanelTabHintsVisible = useSidePanelTabHintsVisible(api?.platform ?? "linux");
  const workbenchTargetRef = useRef(workbenchTarget);
  workbenchTargetRef.current = workbenchTarget;
  const extensionHostActions = useExtensionHostActions({
    api,
    target: workbenchTarget,
    workbench,
    flushComposerDraftAsync,
  });
  const activeTool = workbench.activeTool;
  const activeExtensionView =
    activeTool?.kind === "extension"
      ? extensionViews.views.find(
          (view) => view.extensionId === activeTool.extensionId && view.id === activeTool.viewId,
        )
      : undefined;
  const workbenchRef = useRef(workbench);
  workbenchRef.current = workbench;
  const selectedToolId =
    workbench.view.selection.kind === "tool" ? workbench.view.selection.toolId : null;
  const sidePanelAvailable = snapshot?.activeView === "threads" && Boolean(workbenchTarget);
  const sidePanelVisible = sidePanelAvailable && workbench.view.visibility === "visible";
  const selectedTranscriptForSession =
    selectedTranscript &&
    selectedWorkspace &&
    selectedSession &&
    selectedTranscript.workspaceId === selectedWorkspace.id &&
    selectedTranscript.sessionId === selectedSession.id
      ? selectedTranscript
      : null;
  const activeTranscript = selectedTranscriptForSession?.transcript ?? [];
  const scheduledOrigins = useMemo(() => {
    if (!snapshot || !selectedWorkspace || !selectedSession) {
      return new Map();
    }
    return scheduledOriginsByMessageId(
      snapshot.scheduledTasks,
      selectedWorkspace.id,
      selectedSession.id,
      activeTranscript,
    );
  }, [activeTranscript, selectedSession, selectedWorkspace, snapshot]);
  const scheduledBinding = selectedSession
    ? nonCompletedBindingForSession(snapshot?.scheduledTasks ?? [], selectedSession.id)
    : undefined;
  const transcriptHydration = desktop.view.kind === "ready" ? desktop.view.transcript : undefined;
  const transcriptFailed = transcriptHydration?.kind === "failed" ? transcriptHydration : null;
  const isTranscriptLoading =
    Boolean(selectedSession) && !selectedTranscriptForSession && !transcriptFailed;
  const selectedSessionRunning = selectedSession?.status === "running";
  const turnChanges = useTurnChanges({
    api,
    target: workbenchTarget,
    running: selectedSessionRunning,
    workbench,
  });
  const timelineRows = useMemo(
    () =>
      buildDisplayTimelineItems(activeTranscript, {
        lastTurnRunning: selectedSessionRunning,
        turnChanges: turnChanges.turns,
      }),
    [activeTranscript, selectedSessionRunning, turnChanges.turns],
  );
  const processBlocks = useMemo(() => buildProcessBlocks(timelineRows), [timelineRows]);
  const showSchemaSkewNotice =
    selectedTranscriptForSession?.schemaInfo?.writtenByNewerRuntime === true &&
    Boolean(selectedSessionKey) &&
    !dismissedSchemaSkewSessionKeys.has(selectedSessionKey);
  const viewportRows = useMemo(() => processViewportRows(processBlocks), [processBlocks]);
  const viewport = useTimelineViewport({
    sessionKey: selectedSessionKey,
    rows: viewportRows,
    active: snapshot?.activeView === "threads" && Boolean(selectedSession),
    transcriptReady: !isTranscriptLoading && !transcriptFailed,
    paneRef: timelinePaneRef,
    gap:
      LANCER_PROTOTYPE_UI && !snapshot?.startupDiagnostics.length && !showSchemaSkewNotice ? 6 : 16,
  });
  const threadSearch = useThreadSearch(
    timelinePaneRef,
    viewport.navigateToElement,
    viewport.setSearchMode,
  );
  const selectedSessionCommands = selectedSession
    ? (snapshot?.sessionCommandsBySession[selectedSessionKey] ?? [])
    : [];
  const selectedExtensionUi = selectedSession
    ? snapshot?.sessionExtensionUiBySession[selectedSessionKey]
    : undefined;
  const selectedWorkspaceCommandCompatibility = selectedWorkspace
    ? (snapshot?.extensionCommandCompatibilityByWorkspace[selectedWorkspace.id] ?? [])
    : [];
  const fileWorkbenchContexts = useMemo(
    () =>
      buildFileWorkbenchContexts({
        workspaces: snapshot?.workspaces ?? [],
        selectedWorkspace,
        selectedSessionTitle: selectedExtensionUi?.title || selectedSession?.title,
        rootWorkspace,
        activeWorktrees,
      }),
    [
      activeWorktrees,
      rootWorkspace,
      selectedExtensionUi?.title,
      selectedSession?.title,
      selectedWorkspace,
      snapshot?.workspaces,
    ],
  );
  const selectedExtensionDock = useMemo(
    () => buildExtensionDockModel(selectedExtensionUi),
    [selectedExtensionUi],
  );
  const displayedSessionTitle = selectedExtensionUi?.title ?? selectedSession?.title ?? "";
  const activeExtensionDialog = selectedExtensionUi?.pendingDialogs[0];
  const selectedExtensionUiInstance =
    snapshot?.sessionExtensionUiBySession[selectedSessionKey]?.instanceId;
  const isSelectedExtensionDockExpanded =
    selectedExtensionUiInstance !== undefined &&
    dockExpandedBySession[selectedSessionKey] === selectedExtensionUiInstance;
  const threadSidebarModel = useMemo(
    () => (snapshot ? buildThreadSidebarModel(snapshot) : undefined),
    [snapshot],
  );
  const {
    assistants,
    assistantId,
    threads: assistantThreads,
    archivedSessions,
    selectAssistant,
  } = useAssistantScope(
    snapshot,
    threadSidebarModel?.recencyOrder,
    workbenchTarget,
    (target) => selectThreadRef.current(target),
    setSnapshot,
  );
  const {
    trajectory: sessionTrajectory,
    highlightedId: highlightedTimelineId,
    selectNode: handleTrajectoryNodeSelect,
    onChatClick,
  } = useLancerTrajectory({
    target: workbenchTarget,
    title: displayedSessionTitle,
    threads: assistantThreads,
    children: snapshot?.orchestrationChildren,
    rows: timelineRows,
    transcriptReady: Boolean(selectedTranscriptForSession),
    viewport,
    onSelectThread: (target) => selectThreadRef.current(target),
  });
  const assistantLaneLabel =
    LANCER_PROTOTYPE_UI && selectedSession
      ? conversationModule(selectedSession.title, snapshot?.assistants).label
      : undefined;
  const threadSidebarModelRef = useRef(threadSidebarModel);
  threadSidebarModelRef.current = threadSidebarModel;
  const threadOnScreenKey = snapshot?.activeView === "threads" ? selectedSessionKey : "";
  const threadOnScreenKeyRef = useRef(threadOnScreenKey);
  threadOnScreenKeyRef.current = threadOnScreenKey;
  useEffect(() => {
    // Opening a thread is use; sending always happens in the thread on screen.
    if (!threadOnScreenKey) return;
    saveThreadSwitcherOrder(touchThreadSwitcherOrder(loadThreadSwitcherOrder(), threadOnScreenKey));
  }, [threadOnScreenKey]);
  const threadSwitcher = useThreadSwitcher({
    readSource: () => {
      const currentKey = threadOnScreenKeyRef.current;
      const stored = loadThreadSwitcherOrder();
      // Another window may have used a thread since this one did.
      const order = currentKey ? touchThreadSwitcherOrder(stored, currentKey) : stored;
      const recencyOrder = threadSidebarModelRef.current?.recencyOrder ?? [];
      const entries = orderThreadSwitcherEntries(recencyOrder, order);
      const first = entries[0];
      return {
        entries,
        firstIsCurrent: first !== undefined && sessionThreadKey(first) === currentKey,
      };
    },
    onSelect: (entry) =>
      selectThreadRef.current({ workspaceId: entry.workspaceId, sessionId: entry.session.id }),
  });
  const threadShortcutOrderRef = useRef<readonly ThreadListEntry[] | null>(null);
  const focusComposer = () => {
    window.requestAnimationFrame(() => {
      if (restoreTopmostDialogFocus()) {
        return;
      }
      composerRef.current?.focus();
    });
  };
  const handleViewFileInDiff = useCallback((path: string) => {
    const workspace = selectedWorkspaceRef.current;
    if (!workspace) return;
    const current = workbenchRef.current;
    current.setChanges({
      workspaceId: workspace.id,
      selectedPath: path,
      scope: { kind: "uncommitted" },
    });
    current.openTool({ kind: "changes" });
    setDiffFileRequest({
      sessionKey: selectedSessionKeyRef.current,
      request: { workspaceId: workspace.id, path, nonce: Date.now() },
    });
  }, []);
  const selectedSessionKeyRef = useRef(selectedSessionKey);
  selectedSessionKeyRef.current = selectedSessionKey;
  const selectedWorkspaceRef = useRef(selectedWorkspace);
  selectedWorkspaceRef.current = selectedWorkspace;
  const { handleOpenWorkspaceFileLine, handleOpenDeliverable } = useConversationFileActions(
    api,
    selectedWorkspaceRef,
    workbenchRef,
  );

  const dismissSchemaSkewNotice = useCallback((sessionKey: string) => {
    setDismissedSchemaSkewSessionKeys((current) => {
      if (current.has(sessionKey)) return current;
      const next = new Set(current);
      next.add(sessionKey);
      return next;
    });
  }, []);

  const openSettings = (workspaceId?: string, section?: SettingsSection) => {
    if (!api) return;
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : settingsWorkspaceId || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setSettingsWorkspaceId(nextWorkspaceId);
    }
    if (section) {
      setSettingsSection(section);
    }
    void updateSnapshot(setSnapshot, () => api.setActiveView("settings")).catch(
      (error: unknown) => {
        console.error("[renderer] setActiveView failed", error);
      },
    );
  };

  const {
    treeModalState,
    forkModalState,
    closeTreeModal,
    openTreeModal,
    navigateTreeSelection,
    closeForkModal,
    openForkModal,
    handleForkSubmit,
    canUseWorktree,
  } = useTreeForkModals({
    api,
    snapshot,
    setSnapshot,
    selectedWorkspace,
    selectedSession,
    selectedSessionKey,
    rootWorkspace,
    activeView: snapshot?.activeView,
    setComposerDraft,
    focusComposer,
  });

  const slashMenu = useSlashMenu({
    composerDraft,
    setComposerDraft,
    selectedRuntime,
    selectedModelRuntime,
    sessionCommands: selectedSessionCommands,
    commandCompatibility: selectedWorkspaceCommandCompatibility,
    selectedSessionKey,
    selectedSession,
    selectedWorkspace,
    isRunning: selectedSession?.status === "running",
    api,
    setSnapshot,
    focusComposer,
    openSettings,
    updateSnapshot,
    allowTreeCommand: true,
    onRunTreeCommand: openTreeModal,
  });

  const enableSelectedMentionExtension = useCallback(
    (filePath: string) => {
      if (!api || !selectedWorkspace) return Promise.resolve();
      return updateSnapshot(setSnapshot, () =>
        api.setExtensionEnabled(selectedWorkspace.id, filePath, true),
      ).then(() => undefined);
    },
    [api, selectedWorkspace],
  );

  const mentionMenu = useMentionMenu({
    composerDraft,
    setComposerDraft,
    composerRef,
    workspaceId: selectedWorkspace?.id,
    runtime: selectedRuntime,
    api,
    onEnableExtension: enableSelectedMentionExtension,
  });

  const wsMenu = useWorkspaceMenu({
    api,
    setSnapshot,
    updateSnapshot,
  });
  const threadMenu = useThreadActions({
    api,
    setSnapshot,
    updateSnapshot,
    scheduledTasks: snapshot?.scheduledTasks ?? [],
    sidebarCollapsed: snapshot?.sidebarCollapsed ?? false,
    openScheduledEditor: setScheduledEditor,
  });
  const [newThreadZone, setNewThreadZone] = useState<string | undefined>();
  const newThread = useNewThreadController({
    assistantId,
    lancerZone: newThreadZone ?? "chat",
    api,
    snapshot,
    setSnapshot,
    rootWorkspace,
    workspaceOptions: snapshot?.workspaces ?? [],
    visibleWorkspaces,
    selectedWorkspace,
    openSettings,
    flushComposerDraft,
  });

  const {
    composerAttachments,
    submitComposerDraft,
    stopCurrentRun,
    handlePickAttachments,
    handleRemoveAttachment,
    handleEditQueuedMessage,
    handleCancelQueuedEdit,
    handleRemoveQueuedMessage,
    handleSteerQueuedMessage,
    handleComposerPaste,
    handleComposerDrop,
    handlePastedClipboardImage,
    handleComposerKeyDown,
  } = useSessionComposer({
    api,
    snapshot,
    setSnapshot,
    selectedSession,
    composerDraft,
    setComposerDraft,
    composerDraftRef,
    flushComposerDraft,
    composerRef,
    requiresModelSelection: selectedSessionModelOnboarding.requiresModelSelection,
    openTreeModal,
    handleMentionKeyDown: mentionMenu.handleMentionKeyDown,
    handleSlashKeyDown: slashMenu.handleSlashKeyDown,
    newThreadComposerRef: newThread.composerRef,
    appendNewThreadAttachment: newThread.appendAttachment,
    onNewThreadComposerError: newThread.setComposerError,
  });

  useEffect(() => {
    const sessionExtensionUiBySession = snapshot?.sessionExtensionUiBySession;
    if (!sessionExtensionUiBySession) {
      setDockExpandedBySession((current) => (Object.keys(current).length > 0 ? {} : current));
      return;
    }

    setDockExpandedBySession((current) => {
      let next: Record<string, string> | undefined;
      for (const [sessionKey, instanceId] of Object.entries(current)) {
        if (
          sessionExtensionUiBySession[sessionKey]?.instanceId === instanceId &&
          hasExtensionDockContent(sessionExtensionUiBySession[sessionKey])
        ) {
          continue;
        }
        if (!next) {
          next = { ...current };
        }
        delete next[sessionKey];
      }
      return next ?? current;
    });
  }, [snapshot?.sessionExtensionUiBySession]);

  useEffect(() => {
    if (rootWorkspaceOptions.length === 0) {
      setSettingsWorkspaceId("");
      setSkillsWorkspaceId("");
      setExtensionsWorkspaceId("");
      return;
    }
    setSettingsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current)
        ? current
        : current || rootWorkspaceOptions[0]?.id || "",
    );
    setSkillsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current)
        ? current
        : current || rootWorkspaceOptions[0]?.id || "",
    );
    setExtensionsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current)
        ? current
        : current || rootWorkspaceOptions[0]?.id || "",
    );
  }, [rootWorkspaceOptions]);

  const primarySidebarToggleVisible = canTogglePrimarySidebar(snapshot?.activeView);
  const sidebarToggleShortcutLabel = api ? getDesktopShortcutLabel(api.platform, "B") : "";

  const setActiveView = (view: AppView) => {
    if (!api) return;
    void updateSnapshot(setSnapshot, () => api.setActiveView(view)).catch((error: unknown) => {
      console.error("[renderer] setActiveView failed", error);
    });
  };

  const openSkills = (workspaceId?: string) => {
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : skillsWorkspaceId || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setSkillsWorkspaceId(nextWorkspaceId);
    }
    setActiveView("skills");
  };

  const openExtensions = (workspaceId?: string) => {
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : extensionsWorkspaceId || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setExtensionsWorkspaceId(nextWorkspaceId);
    }
    setActiveView("extensions");
  };

  const selectedThreadTarget =
    snapshot?.activeView === "threads" && selectedWorkspace && selectedSession
      ? { workspaceId: selectedWorkspace.id, sessionId: selectedSession.id }
      : undefined;
  const selectedThreadActions =
    selectedThreadTarget && selectedSession
      ? threadMenu.actionsFor({
          workspaceId: selectedThreadTarget.workspaceId,
          session: selectedSession,
        })
      : undefined;
  const selectedRootWorkspaceId = selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id;
  const commands = useDesktopCommands({
    api,
    snapshot,
    setSnapshot,
    hasWorkspace: rootWorkspaceOptions.length > 0,
    selectedRootWorkspaceId,
    selectedThread: selectedThreadActions
      ? { actions: selectedThreadActions, canSwitchModel: selectedModelOptions.length > 0 }
      : undefined,
    threadSidebarModel,
    threadShortcutOrderRef,
    selectThread: (target) => selectThreadRef.current(target),
    threadSearch,
    workbench,
    sidePanelAvailable,
    sidePanelVisible,
    selectedToolId,
    extensionViews: extensionViews.views,
    openNewThread: newThread.openSurface,
    openSettings,
    openSkills,
    openExtensions,
    setActiveView,
  });

  useEffect(() => {
    const removeWorkspacePickedListener = window.piApp?.onWorkspacePicked?.((workspaceId) => {
      newThread.setPendingWorkspaceId(workspaceId);
      newThread.resetSurface();
    });
    const removeClipboardImageListener = window.piApp?.onClipboardImagePasted?.(
      handlePastedClipboardImage,
    );
    return () => {
      removeWorkspacePickedListener?.();
      removeClipboardImageListener?.();
    };
  }, [handlePastedClipboardImage, newThread]);

  useEffect(() => {
    // The composer is keyed by session: focus only after its new node commits.
    // An IPC completion can precede that commit and focus the outgoing node.
    if (snapshot?.activeView !== "threads" || !selectedSessionKey || !doubao.ready) return;
    if (!restoreTopmostDialogFocus()) composerRef.current?.focus();
  }, [selectedSessionKey, snapshot?.activeView, doubao.ready]);

  if (!api || desktop.view.kind !== "ready" || !snapshot) {
    return (
      <DesktopStartupSurface
        state={toStartupSurfaceState(desktop.view)}
        onRetry={desktop.retry}
        onRelaunch={desktop.canRelaunch ? desktop.relaunch : undefined}
      />
    );
  }

  const secondarySurfaceView =
    snapshot.activeView === "settings" ||
    snapshot.activeView === "skills" ||
    snapshot.activeView === "extensions"
      ? snapshot.activeView
      : null;
  const filesWorkspace = snapshot.workspaces.find(
    (workspace) => workspace.id === workbench.view.files.workspaceId,
  );
  const filesWorktree = filesWorkspace
    ? linkedWorktreeByWorkspaceId.get(filesWorkspace.id)
    : undefined;
  const mainClassName = [
    "main",
    sidePanelVisible ? "main--with-side-panel" : "",
    snapshot.startupDiagnostics.length > 0 ? "main--with-startup-diagnostics" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const { handleSetSessionModel, handleSetSessionThinking } = sessionModelActions(
    api,
    selectedWorkspace && selectedSession
      ? { workspaceId: selectedWorkspace.id, sessionId: selectedSession.id }
      : undefined,
    setSnapshot,
    doubao.leave,
  );

  const handleTrySkill = (command: string) => {
    void updateSnapshot(setSnapshot, () => api.setActiveView("threads")).catch((error: unknown) => {
      console.error("[renderer] setActiveView failed", error);
    });
    slashMenu.fillComposerFromSlash(command);
  };

  const handleSelectSession = (target: { workspaceId: string; sessionId: string }) => {
    // Flush any debounced draft write before the active session changes, otherwise the pending
    // write for the current session is lost (and would land on the wrong session if deferred).
    flushComposerDraft();
    viewport.savePosition();
    if (target.workspaceId === selectedWorkspace?.id && target.sessionId === selectedSession?.id)
      focusComposer();
    void updateSnapshot(setSnapshot, () => api.selectSession(target)).catch((error: unknown) => {
      console.error("[renderer] selectSession failed", error);
    });
  };
  selectThreadRef.current = handleSelectSession;

  const handleRespondToExtensionDialog = (
    response:
      | { readonly requestId: string; readonly value: string }
      | { readonly requestId: string; readonly confirmed: boolean }
      | { readonly requestId: string; readonly cancelled: true },
  ) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }

    void updateSnapshot(setSnapshot, () =>
      api.respondToHostUiRequest(selectedWorkspace.id, selectedSession.id, response),
    )
      .then(() => {
        focusComposer();
      })
      .catch((error: unknown) => {
        console.error("[renderer] updateSnapshot failed", error);
      });
  };

  const handleToggleExtensionDock = () => {
    if (!selectedExtensionDock || !selectedExtensionUiInstance) {
      return;
    }

    setDockExpandedBySession((current) => {
      const next = { ...current };
      if (current[selectedSessionKey] === selectedExtensionUiInstance)
        delete next[selectedSessionKey];
      else next[selectedSessionKey] = selectedExtensionUiInstance;
      return next;
    });
  };

  const handleCreateScheduledTaskWithPi = () => {
    void updateSnapshot(setSnapshot, () => api.beginScheduledTaskInterview()).catch(
      (error: unknown) => {
        console.error("[renderer] beginScheduledTaskInterview failed", error);
      },
    );
  };

  const handleSubmitScheduledTask = (input: CreateScheduledTaskInput) => {
    const action =
      scheduledEditor?.mode === "edit"
        ? () => api.updateScheduledTask(scheduledEditor.taskId, input)
        : () => api.createScheduledTask(input);
    void updateSnapshot(setSnapshot, action)
      .then((state) => {
        if (!state.lastError) {
          setScheduledEditor(null);
        }
      })
      .catch((error: unknown) => {
        console.error("[renderer] save scheduled task failed", error);
      });
  };

  const handleOpenScheduledChat = (target: { workspaceId: string; sessionId: string }) => {
    setScheduledEditor(null);
    handleSelectSession(target);
  };

  const commandPalette =
    commands.paletteMode && threadSidebarModel ? (
      <CommandPaletteSurface
        key={commands.paletteMode}
        api={api}
        mode={commands.paletteMode}
        onModeChange={commands.setPaletteMode}
        onClose={() => commands.setPaletteMode(null)}
        threads={threadSidebarModel.recencyOrder}
        workspaces={threadSidebarModel.folders}
        currentThread={selectedThreadTarget}
        actions={commands.paletteActions}
        fileScope={
          selectedThreadTarget && selectedWorkspace
            ? {
                workspaceId: selectedWorkspace.id,
                label: selectedWorktree?.name ?? selectedWorkspace.name,
                openTabs:
                  workbench.view.files.workspaceId === selectedWorkspace.id
                    ? workbench.view.files.tabs.tabs
                    : [],
              }
            : undefined
        }
        modelScope={
          selectedThreadTarget
            ? {
                options: selectedModelOptions,
                currentProvider: resolvedSessionProvider,
                currentModelId: resolvedSessionModelId,
              }
            : undefined
        }
        onOpenThread={handleSelectSession}
        onOpenWorkspace={wsMenu.selectWorkspace}
        onOpenFile={(path) => {
          if (!selectedWorkspace) return;
          void workbench
            .openFile({ workspaceId: selectedWorkspace.id, path })
            .catch((error: unknown) => {
              console.error("[renderer] open file from palette failed", error);
            });
        }}
        onSelectModel={handleSetSessionModel}
      />
    ) : null;

  if (secondarySurfaceView) {
    return (
      <>
        <SecondarySurfaces
          api={api}
          snapshot={snapshot}
          setSnapshot={setSnapshot}
          activeView={secondarySurfaceView}
          rootWorkspaceOptions={rootWorkspaceOptions}
          settingsSection={settingsSection}
          onSelectSettingsSection={setSettingsSection}
          settingsWorkspaceId={settingsWorkspaceId}
          onSelectSettingsWorkspace={setSettingsWorkspaceId}
          skillsWorkspaceId={skillsWorkspaceId}
          onSelectSkillsWorkspace={setSkillsWorkspaceId}
          extensionsWorkspaceId={extensionsWorkspaceId}
          onSelectExtensionsWorkspace={setExtensionsWorkspaceId}
          onBack={() => setActiveView("threads")}
          onSelectView={setActiveView}
          onTrySkill={handleTrySkill}
        />
        {commandPalette}
      </>
    );
  }
  const headerControls = selectedSession ? (
    <ThreadHeaderControls
      onSelectDoubaoApp={selectDoubao}
      session={selectedSession}
      runtime={selectedModelRuntime}
      provider={resolvedSessionProvider}
      modelId={resolvedSessionModelId}
      thinkingLevel={resolvedSessionThinkingLevel}
      onboarding={selectedSessionModelOnboarding}
      runningLabel={runningLabel}
      threadMenu={threadMenu}
      actions={selectedThreadActions}
      onSetModel={handleSetSessionModel}
      onSetThinking={handleSetSessionThinking}
    />
  ) : null;
  const scheduledTaskChip = scheduledBinding ? (
    <ScheduledTaskChip
      task={scheduledBinding}
      onOpen={() => setScheduledEditor({ mode: "edit", taskId: scheduledBinding.id })}
    />
  ) : null;
  const chatAssistant = assistants.profiles.find((profile) => profile.id === assistantId);
  const composerPanel = selectedSession ? (
    doubao.enabled ? (
      <DoubaoAppComposer bridge={doubao} />
    ) : (
      <>
        {selectedWorkspace ? (
          <VideoLearnBar
            sessionId={selectedSession.id}
            workspaceId={selectedWorkspace.id}
            zoneId={conversationModule(selectedSession.title, snapshot?.assistants).id}
            snapshot={videoLearn}
            onSnapshot={setVideoLearn}
          />
        ) : null}
        <ComposerPanel
          workspacePath={selectedWorkspace?.path}
          onOpenDeliverable={handleOpenDeliverable}
          onSelectDoubaoApp={selectDoubao}
          key={selectedSessionKey}
          preparingTaskDraft={extensionHostActions.preparingTaskDraft || !doubao.ready}
          activeSlashCommand={slashMenu.activeSlashFlow?.command}
          activeSlashCommandMeta={slashMenu.activeSlashFlow?.command?.description}
          attachments={composerAttachments}
          queuedMessages={queuedComposerMessages}
          editingQueuedMessageId={editingQueuedMessageId}
          composerDraft={composerDraft}
          composerRef={composerRef}
          runtime={selectedModelRuntime}
          usage={
            selectedSessionKey ? snapshot.sessionUsageBySession[selectedSessionKey] : undefined
          }
          provider={resolvedSessionProvider}
          modelId={resolvedSessionModelId}
          thinkingLevel={resolvedSessionThinkingLevel}
          onClearSlashCommand={slashMenu.resetSlashUi}
          onComposerKeyDown={guardComposerAction(doubao.ready, handleComposerKeyDown)}
          onComposerPaste={handleComposerPaste}
          onComposerDrop={handleComposerDrop}
          onPickAttachments={handlePickAttachments}
          onRemoveAttachment={handleRemoveAttachment}
          onEditQueuedMessage={handleEditQueuedMessage}
          onCancelQueuedEdit={handleCancelQueuedEdit}
          onRemoveQueuedMessage={handleRemoveQueuedMessage}
          onSteerQueuedMessage={handleSteerQueuedMessage}
          onSelectSlashCommand={(command) => slashMenu.applySlashCommandSelection(command, "click")}
          onSelectSlashOption={(option) => slashMenu.applySlashOptionSelection(option)}
          onSetModel={handleSetSessionModel}
          onSetThinking={handleSetSessionThinking}
          modelOnboarding={selectedSessionModelOnboarding}
          onOpenModelSettings={(section) =>
            openSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id, section)
          }
          onSubmit={guardComposerAction(doubao.ready, submitComposerDraft)}
          onStop={stopCurrentRun}
          runningLabel={runningLabel}
          steerShortcutLabel={api.platform === "darwin" ? "Cmd+Enter" : "Ctrl+Enter"}
          selectedSession={selectedSession}
          lastError={snapshot.lastError}
          selectedSlashCommand={
            slashMenu.activeSlashOptionCommand ?? slashMenu.selectedSlashCommand
          }
          selectedSlashOption={slashMenu.selectedSlashOption}
          slashOptionEmptyState={slashMenu.slashOptionEmptyState}
          setComposerDraft={setComposerDraft}
          showSlashOptionMenu={slashMenu.showSlashOptionMenu}
          showSlashMenu={slashMenu.showSlashMenu}
          slashOptions={slashMenu.slashOptions}
          slashSections={slashMenu.slashSections}
          showMentionMenu={mentionMenu.showMentionMenu}
          mentionOptions={mentionMenu.mentionOptions}
          selectedMentionIndex={mentionMenu.selectedIndex}
          onSelectMention={mentionMenu.insertMention}
          onEnableMentionExtension={mentionMenu.enableMentionExtension}
          extensionDock={selectedExtensionDock}
          extensionDockExpanded={isSelectedExtensionDockExpanded}
          onToggleExtensionDock={handleToggleExtensionDock}
        />
      </>
    )
  ) : null;
  const threadDialogs = (
    <ThreadDialogs
      extension={
        activeExtensionDialog
          ? { dialog: activeExtensionDialog, onRespond: handleRespondToExtensionDialog }
          : undefined
      }
      tree={{ ...treeModalState, onClose: closeTreeModal, onNavigate: navigateTreeSelection }}
      fork={{
        ...forkModalState,
        canUseWorktree,
        onClose: closeForkModal,
        onSubmit: handleForkSubmit,
      }}
    />
  );
  const toolPanel =
    sidePanelVisible && selectedWorkspace && selectedSession ? (
      <Workbench
        view={workbench.view}
        platform={api?.platform ?? "linux"}
        tabHintsVisible={sidePanelTabHintsVisible}
        onResize={workbenchWidth.setWidth}
        onTogglePanel={commands.toggleSidePanel}
        extensionViews={extensionViews.views}
        extensionViewsLoading={extensionViews.loading}
        extensionViewsError={extensionViews.error}
        onReloadExtensionViews={extensionViews.reload}
        onOpenTool={workbench.openTool}
        onActivateTool={workbench.activateTool}
        onCloseTool={workbench.closeTool}
        onShowChooser={workbench.showChooser}
        error={workbench.error || extensionHostActions.fileError}
        loading={!workbench.ready}
        onRetryRestore={workbench.retryRestore}
      >
        <ThreadToolPanel
          api={api}
          workspace={selectedWorkspace}
          session={selectedSession}
          workbench={workbench}
          extensionView={activeExtensionView}
          target={workbenchTarget}
          theme={extensionViewTheme}
          extensionActions={extensionHostActions}
          filesWorkspace={filesWorkspace}
          filesWorktree={filesWorktree}
          contexts={fileWorkbenchContexts}
          fileRequest={
            diffFileRequest?.sessionKey === selectedSessionKey ? diffFileRequest.request : null
          }
        />
      </Workbench>
    ) : null;
  const sidebarToggle = (
    <SidebarToggleButton
      collapsed={snapshot.sidebarCollapsed}
      shortcutLabel={sidebarToggleShortcutLabel}
      onToggle={commands.togglePrimarySidebar}
    />
  );
  const isNewThread =
    snapshot.activeView === "new-thread" || (snapshot.activeView === "threads" && !selectedSession);
  const surfaceWorkspace = isNewThread ? newThread.workspace : selectedWorkspace;
  const newThreadEntry = (
    <NewThreadEntry
      controller={newThread}
      workspaces={snapshot.workspaces}
      onSelectDoubaoApp={doubao.createHandler(newThread.rootWorkspaceId, setSnapshot)}
      openSettings={openSettings}
      error={doubao.error}
    />
  );
  if (
    LANCER_PROTOTYPE_UI &&
    (snapshot.activeView === "threads" || isNewThread) &&
    surfaceWorkspace &&
    (selectedSession || isNewThread) &&
    !snapshot.startupDiagnostics.length &&
    (isNewThread || !showSchemaSkewNotice)
  ) {
    return (
      <>
        <LancerLiveSurface
          threadMenu={threadMenu}
          threadShortcutOrderRef={threadShortcutOrderRef}
          onSelectAssistant={selectAssistant}
          input={{
            threads: assistantThreads,
            sidebarCollapsed: snapshot.sidebarCollapsed,
            archivedSessions,
            assistants,
            runtime: isNewThread ? newThread.runtime : selectedModelRuntime,
            assistantId,
            workspaceId: surfaceWorkspace.id,
            children: snapshot.orchestrationChildren,
            selectedSessionId: isNewThread ? "new-thread" : selectedSession!.id,
            sidebarSessionId: selectedSession?.id,
            title: isNewThread ? t("threads.sidebar.newThread") : displayedSessionTitle,
            provider: isNewThread ? newThread.resolvedProvider : resolvedSessionProvider,
            modelId: isNewThread ? newThread.resolvedModelId : resolvedSessionModelId,
            processBlocks: isNewThread ? [] : processBlocks,
            trajectory: sessionTrajectory,
            workspacePath: surfaceWorkspace.path,
            onOpenWorkspaceFileLine: handleOpenWorkspaceFileLine,
            onOpenDeliverable: handleOpenDeliverable,
            onViewFileInDiff: handleViewFileInDiff,
            scheduledOrigins,
            turns: turnChanges.turns,
            onOpenTurnChange: turnChanges.openTurnChange,
            onForkFromMessage: selectedSessionRunning ? undefined : openForkModal,
            videoLearn: isNewThread ? undefined : (doubao.learning ?? videoLearn),
          }}
          viewport={viewport}
          conversation={
            isNewThread ? (
              <div className="process-new-thread-blank" />
            ) : doubao.enabled ? (
              <DoubaoAppTranscript bridge={doubao} assistant={chatAssistant} />
            ) : undefined
          }
          composer={
            isNewThread ? (
              newThreadEntry
            ) : (
              <>
                {scheduledTaskChip}
                {composerPanel}
              </>
            )
          }
          toolPanel={isNewThread ? undefined : toolPanel}
          layoutStyle={workbenchWidth.style}
          modelReel={
            <ModelReel
              onSelectDoubaoApp={
                isNewThread
                  ? doubao.createHandler(newThread.rootWorkspaceId, setSnapshot)
                  : selectDoubao
              }
              doubaoActive={!isNewThread && doubao.enabled}
              runtime={isNewThread ? newThread.runtime : selectedModelRuntime}
              provider={isNewThread ? newThread.resolvedProvider : resolvedSessionProvider}
              modelId={isNewThread ? newThread.resolvedModelId : resolvedSessionModelId}
              disabled={!isNewThread && selectedSessionRunning}
              onSelectModel={
                isNewThread
                  ? (provider, modelId) => {
                      newThread.setProvider(provider);
                      newThread.setModelId(modelId);
                    }
                  : handleSetSessionModel
              }
            />
          }
          headerActions={
            <>
              {sidebarToggle}
              {isNewThread ? null : headerControls}
            </>
          }
          highlightedId={highlightedTimelineId}
          onSelectNode={handleTrajectoryNodeSelect}
          onSelectThread={handleSelectSession}
          onNewThread={(zone) => {
            setNewThreadZone(zone);
            newThread.openSurface(surfaceWorkspace.id);
          }}
          onOpenTools={() => openSettings(surfaceWorkspace.rootWorkspaceId ?? surfaceWorkspace.id)}
          onTogglePanel={commands.toggleSidePanel}
          threadSearch={threadSearch}
          loading={!isNewThread && isTranscriptLoading}
          failure={!isNewThread && Boolean(transcriptFailed)}
          onRetry={desktop.retry}
        />
        {threadDialogs}
        {commandPalette}
        {threadSwitcher.state?.overlayVisible ? (
          <ThreadSwitcher state={threadSwitcher.state} onChoose={threadSwitcher.choose} />
        ) : null}
      </>
    );
  }
  const shellClassName = `shell${LANCER_PROTOTYPE_UI ? " shell--lancer" : ""}${snapshot.sidebarCollapsed ? " shell--sidebar-collapsed" : ""}`;
  return (
    <div className={shellClassName}>
      {primarySidebarToggleVisible ? sidebarToggle : null}
      {!snapshot.sidebarCollapsed ? (
        <Sidebar
          activeView={snapshot.activeView}
          selectedWorkspace={selectedWorkspace}
          selectedSession={selectedSession}
          visibleWorkspaces={visibleWorkspaces}
          threadSidebarModel={threadSidebarModel ?? buildThreadSidebarModel(snapshot)}
          threadShortcutOrderRef={threadShortcutOrderRef}
          threadGrouping={snapshot.threadGrouping}
          linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
          wsMenu={wsMenu}
          threadMenu={threadMenu}
          api={api}
          setSnapshot={setSnapshot}
          updateSnapshot={updateSnapshot}
          onNewThread={(workspaceId) =>
            newThread.openSurface(
              workspaceId ?? selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id,
            )
          }
          onSetActiveView={setActiveView}
          onOpenSkills={openSkills}
          onOpenExtensions={openExtensions}
          onOpenSettings={openSettings}
          onArchiveSession={threadMenu.archive}
          onSelectSession={handleSelectSession}
          onSetSessionPinned={threadMenu.setPinned}
          onUnarchiveSession={threadMenu.restore}
        />
      ) : null}

      <main className={mainClassName} style={workbenchWidth.style}>
        <Topbar
          activeView={snapshot.activeView}
          rootWorkspace={
            snapshot.activeView === "new-thread"
              ? (newThread.workspace ?? rootWorkspace)
              : rootWorkspace
          }
          selectedWorkspace={selectedWorkspace}
          selectedWorktree={selectedWorktree}
          api={api}
          panelAvailable={sidePanelAvailable}
          panelVisible={sidePanelVisible}
          onTogglePanel={commands.toggleSidePanel}
          sessionTitle={
            snapshot.activeView === "threads" && selectedSession && !LANCER_PROTOTYPE_UI
              ? displayedSessionTitle
              : undefined
          }
          center={
            LANCER_PROTOTYPE_UI && snapshot.activeView === "threads" && selectedSession ? (
              <ModelReel
                doubaoActive={doubao.enabled}
                onSelectDoubaoApp={selectDoubao}
                runtime={selectedModelRuntime}
                provider={resolvedSessionProvider}
                modelId={resolvedSessionModelId}
                disabled={selectedSession.status === "running"}
                onSelectModel={handleSetSessionModel}
              />
            ) : undefined
          }
        >
          {snapshot.activeView === "threads" && selectedWorkspace && selectedSession
            ? headerControls
            : null}
        </Topbar>

        <StartupDiagnostics diagnostics={snapshot.startupDiagnostics} />

        <>
          {snapshot.activeView === "scheduled" ? (
            <ScheduledTasksView
              tasks={snapshot.scheduledTasks}
              lastError={snapshot.lastError}
              api={api}
              setSnapshot={setSnapshot}
              updateSnapshot={updateSnapshot}
              onCreateWithPi={handleCreateScheduledTaskWithPi}
              onOpenEditor={setScheduledEditor}
            />
          ) : snapshot.activeView === "new-thread" ||
            (snapshot.activeView === "threads" && !selectedSession) ? (
            rootWorkspaceOptions.length > 0 ? (
              newThreadEntry
            ) : (
              <section className="canvas canvas--empty">
                <div className="empty-panel">
                  <div className="session-header__eyebrow">{t("app.empty.eyebrow")}</div>
                  <h1>{t("app.empty.openFolderTitle")}</h1>
                  <p>{t("app.empty.addFolderBeforeThread")}</p>
                </div>
              </section>
            )
          ) : selectedWorkspace && selectedSession ? (
            <>
              <div className="thread-workspace" onClickCapture={onChatClick}>
                {LANCER_PROTOTYPE_UI ? (
                  <TrajectoryFocusCurve
                    targetId={highlightedTimelineId}
                    sessionId={selectedSession.id}
                  />
                ) : null}
                <section className="canvas canvas--thread">
                  <div className="thread-main-grid">
                    <div className="conversation conversation--thread">
                      {LANCER_PROTOTYPE_UI ? (
                        <LancerLaneOverview
                          threads={threadSidebarModel?.recencyOrder ?? []}
                          selectedSessionId={selectedSession.id}
                          branchName={selectedWorkspace.branchName}
                          onSelect={handleSelectSession}
                        />
                      ) : null}
                      {showSchemaSkewNotice ? (
                        <SchemaSkewNotice
                          onDismiss={() => dismissSchemaSkewNotice(selectedSessionKey)}
                        />
                      ) : null}
                      {doubao.enabled ? (
                        <DoubaoAppTranscript bridge={doubao} assistant={chatAssistant} />
                      ) : (
                        <ConversationTimeline
                          key={selectedSessionKey}
                          transcript={activeTranscript}
                          isTranscriptLoading={isTranscriptLoading}
                          transcriptFailed={transcriptFailed}
                          onRetryTranscript={desktop.retry}
                          viewport={viewport}
                          threadSearch={threadSearch}
                          onViewFileInDiff={handleViewFileInDiff}
                          onOpenTurnChange={turnChanges.openTurnChange}
                          onOpenWorkspaceFileLine={handleOpenWorkspaceFileLine}
                          workspacePath={selectedWorkspace.path}
                          onForkFromMessage={
                            selectedSession.status === "running" ? undefined : openForkModal
                          }
                          scheduledOrigins={scheduledOrigins}
                          processBlocks={processBlocks}
                          turnChanges={turnChanges.turns}
                          highlightedItemId={highlightedTimelineId}
                          assistantLaneLabel={assistantLaneLabel}
                          assistantModelLabel={resolvedSessionModelId}
                        />
                      )}
                    </div>
                    <TrajectoryPanel
                      trajectory={sessionTrajectory}
                      highlightedNodeId={highlightedTimelineId}
                      onSelectNode={handleTrajectoryNodeSelect}
                    />
                  </div>
                </section>
                {scheduledTaskChip}
                {composerPanel}
              </div>
              {threadDialogs}
            </>
          ) : (
            <ThreadEmptySurface
              workspace={selectedWorkspace}
              onNewThread={() =>
                newThread.openSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)
              }
            />
          )}
        </>
        {toolPanel}
      </main>
      {LANCER_PROTOTYPE_UI ? (
        <LancerRecentThreads
          threads={threadSidebarModel?.recencyOrder ?? []}
          onSelect={handleSelectSession}
        />
      ) : null}
      {scheduledEditor ? (
        <ScheduledTaskEditor
          editor={scheduledEditor}
          task={
            scheduledEditor.mode === "edit"
              ? snapshot.scheduledTasks.find((task) => task.id === scheduledEditor.taskId)
              : undefined
          }
          workspaces={snapshot.workspaces}
          selectedWorkspaceId={snapshot.selectedWorkspaceId}
          busy={false}
          error={snapshot.lastError}
          onClose={() => setScheduledEditor(null)}
          onSubmit={handleSubmitScheduledTask}
          onOpenChat={handleOpenScheduledChat}
        />
      ) : null}
      {threadSwitcher.state?.overlayVisible ? (
        <ThreadSwitcher state={threadSwitcher.state} onChoose={threadSwitcher.choose} />
      ) : null}
      {commandPalette}
    </div>
  );
}
