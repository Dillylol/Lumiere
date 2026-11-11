import { useState } from "react";
import { LIVE_DEFAULT_POWER_CAP, LIVE_OPMODE_NAME } from "../core";
import { createLivePairing, type LivePairing } from "./livePairing";
import { NumberField } from "./NumberField";

/**
 * Live runs on the Robot page. Turning them on pairs this computer with the Lumière Live OpMode that
 * its next deploy writes, so the robot can take programs from here and run them without the team
 * rebuilding the robot code.
 */
export function LiveRunsPanel({ pairing, onPairing, desktop }: { pairing: LivePairing | null; onPairing(next: LivePairing | null): void; desktop: boolean }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const toggle = async (on: boolean) => {
    setFailure("");
    if (!on) {
      onPairing(null);
      return;
    }
    setBusy(true);
    try {
      onPairing(await createLivePairing());
    } catch (error) {
      setFailure(`Could not pair this computer: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return <section className="live-runs" aria-labelledby="live-runs-heading">
    <h2 id="live-runs-heading">{LIVE_OPMODE_NAME}</h2>
    <p>
      Run autonomous programs from this computer without rebuilding the robot code. {LIVE_OPMODE_NAME} checks each
      program against the robot's hardware, sets it up at INIT, and runs it on START, with mechanism powers capped.
      It stops if this computer goes quiet for a second, and the Driver Station's STOP always works.
    </p>
    <label className="check">
      <input type="checkbox" checked={!!pairing} disabled={busy} onChange={(event) => void toggle(event.target.checked)}/>
      Live runs from this computer
    </label>
    {failure && <p className="studio-notice" role="alert">{failure}</p>}
    {pairing ? <>
      <div className="form-grid">
        <NumberField label="Mechanism power limit" value={pairing.powerCap ?? LIVE_DEFAULT_POWER_CAP} min={0.1} max={1} step={0.05}
          onChange={(powerCap) => onPairing({ ...pairing, powerCap })}/>
      </div>
      <ol className="profile-note live-steps">
        <li>{desktop ? "Deploy and install the robot code once" : "Download the generated code from Code, add it to TeamCode, and install it once"}, and again after changing the power limit. The Driver Station then lists {LIVE_OPMODE_NAME}.</li>
        <li>On the Driver Station, choose {LIVE_OPMODE_NAME} and press INIT. With Pathing → Robot connected, this computer sends the autonomous you have open, and the robot reports what it found. Press START on the Driver Station to run it.</li>
        <li>Keep Pathing → Robot open during the run. Motors that take encoder targets need a travel range (Robot hardware, below).</li>
        <li>Only this computer is paired. Turning Live runs off and deploying again removes {LIVE_OPMODE_NAME}; remove it before competitions.</li>
      </ol>
    </> : <p className="profile-note">Off. Deploys from this computer leave {LIVE_OPMODE_NAME} out of the robot code.</p>}
  </section>;
}
