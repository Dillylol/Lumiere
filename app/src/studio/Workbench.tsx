import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Check, ChevronDown, Code2, Command, Copy, Download, FolderOpen, GitBranch, Play, Plus, Redo2, Route, Trash2, Undo2, Wrench } from "lucide-react";
import { applyTunerOutput, createAutonomous, createTeleOp, findOpModes, generateJava, newId, ownershipOf, parseBuildOutput, readPedroConstants, syncRobotProfile, updateTuningLocalizer, validateProject, type Project, type Program, type ScannedDevice, type ScannedPedro } from "../core";
import { isDesktop } from "../desktop/backend";
import { Modal } from "../components/ui/Modal";
import { Brand, Learn } from "./StudioApp";
import { ProgramEditor } from "./ProgramEditor";
import { Mechanisms } from "./Mechanisms";
import { PathingWorkspace, type PathingMode } from "./pathing/PathingWorkspace";
import type { RunEnvironment } from "./pathing/RunPanels";
import { SimulatorSetup } from "./SimulatorSetup";
import { RobotBreakdown } from "./RobotBreakdown";
import { RobotProfilePanel } from "./RobotProfile";
import { LiveRunsPanel } from "./LiveRuns";
import { loadLivePairing, saveLivePairing, type LivePairing } from "./livePairing";
import { useDesktop } from "./useDesktop";
import { DeployStatus, SdkConnection } from "./SdkConnection";
import { confirmAction, download, exportProject, robotHost, saveRobotHost } from "./store";
const JavaEditor=lazy(()=>import("./JavaEditor"));
const TABS=[{id:"build",label:"Build",Icon:GitBranch},{id:"paths",label:"Pathing",Icon:Route},{id:"code",label:"Code",Icon:Code2},{id:"robot",label:"Robot",Icon:Wrench},{id:"learn",label:"Learn",Icon:BookOpen}] as const;
type Tab=typeof TABS[number]["id"];
export default function Workbench({project,onUpdate,onBack,saved,notice,onNotice:setNotice}:{project:Project;onUpdate:(p:Project)=>void;onBack:()=>void;saved:string;notice:string;onNotice:(s:string)=>void}){
 const [tab,setTab]=useState<Tab>("build"),[programId,setProgramId]=useState(project.programs[0]?.id),[output,setOutput]=useState<string[]>([]),[filePath,setFilePath]=useState(""),[line,setLine]=useState<number>(),[palette,setPalette]=useState(false),[query,setQuery]=useState(""),[addProgram,setAddProgram]=useState(false),[newName,setNewName]=useState("New Auto"),[newKind,setNewKind]=useState("autonomous"),[license,setLicense]=useState(false),[host,setHost]=useState(()=>robotHost(project.id)),[tuner,setTuner]=useState<string|null>(null),[history,setHistory]=useState<{past:Project[];future:Project[]}>({past:[],future:[]});
 const log=useCallback((s:string)=>setOutput(lines=>[...lines.slice(-999),s]),[]);
 // Live runs: this computer's pairing with Lumière Live, kept on this computer only.
 const [livePairing,setLivePairingState]=useState(()=>loadLivePairing(project.id));
 useEffect(()=>setLivePairingState(loadLivePairing(project.id)),[project.id]);
 const setLivePairing=(next:LivePairing|null)=>{saveLivePairing(project.id,next);setLivePairingState(next);};
 const liveTarget=useMemo(()=>livePairing?{pairingHash:livePairing.pairingHash,...(livePairing.powerCap!==undefined?{powerCap:livePairing.powerCap}:{})}:undefined,[livePairing?.pairingHash,livePairing?.powerCap]);
 const desktop=useDesktop(project,log,liveTarget);
 const program=project.programs.find(p=>p.id===programId)??project.programs[0];
 // While an FTC SDK project is linked, the robot profile follows its Pedro constants class as saved on disk.
 // Syncing is not an edit, so it skips undo history; after an undo it applies again.
 const constantsFile = useMemo(() => {
   const path = desktop.inspection?.constantsClasses.find(item => item.qualifiedName === desktop.sdk?.constantsClass)?.path;
   return path ? desktop.files.find(file => file.path === path) : undefined;
 }, [desktop.inspection, desktop.sdk?.constantsClass, desktop.files]);
 useEffect(() => {
   if (!constantsFile) return;
   const robot = syncRobotProfile(project.robot, readPedroConstants(constantsFile.disk), constantsFile.path);
   if (robot) onUpdate({ ...project, robot });
 }, [constantsFile?.path, constantsFile?.disk, project.robot]);
 // The robot's manifest arrives on a stream callback, so it reads the newest project here.
 const latestProject = useRef(project);
 latestProject.current = project;
 const recordScan = useCallback((devices: ScannedDevice[], pedro?: ScannedPedro) => {
   const current = latestProject.current;
   const next = { devices, ...(pedro ? { pedro } : {}) };
   const known = current.robot.scan;
   // Saved only when the report changes, so `scannedAt` says when the robot's configuration last changed.
   if (known && JSON.stringify({ devices: known.devices, ...(known.pedro ? { pedro: known.pedro } : {}) }) === JSON.stringify(next)) return;
   onUpdate({ ...current, robot: { ...current.robot, scan: { ...next, scannedAt: new Date().toISOString() } } });
 }, [onUpdate]);
 const [simulatorConfig, setSimulatorConfig] = useState<string>();
 /** Pathing's mode: Develop draws paths, Simulate runs them, Robot watches the robot. */
 const [pathingMode, setPathingMode] = useState<PathingMode>("develop");
 const openPathing = (mode: PathingMode) => { setPathingMode(mode); setTab("paths"); };
 const hostField = <label>Control Hub address<input value={host} onChange={e=>setHost(e.target.value)} placeholder="192.168.43.1"/></label>;
 useEffect(()=>saveRobotHost(project.id,host),[project.id,host]);
 const omittedFromSdk = !!program && !!desktop.sdk?.programIds && !desktop.sdk.programIds.includes(program.id);
 const update=(p:Project)=>{setHistory(h=>({past:[...h.past.slice(-99),project],future:[]}));onUpdate(p);};
 const updateProgram=(p:Program)=>update({...project,programs:project.programs.map(x=>x.id===p.id?p:x)});
 const simulatorSetup = isDesktop() && program ? (
   <SimulatorSetup robot={project.robot} config={simulatorConfig} onConfig={setSimulatorConfig} onError={setNotice}
     needsFolder={!desktop.folder} omittedFromSdk={omittedFromSdk} busy={!!desktop.busy}
     onConnect={() => void desktop.connect()} onRobotSetup={() => setTab("robot")}/>
 ) : undefined;
 const runEnv: RunEnvironment = {
   desktop: isDesktop(), busy: desktop.busy, canLaunch: !!desktop.folder && !omittedFromSdk,
   launch: () => program ? desktop.launch(program, simulatorConfig) : Promise.resolve(undefined),
   cancel: desktop.cancel, onLog: log, simulatorSetup, host, onHost: setHost, onScan: recordScan,
   deployCode: desktop.folder ? () => { setBottom("output"); void desktop.deploy(); } : undefined,
   deployApk: desktop.folder && /^[\w.-]+$/.test(host) ? () => { setBottom("output"); void desktop.run("deploy", host); } : undefined,
   onRobotSetup: () => setTab("robot"),
   live: livePairing ? { secret: livePairing.secret } : undefined,
 };
 const undo=()=>{const p=history.past[history.past.length-1];if(p){setHistory({past:history.past.slice(0,-1),future:[project,...history.future]});onUpdate(p);}};
 const redo=()=>{const p=history.future[0];if(p){setHistory({past:[...history.past,project],future:history.future.slice(1)});onUpdate(p);}};
 const generation=useMemo(()=>generateJava(project,desktop.target??(liveTarget?{live:liveTarget}:undefined)),[project,desktop.target?.javaPackage,desktop.target?.constantsClass,liveTarget]);const generated=generation.ok?generation.files:[];
 const problems=useMemo(()=>validateProject(project),[project]);const build=useMemo(()=>parseBuildOutput(output,desktop.folder),[output,desktop.folder]);
 const [bottom, setBottom] = useState<"problems" | "output" | null>();
 const problemCount = problems.length + build.problems.length;
 const openPanel = bottom === undefined ? (problemCount > 0 ? "problems" : null) : bottom;
 const togglePanel = (panel: "problems" | "output") => setBottom(openPanel === panel ? null : panel);
 const file=desktop.files.find(f=>f.path===filePath)??desktop.files[0];const generatedFile=generated.find(f=>f.path===filePath)??generated[0];const shown=desktop.folder?file:generatedFile;
 const [visualCode,setVisualCode]=useState(false);
 const selectedModes=shown?findOpModes(shown.content):[];
 useEffect(() => {
   const keys = (event: KeyboardEvent) => {
     const target = event.target as HTMLElement;
     const inDialog = target.closest("[aria-modal=true]") !== null;
     const shortcut = event.ctrlKey || event.metaKey;
     const key = event.key.toLowerCase();
     if (shortcut && key === "k") {
       event.preventDefault();
       if (!inDialog || palette) setPalette(open => !open);
     }
     if (event.key === "F5" && event.shiftKey) {
       event.preventDefault();
       desktop.cancel();
     }
     if (shortcut && key === "z" && !inDialog && !/INPUT|TEXTAREA/.test(target.tagName) && !target.closest(".monaco-editor")) {
       event.preventDefault();
       if (event.shiftKey) redo();
       else undo();
     }
   };
   window.addEventListener("keydown", keys);
   return () => window.removeEventListener("keydown", keys);
 });
 const commands=[...TABS.map(t=>({label:`Open ${t.label}`,run:()=>setTab(t.id)})),{label:"Undo",run:undo},{label:"Redo",run:redo},{label:"Export project",run:()=>exportProject(project)},...(isDesktop()?[{label:"Check Java",run:()=>{setBottom("output");void desktop.run("check");}},{label:"Connect FTC SDK project",run:()=>void desktop.connect()},...(desktop.folder?[{label:"Deploy code",run:()=>{setBottom("output");void desktop.deploy();}}]:[])]:[])];
 const codePane=<div className="java-workspace"><div className="file-explorer"><div className="section-title"><strong>{desktop.folder?"TeamCode":"Generated Java"}</strong></div>{(desktop.folder?desktop.files:generated).map(f=><button className={shown?.path===f.path?"active":""} key={f.path} title={f.path} onClick={()=>{setFilePath(f.path);setLine(undefined);}}><Code2/><span>{f.path.split("/").slice(-1)[0]}{"disk"in f&&f.content!==f.disk?" •":""}</span></button>)}</div><div className="java-main"><div className="java-toolbar"><span>{shown?.path.split("/").slice(-1)[0]??"No file selected"}</span><small>{desktop.folder?(shown&&ownershipOf(shown.content)==="generated"?"Generated · locked":"Team owned"):"Generated · read only"}</small>{shown&&<button onClick={()=>download(shown.path.split("/").slice(-1)[0]!,shown.content)}><Download/>Download</button>}{file&&desktop.folder&&<><button disabled={!!desktop.busy} onClick={()=>void desktop.save()}>Save files</button><button disabled={!!desktop.busy} onClick={()=>void desktop.reloadFile(file.path)}>Reload file</button>{ownershipOf(file.content)!=="team"&&<button onClick={()=>desktop.eject(file.path)}>Eject</button>}{file.path.endsWith("/Constants.java")&&<button onClick={()=>setTuner("")}>Paste AutoTune</button>}</>}</div>{shown?<Suspense fallback={<pre className="code-fallback">{shown.content}</pre>}><JavaEditor path={`${project.id}/${desktop.folder||"generated"}/${shown.path}`} value={shown.content} readOnly={!desktop.folder||ownershipOf(shown.content)==="generated"||!!desktop.busy} onChange={value=>desktop.edit(shown.path,value)} problems={build.problems.filter(p=>p.file===shown.path)} line={line}/></Suspense>:<div className="studio-empty"><Code2/><h2>Open your robot code</h2><p>{generation.ok?"Link an FTC project folder or create one below.":"Resolve the project problems to generate Java."}</p></div>}{selectedModes.length>0&&<div className="java-mode-list">OpModes: {selectedModes.map(m=>`${m.name}${m.disabled?" (disabled)":""}`).join(" · ")}</div>}</div></div>;
 return <div className="studio-workbench"><header className="studio-top"><div className="brand-home"><Brand onBack={onBack}/></div><div className="breadcrumb"><span>Projects</span><span>/</span><input aria-label="Project name" value={project.name} onChange={e=>update({...project,name:e.target.value})}/><small><i className="status-dot"/>{saved}</small><DeployStatus desktop={desktop}/></div><div className="inline-actions"><button disabled={!history.past.length} onClick={undo} aria-label="Undo"><Undo2/></button><button disabled={!history.future.length} onClick={redo} aria-label="Redo"><Redo2/></button><button aria-label="Commands" aria-keyshortcuts="Control+K Meta+K" onClick={()=>setPalette(true)}><Command/><span>Commands</span></button><button aria-label="Help" onClick={()=>setTab("learn")}><BookOpen/></button></div></header>
 <aside className="studio-sidebar"><nav aria-label="Workspace">{TABS.map(({id,label,Icon})=><button key={id} className={id===tab?"active":""} aria-label={label} title={label} aria-current={id===tab?"page":undefined} onClick={()=>setTab(id)}><Icon/><span>{label}</span></button>)}</nav><div className="program-heading"><span>Programs</span><button aria-label="Add program" onClick={()=>setAddProgram(true)}><Plus/></button></div><nav aria-label="Programs">{project.programs.map(p=><button key={p.id} className={p.id===program?.id?"active":""} aria-label={p.name||"Unnamed program"} title={p.name||"Unnamed program"} aria-pressed={p.id===program?.id} onClick={()=>setProgramId(p.id)}><GitBranch/><span>{p.name||"Unnamed program"}</span></button>)}</nav>{program&&<div className="program-actions"><button aria-label="Duplicate program" onClick={()=>{const copy={...structuredClone(program),id:newId("program"),name:`${program.name} copy`};update({...project,programs:[...project.programs,copy]});setProgramId(copy.id);}}><Copy/></button><button aria-label="Delete program" onClick={async()=>{if(await confirmAction(`Delete ${program.name}? You can undo this change.`))update({...project,programs:project.programs.filter(p=>p.id!==program.id)});}}><Trash2/></button></div>}<div className="sidebar-bottom"><small><i className="status-dot"/>Local workspace</small><button aria-label="Export project" title="Export project" onClick={()=>exportProject(project)}><Download/><span>Export project</span></button><button aria-label="All projects" title="All projects" onClick={onBack}><ArrowLeft/><span>All projects</span></button></div></aside>
 <main className="workbench-content">{tab!=="paths"&&<header className="workbench-heading"><div><h1>{tab==="build"?"Program flow":tab==="code"?"Java editor":tab==="robot"?"Robot setup":"Learn"}</h1><p>{program?`${program.kind==="autonomous"?"Autonomous":"TeleOp"} · ${program.name}`:"Add a program to get started."}</p></div><div className="inline-actions">
 {tab==="build"&&<div className="segmented"><button className={!visualCode?"active":""} onClick={()=>setVisualCode(false)}>Visual</button><button className={visualCode?"active":""} onClick={()=>setVisualCode(true)}>Code</button></div>}{isDesktop()?<><button disabled={!!desktop.busy||!desktop.folder} onClick={()=>{setBottom("output");void desktop.run("check");}}><Check/>Check</button><button disabled={!!desktop.busy||!desktop.folder} onClick={()=>{setBottom("output");void desktop.run("build");}}>Build APK</button></>:null}{program&&(isDesktop()||program.kind==="autonomous")&&<button className="primary" onClick={()=>openPathing("simulate")}><Play/>{isDesktop()?"Open simulator":"Preview program"}</button>}</div></header>}
 {notice&&<div className="studio-notice" role="alert">{notice}<button onClick={()=>setNotice("")}>Dismiss</button></div>}
 {tab==="code"&&isDesktop()&&<div className="desktop-bar">{desktop.folder?<><span title={desktop.folder}>{desktop.folder}</span><button disabled={!!desktop.busy} onClick={()=>{setBottom("output");void desktop.deploy();}}>Deploy code</button><button onClick={()=>setTab("robot")}>Deploy settings</button></>:<><button disabled={!!desktop.busy} onClick={()=>{setBottom("output");void desktop.connect();}}><FolderOpen/>Connect FTC SDK project</button><button disabled={!!desktop.busy} onClick={()=>{setBottom("output");void desktop.create();}}><Plus/>Create FTC project</button><span>No FTC SDK project connected</span></>}</div>}
 {tab==="code"&&isDesktop()&&!desktop.status?.ready&&<div className="toolchain-bar"><strong>Build tools</strong><span>{desktop.status?.missing.join(", ")||"Checking Java and Android SDK…"}</span>{desktop.status&&<><label className="check"><input type="checkbox" checked={license} onChange={e=>setLicense(e.target.checked)}/>I accept the <a href={desktop.status.install.licenseUrl} target="_blank" rel="noreferrer">Android SDK license</a></label><button disabled={!!desktop.busy||(!license&&desktop.status.missing.some(m=>m!=="java"))} onClick={()=>{setBottom("output");void desktop.install(license);}}>Install tools</button></>}</div>}
 <div className="workbench-surface">{tab==="build"?(program?(visualCode?codePane:<ProgramEditor project={project} program={program} onChange={updateProgram}/>):<div className="studio-empty"><h2>Your next program starts here.</h2><button onClick={()=>setAddProgram(true)}><Plus/>Add program</button></div>):tab==="paths"?(program?<PathingWorkspace key={program.id} project={project} program={program} mode={pathingMode} onMode={setPathingMode} onChange={updateProgram} onAddProgram={(next)=>{update({...project,programs:[...project.programs,next]});setProgramId(next.id);}} onNotice={setNotice} onOpenRobot={()=>setTab("robot")} env={runEnv}/>:<div className="studio-empty"><Route/><h2>Add a program to start</h2><p>Draw an autonomous program's paths here, then run it in the simulator or on the robot.</p><button onClick={()=>setAddProgram(true)}><Plus/>Add program</button></div>):tab==="code"?codePane:tab==="robot"?<div className="editor-scroll"><SdkConnection desktop={desktop} project={project}/><h2>Robot connection</h2><div className="inline-actions">{hostField}<a href={`http://${host}:8001`} target="_blank" rel="noreferrer">Open Panels</a><a href={`http://${host}:10158`} target="_blank" rel="noreferrer">Open AutoTune</a>{isDesktop()&&<button className="primary" disabled={!!desktop.busy||!desktop.folder||!/^[\w.-]+$/.test(host)} onClick={()=>{setBottom("output");void desktop.run("deploy",host);}}>Deploy APK</button>}</div><p className="live-view-link">Watch the robot drive against the plan and compare its runs in Pathing.{program&&<button className="text-button" onClick={()=>openPathing("robot")}>Open the live view</button>}</p><LiveRunsPanel pairing={livePairing} onPairing={setLivePairing} desktop={isDesktop()}/><RobotProfilePanel project={project} onChange={update} linked={!!desktop.sdk}/><Mechanisms project={project} onChange={update}/><RobotBreakdown project={project}/></div>:<div className="editor-scroll"><Learn/></div>}</div>
 <section className="workbench-output" aria-label="Diagnostics">
   <div className="output-tabs">
     <button className={openPanel==="problems"?"active":""} aria-expanded={openPanel==="problems"} aria-controls="workbench-diagnostics" onClick={()=>togglePanel("problems")}>
       Problems{problemCount > 0 && <span className="problem-count">{problemCount}</span>}{openPanel==="problems"&&<ChevronDown aria-hidden="true"/>}
     </button>
     <button className={openPanel==="output"?"active":""} aria-expanded={openPanel==="output"} aria-controls="workbench-diagnostics" onClick={()=>togglePanel("output")}>Output{openPanel==="output"&&<ChevronDown aria-hidden="true"/>}</button>
     <span className="output-task" title={desktop.busy}>{desktop.busy}</span>
     {desktop.busy&&<button className="danger" onClick={desktop.cancel}>Cancel task</button>}
     {openPanel==="output"&&output.length>0&&<button onClick={()=>setOutput([])}>Clear output</button>}
   </div>
   <div className="output-body" id="workbench-diagnostics" hidden={!openPanel}>
     {openPanel === "output" ? (
       <pre aria-live="polite">{output.join("\n") || "Build and simulator output appears here."}</pre>
     ) : openPanel === "problems" ? (
       problemCount === 0 ? <p><i className="status-dot"/>No problems found.</p> : <>
         {problems.map((problem, i) => (
           <button className={["problem", problem.severity].join(" ")} key={i} onClick={() => {
             if (problem.location.programId) setProgramId(problem.location.programId);
             if (problem.location.pathId) setPathingMode("develop");
             setTab(problem.location.pathId ? "paths" : problem.location.robot || problem.location.subsystemId ? "robot" : "build");
             setVisualCode(false);
           }}>{problem.severity}: {problem.message}</button>
         ))}
         {build.problems.map((problem, i) => (
           <button className="problem error" key={"build" + i} onClick={() => {
             if (!problem.file) return;
             setFilePath(problem.file);
             setLine(problem.line);
             setTab("code");
           }}>{problem.file}:{problem.line} {problem.message}</button>
         ))}
       </>
     ) : null}
   </div>
 </section></main>
 <Modal open={palette} title="Commands" onClose={()=>setPalette(false)}><label>Search commands<input value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="command-list">{commands.filter(c=>c.label.toLowerCase().includes(query.toLowerCase())).map(c=><button key={c.label} onClick={()=>{c.run();setPalette(false);setQuery("");}}>{c.label}</button>)}</div></Modal>
 <Modal open={addProgram} title="Add program" onClose={()=>setAddProgram(false)} footer={<><button onClick={()=>setAddProgram(false)}>Cancel</button><button className="primary" disabled={!newName.trim()} onClick={()=>{const p=newKind==="autonomous"?createAutonomous(newName.trim()):createTeleOp(newName.trim());update({...project,programs:[...project.programs,p]});setProgramId(p.id);setAddProgram(false);}}>Add program</button></>}><label>Program name<input value={newName} onChange={e=>setNewName(e.target.value)}/></label><label>Program type<select value={newKind} onChange={e=>setNewKind(e.target.value)}><option value="autonomous">Autonomous</option><option value="teleop">TeleOp</option></select></label></Modal>
 <Modal open={tuner!==null} title="Paste AutoTune results" onClose={()=>setTuner(null)} description="Review the updated Constants.java before saving. Localizer changes also update Tuning.java." footer={<><button onClick={()=>setTuner(null)}>Cancel</button><button className="primary" disabled={!tuner?.trim()} onClick={()=>{try{if(!file)return;const result=applyTunerOutput(file.content,tuner!);if(!result.replaced.length)throw new Error("No matching tuner declarations were found.");desktop.edit(file.path,result.source);const tuning=desktop.files.find(f=>f.path.endsWith("/pedro/Tuning.java"));if(result.localizerChange&&tuning)desktop.edit(tuning.path,updateTuningLocalizer(tuning.content,result.localizerChange));setNotice([...result.notes,...result.missing.map(m=>`Unmatched field: ${m}`),result.localizerChange&&!tuning?"Tuning.java was not found. Update its localizer type before building.":"","AutoTune results are staged in the editor. Review and save files."].filter(Boolean).join("\n"));setTuner(null);}catch(e){setNotice(String(e));}}}>Apply to editor</button></>}><label>AutoTune output<textarea rows={12} value={tuner??""} onChange={e=>setTuner(e.target.value)}/></label></Modal>
 </div>;
}
