import { useEffect, useState } from "react";
import { AlertTriangle, Check, FolderOpen, Link2, Link2Off, RefreshCw, Upload } from "lucide-react";
import { checkJavaTarget, defaultJavaPackage, EXPECTED_SDK_VERSION, javaPackageDirectory, type Project } from "../core";
import { isDesktop } from "../desktop/backend";
import type { useDesktop } from "./useDesktop";

type Desktop = ReturnType<typeof useDesktop>;

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** A one-line deploy status for the workspace header. */
export function DeployStatus({ desktop }: { desktop: Desktop }) {
  const { sdk, deployState } = desktop;
  if (!isDesktop() || !sdk) return null;
  const label =
    deployState.state === "deploying" ? "Deploying…"
    : deployState.state === "attention" ? "Deploy needs your choice"
    : deployState.state === "waiting" ? "Deploy waiting for fixes"
    : deployState.state === "blocked" ? "Deploy paused"
    : deployState.state === "failed" ? "Deploy failed"
    : sdk.lastDeploy ? `Deployed ${time(sdk.lastDeploy.at)}`
    : sdk.mode === "auto" ? "Deploys automatically" : "Deploy by hand";
  const warn = ["attention", "waiting", "blocked", "failed"].includes(deployState.state);
  return (
    <small className={`deploy-status${warn ? " warn" : ""}`} title={deployState.message || sdk.folder}>
      <i className="status-dot" />
      {label}
    </small>
  );
}

export function SdkConnection({ desktop, project }: { desktop: Desktop; project: Project }) {
  const { sdk, inspection, deployState, busy } = desktop;
  const [packageDraft, setPackageDraft] = useState(sdk?.javaPackage ?? "");
  const [pedroSetup, setPedroSetup] = useState(true);
  useEffect(() => setPackageDraft(sdk?.javaPackage ?? ""), [sdk?.javaPackage, sdk?.folder]);

  if (!isDesktop()) {
    return (
      <section className="sdk-connection">
        <h2>FTC SDK project</h2>
        <p>
          The desktop app can connect this project to your FtcRobotController folder and keep the generated Java in TeamCode up to date,
          so you only build and install from Android Studio. In the browser, download the files from Code instead.
        </p>
      </section>
    );
  }

  if (!sdk) {
    return (
      <section className="sdk-connection">
        <h2>FTC SDK project</h2>
        <p>
          Connect the FtcRobotController folder you build in Android Studio. The app writes this project's Java into TeamCode for you, every
          time you change it or when you press Deploy code. Building and installing on the robot stay the same.
        </p>
        <div className="inline-actions">
          <button className="primary" disabled={!!busy} onClick={() => void desktop.connect()}>
            <Link2 />
            Connect FTC SDK project
          </button>
          <button disabled={!!busy} onClick={() => void desktop.create()}>
            <FolderOpen />
            Create a new one
          </button>
        </div>
      </section>
    );
  }

  const packageProblem = checkJavaTarget({ javaPackage: packageDraft });
  const conflicts = deployState.state === "attention" || deployState.state === "deployed" ? deployState.plan.writes.filter((entry) => entry.action === "conflict") : [];
  // The conflict list below explains edited files, so its summary warning is not repeated.
  const planWarnings = deployState.state === "attention" || deployState.state === "deployed" ? deployState.plan.warnings.filter((message) => !(conflicts.length && message.includes("edited by hand"))) : [];
  const constantsOptions = [...new Set([sdk.constantsClass, ...(inspection?.constantsClasses.map((item) => item.qualifiedName) ?? [])])];
  const missingLibraries = inspection?.libraries.filter((library) => !library.ok) ?? [];
  const hasConstants = !!inspection?.constantsClasses.length;
  const allPrograms = sdk.programIds === null;
  const chosen = new Set(sdk.programIds ?? project.programs.map((program) => program.id));

  return (
    <section className="sdk-connection" aria-label="FTC SDK project">
      <div className="section-title">
        <div>
          <h2>FTC SDK project</h2>
          <p className="sdk-folder" title={sdk.folder}>{sdk.folder}</p>
        </div>
        <div className="inline-actions">
          <button disabled={!!busy} onClick={() => void desktop.inspect()} aria-label="Check the FTC SDK project again"><RefreshCw /></button>
          <button onClick={() => void import("@tauri-apps/plugin-opener").then((opener) => opener.revealItemInDir(sdk.folder))}><FolderOpen />Show folder</button>
          <button disabled={!!busy} onClick={() => void desktop.connect()}><Link2 />Change folder</button>
          <button disabled={!!busy} onClick={() => void desktop.disconnect()}><Link2Off />Disconnect</button>
        </div>
      </div>

      {inspection && (
        <div className="sdk-checks">
          <p>
            {inspection.sdkVersion ? <>FTC SDK {inspection.sdkVersion}</> : "FTC SDK version unknown"}
            {inspection.sdkVersion && inspection.sdkVersion !== EXPECTED_SDK_VERSION && <> · built and tested with {EXPECTED_SDK_VERSION}</>}
            {" · "}
            {inspection.opModes.length} OpModes in TeamCode
          </p>
          <ul>
            {inspection.libraries.map((library) => (
              <li key={library.artifact} className={library.ok ? "ok" : "missing"}>
                {library.ok ? <Check aria-hidden /> : <AlertTriangle aria-hidden />}
                <span>{library.name}{library.found ? ` ${library.found}` : " is missing"}</span>
              </li>
            ))}
            <li className={hasConstants ? "ok" : "missing"}>
              {hasConstants ? <Check aria-hidden /> : <AlertTriangle aria-hidden />}
              <span>{hasConstants ? "Pedro Pathing constants found" : "No Pedro Pathing constants class with create(HardwareMap)"}</span>
            </li>
          </ul>
          {[...inspection.incompatible, ...inspection.warnings].map((message) => <p className="studio-notice" role="status" key={message}>{message}</p>)}
          {(missingLibraries.length > 0 || !hasConstants) && inspection.incompatible.length === 0 && (
            <div className="inline-actions">
              <button className="primary" disabled={!!busy} onClick={() => void desktop.addLibraries(!hasConstants && pedroSetup)}>
                Add what is missing
              </button>
              {!hasConstants && (
                <label className="check">
                  <input type="checkbox" checked={pedroSetup} onChange={(event) => setPedroSetup(event.target.checked)} />
                  Include Pedro Pathing constants and AutoTune
                </label>
              )}
              <small>Existing files are never replaced. Sync Gradle in Android Studio afterwards.</small>
            </div>
          )}
        </div>
      )}

      <h3>Deploy settings</h3>
      <div className="form-grid sdk-settings">
        <label>
          Java package
          <input
            value={packageDraft}
            spellCheck={false}
            aria-invalid={!!packageProblem}
            onChange={(event) => {
              setPackageDraft(event.target.value);
              if (!checkJavaTarget({ javaPackage: event.target.value })) desktop.updateSdk({ javaPackage: event.target.value });
            }}
          />
          <small>{packageProblem ?? `Files go to ${javaPackageDirectory(sdk.javaPackage)}`}</small>
          {sdk.javaPackage !== defaultJavaPackage(project) && (
            <button className="text-button" onClick={() => desktop.updateSdk({ javaPackage: defaultJavaPackage(project) })}>Use {defaultJavaPackage(project)}</button>
          )}
        </label>
        <label>
          Pedro Pathing constants class
          <select value={sdk.constantsClass} onChange={(event) => desktop.updateSdk({ constantsClass: event.target.value })}>
            {constantsOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <small>Generated OpModes call its create(hardwareMap).</small>
        </label>
        <fieldset>
          <legend>When to deploy</legend>
          <label className="check">
            <input type="radio" name="deploy-mode" checked={sdk.mode === "auto"} onChange={() => desktop.updateSdk({ mode: "auto" })} />
            Automatically after each change
          </label>
          <label className="check">
            <input type="radio" name="deploy-mode" checked={sdk.mode === "manual"} onChange={() => desktop.updateSdk({ mode: "manual" })} />
            Only when I press Deploy code
          </label>
        </fieldset>
        <fieldset>
          <legend>Programs to deploy</legend>
          <label className="check">
            <input type="checkbox" checked={allPrograms} onChange={(event) => desktop.updateSdk({ programIds: event.target.checked ? null : project.programs.map((program) => program.id) })} />
            All programs, including new ones
          </label>
          {!allPrograms && project.programs.map((program) => (
            <label className="check" key={program.id}>
              <input
                type="checkbox"
                checked={chosen.has(program.id)}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.target.checked) next.add(program.id);
                  else next.delete(program.id);
                  desktop.updateSdk({ programIds: project.programs.filter((item) => next.has(item.id)).map((item) => item.id) });
                }}
              />
              {program.name || "Unnamed program"}
            </label>
          ))}
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={sdk.removeOutdated} onChange={(event) => desktop.updateSdk({ removeOutdated: event.target.checked })} />
          Remove generated files this project no longer makes (renamed or removed programs). Edited files are always kept.
        </label>
      </div>

      <div className="inline-actions sdk-deploy">
        <button className="primary" disabled={!!busy} onClick={() => void desktop.deploy()}>
          <Upload />
          Deploy code now
        </button>
        <span role="status" aria-live="polite">
          {deployState.state === "idle"
            ? sdk.lastDeploy ? `Last deploy ${time(sdk.lastDeploy.at)}: ${sdk.lastDeploy.summary}` : "Not deployed yet."
            : deployState.state === "blocked" ? "Automatic deploys are paused."
            : deployState.message}
        </span>
      </div>
      {sdk.mode === "auto" && desktop.autoDeployBlocker && <p className="studio-notice" role="status">{desktop.autoDeployBlocker}</p>}
      {planWarnings.map((message) => <p className="studio-notice" role="status" key={message}>{message}</p>)}
      {conflicts.length > 0 && (
        <div className="sdk-conflicts">
          <h3>Edited generated files</h3>
          <p>These files were changed by hand after they were generated, so they were not updated. Overwrite them with the current program, or delete their GENERATED header in the file to keep your version.</p>
          <ul>
            {conflicts.map((entry) => (
              <li key={entry.path}>
                <code>{entry.path}</code>
                <button disabled={!!busy} onClick={() => void desktop.deploy([entry.path])}>Overwrite</button>
              </li>
            ))}
          </ul>
          {conflicts.length > 1 && <button className="danger" disabled={!!busy} onClick={() => void desktop.deploy(conflicts.map((entry) => entry.path))}>Overwrite all</button>}
        </div>
      )}
      <p className="sdk-footnote">Build and install from Android Studio as usual. Generated files start with a GENERATED header; delete it to take a file over, and the app will leave it alone.</p>
    </section>
  );
}
