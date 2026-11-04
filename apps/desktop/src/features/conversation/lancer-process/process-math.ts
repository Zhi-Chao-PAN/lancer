import type { ProcessEvent, ProcessFixture, ProcessViewState } from "./process-types";

import { clamp, segment, smoothstep, type Point } from "@lancer/light-ui";
export {
  clamp,
  segment,
  smoothstep,
  cubicEase,
  FLIGHT_SECONDS,
  LANDING_SECONDS,
  flightEase,
  outEase,
  springEase,
  bezier,
} from "@lancer/light-ui";
export type { Point } from "@lancer/light-ui";
export function eventLanes(fixture: ProcessFixture) {
  // Relay columns are ordered pipeline stages, including stages not reached yet.
  if (fixture.timelineEnd !== undefined || fixture.assistants) return fixture.lanes;
  const populated = new Set(fixture.events.map((event) => event.lane));
  const lanes = fixture.lanes.filter((lane) => populated.has(lane.id));
  return lanes.length ? lanes : fixture.lanes;
}
export function eventPoint(
  event: ProcessEvent,
  fixture: ProcessFixture,
  width: number,
  height: number,
  end = 26.5,
): Point {
  const lanes = eventLanes(fixture);
  const index = Math.max(
    0,
    lanes.findIndex((lane) => lane.id === event.lane),
  );
  if (fixture.assistants && event.row !== undefined) {
    return {
      x:
        (index * width) / Math.max(1, lanes.length) +
        (fixture.centeredTree
          ? (width / Math.max(1, lanes.length) -
              Math.max(
                0,
                ...fixture.events
                  .filter((e) => e.lane === event.lane)
                  .map((e) => e.nativeNode?.depth ?? 0),
              ) *
                22) /
            2
          : 20) +
        (event.nativeNode?.depth ?? 0) * 22,
      y: 16 + event.row * 32,
    };
  }
  if (fixture.timelineEnd === undefined) {
    // Keep the authored replay calculation byte-for-byte equivalent to df5be5e.
    const fork =
      fixture.events.find((e) => e.lane === event.lane && e.kind === "fork")?.time ?? 3.4;
    const merge =
      fixture.events.find((e) => e.lane === event.lane && e.kind === "merge")?.time ?? 20.2;
    const branch =
      event.branch && event.time >= fork && event.time <= merge
        ? smoothstep(segment(event.time, fork, fork + 0.8)) *
          (1 - smoothstep(segment(event.time, merge - 0.8, merge)))
        : 0;
    return {
      x:
        (index * width) / Math.max(1, lanes.length) +
        Math.min(16, width / lanes.length / 2) +
        branch * Math.min(18, Math.max(0, width / lanes.length / 2 - 5)),
      y: event.row === undefined ? 16 + (event.time * (height - 34)) / end : 16 + event.row * 32,
    };
  }
  const branchEvents = fixture.events.filter(
    (e) => e.lane === event.lane && (!event.branchId || e.branchId === event.branchId),
  );
  const fork = branchEvents.find((e) => e.kind === "fork")?.time ?? 3.4;
  const merge =
    branchEvents.find((e) => e.kind === "merge")?.time ??
    (event.branchId ? Number.POSITIVE_INFINITY : 20.2);
  const terminal = branchEvents.find((e) => e.fail || e.unverified)?.time ?? merge;
  const branches = fixture.events.filter((candidate) => {
    if (candidate.lane !== event.lane || candidate.kind !== "fork" || !candidate.branchId)
      return false;
    const end =
      fixture.events.find(
        (e) => e.branchId === candidate.branchId && (e.kind === "merge" || e.fail || e.unverified),
      )?.time ?? Number.POSITIVE_INFINITY;
    return candidate.time <= terminal && end >= fork;
  });
  // Sequential attempts reuse the replay offset; only simultaneous rails need separate slots.
  const slot = event.branchId
    ? Math.max(1, branches.findIndex((e) => e.branchId === event.branchId) + 1)
    : 1;
  const spacing = event.branchId
    ? Math.min(
        18,
        Math.max(0, width / fixture.lanes.length - 2 * 16) / Math.max(1, branches.length),
      )
    : 18;
  const duration = terminal - fork;
  const window = event.branchId && duration > 0 ? Math.min(0.8, duration / 3) : 0.8;
  const branch =
    event.branch && event.time >= fork && event.time <= merge
      ? smoothstep(segment(event.time, fork, fork + window)) *
        (Number.isFinite(merge) ? 1 - smoothstep(segment(event.time, merge - window, merge)) : 1)
      : 0;
  return {
    x: (index * width) / Math.max(1, lanes.length) + 16 + branch * spacing * slot,
    y:
      event.row === undefined
        ? 16 + (event.time * (height - 34)) / (fixture.timelineEnd ?? end)
        : 16 + event.row * 32,
  };
}
export function actorName(fixture: ProcessFixture, id: string, full = false): string {
  return id
    .split("+")
    .map((key) => {
      const actor = fixture.actors.find((actor) => actor.id === key);
      return (full ? actor?.name : (actor?.short ?? actor?.name)) ?? key;
    })
    .join("+");
}
const nativeClockFormat = new Intl.DateTimeFormat([], {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
export function nativeClock(timestamp?: string): string {
  const date = new Date(timestamp ?? "");
  return Number.isNaN(date.getTime()) ? "" : nativeClockFormat.format(date);
}
export function knownDurationSeconds(
  steps: readonly { readonly duration: string }[],
): number | null {
  const durations = steps.flatMap((step) => {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(step.duration.trim());
    return match ? [Number(match[1])] : [];
  });
  if (!durations.length) return null;
  return Math.max(1, Math.round(durations.reduce((total, seconds) => total + seconds, 0)));
}
/** Paint the arrived head for the observing frame and the next one.
 * Smoothstep reaches the anchor only in the last ~20ms, so one late frame
 * removes the route before a sampler can record the landing. Two frames cover
 * a capture that runs either before or after the painter, at any frame rate.
 * The returned time is the route clock; the landing ring keeps the real schedule. */
export function presentArrivalTime(
  eventTime: number,
  scheduledTime: number,
  frame: number,
  shownFrame: number | undefined,
): { readonly time: number; readonly shownFrame: number | undefined } {
  if (!(scheduledTime >= eventTime)) return { time: scheduledTime, shownFrame: undefined };
  const shown = shownFrame ?? frame;
  return {
    time: frame <= shown + 1 ? eventTime - 1e-4 : scheduledTime,
    shownFrame: shown,
  };
}
export const clock = (time: number) => {
  const seconds = 20 * 3600 + 10 * 60 + Math.round(time * 7);
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
export function currentActor(fixture: ProcessFixture, state: ProcessViewState) {
  if (state.currentActor) return state.currentActor;
  const events = fixture.events.filter(
    (event) => state.lane === "all" || event.lane === state.lane,
  );
  const event =
    state.lane === "all"
      ? events
          .filter(
            (event) => event.time <= state.time && event.kind !== "tool" && event.actor !== "you",
          )
          .at(-1)
      : (events.find(
          (event) => event.time > state.time && event.kind !== "tool" && event.actor !== "you",
        ) ?? events.filter((event) => event.actor !== "you").at(-1));
  return event?.actor.split("+").at(-1) ?? "grok";
}
export const EVENT_NAMES: Readonly<Record<ProcessEvent["kind"], string>> = {
  start: "起点",
  commit: "提交/保存",
  handoff: "交接",
  checkpoint: "检查点",
  test: "测试",
  review: "审查通过",
  fork: "分叉",
  merge: "合并",
  artifact: "产物",
  tool: "工具调用",
  switch: "模型切换",
  compact: "上下文压缩",
  wait: "等待你",
  xref: "跨线引用",
  error: "错误",
  retry: "重试",
};
