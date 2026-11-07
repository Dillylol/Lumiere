import { serializeProject } from "./io";
import type { ProjectFiles } from "./state/files.svelte";
import { currentFilePath } from "./stores";

const CHANNEL = "lumiere.pedro-visualizer.v1";
const MAX_TEXT = 8 * 1024 * 1024;

export function installLumiereBridge(files: ProjectFiles, unsupported: boolean) {
  if (parent === window || !document.documentElement.hasAttribute("data-lumiere-visualizer")) return () => {};

  const origin = window.origin;
  const targetOrigin = origin === "null" ? "*" : origin;
  const send = (type: string, id?: number, value?: string) => parent.postMessage({ channel: CHANNEL, type, id, value }, targetOrigin);
  const announce = () => send(unsupported ? "unsupported" : "ready");

  function receive(event: MessageEvent) {
    if (event.source !== parent || event.origin !== origin || event.data?.channel !== CHANNEL) return;
    const { type, id, value } = event.data;
    if (type === "ping") return announce();
    if (unsupported || !Number.isSafeInteger(id)) return;
    try {
      switch (type) {
        case "load": {
          if (typeof value !== "string" || value.length > MAX_TEXT) throw new Error("Expected a .pp file up to 8 MB.");
          const doc = files.read(value);
          if (!doc) throw new Error("The Visualizer could not open that .pp file.");
          files.open(doc);
          currentFilePath.set(null);
          send("loaded", id);
          break;
        }
        case "save": {
          const text = serializeProject(files.current(), { pretty: true });
          if (text.length > MAX_TEXT) throw new Error("The .pp export exceeds 8 MB.");
          send("saved", id, text);
          break;
        }
      }
    } catch (error) {
      send("error", id, error instanceof Error ? error.message : "The Visualizer could not complete the request.");
    }
  }

  window.addEventListener("message", receive);
  announce();
  return () => window.removeEventListener("message", receive);
}
