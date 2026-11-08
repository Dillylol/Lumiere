import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Download, Play, Route, Upload } from "lucide-react";
import { exportVisualizer, type AutonomousProgram, type RobotProfile } from "../core";
import { confirmAction, download } from "./store";
import "./pedro-visualizer.css";

const CHANNEL = "lumiere.pedro-visualizer.v1";
const MAX_TEXT = 8 * 1024 * 1024;
const WAIT_MS = 10_000;
/**
 * The draft as Lumière last loaded or applied it. The Visualizer restores its
 * last session on startup, so this survives restarts: a restored draft that
 * still matches it has no changes of its own and can be replaced.
 */
const BASELINE_KEY = "lumiere.pedro-visualizer.baseline";

function readBaseline() {
  try { return localStorage.getItem(BASELINE_KEY) ?? undefined; } catch { return undefined; }
}

function writeBaseline(text: string) {
  try { localStorage.setItem(BASELINE_KEY, text); } catch { /* Storage can be unavailable; the draft then counts as unchanged. */ }
}

/** The draft without the save time that the Visualizer stamps on every .pp it writes. */
function comparable(text: string) {
  try {
    const doc = JSON.parse(text);
    if (doc && typeof doc === "object") delete doc.timestamp;
    return JSON.stringify(doc);
  } catch {
    return text;
  }
}

function frameDocument() {
  const theme = document.documentElement.dataset.theme;
  const themeName = theme === "light" || theme === "contrast" ? theme : "dark";
  const assets = new URL("./pedro-visualizer/", document.baseURI).href.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  // srcdoc inherits the app's CSP. Loading a separate Tauri HTML asset would
  // also apply its frame-ancestors 'none' response header to the child.
  return `<!doctype html><html lang="en" class="${themeName === "light" ? "" : "dark"}" data-lumiere-visualizer data-lumiere-theme="${themeName}">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="connect-src 'self'; img-src 'self' blob: data:">
    <base href="${assets}"><title>Pedro Pathing Visualizer</title>
    <link rel="stylesheet" href="assets/editor.css"><script type="module" src="assets/editor.js"></script></head><body></body></html>`;
}

function programFilename(program: AutonomousProgram) {
  return (program.name.trim().replace(/[<>:"/\\|?*]/g, "-") || "program") + ".pp";
}

/** What the Visualizer is showing. */
interface Draft {
  /** The program version this draft was loaded from or applied to. */
  target?: AutonomousProgram;
  /** "session" is whatever the Visualizer restored when it started. */
  source: "session" | "program" | "file";
  filename: string;
}

interface Call {
  expected: "loaded" | "saved";
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
}

interface PedroVisualizerProps {
  program?: AutonomousProgram;
  robot: RobotProfile;
  hidden: boolean;
  onApplyDraft: (text: string, target: AutonomousProgram) => AutonomousProgram;
}

export function PedroVisualizer({ program, robot, hidden, onApplyDraft }: PedroVisualizerProps) {
  const [srcDoc] = useState(frameDocument);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Starting the Visualizer…");
  const [draft, setDraft] = useState<Draft>({ source: "session", filename: "visualizer.pp" });
  /** The program the draft was kept from because it holds changes of its own. */
  const [keptFor, setKeptFor] = useState<AutonomousProgram>();
  const frame = useRef<HTMLIFrameElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const calls = useRef(new Map<number, Call>());
  const requestId = useRef(0);
  const working = useRef(false);
  const baseline = useRef(readBaseline());
  /** The program and draft last checked for an automatic load. Undo can bring back a program checked before. */
  const autoChecked = useRef<{ program: AutonomousProgram; draft: Draft } | undefined>(undefined);
  const latest = useRef({ program, hidden, onApplyDraft, context: 0 });

  useLayoutEffect(() => {
    const previous = latest.current;
    const changed = previous.program !== program || previous.hidden !== hidden;
    latest.current = { program, hidden, onApplyDraft, context: previous.context + Number(changed) };
  }, [program, hidden, onApplyDraft]);

  useEffect(() => {
    const pending = calls.current;
    const startup = window.setTimeout(() => setStatus("The Visualizer did not start."), WAIT_MS);
    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.origin || event.data?.channel !== CHANNEL) return;
      const { type, value, id } = event.data;
      if (type === "ready" || type === "unsupported") {
        window.clearTimeout(startup);
        setReady(type === "ready");
        setStatus(type === "ready" ? "" : "The Visualizer is available on desktop-sized devices.");
        return;
      }
      const call = pending.get(id);
      if (!call || (type !== "error" && type !== call.expected)) return;
      pending.delete(id);
      window.clearTimeout(call.timer);
      if (type === "error") call.reject(new Error(typeof value === "string" ? value : "The Visualizer could not complete the request."));
      else call.resolve(value);
    }
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      window.clearTimeout(startup);
      for (const call of pending.values()) window.clearTimeout(call.timer);
      pending.clear();
    };
  }, []);

  function send(type: string, extra: { id?: number; value?: string } = {}) {
    frame.current?.contentWindow?.postMessage({ channel: CHANNEL, type, ...extra }, window.origin === "null" ? "*" : window.origin);
  }

  function call(type: "load" | "save", value?: string) {
    if (value !== undefined && value.length > MAX_TEXT) return Promise.reject(new Error("Choose a .pp file up to 8 MB."));
    const id = ++requestId.current;
    return new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        calls.current.delete(id);
        reject(new Error("The Visualizer did not respond. Try again."));
      }, WAIT_MS);
      calls.current.set(id, { expected: type === "load" ? "loaded" : "saved", resolve, reject, timer });
      send(type, { id, value });
    });
  }

  /** The draft as a .pp file. */
  async function snapshot() {
    const text = await call("save");
    if (typeof text !== "string" || text.length > MAX_TEXT) throw new Error("The Visualizer returned an invalid .pp file.");
    return text;
  }

  /** Whether the draft has changes Lumière has not loaded or applied. */
  async function edited() {
    return baseline.current !== undefined && comparable(await snapshot()) !== baseline.current;
  }

  function remember(text: string) {
    baseline.current = comparable(text);
    writeBaseline(baseline.current);
    setKeptFor(undefined);
  }

  /** Runs one Visualizer operation at a time and reports its failure in the toolbar. */
  async function run(task: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await task();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The Visualizer could not complete the request.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function open(text: string, next: Draft, notes: string[] = []) {
    await call("load", text);
    remember(await snapshot());
    setDraft(next);
    setStatus(["Opened " + next.filename, ...notes].join(" · "));
  }

  async function openProgram(target: AutonomousProgram) {
    const result = exportVisualizer(target, { robot });
    await open(result.text, { target, source: "program", filename: programFilename(target) }, result.warnings);
  }

  async function mayReplace(replacement: string) {
    return !(await edited()) || confirmAction(`Replace the Visualizer draft with ${replacement}? Its changes that are not applied or saved will be lost.`);
  }

  // Show the selected program whenever the Visualizer opens on it, unless the
  // draft holds changes of its own or is a .pp file opened for this program.
  useEffect(() => {
    if (hidden || !ready || busy || !program || draft.target === program) return;
    if (autoChecked.current?.program === program && autoChecked.current.draft === draft) return;
    if (draft.source === "file" && draft.target?.id === program.id) return;
    autoChecked.current = { program, draft };
    void run(async () => {
      if (await edited()) {
        setStatus("");
        setKeptFor(program);
        return;
      }
      await openProgram(program);
    });
  }, [hidden, ready, busy, program, draft]);

  let draftBlock = "";
  if (!program) {
    draftBlock = "Select an autonomous program to apply and test a draft.";
  } else if (!draft.target || draft.target.id !== program.id) {
    draftBlock = "Load the selected program or open a .pp file to link this draft.";
  } else if (draft.target !== program) {
    draftBlock = "The selected program has changed. Save the draft as .pp or load the selected program again.";
  }
  let notice = draftBlock;
  if (program && keptFor === program) {
    notice = !draft.target
      ? `The Visualizer kept its unsaved draft. Save it as .pp, or load ${program.name} to replace it.`
      : draft.target.id === program.id
        ? `This draft has changes that are not applied, and ${program.name} changed since it was loaded. Save the draft as .pp, or load ${program.name} to replace it.`
        : `This draft has changes that are not applied to ${draft.target.name}. Save it as .pp, or load ${program.name} to replace it.`;
  }

  return <div className="pedro-workspace" hidden={hidden}>
    <div className="pedro-toolbar">
      <button disabled={!ready || busy || !program} onClick={() => {
        if (!program) return;
        void run(async () => {
          if (await mayReplace(program.name)) await openProgram(program);
        });
      }}><Route/>Load selected program</button>
      <button className="primary" disabled={!ready || busy || Boolean(draftBlock)}
        title={draftBlock || "Apply the draft to the selected program and open testing"}
        onClick={() => {
          if (!program || draftBlock) return;
          const target = program;
          const context = latest.current.context;
          void run(async () => {
            const text = await snapshot();
            const current = latest.current;
            if (current.hidden || current.program !== target || current.context !== context) {
              setStatus("The workspace changed before the draft was ready. Apply again when the draft and program match.");
              return;
            }
            const next = current.onApplyDraft(text, target);
            remember(text);
            setDraft({ target: next, source: "program", filename: draft.filename });
            setStatus("Applied to " + target.name);
          });
        }}><Play/>Apply &amp; test</button>
      <button disabled={!ready || busy} onClick={() => fileInput.current?.click()}><Upload/>Open .pp</button>
      <button disabled={!ready || busy} onClick={() => void run(async () => {
        download(draft.filename, await snapshot());
        setStatus("Downloaded " + draft.filename);
      })}><Download/>Save .pp</button>
      <input aria-label="Open a Pedro Pathing .pp file" ref={fileInput} type="file" accept=".pp" hidden onChange={(event) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".pp") || file.size > MAX_TEXT) {
          setStatus("Choose a .pp file up to 8 MB.");
          return;
        }
        void run(async () => {
          const text = await file.text().catch(() => { throw new Error("Lumière could not read that .pp file."); });
          if (await mayReplace(file.name)) await open(text, { target: program, source: "file", filename: file.name });
        });
      }}/>
      <span role="status">{[status, ready && !busy ? notice : ""].filter(Boolean).join(" · ")}</span>
    </div>
    <iframe ref={frame} title="Pedro Pathing Visualizer" sandbox="allow-scripts allow-same-origin allow-downloads" srcDoc={srcDoc} onLoad={() => send("ping")}/>
  </div>;
}
