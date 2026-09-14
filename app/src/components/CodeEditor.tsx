import { BRAND } from "../brand";
import Editor, { loader, type BeforeMount, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import "monaco-editor/languages/definitions/java/register";
import { JULES_SNIPPETS } from "../language/julesLanguage";
import type { Diagnostic } from "../models/project";

interface CodeEditorProps {
  value: string;
  onChange?: (value: string | undefined) => void;
  language?: "jules" | "java" | "json";
  diagnostics?: Diagnostic[];
  manifest?: Record<string, unknown>;
  readOnly?: boolean;
  ariaLabel?: string;
  onCursorLineChange?: (line: number) => void;
}

type MonacoApi = typeof monaco;
type MonacoEnvironmentHost = typeof globalThis & {
  MonacoEnvironment?: { getWorker: () => Worker };
};

if (typeof globalThis !== "undefined") {
  (globalThis as MonacoEnvironmentHost).MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };
}
loader.config({ monaco });

let julesRegistered = false;
let latestManifest: Record<string, unknown> = {};

export const CodeEditor = ({
  value,
  onChange,
  language = "jules",
  diagnostics = [],
  manifest = {},
  readOnly = false,
  ariaLabel = readOnly ? "Generated FTC Java preview" : `${BRAND.name} program editor`,
  onCursorLineChange,
}: CodeEditorProps) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [mounted, setMounted] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const editorTheme = useEditorTheme();
  latestManifest = manifest;

  useEffect(() => {
    if (mounted) return;
    const timer = window.setTimeout(() => setUseFallback(true), 4_000);
    return () => window.clearTimeout(timer);
  }, [mounted]);

  const beforeMount: BeforeMount = (api) => {
    if (julesRegistered) return;
    api.languages.register({ id: "jules", extensions: [".jules"], aliases: [BRAND.name] });
    api.languages.setMonarchTokensProvider("jules", {
      tokenizer: {
        root: [
          [/#.*$/, "comment"],
          [/\b(drive|turn|motor|servo|path)\b/, "type.identifier"],
          [/\b(forward|backward|back|left|right|set|linear|tangent|constant|seg|wait|stop)\b/, "keyword"],
          [/-?\d+(?:\.\d+)?/, "number"],
          [/"[^"\\]*(?:\\.[^"\\]*)*"/, "string"],
        ],
      },
    });
    api.languages.setLanguageConfiguration("jules", {
      comments: { lineComment: "#" },
      brackets: [["(", ")"]],
      autoClosingPairs: [{ open: "(", close: ")" }, { open: '"', close: '"' }],
    });
    api.languages.registerCompletionItemProvider("jules", {
      provideCompletionItems: () => {
        const deviceSuggestions = ["motors", "servos"].flatMap((category) => {
          const devices = Array.isArray(latestManifest[category]) ? latestManifest[category] as string[] : [];
          return devices.map((device) => ({
            label: device,
            kind: api.languages.CompletionItemKind.Value,
            insertText: `"${device}"`,
            detail: `${category === "motors" ? "Motor" : "Servo"} from this project's hardware manifest`,
          }));
        });
        return {
          suggestions: [
            ...JULES_SNIPPETS.map((snippet) => ({
              label: snippet.label,
              kind: api.languages.CompletionItemKind.Snippet,
              insertText: snippet.insertText,
              detail: snippet.detail,
            })),
            ...deviceSuggestions,
          ],
        };
      },
    });
    julesRegistered = true;
  };

  const handleMount: OnMount = (editor, api) => {
    editorRef.current = editor;
    setMounted(true);
    editor.getDomNode()?.setAttribute("aria-label", ariaLabel);
    editor.onDidChangeCursorPosition((event) => onCursorLineChange?.(event.position.lineNumber));
    const model = editor.getModel();
    if (model) setMarkers(api as MonacoApi, model, diagnostics);
  };

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model) setMarkers(monaco, model, diagnostics);
  }, [diagnostics]);

  if (useFallback && !mounted) {
    return (
      <div className="code-editor-fallback">
        <span role="status">The full editor was unavailable. Lightweight editing is active.</span>
        <textarea
          aria-label={ariaLabel}
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          onChange={(event) => onChange?.(event.target.value)}
        />
      </div>
    );
  }

  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      onChange={onChange}
      theme={editorTheme}
      beforeMount={beforeMount}
      onMount={handleMount}
      loading={<div className="editor-loading" role="status"><span className="loading-bar" aria-hidden="true" />Starting the local editor…</div>}
      options={{
        accessibilitySupport: "on",
        ariaLabel,
        automaticLayout: true,
        readOnly,
        domReadOnly: readOnly,
        fontSize: 14,
        lineHeight: 22,
        minimap: { enabled: false },
        padding: { top: 16, bottom: 16 },
        renderLineHighlight: "line",
        scrollBeyondLastLine: false,
        smoothScrolling: false,
        wordWrap: "on",
        tabSize: 2,
      }}
    />
  );
};

function useEditorTheme(): "vs" | "vs-dark" {
  const resolveTheme = () => {
    const choice = document.documentElement.dataset.theme ?? "system";
    return choice === "dark" || choice === "contrast" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "vs-dark" : "vs";
  };
  const [theme, setTheme] = useState<"vs" | "vs-dark">(resolveTheme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const refresh = () => setTheme(resolveTheme());
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    media.addEventListener("change", refresh);
    return () => { observer.disconnect(); media.removeEventListener("change", refresh); };
  }, []);
  return theme;
}

function setMarkers(api: MonacoApi, model: monaco.editor.ITextModel, diagnostics: Diagnostic[]) {
  api.editor.setModelMarkers(model, "jules", diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity === "error" ? api.MarkerSeverity.Error : diagnostic.severity === "warning" ? api.MarkerSeverity.Warning : api.MarkerSeverity.Info,
    startLineNumber: diagnostic.line,
    startColumn: diagnostic.column,
    endLineNumber: diagnostic.line,
    endColumn: diagnostic.endColumn,
    message: diagnostic.suggestion ? `${diagnostic.message}\n${diagnostic.suggestion}` : diagnostic.message,
  })));
}
