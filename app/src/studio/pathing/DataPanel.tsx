/**
 * Live graphs of a run, after Panels' graph widget: one small chart per value, the robot's line beside the
 * plan's where the plan has one, on a shared time axis. Hover or the arrow keys read every chart at one
 * moment. The values are always printed too, so nothing depends on reading a line's color.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Pause, Play } from "lucide-react";
import { Section } from "./LayersPanel";
import type { RunSample } from "./useRunSession";

/** What the plan has at a time since START: where the ghost is, and how fast it goes. */
export interface PlannedMotion {
  x: number;
  y: number;
  /** Radians. */
  heading: number;
  /** Inches per second. */
  speed: number;
}

export interface DataPanelProps {
  history: RunSample[];
  /** Whether the run is going, so the graphs follow its last 30 seconds. */
  live: boolean;
  /** The plan at a time, when the run is compared with one. */
  planAt?(t: number): PlannedMotion | undefined;
  /** How far a point is from the planned path, in inches, when the run is compared with one. */
  offPlanAt?(x: number, y: number): number;
  /** What the plan's line shows: "the estimate" or "your simulated run". */
  planLabel?: string;
}

interface Series {
  id: string;
  label: string;
  unit: string;
  digits: number;
  robot: (number | undefined)[];
  plan?: (number | undefined)[];
}

const WINDOW_MS = 30_000;
const DEFAULT_SERIES = ["speed", "offPlan", "x", "y"];
/** Session.data keys Lumière reports for the run comparison, not values worth graphing. */
const TIMING_KEYS = new Set(["lumiere.routineElapsedMs", "lumiere.routineRevision"]);

const degrees = (radians: number) => (radians * 180) / Math.PI;
const format = (value: number | undefined, digits: number) => (value === undefined ? "—" : value.toFixed(digits));

/** Every value the samples carry, one column per series. Heading is unwrapped so a turn past 0° stays a line. */
function seriesOf(history: RunSample[], planAt?: DataPanelProps["planAt"], offPlanAt?: DataPanelProps["offPlanAt"]): Series[] {
  const speed = history.map((item, i) => {
    const previous = history[i - 1];
    if (!previous || item.t <= previous.t) return undefined;
    return Math.hypot(item.x - previous.x, item.y - previous.y) / ((item.t - previous.t) / 1000);
  });
  let unwrapped = 0;
  const heading = history.map((item, i) => {
    const value = degrees(item.heading);
    if (i === 0) unwrapped = ((value % 360) + 360) % 360;
    else unwrapped += ((((value - degrees(history[i - 1].heading)) % 360) + 540) % 360) - 180;
    return unwrapped;
  });
  const planned = planAt ? history.map((item) => planAt(item.t)) : undefined;
  let plannedHeading = 0;
  const planHeading = planned?.map((item, i) => {
    if (!item) return undefined;
    const value = degrees(item.heading);
    const before = planned[i - 1];
    if (i === 0 || !before) plannedHeading = heading[i] + ((((value - heading[i]) % 360) + 540) % 360) - 180;
    else plannedHeading += ((((value - degrees(before.heading)) % 360) + 540) % 360) - 180;
    return plannedHeading;
  });
  const series: Series[] = [
    { id: "speed", label: "Speed", unit: "in/s", digits: 0, robot: speed, plan: planned?.map((item) => item?.speed) },
    ...(offPlanAt ? [{ id: "offPlan", label: "Off plan", unit: "in", digits: 1, robot: history.map((item) => offPlanAt(item.x, item.y)) }] : []),
    { id: "x", label: "X", unit: "in", digits: 1, robot: history.map((item) => item.x), plan: planned?.map((item) => item?.x) },
    { id: "y", label: "Y", unit: "in", digits: 1, robot: history.map((item) => item.y), plan: planned?.map((item) => item?.y) },
    { id: "heading", label: "Heading", unit: "°", digits: 0, robot: heading, plan: planHeading },
  ];
  if (history.some((item) => item.loopMs !== undefined)) series.push({ id: "loop", label: "Loop time", unit: "ms", digits: 1, robot: history.map((item) => item.loopMs) });
  const dataKeys = [...new Set(history.flatMap((item) => Object.keys(item.data)))].filter((key) => !TIMING_KEYS.has(key)).sort();
  for (const key of dataKeys) series.push({ id: `data:${key}`, label: key, unit: "", digits: 2, robot: history.map((item) => item.data[key]) });
  const devices = new Map<string, Set<"power" | "position">>();
  for (const item of history) {
    for (const [name, report] of Object.entries(item.devices ?? {})) {
      const kinds = devices.get(name) ?? new Set();
      if (report.power !== undefined) kinds.add("power");
      if (typeof report.position === "number") kinds.add("position");
      devices.set(name, kinds);
    }
  }
  for (const [name, kinds] of [...devices].sort(([a], [b]) => a.localeCompare(b))) {
    for (const kind of [...kinds].sort()) {
      const motor = history.some((item) => item.devices?.[name]?.type === "motor");
      const label = kind === "power" ? `${name} power` : motor ? `${name} ticks` : `${name} position`;
      series.push({ id: `device:${name}:${kind}`, label, unit: "", digits: kind === "position" && motor ? 0 : 2,
        robot: history.map((item) => { const value = item.devices?.[name]?.[kind]; return typeof value === "number" ? value : undefined; }) });
    }
  }
  return series;
}

/** An element's width in pixels, kept current as it resizes; the callback ref follows the element as it comes and goes. */
function useWidth() {
  const [width, setWidth] = useState(280);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element || typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(([entry]) => setWidth(Math.max(120, Math.round(entry.contentRect.width))));
    observer.current.observe(element);
  }, []);
  return { ref, width };
}

const HEIGHT = 56;
const PAD = 5;

function Chart({ series, times, span: [start, end], cursor, width, onCursor }: {
  series: Series; times: number[]; span: [number, number]; cursor?: number; width: number; onCursor(t?: number): void;
}) {
  const indexes = times.flatMap((t, i) => (t >= start && t <= end ? [i] : []));
  const values = indexes.flatMap((i) => [series.robot[i], series.plan?.[i]]).filter((value): value is number => value !== undefined);
  let low = values.length ? Math.min(...values) : 0;
  let high = values.length ? Math.max(...values) : 1;
  if (high - low < 1e-6) { low -= 1; high += 1; }
  const x = (t: number) => ((t - start) / Math.max(1, end - start)) * width;
  const y = (value: number) => HEIGHT - PAD - ((value - low) / (high - low)) * (HEIGHT - PAD * 2);
  const line = (column: (number | undefined)[]) => {
    let d = "";
    let pen = false;
    for (const i of indexes) {
      const value = column[i];
      if (value === undefined) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${x(times[i]).toFixed(1)} ${y(value).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const lastIndex = [...indexes].reverse().find((i) => series.robot[i] !== undefined);
  const at = cursor === undefined ? lastIndex : nearest(times, cursor);
  const shown = at === undefined ? undefined : series.robot[at];
  const plan = at === undefined ? undefined : series.plan?.[at];
  const unit = series.unit ? ` ${series.unit}` : "";
  const read = (value?: number) => `${format(value, series.digits)}${value === undefined ? "" : unit}`;
  return <figure className="pv-chart">
    <figcaption>
      <span>{series.label}</span>
      <span className="pv-chart-values"><b>{read(shown)}</b>{series.plan && <small> plan {read(plan)}</small>}</span>
    </figcaption>
    <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img"
      aria-label={`${series.label}: ${read(shown)}${series.plan ? `, plan ${read(plan)}` : ""}`}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        onCursor(start + ((event.clientX - box.left) / Math.max(1, box.width)) * (end - start));
      }}
      onPointerLeave={() => onCursor(undefined)}>
      <line className="pv-chart-grid" x1={0} x2={width} y1={PAD} y2={PAD}/>
      <line className="pv-chart-grid" x1={0} x2={width} y1={HEIGHT - PAD} y2={HEIGHT - PAD}/>
      <text className="pv-chart-scale" x={2} y={PAD + 9}>{format(high, series.digits)}</text>
      <text className="pv-chart-scale" x={2} y={HEIGHT - PAD - 2}>{format(low, series.digits)}</text>
      {series.plan && <path className="pv-chart-plan" d={line(series.plan)}/>}
      <path className="pv-chart-robot" d={line(series.robot)}/>
      {cursor !== undefined && at !== undefined && <line className="pv-chart-cursor" x1={x(times[at])} x2={x(times[at])} y1={0} y2={HEIGHT}/>}
      {lastIndex !== undefined && cursor === undefined && series.robot[lastIndex] !== undefined
        && <circle className="pv-chart-dot" cx={x(times[lastIndex])} cy={y(series.robot[lastIndex]!)} r={4}/>}
    </svg>
  </figure>;
}

/** The index of the sample nearest a time. */
function nearest(times: number[], t: number) {
  let best = 0;
  for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
  return times.length ? best : undefined;
}

export function DataPanel({ history, live, planAt, offPlanAt, planLabel }: DataPanelProps) {
  const series = useMemo(() => seriesOf(history, planAt, offPlanAt), [history, planAt, offPlanAt]);
  const [chosen, setChosen] = useState<string[]>(DEFAULT_SERIES);
  const [paused, setPaused] = useState<[number, number]>();
  const [cursor, setCursor] = useState<number>();
  const { ref, width } = useWidth();
  const times = useMemo(() => history.map((item) => item.t), [history]);
  // A new run starts with live graphs.
  useEffect(() => { if (!history.length) { setPaused(undefined); setCursor(undefined); } }, [history.length === 0]);
  if (!history.length) {
    return <Section title="Data"><p className="pv-note">Graphs of the run appear here once an OpMode starts: speed, position, heading, Session.data values and device outputs.</p></Section>;
  }
  const last = times[times.length - 1];
  const span: [number, number] = paused ?? (live ? [Math.max(0, last - WINDOW_MS), Math.max(last, WINDOW_MS)] : [0, Math.max(last, 1)]);
  const shown = series.filter((item) => chosen.includes(item.id));
  const anyPlan = shown.some((item) => item.plan);
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.shiftKey ? 1000 : 100;
    const from = cursor ?? last;
    if (event.key === "ArrowLeft") setCursor(Math.max(span[0], from - by));
    else if (event.key === "ArrowRight") setCursor(Math.min(span[1], from + by));
    else if (event.key === "Home") setCursor(span[0]);
    else if (event.key === "End") setCursor(last);
    else if (event.key === "Escape") setCursor(undefined);
    else return;
    event.preventDefault();
  };
  return <Section title="Data" count={shown.length || undefined}>
    <div className="pv-chart-controls">
      <div className="pv-chart-chips" role="group" aria-label="Values to graph">
        {series.map((item) => <button key={item.id} type="button" className="pv-chip" aria-pressed={chosen.includes(item.id)}
          onClick={() => setChosen((ids) => (ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id]))}>{item.label}</button>)}
      </div>
      {live && <button type="button" className="pv-ghost-button" onClick={() => setPaused(paused ? undefined : span)}>
        {paused ? <><Play aria-hidden="true"/>Follow the run</> : <><Pause aria-hidden="true"/>Pause</>}
      </button>}
    </div>
    {anyPlan && <ul className="pv-chart-legend" aria-label="Graph key">
      <li><i className="robot" aria-hidden="true"/>Robot</li>
      <li><i className="plan" aria-hidden="true"/>Plan{planLabel ? `: ${planLabel}` : ""}</li>
    </ul>}
    <div ref={ref} className="pv-charts" role="group" tabIndex={0} onKeyDown={step}
      aria-label={`Run graphs, ${((span[1] - span[0]) / 1000).toFixed(0)} seconds. Hover, or use the arrow keys, to read one moment.`}>
      {shown.length
        ? shown.map((item) => <Chart key={item.id} series={item} times={times} span={span} cursor={cursor} width={width} onCursor={setCursor}/>)
        : <p className="pv-note">Choose values to graph above.</p>}
      <p className="pv-chart-time">{cursor === undefined
        ? live && !paused ? `Last ${((span[1] - span[0]) / 1000).toFixed(0)} s · now ${(last / 1000).toFixed(1)} s` : `Whole run · ${(last / 1000).toFixed(1)} s`
        : `At ${(times[nearest(times, cursor) ?? 0] / 1000).toFixed(1)} s`}</p>
    </div>
  </Section>;
}
