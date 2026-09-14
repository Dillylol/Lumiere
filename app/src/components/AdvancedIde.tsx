import { BRAND } from "../brand";
import { useMemo, useState } from "react";
import { Braces, CheckCircle2, Code2, Columns2, FileCode2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { generateJava } from "../language/julesLanguage";
import type { Diagnostic, ProgramDocument } from "../models/project";
import { CodeEditor } from "./CodeEditor";

interface AdvancedIdeProps {
  program: ProgramDocument;
  diagnostics: Diagnostic[];
  manifest: Record<string, unknown>;
  onSourceChange: (source: string) => void;
}

export function AdvancedIde({ program, diagnostics, manifest, onSourceChange }: AdvancedIdeProps) {
  const [javaOpen, setJavaOpen] = useState(false);
  const [activePane, setActivePane] = useState<"jules" | "java">("jules");
  const java = useMemo(() => generateJava(program.ir, program.name.replace(/\s+/g, ""), program.kind), [program.ir, program.kind, program.name]);
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;

  return (
    <section className="ide-workbench" aria-labelledby="ide-heading">
      <header className="ide-workbench__header">
        <div><p className="eyebrow">Advanced build</p><h2 id="ide-heading">{BRAND.name} IDE</h2></div>
        <div className="ide-status" role="status">{errorCount ? <><Braces /> {errorCount} problem{errorCount === 1 ? "" : "s"}</> : <><CheckCircle2 /> Program valid</>}</div>
        <button className="button button--ghost desktop-only" type="button" onClick={() => setJavaOpen(!javaOpen)}>{javaOpen ? <PanelRightClose /> : <PanelRightOpen />}{javaOpen ? "Hide Java" : "Show Java"}</button>
      </header>
      <div className="mobile-editor-tabs" role="tablist" aria-label="Editor view">
        <button role="tab" aria-selected={activePane === "jules"} onClick={() => setActivePane("jules")}><Code2 /> {BRAND.name}</button>
        <button role="tab" aria-selected={activePane === "java"} onClick={() => setActivePane("java")}><FileCode2 /> FTC Java</button>
      </div>
      <div className={`editor-grid ${javaOpen ? "editor-grid--split" : ""}`}>
        <div className={`editor-pane ${activePane !== "jules" ? "editor-pane--mobile-hidden" : ""}`}>
          <div className="editor-pane__title"><span><Code2 /> {program.name}.jules</span><small>Editable source</small></div>
          <div className="editor-pane__content"><CodeEditor value={program.draftSource} onChange={(value) => onSourceChange(value ?? "")} language="jules" diagnostics={diagnostics} manifest={manifest} /></div>
        </div>
        {javaOpen && <div className={`editor-pane editor-pane--generated ${activePane !== "java" ? "editor-pane--mobile-hidden" : ""}`}><div className="editor-pane__title"><span><FileCode2 /> {program.name.replace(/\s+/g, "")}.java</span><small><Columns2 /> Generated · read only</small></div><div className="editor-pane__content"><CodeEditor value={java} language="java" readOnly ariaLabel="Generated FTC Java preview" /></div></div>}
      </div>
    </section>
  );
}
