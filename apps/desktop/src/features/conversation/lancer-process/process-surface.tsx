import { useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import type { TimelineViewport } from "../hooks/use-timeline-viewport";
import type { ProcessFixture, ProcessSurfaceActions, ProcessViewState } from "./process-types";
import { laneStyle } from "./process-types";
import { actorName, clock, currentActor } from "./process-math";
import { ProcessActorIcon, ProcessDataContext, useProcessData } from "./process-glyph";
import { ProcessConversation } from "./process-conversation";
import { ProcessCurves } from "./process-curves";
import { ProcessLaneHeads, ProcessLegend, ProcessTree } from "./process-tree";
import { ProcessSidebar } from "./shell-sidebar";
import "./process-surface.css";
import "./shell.css";

export function LancerProcessSurface({
  data,
  state,
  actions,
  sidebar,
  conversation,
  conversationHeader,
  composer,
  toolPanel,
  layoutStyle,
  modelReel,
  headerActions,
  viewport,
  sessionKey,
  onViewport,
  search,
  loading,
  failure,
  onRetry,
  emissions = false,
  graphHeight,
  currentLane,
}: {
  readonly data: ProcessFixture;
  readonly state: ProcessViewState;
  readonly actions: ProcessSurfaceActions;
  readonly sidebar?: ReactNode;
  readonly conversation?: ReactNode;
  readonly conversationHeader?: ReactNode;
  readonly composer?: ReactNode;
  readonly toolPanel?: ReactNode;
  readonly layoutStyle?: CSSProperties;
  readonly modelReel?: ReactNode;
  readonly headerActions?: ReactNode;
  readonly viewport?: TimelineViewport;
  readonly sessionKey: string;
  readonly onViewport?: (viewport: TimelineViewport) => void;
  readonly search?: ReactNode;
  readonly loading?: boolean;
  readonly failure?: boolean;
  readonly onRetry?: () => void;
  readonly emissions?: boolean;
  readonly graphHeight?: number;
  readonly currentLane?: string;
}) {
  const [treeOverview, setTreeOverview] = useState(false);
  const [treeFocused, setTreeFocused] = useState(false);
  const targetLane = currentLane ?? state.lane;
  const visibleIds = new Set([targetLane]);
  for (let pass = 0; pass < data.lanes.length; pass++) {
    for (const lane of data.lanes)
      if (lane.parentLaneId && visibleIds.has(lane.parentLaneId)) visibleIds.add(lane.id);
  }
  const focused = Boolean(data.assistants && treeFocused);
  const treeData = focused
    ? {
        ...data,
        centeredTree: true,
        lanes: data.lanes.filter((lane) => visibleIds.has(lane.id)),
        events: data.events.filter((event) => visibleIds.has(event.lane)),
      }
    : data;
  return (
    <ProcessDataContext value={data}>
      <div
        className={`lancer-process${data.sidebarCollapsed ? " lancer-process--sidebar-collapsed" : ""}${toolPanel ? " lancer-process--tools" : ""}`}
        data-testid="lancer-process-surface"
        data-relay-tree={data.lanes[0]?.id === "relay:download" ? "true" : undefined}
        data-provenance={emissions && !state.flightTimes ? "scripted-fixture" : "native-session"}
        data-live-flight-count={
          state.flightTimes ? Object.keys(state.flightTimes).length : undefined
        }
        data-native-window={!emissions || state.flightTimes ? window.piApp?.platform : undefined}
        style={layoutStyle}
      >
        <ProcessTitlebar
          state={state}
          actions={actions}
          headerActions={headerActions}
          modelReel={modelReel}
        />
        <div className="body ml">
          {sidebar ?? <ProcessSidebar actions={actions} />}
          <main className="main">
            <ProcessRelayStrip state={state} actions={actions} />
            {conversation ? (
              <div className="process-conversation-surface">
                {conversationHeader}
                {conversation}
              </div>
            ) : (
              <ProcessConversation
                headerContent={conversationHeader}
                state={state}
                actions={actions}
                viewport={state.lane === "all" ? undefined : viewport}
                sessionKey={`${sessionKey}:${state.lane}`}
                onViewport={onViewport}
                search={search}
                loading={loading}
                failure={failure}
                onRetry={onRetry}
                notifications={Boolean(state.flightTimes) || !emissions}
              />
            )}
            <div className="cmp process-surface-composer">
              {composer ?? <ProcessDemoComposer actions={actions} />}
            </div>
          </main>
          {toolPanel ? <div className="process-tool-panel">{toolPanel}</div> : null}
          <aside className="rp2" data-testid="session-trajectory-panel">
            <header className="rh">
              {data.lanes[0]?.id === "relay:download" ? "接力树" : "GitTree · 会话"}
              <span className="smp">
                {data.laneSummary ?? `${data.lanes.length} 条并行 · 预留位`}
              </span>
              {data.assistants ? (
                <button
                  type="button"
                  className="tree-view-toggle"
                  aria-pressed={treeOverview}
                  onClick={() => setTreeOverview((v) => !v)}
                >
                  {treeOverview ? "正常间距" : "总览"}
                </button>
              ) : null}
            </header>
            <div className="fbar">
              {data.assistants ? (
                <button
                  type="button"
                  className={focused ? "pri" : ""}
                  aria-pressed={focused}
                  disabled={!data.lanes.some((lane) => lane.id === targetLane)}
                  onClick={() => setTreeFocused(true)}
                  data-testid="process-focus-tree"
                >
                  聚焦
                </button>
              ) : (
                "聚焦"
              )}
              <button
                type="button"
                className={focused ? "" : "pri"}
                aria-pressed={!focused}
                data-testid="process-global-flow"
                onClick={() =>
                  data.assistants ? setTreeFocused(false) : actions.onSelectLane("all")
                }
              >
                全部会话
              </button>
              <span className="r">{data.clockLabel ?? clock(state.time)}</span>
            </div>
            <ProcessDataContext value={treeData}>
              <div className="process-tree-scroll" key={focused ? targetLane : "all"}>
                <div
                  className="process-tree-columns"
                  data-overview={Boolean(data.assistants && treeOverview)}
                  style={{
                    minWidth:
                      Math.max(1, treeData.lanes.length) *
                      Math.max(
                        data.assistants && treeOverview ? 76 : 112,
                        56 +
                          Math.max(
                            0,
                            ...treeData.events.map((event) => event.nativeNode?.depth ?? 0),
                          ) *
                            22,
                      ),
                  }}
                >
                  <ProcessLaneHeads state={state} actions={actions} />
                  <ProcessTree
                    state={state}
                    actions={actions}
                    graphHeight={graphHeight}
                    overview={Boolean(data.assistants && treeOverview)}
                  />
                </div>
              </div>
            </ProcessDataContext>
            <ProcessLegend />
          </aside>
        </div>
        <ProcessFooter state={state} actions={actions} />
        <ProcessCurves data={data} state={state} emissions={emissions} />
      </div>
    </ProcessDataContext>
  );
}
function ProcessTitlebar({
  state,
  actions,
  headerActions,
  modelReel,
}: {
  readonly state: ProcessViewState;
  readonly actions: ProcessSurfaceActions;
  readonly headerActions?: ReactNode;
  readonly modelReel?: ReactNode;
}) {
  const data = useProcessData();
  const model = currentActor(data, state),
    target = Math.max(0, data.reel.indexOf(model));
  const track = useRef<HTMLDivElement>(null),
    position = useRef(target);
  useLayoutEffect(() => {
    if (state.reelPosition !== undefined || !track.current) return;
    let frame = 0;
    const tick = () => {
      position.current += (target - position.current) * 0.085;
      if (Math.abs(target - position.current) < 0.002) position.current = target;
      if (track.current)
        track.current.style.transform = `translateX(${210 - 58 - position.current * 116}px)`;
      if (position.current !== target) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [target, state.reelPosition]);
  const current = state.reelPosition ?? target;
  return (
    <header
      className="tbar"
      data-testid="topbar"
      onDoubleClick={(event) => {
        if (
          event.target instanceof HTMLElement &&
          !event.target.closest(".topbar__actions, button")
        )
          actions.onToggleMaximize?.();
      }}
    >
      <span className="tdots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div className="brand">
        Lancer<span>多任务线 · 会话过程 Chat</span>
      </div>
      {modelReel ? (
        <div className="reel">{modelReel}</div>
      ) : (
        <div className="reel" data-testid="model-reel">
          <div className="mask">
            <div
              className="trk"
              ref={track}
              style={{ transform: `translateX(${210 - 58 - current * 116}px)` }}
            >
              {data.reel.map((actor, i) => (
                <button
                  type="button"
                  key={actor}
                  className={`it process-reel-button ${Math.abs(i - current) < 0.5 ? "c" : ""} ${actor === model ? "model-reel__chip--active" : ""}`}
                  style={{
                    left: i * 116,
                    opacity: Math.max(0.15, 1 - Math.abs(i - current) * 0.33),
                  }}
                  aria-pressed={actor === model}
                  onClick={() => actions.onSelectModel?.(actor)}
                >
                  <ProcessActorIcon actor={actor} />
                  <span>{actorName(data, actor, true)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="lens" />
        </div>
      )}
      <div className="tright topbar__actions">{headerActions}</div>
    </header>
  );
}
function ProcessRelayStrip({
  state,
  actions,
}: {
  readonly state: ProcessViewState;
  readonly actions: ProcessSurfaceActions;
}) {
  const data = useProcessData();
  return (
    <div className="strip4" aria-label="任务协作顺序">
      {data.lanes.map((lane) => {
        const events = data.events.filter((event) => event.lane === lane.id),
          next = events.find((event) => event.time > state.time && event.kind !== "tool");
        const waiting = events.find(
          (event) =>
            event.kind === "wait" &&
            state.time >= event.time &&
            state.time < event.time + (event.waitDuration ?? 0),
        );
        return (
          <div
            className="lr"
            key={lane.id}
            style={{ opacity: state.focus && state.focus !== lane.id ? 0.3 : 1 }}
          >
            <button
              type="button"
              className="zl"
              disabled={lane.available === false}
              onClick={() => actions.onSelectLane(lane.id)}
            >
              <i style={{ background: lane.color }} />
              {lane.name}
            </button>
            {lane.relay.map((actor, i) => {
              const active =
                  next?.actor === actor ||
                  events.some(
                    (event) => event.actor === actor && event.running && event.time <= state.time,
                  ),
                done =
                  !active &&
                  events.some(
                    (event) => !event.running && event.time <= state.time && event.actor === actor,
                  ),
                wait = waiting && actor === "you";
              const failed = events
                .filter((event) => event.time <= state.time && event.actor === actor)
                .at(-1)?.fail;
              const complete =
                !failed &&
                !active &&
                !wait &&
                done &&
                !events.some((event) => event.time > state.time && event.actor === actor);
              return (
                <span className="process-relay-step" key={actor}>
                  {i ? <span className="ar">→</span> : null}
                  <button
                    type="button"
                    className={`agc ${wait ? "wait" : active ? "run" : done && !failed ? "done" : "q"}`}
                    style={laneStyle(lane.color)}
                    disabled={lane.available === false}
                    data-relay-lane={lane.id}
                    data-relay-actor={actor}
                    data-anchor-key={`chip:${lane.id}:${actor}`}
                    onClick={() => actions.onSelectLane(lane.id)}
                  >
                    <ProcessActorIcon actor={actor} />
                    {actorName(data, actor)}
                    <span className="ck">{failed ? "失败" : complete ? "✓" : ""}</span>
                  </button>
                </span>
              );
            })}
            {lane.available === false ? <span className="smp">未开始</span> : null}
          </div>
        );
      })}
    </div>
  );
}
function ProcessFooter({
  state,
  actions,
}: {
  readonly state: ProcessViewState;
  readonly actions: ProcessSurfaceActions;
}) {
  const data = useProcessData();
  const actors = data.recentActors ?? [
    "doubao",
    "grok",
    "x",
    "grokbot",
    "codex",
    "sol",
    "opus",
    "kimi",
  ];
  return (
    <footer className="foot" aria-label="Recently here">
      <span className="lb">RECENTLY HERE</span>
      <div className="avs">
        {actors.map((actor) => (
          <button
            type="button"
            key={actor}
            className={`av2 ${data.lanes.some((lane) => data.events.find((event) => event.lane === lane.id && event.time > state.time && event.kind !== "tool")?.actor.includes(actor)) ? "on" : ""}`}
            title={actorName(data, actor)}
            onClick={() => {
              const session = data.sidebar
                .flatMap((group) => group.sessions)
                .find((session) => session.actor === actor);
              if (session) actions.onSelectSession(session.id);
            }}
          >
            <ProcessActorIcon actor={actor} />
          </button>
        ))}
      </div>
      <span className="smp" style={{ marginLeft: "auto" }}>
        {data.laneSummary ?? `${data.lanes.length} 条任务线`} · {data.statusLabel ?? "运行中"}
      </span>
    </footer>
  );
}
function ProcessDemoComposer({ actions }: { readonly actions: ProcessSurfaceActions }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="composer">
      <textarea
        className="process-demo-input"
        data-testid="composer"
        aria-label="Composer"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="继续和 Grok 讨论，或直接交接…"
      />
      <div className="row">
        <span>⏎ 发送</span>
        <span>@ 引用文件</span>
        <span>⇧⌘H 交接</span>
        <button type="button" className="send" aria-label="Send" onClick={actions.onLaunch}>
          ↑
        </button>
      </div>
    </div>
  );
}
