import { useState } from "react";
import { LIVE_OPMODE_NAME } from "../core";
import { createLivePairing, type LivePairing } from "./livePairing";

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
      program against the robot's hardware, sets it up at INIT, and runs it on START, with every power cut to its
      device's limit in the hardware list. It stops if this computer goes quiet for a second, and the Driver Station's
      STOP always works.
    </p>
    <label className="check">
      <input type="checkbox" checked={!!pairing} disabled={busy} onChange={(event) => void toggle(event.target.checked)}/>
      Live runs from this computer
    </label>
    {failure && <p className="studio-notice" role="alert">{failure}</p>}
    {pairing ? <>
      <ol className="profile-note live-steps">
        <li>{desktop ? "Deploy and install the robot code once" : "Download the generated code from Code, add it to TeamCode, and install it once"}. The Driver Station then lists {LIVE_OPMODE_NAME}.</li>
        <li>On the Driver Station, choose {LIVE_OPMODE_NAME} and press INIT. With Pathing → Robot connected, this computer sends the autonomous you have open, and the robot reports what it found. Press START on the Driver Station to run it.</li>
        <li>Keep Pathing → Robot open during the run. Set power limits for first tests, such as 0.6, and a travel range for motors that take encoder targets, in Robot hardware below. A changed limit goes with the next program sent; nothing needs installing again.</li>
        <li>Only this computer is paired. Turning Live runs off and deploying again removes {LIVE_OPMODE_NAME}; remove it before competitions.</li>
      </ol>
    </> : <p className="profile-note">Off. Deploys from this computer leave {LIVE_OPMODE_NAME} out of the robot code.</p>}
  </section>;
}
