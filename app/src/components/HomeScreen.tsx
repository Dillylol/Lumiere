import { BRAND } from "../brand";
import { useMemo, useState } from "react";
import { ArrowRight, HelpCircle, Settings, Folder, Boxes, Code2, FileInput, FolderOpen, GraduationCap, MoreHorizontal, Plus, Route, Trash2, Wrench } from "lucide-react";
import type { ExperienceMode, JulesProjectV1, ProgramKind } from "../models/project";
import { Modal } from "./ui/Modal";

export interface NewProjectRequest {
  name: string;
  kind: ProgramKind;
  template: "starter" | "blank" | "square" | "mechanism";
}

interface HomeScreenProps {
  mode: ExperienceMode;
  notice?: string;
  projects: JulesProjectV1[];
  storageKind: "web" | "desktop";
  onModeChange: (mode: ExperienceMode) => void;
  onCreate: (request: NewProjectRequest) => void;
  onOpen: (id: string) => void;
  onImport: () => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

const templateOptions = [
  { id: "starter" as const, title: "Guided first program", description: "A safe introduction to actions, timing, and stop behavior.", icon: GraduationCap, kind: "autonomous" as const },
  { id: "square" as const, title: "Square autonomous", description: "A simple movement sequence ready for simulation.", icon: Route, kind: "autonomous" as const },
  { id: "mechanism" as const, title: "Mechanism check", description: "Test one motor and servo using conservative values.", icon: Wrench, kind: "utility" as const },
  { id: "blank" as const, title: "Blank project", description: "Start with an empty program and choose every action.", icon: Code2, kind: "teleop" as const },
];

export function HomeScreen({ mode, notice, projects, storageKind, onModeChange, onCreate, onOpen, onImport, onDelete, onDuplicate }: HomeScreenProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("My FTC Project");
  const [kind, setKind] = useState<ProgramKind>("autonomous");
  const [template, setTemplate] = useState<NewProjectRequest["template"]>("starter");
  const [menuId, setMenuId] = useState<string>();
  const [deleteId, setDeleteId] = useState<string>();
  const recent = useMemo(() => projects.slice(0, 6), [projects]);

  const chooseTemplate = (option: typeof templateOptions[number]) => {
    setTemplate(option.id);
    setKind(option.kind);
    setName(option.id === "square" ? "Square Auto" : option.id === "mechanism" ? "Robot Hardware Check" : "My FTC Project");
    setDialogOpen(true);
  };

  const submit = () => {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), kind, template });
    setDialogOpen(false);
  };

  return (
    <div className="home-shell">
      <a className="skip-link" href="#home-content">Skip to projects</a>
      <aside className="home-sidebar">
        <a className="brand" href="#/" aria-label={`${BRAND.name} home`}><span className="brand-mark" aria-hidden="true">{BRAND.name[0]}</span><strong>{BRAND.name}</strong></a>
        <nav aria-label="Home navigation"><a className="sidebar-link active" href="#/" aria-current="page"><Folder />Projects</a></nav>
        <div className="home-sidebar__footer"><a className="sidebar-link" href="#/help"><HelpCircle />Help</a><a className="sidebar-link" href="#/settings" aria-label="Open settings"><Settings />Settings</a><span className="local-status"><i />Local workspace</span></div>
      </aside>
      {notice && <div className="home-notice" role="alert">{notice}</div>}
      <main id="home-content" className="home-content">
        <header className="home-heading"><div><h1>Your projects</h1><p>A place for your next robot program.</p></div><div className="home-heading__actions"><button className="button button--primary" type="button" onClick={() => setDialogOpen(true)}><Plus />New project</button><button className="button button--secondary" type="button" onClick={onImport}><FileInput />Import project</button></div></header>

        <section aria-labelledby="recent-heading" className="home-section">
          <div className="section-heading">
            <h2 id="recent-heading">Recent projects</h2>
            <span className="storage-note">{storageKind === "desktop" ? "Saved on this computer" : "Saved in this browser"}</span>
          </div>
          {recent.length ? (
            <div className="project-grid">
              {recent.map((project) => (
                <article className="project-card" key={project.id}>
                  <button className="project-card__open" type="button" onClick={() => onOpen(project.id)}>
                    <span className="project-card__icon">{project.programs[0]?.kind === "teleop" ? <Boxes /> : <Route />}</span>
                    <span className="project-card__copy"><strong>{project.name}</strong><span>{project.programs.length} program{project.programs.length === 1 ? "" : "s"} · {project.experienceMode}</span></span>
                    <span className="project-card__time">{formatRelative(project.updatedAt)}</span>
                  </button>
                  <button className="icon-button project-card__menu" type="button" aria-label={`Project actions for ${project.name}`} aria-expanded={menuId === project.id} onClick={() => setMenuId(menuId === project.id ? undefined : project.id)}><MoreHorizontal /></button>
                  {menuId === project.id && (
                    <div className="project-menu" role="menu">
                      <button role="menuitem" onClick={() => { onDuplicate(project.id); setMenuId(undefined); }}>Duplicate</button>
                      <button className="danger-text" role="menuitem" onClick={() => { setDeleteId(project.id); setMenuId(undefined); }}><Trash2 /> Delete</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state home-empty"><FolderOpen aria-hidden="true" /><h3>Make your first move.</h3><p>Create a project or start with a template below.</p><button className="text-button" onClick={() => setDialogOpen(true)}>Create a project <ArrowRight /></button></div>
          )}
        </section>

        <section aria-labelledby="templates-heading" className="home-section">
          <div className="section-heading"><h2 id="templates-heading">Start from a template</h2></div>
          <div className="template-grid">
            {templateOptions.map((option) => {
              const Icon = option.icon;
              return <button className="template-card" type="button" key={option.id} onClick={() => chooseTemplate(option)}><span className="template-card__icon"><Icon /></span><span><strong>{option.title}</strong><small>{option.description}</small></span><ArrowRight aria-hidden="true" /></button>;
            })}
          </div>
        </section>
        <p className="home-footnote">Everything stays on this device.</p>
      </main>

      <Modal
        open={dialogOpen}
        title={`Create a ${BRAND.name} project`}
        description="You can change modes and add programs later."
        onClose={() => setDialogOpen(false)}
        footer={<><button className="button button--ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</button><button className="button button--primary" type="button" disabled={!name.trim()} onClick={submit}>Create project</button></>}
      >
        <div className="form-stack">
          <label className="field"><span>Project name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="field"><span>Editing mode</span><select value={mode} onChange={(event) => onModeChange(event.target.value as ExperienceMode)}><option value="beginner">Visual · guided actions</option><option value="advanced">Code · text editor</option></select></label>
          <label className="field"><span>First program</span><select value={kind} onChange={(event) => setKind(event.target.value as ProgramKind)}><option value="autonomous">Autonomous</option><option value="teleop">TeleOp</option><option value="utility">Utility / test</option></select></label>
          <label className="field"><span>Starting point</span><select value={template} onChange={(event) => setTemplate(event.target.value as NewProjectRequest["template"])}><option value="starter">Guided starter</option><option value="square">Square autonomous</option><option value="mechanism">Mechanism check</option><option value="blank">Blank</option></select></label>
        </div>
      </Modal>
      <Modal
        open={Boolean(deleteId)}
        title="Delete this project?"
        description="This removes the local project from this computer. Export it first if you may need it later."
        onClose={() => setDeleteId(undefined)}
        footer={<><button className="button button--ghost" type="button" onClick={() => setDeleteId(undefined)}>Cancel</button><button className="button button--danger" type="button" onClick={() => { if (deleteId) onDelete(deleteId); setDeleteId(undefined); }}>Delete project</button></>}
      >
        <p><strong>{projects.find((project) => project.id === deleteId)?.name}</strong> cannot be recovered after deletion.</p>
      </Modal>
    </div>
  );
}

function formatRelative(timestamp: string) {
  const difference = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(difference / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}
