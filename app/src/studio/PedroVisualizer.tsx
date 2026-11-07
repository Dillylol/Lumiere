import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Download, Play, Route, Upload } from "lucide-react";
import { exportVisualizer, type AutonomousProgram, type RobotProfile } from "../core";
import { download } from "./store";
import "./pedro-visualizer.css";

const CHANNEL = "lumiere.pedro-visualizer.v1";
const MAX_TEXT = 8 * 1024 * 1024;
const WAIT_MS = 10_000;

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

type Operation =
  | { type: "load"; filename: string; target?: AutonomousProgram; warnings?: string[] }
  | { type: "save" }
  | { type: "apply"; target: AutonomousProgram; context: number };

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
  const [draftTarget, setDraftTarget] = useState<AutonomousProgram>();
  const frame = useRef<HTMLIFrameElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef<{ id: number; operation: Operation } | undefined>(undefined);
  const requestId = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const filename = useRef("visualizer.pp");
  const latest = useRef({ program, hidden, onApplyDraft, context: 0 });

  useLayoutEffect(() => {
    const previous = latest.current;
    const changed = previous.program !== program || previous.hidden !== hidden;
    latest.current = { program, hidden, onApplyDraft, context: previous.context + Number(changed) };
  }, [program, hidden, onApplyDraft]);

  useEffect(() => {
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
      const request = pending.current;
      if (!request || request.id !== id) return;
      const { operation } = request;
      const expected = operation.type === "load" ? "loaded" : "saved";
      if (type !== "error" && type !== expected) return;
      pending.current = undefined;
      window.clearTimeout(timer.current);
      setBusy(false);

      if (type === "error") {
        setStatus(typeof value === "string" ? value : "The Visualizer could not complete the request.");
      } else if (operation.type === "load") {
        filename.current = operation.filename;
        setDraftTarget(operation.target);
        setStatus(["Opened " + operation.filename, ...(operation.warnings ?? [])].join(" · "));
      } else if (typeof value !== "string" || value.length > MAX_TEXT) {
        setStatus("The Visualizer returned an invalid .pp file.");
      } else if (operation.type === "save") {
        download(filename.current, value);
        setStatus("Downloaded " + filename.current);
      } else {
        const current = latest.current;
        if (current.hidden || current.program !== operation.target || current.context !== operation.context) {
          setStatus("The workspace changed before the draft was ready. Apply again when the draft and program match.");
          return;
        }
        try {
          setDraftTarget(current.onApplyDraft(value, operation.target));
          setStatus("Applied to " + operation.target.name);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Lumière could not apply that draft.");
        }
      }
    }
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      window.clearTimeout(startup);
      window.clearTimeout(timer.current);
      pending.current = undefined;
    };
  }, []);

  function send(type: string, extra: { id?: number; value?: string } = {}) {
    frame.current?.contentWindow?.postMessage({ channel: CHANNEL, type, ...extra }, window.origin === "null" ? "*" : window.origin);
  }

  function request(operation: Operation, value?: string) {
    if (pending.current) return;
    if (value && value.length > MAX_TEXT) {
      setStatus("Choose a .pp file up to 8 MB.");
      return;
    }
    const id = ++requestId.current;
    pending.current = { id, operation };
    setBusy(true);
    send(operation.type === "load" ? "load" : "save", { id, value });
    timer.current = window.setTimeout(() => {
      pending.current = undefined;
      if (operation.type === "load") setDraftTarget(undefined);
      setBusy(false);
      setStatus("The Visualizer did not respond. Try again.");
    }, WAIT_MS);
  }

  let draftBlock = "";
  if (!program) {
    draftBlock = "Select an autonomous program to apply and test a draft.";
  } else if (!draftTarget || draftTarget.id !== program.id) {
    draftBlock = "Load the selected program or open a .pp file to link this draft.";
  } else if (draftTarget !== program) {
    draftBlock = "The selected program has changed. Save the draft as .pp or load the selected program again.";
  }

  return <div className="pedro-workspace" hidden={hidden}>
    <div className="pedro-toolbar">
      <button disabled={!ready || busy || !program} onClick={() => {
        if (!program) return;
        const result = exportVisualizer(program, { robot });
        const name = program.name.trim().replace(/[<>:"/\\|?*]/g, "-") || "program";
        request({ type: "load", filename: name + ".pp", target: program, warnings: result.warnings }, result.text);
      }}><Route/>Load selected program</button>
      <button className="primary" disabled={!ready || busy || Boolean(draftBlock)}
        title={draftBlock || "Apply the draft to the selected program and open testing"}
        onClick={() => {
          if (program && !draftBlock) request({ type: "apply", target: program, context: latest.current.context });
        }}><Play/>Apply &amp; test</button>
      <button disabled={!ready || busy} onClick={() => fileInput.current?.click()}><Upload/>Open .pp</button>
      <button disabled={!ready || busy} onClick={() => request({ type: "save" })}><Download/>Save .pp</button>
      <input aria-label="Open a Pedro Pathing .pp file" ref={fileInput} type="file" accept=".pp" hidden onChange={async (event) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".pp") || file.size > MAX_TEXT) {
          setStatus("Choose a .pp file up to 8 MB.");
          return;
        }
        try { request({ type: "load", filename: file.name, target: program }, await file.text()); }
        catch { setStatus("Lumière could not read that .pp file."); }
      }}/>
      <span role="status">{[status, ready && !busy ? draftBlock : ""].filter(Boolean).join(" · ")}</span>
    </div>
    <iframe ref={frame} title="Pedro Pathing Visualizer" sandbox="allow-scripts allow-same-origin allow-downloads" srcDoc={srcDoc} onLoad={() => send("ping")}/>
  </div>;
}
