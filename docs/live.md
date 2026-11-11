# Lumière Live

Lumière Live runs an autonomous program from Lumière on the robot without rebuilding and installing the robot code. You still start it from the Driver Station, and the Driver Station's STOP always works.

It is for trying and tuning autonomous programs. Turn it off before competitions.

## Turn it on

1. On the **Robot** page, find **Lumière Live** and turn on **Live runs from this computer**. This pairs this computer with the robot code you deploy next. The pairing secret stays on this computer; the robot code carries only its fingerprint.
2. In the Robot page's **hardware list**, set a **power limit** on motors and continuous servos for first tests, such as 0.6; raise it once the program behaves. Every power the device is given is cut to its limit, in Lumière Live as in deployed code, and a changed limit goes with the next program sent.
3. Give every motor that takes encoder targets a **travel range** in the Robot page's **hardware list**: the lowest and highest ticks it may reach, counted from where it is at INIT. Lumière Live refuses encoder targets without one.
4. **Deploy** and install the robot code (in the browser, download the generated code from **Code**). The Driver Station then lists **Lumière Live**.

Lumière Live needs robot library 0.4.0 or newer for programs from Lumière 0.4.0, which carry each device's settings, Motor and Servo actions, and timed actions. Deploy warns when TeamCode uses an older one.

## Run a program

1. Join robot Wi-Fi. In **Pathing**, open the autonomous and switch to **Robot**, then **Connect robot**.
2. On the Driver Station, choose **Lumière Live** and press **INIT**. The app pairs and sends the program, and the robot checks it.
   - **The result:** the Lumière Live panel shows whether the program passed, with any problems and notes. The Driver Station shows the same.
   - **Edits:** if you change the program before START, the app sends it again.
   - **INIT setup:** a program that passes is set up as the deployed OpMode would set it up: the robot's start pose, each mechanism's starting state, and the devices the program sets directly.
3. Press **START** on the Driver Station.
   - **During the run:** the panel shows the run as it goes: running, finished with its time, or stopped with the reason. How the run ended stays in the panel until the next INIT.
   - **The field:** it draws the run against the plan, as for the program's own OpMode.
4. To run again, press **STOP**, then **INIT** Lumière Live again. A program can't change after START.

Keep **Pathing → Robot** connected, and the computer awake and on robot Wi-Fi, during the run. The app can be behind other windows. While paired, it checks in with the robot four times a second.

## What the robot checks

| Problem | What to do |
| --- | --- |
| A device is not in the robot's configuration | Match the name to the Robot Controller configuration |
| A device is configured as another type (for example a continuous servo used as a servo) | Fix the device type in the hardware list, the action or mechanism, or the configuration |
| A device is one of Pedro Pathing's drive motors | Mechanisms and actions can't use Pedro's devices |
| An encoder target on a motor whose encoder port has a dead wheel | Give that motor power instead, or move the dead wheel |
| An encoder target without a travel range, or outside it | Set or widen the travel range in the Robot page's hardware list |
| The program's format is newer than the robot library | Update the robot library and install the robot code |

**Notes don't stop the program.** The usual one says a power is above its device's limit and will be cut to it.

## Safety

- **Caps and limits:**
  - Every power is cut to its device's power limit.
  - Motors with encoder targets must stay within their travel range.
  - Pedro Pathing's drive motors and dead wheels are never driven by mechanisms or actions.
- **When a run stops:** whenever any of these happens:
  - the robot hears nothing from the paired computer for more than 1 second
  - the paired computer disconnects
  - a motor goes more than 5% of its range past its travel (at least 20 ticks)
  - anything fails
- **What stopping does:** the program's motors and continuous servos go to zero power, servos stay where they are, the follower stops, and the OpMode ends.
- **Driver Station in charge:** only it can INIT and START Lumière Live, and its STOP always works. The app sends no gamepad input.
- **First runs:** for a new program, run it with the robot on a stand and low power limits first, with a hand near STOP.

## One computer at a time

The robot code is paired with the computer that deployed it with Live runs on.
- **Another computer:** deploying from another computer with Live runs on pairs that one instead.
- **Turning it off:** turning Live runs off and deploying removes Lumière Live, even when other outdated files are kept.
- **Re-pairing:** turning Live runs off and on again makes a new secret, so older deploys stop pairing.

## Competitions

**Before events, turn Live runs off and deploy.** Lumière Live can't run without the paired computer connected: START does nothing without it. Removing it keeps a laptop-only OpMode off the Driver Station.

## When something goes wrong

| The panel says | Meaning |
| --- | --- |
| "Lumière Live isn't installed on this robot yet" | Deploy with Live runs on, then build and install |
| "This robot's robot library predates Lumière Live" | Update the robot library version in TeamCode, then deploy and install |
| "This computer is not paired with Lumière Live on this robot" | Another computer deployed last. Deploy from this computer |
| "Not run. The paired computer is not connected" | START came while the app was disconnected. Keep Pathing → Robot connected, then INIT again |
| "Stopped. …silent for more than 1.0 s" | Wi-Fi dropped or the computer slept during the run |
| "Stopped. …left its travel" | The travel range is wrong, or the motor or its encoder is reversed |

## How it matches the deployed OpMode

The app sends the program with exactly the numbers the generated Java uses: the same poses, heading rules and rounding. Lumière Live builds the same Pedro Pathing paths and Ivy commands, and drives mechanisms the way the generated mechanism classes do.

**On the virtual hub, against the deployed OpMode:** a team robot's 23.6-second autonomous took the same time (within 0.3%). It drove the same route and set the same 16 mechanism outputs in the same order.

The messages are in the [stream protocol](protocol.md#lumière-live-programs).
