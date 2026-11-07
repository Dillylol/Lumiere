import { useState } from "react";
import type { RobotProfile } from "../core";

interface Props {
  robot: RobotProfile;
  config?: string;
  onConfig: (path: string | undefined) => void;
  onError: (message: string) => void;
  needsFolder: boolean;
  omittedFromSdk: boolean;
  busy: boolean;
  onConnect: () => void;
  onRobotSetup: () => void;
}

export function SimulatorSetup({ robot, config, onConfig, onError, needsFolder, omittedFromSdk, busy, onConnect, onRobotSetup }: Props) {
  const [choosing, setChoosing] = useState(false);

  async function chooseConfig() {
    setChoosing(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ title: "Choose simulator model JSON", filters: [{ name: "Simulator configuration", extensions: ["json"] }] });
      if (typeof path === "string") onConfig(path);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setChoosing(false);
    }
  }

  return <section className="simulator-setup" aria-label="Simulator setup">
    {needsFolder && <div className="inline-actions">
      <small>Connect an FTC SDK project to run your Java.</small>
      <button disabled={busy} onClick={onConnect}>Connect FTC SDK project</button>
    </div>}
    {omittedFromSdk && <div className="inline-actions">
      <small>Include this program in your FTC SDK deploy settings before testing it.</small>
      <button onClick={onRobotSetup}>Open robot setup</button>
    </div>}
    <details>
      <summary>Robot model <small>{config ? "· Custom JSON" : "· Project footprint"}</small></summary>
      <p>{config
        ? config.split(/[\\/]/).pop()
        : "The simulator uses the program’s starting pose and a " + robot.lengthInches + " × " + robot.widthInches + " in footprint with the default mecanum model."}</p>
      <div className="inline-actions">
        <button disabled={busy || choosing} onClick={() => void chooseConfig()}>Choose model JSON</button>
        {config && <button disabled={busy || choosing} onClick={() => onConfig(undefined)}>Use project footprint</button>}
      </div>
      <p>A model file can set wheel dimensions, motor RPM and battery voltage. Measured runs let you check the model against your robot.</p>
    </details>
  </section>;
}

