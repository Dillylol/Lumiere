import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { ArrowLeft, Bot, Check, Contrast, ExternalLink, Eye, Keyboard, Laptop, Moon, RotateCcw, Sun } from "lucide-react";
import "./App.css";
import { BRAND, repositoryUrl } from "./brand";
import { HomeScreen, type NewProjectRequest } from "./components/HomeScreen";
import { Onboarding } from "./components/Onboarding";
import { parseJules } from "./language/julesLanguage";
import { cloneProject, createProject, parseProject, STARTER_SOURCES, type ExperienceMode, type JulesProjectV1, type SaveState } from "./models/project";
import { createProjectStore, exportProject, importProjectFromFile, migrateLegacyPrograms, type ProjectStore } from "./storage/projectStore";

type ThemeChoice = "system" | "light" | "dark" | "contrast";
const RECOVERY_KEY = "jules-recovery-drafts";

const TEMPLATE_SOURCE: Record<NewProjectRequest["template"], string> = {
  starter: STARTER_SOURCES.autonomous,
  blank: "# Add your first action here",
  square: `# Timed square for learning sequence flow\ndrive.forward(0.4, 900)\nturn.right(0.3, 550)\ndrive.forward(0.4, 900)\nturn.right(0.3, 550)\ndrive.forward(0.4, 900)\nturn.right(0.3, 550)\ndrive.forward(0.4, 900)\nstop()`,
  mechanism: STARTER_SOURCES.utility,
};

const WorkspaceShell = lazy(() => import("./components/WorkspaceShell").then((module) => ({ default: module.WorkspaceShell })));

function App() {
  return <AppErrorBoundary><Application /></AppErrorBoundary>;
}

function Application() {
  const [route, navigate] = useHashLocation();
  const store = useMemo<ProjectStore>(() => createProjectStore(), []);
  const [mode, setMode] = useState<ExperienceMode | undefined>(() => {
    const saved = localStorage.getItem("jules-experience-mode");
    return saved === "beginner" || saved === "advanced" ? saved : "beginner";
  });
  const [projects, setProjects] = useState<JulesProjectV1[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const pendingRef = useRef(new Set<string>());
  const saveTimerRef = useRef<number | undefined>(undefined);
  useTheme();

  const makeLegacy = useCallback((name: string, code: string) => {
    const result = parseJules(code);
    return createProject(`Imported: ${name}`, "advanced", "utility", code, result.ir);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      await migrateLegacyPrograms(store, makeLegacy);
      const storedProjects = await store.list();
      const recovered = readRecoveryDrafts();
      setProjects(storedProjects.map((project) => {
        const draft = recovered[project.id];
        return draft && draft.updatedAt > project.updatedAt ? draft : project;
      }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [makeLegacy, store]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!pendingRef.current.size) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      const ids = [...pendingRef.current];
      pendingRef.current.clear();
      setSaveStates((state) => ({ ...state, ...Object.fromEntries(ids.map((id) => [id, "saving"])) }));
      for (const id of ids) {
        const project = projects.find((item) => item.id === id);
        if (!project) continue;
        try {
          await store.save(project);
          clearRecoveryDraft(id);
          setSaveStates((state) => ({ ...state, [id]: "saved" }));
        } catch (error) {
          console.error("Could not autosave project", error);
          setSaveStates((state) => ({ ...state, [id]: "error" }));
        }
      }
    }, 750);
    return () => window.clearTimeout(saveTimerRef.current);
  }, [projects, store]);

  const chooseMode = (choice: ExperienceMode) => {
    localStorage.setItem("jules-experience-mode", choice);
    setMode(choice);
  };

  const create = async (request: NewProjectRequest) => {
    const source = request.template === "starter" ? STARTER_SOURCES[request.kind] : TEMPLATE_SOURCE[request.template];
    const result = parseJules(source);
    const project = createProject(request.name, mode ?? "beginner", request.kind, source, result.ir);
    await store.save(project);
    setProjects((items) => [project, ...items]);
    setSaveStates((states) => ({ ...states, [project.id]: "saved" }));
    return project;
  };

  const update = (project: JulesProjectV1) => {
    const updated = { ...project, updatedAt: new Date().toISOString() };
    writeRecoveryDraft(updated);
    pendingRef.current.add(project.id);
    setSaveStates((states) => ({ ...states, [project.id]: "unsaved" }));
    setProjects((items) => items.map((item) => item.id === project.id ? updated : item));
  };

  const remove = async (id: string) => {
    await store.delete(id);
    setProjects((items) => items.filter((item) => item.id !== id));
  };

  const duplicate = async (id: string) => {
    const source = projects.find((item) => item.id === id);
    if (!source) return;
    const copy = await store.duplicate(source);
    setProjects((items) => [copy, ...items]);
  };

  const importFile = async () => {
    const imported = await importProjectFromFile();
    if (!imported) return undefined;
    const project = projects.some((item) => item.id === imported.id) ? cloneProject(imported, `${imported.name} imported`) : imported;
    await store.save(project);
    setProjects((items) => [project, ...items.filter((item) => item.id !== project.id)]);
    return project;
  };

  if (route === "/setup") return <Onboarding onChoose={(choice) => { chooseMode(choice); navigate("/"); }} />;
  if (loading) return <LoadingScreen />;
  if (loadError) return <FailureScreen error={loadError} onRetry={reload} />;

  const projectMatch = route.match(/^\/project\/([^/]+)$/);
  if (projectMatch) return <WorkspaceRoute projectId={decodeURIComponent(projectMatch[1])} projects={projects} saveStates={saveStates} onUpdate={update} navigate={navigate} />;
  if (route === "/settings") return <SettingsPage onBack={() => navigate("/")} />;
  if (route === "/help") return <HelpPage onBack={() => navigate("/")} />;
  return <HomeRoute mode={mode ?? "beginner"} projects={projects} store={store} onModeChange={chooseMode} onCreate={create} onImport={importFile} onDelete={remove} onDuplicate={duplicate} navigate={navigate} />;
}

function HomeRoute({ mode, projects, store, onModeChange, onCreate, onImport, onDelete, onDuplicate, navigate }: { mode: ExperienceMode; projects: JulesProjectV1[]; store: ProjectStore; onModeChange: (mode: ExperienceMode) => void; onCreate: (request: NewProjectRequest) => Promise<JulesProjectV1>; onImport: () => Promise<JulesProjectV1 | undefined>; onDelete: (id: string) => Promise<void>; onDuplicate: (id: string) => Promise<void>; navigate: (path: string) => void }) {
  const [importError, setImportError] = useState("");
  return <HomeScreen mode={mode} notice={importError} projects={projects} storageKind={store.kind} onModeChange={onModeChange} onCreate={(request) => void onCreate(request).then((project) => navigate(`/project/${project.id}`))} onOpen={(id) => navigate(`/project/${id}`)} onImport={() => { setImportError(""); void onImport().then((project) => project && navigate(`/project/${project.id}`)).catch((error) => setImportError(`Could not import project: ${error instanceof Error ? error.message : String(error)}`)); }} onDelete={(id) => void onDelete(id)} onDuplicate={(id) => void onDuplicate(id)} />;
}

function WorkspaceRoute({ projectId, projects, saveStates, onUpdate, navigate }: { projectId: string; projects: JulesProjectV1[]; saveStates: Record<string, SaveState>; onUpdate: (project: JulesProjectV1) => void; navigate: (path: string) => void }) {
  const project = projects.find((item) => item.id === projectId);
  if (!project) return <HomeRedirect navigate={navigate} />;
  return <Suspense fallback={<LoadingScreen />}><WorkspaceShell project={project} saveState={saveStates[project.id] ?? "saved"} onBack={() => navigate("/")} onUpdate={onUpdate} onExport={() => void exportProject(project)} /></Suspense>;
}

function LoadingScreen() {
  return <main className="state-screen" aria-busy="true"><span className="brand-mark brand-mark--large"><Bot /></span><h1>Opening {BRAND.name}</h1><p>Loading projects from this computer…</p><span className="loading-bar" aria-hidden="true" /></main>;
}

function FailureScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <main className="state-screen"><span className="state-screen__error">!</span><h1>Projects could not be opened</h1><p>{error}</p><button className="button button--primary" onClick={onRetry}><RotateCcw /> Try again</button></main>;
}

function SettingsPage({ onBack }: { onBack: () => void }) {
  const [theme, setTheme] = useTheme();
  const navigate = (_path: string) => onBack();
  const themes: Array<{ id: ThemeChoice; title: string; detail: string; icon: typeof Laptop }> = [
    { id: "system", title: "System", detail: "Follow this computer's appearance.", icon: Laptop },
    { id: "light", title: "Light", detail: "Uses #ABDBFF as the primary color.", icon: Sun },
    { id: "dark", title: "Dark", detail: "Graphite surfaces with warm amber accents.", icon: Moon },
    { id: "contrast", title: "High contrast", detail: "Stronger borders and focus visibility.", icon: Contrast },
  ];
  return <PageShell title="Settings" subtitle={`Make ${BRAND.name} comfortable on this computer.`} onBack={() => navigate("/")}><section className="settings-section"><div><p className="eyebrow">Appearance</p><h2>Theme</h2><p>All themes preserve the same layout and information.</p></div><div className="theme-grid">{themes.map((option) => { const Icon = option.icon; return <button type="button" key={option.id} className={theme === option.id ? "selected" : ""} onClick={() => setTheme(option.id)}><Icon /><span><strong>{option.title}</strong><small>{option.detail}</small></span>{theme === option.id && <Check />}</button>; })}</div></section><section className="settings-section"><div><p className="eyebrow">Editor</p><h2>Accessible by default</h2></div><div className="settings-cards"><article><Eye /><div><strong>Readable interface</strong><p>14–16 px interface text, scalable layouts, and no color-only status.</p></div></article><article><Keyboard /><div><strong>Keyboard workflow</strong><p>Ctrl/Cmd+K opens commands. Ctrl/Cmd+Enter runs. Shift+F5 stops.</p></div></article></div></section></PageShell>;
}

function HelpPage({ onBack }: { onBack: () => void }) {
  const navigate = (_path: string) => onBack();
  return <PageShell title="Help and shortcuts" subtitle="Short, task-focused guidance that works offline." onBack={() => navigate("/")}><section className="help-grid"><article><GraduationCard number="1" title="Start in Beginner mode">Add structured actions and select one to see its meaning, safe range, and program statement.</GraduationCard></article><article><GraduationCard number="2" title="Switch when ready">Advanced mode edits the same program. Invalid source is preserved and clearly diagnosed.</GraduationCard></article><article><GraduationCard number="3" title="Simulate before hardware">The simulator is always the default target. Start real OpModes from the Driver Station.</GraduationCard></article></section><section className="shortcut-section"><h2>Keyboard shortcuts</h2><dl><div><dt><kbd>Ctrl/⌘ K</kbd></dt><dd>Open command palette</dd></div><div><dt><kbd>Ctrl/⌘ Enter</kbd></dt><dd>Run with the selected target</dd></div><div><dt><kbd>Shift F5</kbd></dt><dd>Stop</dd></div><div><dt><kbd>F1</kbd></dt><dd>Monaco editor accessibility help</dd></div></dl></section>{repositoryUrl() && <a className="button button--secondary" href={repositoryUrl()} target="_blank" rel="noreferrer">Project repository <ExternalLink /></a>}<a className="button button--secondary" href="#/setup">Choose editing mode</a></PageShell>;
}

function PageShell({ title, subtitle, onBack, children }: { title: string; subtitle: string; onBack: () => void; children: ReactNode }) {
  return <div className="page-shell"><header><button className="icon-button" onClick={onBack} aria-label="Back to projects"><ArrowLeft /></button><span className="brand-mark"><Bot /></span><div><p className="eyebrow">{BRAND.name}</p><h1>{title}</h1><p>{subtitle}</p></div></header><main>{children}</main></div>;
}

function GraduationCard({ number, title, children }: { number: string; title: string; children: ReactNode }) { return <><span>{number}</span><h2>{title}</h2><p>{children}</p></>; }

function HomeRedirect({ navigate }: { navigate: (path: string) => void }) {
  useEffect(() => navigate("/"), [navigate]);
  return <LoadingScreen />;
}

function useHashLocation(): [string, (path: string) => void] {
  const readPath = () => window.location.hash.slice(1) || "/";
  const [path, setPath] = useState(readPath);
  useEffect(() => {
    const handleHashChange = () => setPath(readPath());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);
  const navigate = useCallback((nextPath: string) => {
    const nextHash = `#${nextPath}`;
    if (window.location.hash === nextHash) setPath(nextPath);
    else window.location.hash = nextPath;
  }, []);
  return [path, navigate];
}

function useTheme(): [ThemeChoice, (theme: ThemeChoice) => void] {
  const [theme, setThemeState] = useState<ThemeChoice>(() => (localStorage.getItem("jules-theme") as ThemeChoice) || "dark");
  const setTheme = (choice: ThemeChoice) => { localStorage.setItem("jules-theme", choice); setThemeState(choice); };
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === "dark" || theme === "contrast" ? "dark" : theme === "light" ? "light" : "light dark";
  }, [theme]);
  return [theme, setTheme];
}

function readRecoveryDrafts(): Record<string, JulesProjectV1> {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (!raw) return {};
    const candidates = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(candidates).flatMap(([id, value]) => {
      try { return [[id, parseProject(value)]]; } catch { return []; }
    }));
  } catch { return {}; }
}

function writeRecoveryDraft(project: JulesProjectV1) {
  try {
    const drafts = readRecoveryDrafts();
    drafts[project.id] = project;
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(drafts));
  } catch (error) {
    console.warn("Could not write project recovery draft", error);
  }
}

function clearRecoveryDraft(id: string) {
  try {
    const drafts = readRecoveryDrafts();
    delete drafts[id];
    if (Object.keys(drafts).length) localStorage.setItem(RECOVERY_KEY, JSON.stringify(drafts));
    else localStorage.removeItem(RECOVERY_KEY);
  } catch { /* recovery cleanup is best effort */ }
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("UI error", error, info); }
  render() {
    if (this.state.error) return <main className="state-screen"><span className="state-screen__error">!</span><h1>{BRAND.name} hit an unexpected problem</h1><p>Your projects remain stored locally. Reload the application to recover.</p><pre>{this.state.error.message}</pre><button className="button button--primary" onClick={() => location.reload()}><RotateCcw /> Reload {BRAND.name}</button></main>;
    return this.props.children;
  }
}

export default App;
