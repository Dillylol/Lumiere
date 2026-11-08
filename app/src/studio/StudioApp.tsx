import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Copy, Download, Flame, Folder, FolderOpen, Gamepad2, Plus, RefreshCw, Route, Settings, Square, Trash2, Upload } from "lucide-react";
import { BRAND } from "../brand";
import { createAutonomous, createLine, createProject, createTeleOp, duplicateProject, newId, type Project } from "../core";
import { isDesktop } from "../desktop/backend";
import { Modal } from "../components/ui/Modal";
import { deleteProject, exportProject, listProjects, parseImport, PROJECT_FILE_TYPES, recovery, saveProject, stage } from "./store";
import { useUpdater } from "./useUpdater";
import "./studio.css";

const Workbench = lazy(() => import("./Workbench"));
const TEMPLATES = [
  { id: "starter", title: "Guided first program", detail: "Follow a path and add your first actions.", kind: "Autonomous", Icon: Route },
  { id: "square", title: "Square autonomous", detail: "Explore a four-sided path and its waypoints.", kind: "Autonomous", Icon: Square },
  { id: "red", title: "Red autonomous", detail: "Start with a mirrored path on the opposite side of the field.", kind: "Autonomous", Icon: Route },
  { id: "teleop", title: "Field-centric TeleOp", detail: "Drive with slow mode and heading reset already set up.", kind: "TeleOp", Icon: Gamepad2 },
  { id: "blank", title: "Blank project", detail: "Start with an autonomous program and add your own paths and actions.", kind: "Autonomous", Icon: Folder },
] as const;
type Template = typeof TEMPLATES[number]["id"];
export function Brand({ onBack }: { onBack?: () => void }) {
  const [sparkOpen, setSparkOpen] = useState(false);
  const closeSpark = () => setSparkOpen(false);

  return <>
    <span className="studio-brand">
      <button type="button" className="brand-mark" aria-label={`${BRAND.name} flame`} aria-haspopup="dialog" onClick={() => setSparkOpen(true)}>
        <Flame aria-hidden="true" fill="currentColor"/>
      </button>
      {onBack
        ? <button type="button" className="brand-link" aria-label="Back to projects" onClick={onBack}>{BRAND.name}</button>
        : <strong>{BRAND.name}</strong>}
    </span>
    <Modal open={sparkOpen} title="What Sparked This?" onClose={closeSpark}
      footer={<button type="button" className="primary" onClick={closeSpark}>Keep building</button>}>
      <div className="spark-reveal">
        <div className="spark-dedication">
          <p>I dedicate Lumière to my two mentors, Mr. Cyr and Mr. Botello, who gave me room to explore, try, fail, and build a tool for teams everywhere.</p>
          <p>To Team 27303, Bots of Steele Team Shield, thank you for giving me the chance to lead, create, and grow alongside all of you.</p>
          <p>To everyone in the Steele Robotics Club, may you never stop dreaming, creating, and making memories. May the wins be great, and may the memories and experiences be even greater.</p>
        </div>
      </div>
    </Modal>
  </>;
}
export function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
export function starter(name: string, template: string): Project {
  const project = createProject(name);
  if (template === "teleop") project.programs.push(createTeleOp("Main TeleOp"));
  else {
    const auto = createAutonomous(template === "red" ? "Red Auto" : "Main Auto", { x: 24, y: 24, headingDeg: 0 });
    if (template !== "blank") {
      auto.paths = (template === "square" ? [{x:72,y:24},{x:72,y:72},{x:24,y:72},{x:24,y:24}] : [{x:72,y:24}]).map((point,i) => createLine(point, 0, 0, i, `Path ${i+1}`));
      if (template === "red") { auto.start.x = 120; auto.start.headingDeg = 180; auto.paths.forEach(p => { if(p.kind!=="atomic")return; p.end.x = 144-p.end.x; p.heading = { type: "constant", degrees: 180 }; }); }
      auto.routine = [...auto.paths.map(p => ({id:newId("step"),kind:"path" as const,pathId:p.id})), {id:newId("step"),kind:"wait",ms:250}];
    }
    project.programs.push(auto);
  }
  return project;
}

function Studio() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [ready,setReady] = useState(false);
  const [notice,setNotice] = useState("");
  const [route,setRoute] = useState(() => location.hash.slice(1));
  const [dialog,setDialog] = useState(false);
  const [name,setName] = useState("My FTC Project");
  const [template,setTemplate] = useState<Template>("starter");
  const selectedTemplate = TEMPLATES.find(item => item.id === template)!;
  const openNewProject = (startingPoint: Template = "starter", projectName = "My FTC Project") => {
    setTemplate(startingPoint);
    setName(projectName);
    setDialog(true);
  };
  const [remove,setRemove] = useState<Project>();
  const [saved,setSaved] = useState("Saved");
  const [theme,setTheme] = useState(() => localStorage.getItem("lumiere-theme") ?? "dark");
  const updater = useUpdater();
  const pending = useRef(new Map<string,Project>());
  const queue = useRef(Promise.resolve());
  const input = useRef<HTMLInputElement>(null);
  const go = (value: string) => { location.hash = value; setRoute(value); };
  useEffect(() => { const fn=()=>setRoute(location.hash.slice(1)); window.addEventListener("hashchange",fn); return ()=>window.removeEventListener("hashchange",fn); },[]);
  useEffect(() => { document.documentElement.dataset.theme=theme; document.documentElement.style.colorScheme=theme === "light" ? "light" : "dark"; localStorage.setItem("lumiere-theme",theme); },[theme]);
  useEffect(() => { let live=true; void listProjects().then(result=>{if(live){setProjects(result.projects);setNotice(result.warnings.join("\n"));setReady(true); for(const draft of Object.values(recovery())) pending.current.set(draft.id,draft);}}).catch(e=>{if(live){setNotice(errorText(e));setReady(true);}}); return ()=>{live=false;}; },[]);
  const flush = () => {
    const drafts=[...pending.current.values()]; pending.current.clear();
    queue.current=queue.current.then(async()=>{for(const draft of drafts){try{await saveProject(draft);}catch(e){pending.current.set(draft.id,draft);setSaved("Save failed");setNotice(errorText(e));return;}} if(!pending.current.size)setSaved("Saved");});
    return queue.current;
  };
  useEffect(()=>{if(!pending.current.size)return;const timer=setTimeout(()=>void flush(),750);return()=>clearTimeout(timer);},[projects]);
  useEffect(()=>{const save=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();void flush();}};window.addEventListener("keydown",save);return()=>window.removeEventListener("keydown",save);},[]);
  const update=(project:Project)=>{
    const next={...project,updatedAt:new Date().toISOString()};
    try{stage(next);}catch(e){setNotice(`Recovery storage: ${errorText(e)}`);}
    pending.current.set(next.id,next);setSaved("Saving…");setProjects(items=>items.map(p=>p.id===next.id?next:p));
  };
  const add=async(project:Project)=>{try{await saveProject(project);setProjects(items=>[project,...items]);setDialog(false);go(`/project/${project.id}`);}catch(e){setNotice(errorText(e));}};
  const active=projects.find(p=>route===`/project/${p.id}`);
  if(active)return <Suspense fallback={<div className="studio-loading">Opening workspace…</div>}><Workbench key={active.id} project={active} onUpdate={update} onBack={()=>{void flush();go("/");}} saved={saved} notice={notice} onNotice={setNotice}/></Suspense>;
  return <div className="studio-home">
    <aside className="studio-sidebar"><Brand/><nav aria-label="Main navigation"><button className={!route||route==="/"?"active":""} aria-current={!route||route==="/"?"page":undefined} onClick={()=>go("/")}><Folder/>Projects</button></nav><div className="sidebar-bottom"><button title="Help" aria-current={route==="/help"?"page":undefined} onClick={()=>go("/help")}><BookOpen/>Help</button><button title="Settings" aria-current={route==="/settings"?"page":undefined} onClick={()=>go("/settings")}><Settings/>Settings</button><small><i className="status-dot"/>Local workspace</small></div></aside>
    <main className="studio-home-main">
      {route==="/settings"?<><button onClick={()=>go("/")}><ArrowLeft/>Back to projects</button><h1>Settings</h1><p>Make the workspace comfortable on this computer.</p><h2>Appearance</h2><div className="inline-actions">{["dark","light","contrast"].map(t=><button key={t} aria-pressed={theme===t} className={theme===t?"active":""} onClick={()=>setTheme(t)}>{t=== "dark"?"Graphite":t==="light"?"Light":"High contrast"}</button>)}</div><section className="update-settings"><h2>Updates</h2>{updater.state.phase==="unavailable"?<p>Updates are included in the desktop app.</p>:updater.state.phase==="checking"?<p role="status">Checking for updates…</p>:updater.state.phase==="current"?<p role="status">Lumière is up to date.</p>:updater.state.phase==="available"?<><p>Version {updater.state.version} is ready to install.</p>{updater.state.notes&&<p className="update-notes">{updater.state.notes}</p>}</>:updater.state.phase==="downloading"?<p role="status">Downloading version {updater.state.version}{updater.state.progress===undefined?"…":` · ${updater.state.progress}%`}</p>:updater.state.phase==="restarting"?<p role="status">Update installed. Restarting Lumière…</p>:<p role="alert">Could not check for updates. {updater.state.message}</p>}{updater.state.phase!=="unavailable"&&<div className="inline-actions">{updater.state.phase==="available"&&<button className="primary" onClick={()=>void updater.install()}><Download/>Install and restart</button>}<button disabled={updater.state.phase==="checking"||updater.state.phase==="downloading"||updater.state.phase==="restarting"} onClick={()=>void updater.checkNow()}><RefreshCw/>Check again</button></div>}</section></>:
      route==="/help"?<><button onClick={()=>go("/")}><ArrowLeft/>Back to projects</button><h1>Help and shortcuts</h1><Learn/><p><kbd>Ctrl/⌘ S</kbd> Save · <kbd>Ctrl/⌘ Z</kbd> Undo · <kbd>Ctrl/⌘ K</kbd> Commands</p></>:
      <><header className="studio-home-heading"><div><h1>Your projects</h1><p>{BRAND.tagline}</p></div><div className="inline-actions"><button className="primary" onClick={()=>openNewProject()}><Plus/>New project</button><button onClick={()=>input.current?.click()}><Upload/>Import project</button></div></header>
      {updater.state.phase==="available"&&<div role="status" className="studio-notice update-notice"><span>Version {updater.state.version} is ready.</span><button onClick={()=>go("/settings")}>View update</button></div>}
      {notice&&<div role="alert" className="studio-notice">{notice}<button aria-label="Dismiss message" onClick={()=>setNotice("")}>Dismiss</button></div>}
      <section><div className="section-title"><h2>Recent projects</h2><small>{isDesktop()?"Saved on this computer.":"Saved in this browser."}</small></div>
      {!ready?<p role="status">Loading projects…</p>:!projects.length?<div className="studio-empty projects-empty"><FolderOpen/><h3>No projects yet</h3><p>Create a project, import a saved one, or choose a template below.</p></div>:<div className="project-rows">{projects.map(p=><article key={p.id}><button className="project-open" onClick={()=>go(`/project/${p.id}`)}><Folder/><span><strong>{p.name}</strong><small>{p.programs.length} {p.programs.length===1?"program":"programs"} · {new Date(p.updatedAt).toLocaleDateString()}</small></span><ArrowRight/></button><button aria-label={`Duplicate ${p.name}`} onClick={()=>void add(duplicateProject(p))}><Copy/></button><button aria-label={`Export ${p.name}`} onClick={()=>exportProject(p)}><Download/></button><button aria-label={`Delete ${p.name}`} onClick={()=>setRemove(p)}><Trash2/></button></article>)}</div>}</section>
      <section aria-labelledby="templates-heading">
        <h2 id="templates-heading">Start from a template</h2>
        <div className="template-grid">
          {TEMPLATES.map(({ id, title, detail, kind, Icon }) => (
            <button key={id} onClick={() => openNewProject(id, title)}>
              <span className="template-symbol"><Icon aria-hidden="true"/></span>
              <span className="template-copy">
                <span className="template-kind">{kind}</span>
                <strong>{title}</strong>
                <small>{detail}</small>
              </span>
              <ArrowRight className="template-arrow" aria-hidden="true"/>
            </button>
          ))}
        </div>
      </section><p className="home-footnote">Everything stays on this device.</p></>}
    </main>
    <input hidden type="file" ref={input} accept={PROJECT_FILE_TYPES} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const result=parseImport(await file.text(),file.name);setNotice(result.warnings.join("\n"));await add(projects.some(p=>p.id===result.project.id)?duplicateProject(result.project):result.project);}catch(err){setNotice(errorText(err));}e.target.value="";}}/>
    <Modal open={dialog} title="New project" onClose={()=>setDialog(false)} footer={<>
      <button onClick={()=>setDialog(false)}>Cancel</button>
      <button className="primary" disabled={!name.trim()} onClick={()=>void add(starter(name.trim(),template))}>Create project</button>
    </>}>
      <label>Project name
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{
          if(e.key==="Enter"&&name.trim())void add(starter(name.trim(),template));
        }}/>
      </label>
      <label className="starting-point">Starting point
        <select value={template} aria-describedby="starting-point-detail" onChange={e=>setTemplate(e.target.value as Template)}>
          {TEMPLATES.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
        </select>
      </label>
      <small id="starting-point-detail">{selectedTemplate.detail}</small>
    </Modal>
    <Modal open={!!remove} title="Delete project?" onClose={()=>setRemove(undefined)} footer={<><button onClick={()=>setRemove(undefined)}>Cancel</button><button className="danger" onClick={async()=>{if(!remove)return;try{await flush();await deleteProject(remove.id);setProjects(p=>p.filter(x=>x.id!==remove.id));setRemove(undefined);}catch(e){setNotice(errorText(e));}}}>Delete project</button></>}><p>This removes {remove?.name} from local storage. Export a copy first if you need it.</p></Modal>
  </div>;
}
export function Learn(){return <div className="learn-list">{[["Build a routine","Paths and waits run in order. Together waits for every child; Race finishes when the first child completes.","https://pedropathing.com/docs/pathing"],["Configure your robot","Motor and servo names must match the Robot Controller configuration. Use mechanism states to describe positions and powers.","https://ftc-docs.firstinspires.org/"],["Tune before driving","Use AutoTune on the robot, then paste the results into Constants.java. The desktop simulator currently models Pinpoint localization.","https://pedropathing.com/docs/pathing"],["Preview and simulate","Web Preview estimates ideal path motion. Desktop Real Java runs the actual OpMode with simulated hardware. Start real robot OpModes from the Driver Station.","https://ftc-docs.firstinspires.org/"]].map(([title,body,url])=><article key={title}><h2>{title}</h2><p>{body}</p><a href={url} target="_blank" rel="noreferrer">Read the official documentation<ArrowRight/></a></article>)}</div>;}
export default class StudioApp extends Component<Record<string,never>,{error?:string}>{state:{error?:string}={};static getDerivedStateFromError(e:Error){return{error:e.message};}render(){return this.state.error?<main className="studio-loading"><h1>Could not open the workspace</h1><p>{this.state.error}</p><button onClick={()=>location.reload()}>Reload</button></main>:<Studio/>;}}
