/**
 * What each part of the workspace is for and how to use it. The "i" buttons beside each tab's heading
 * and Pathing's modes show one topic; the Learn page shows them all. A guided tour can reuse them.
 */
import { BRAND, repositoryUrl } from "../brand";

export type HelpTopicId = "build" | "pathing" | "develop" | "simulate" | "robotMode" | "code" | "robot" | "learn";

export interface HelpTopic {
  title: string;
  /** What it is for, in a sentence or two. */
  summary: string;
  /** Its main functions. */
  functions: string[];
  /** How to use it, in order. */
  steps: string[];
  /** A guide in the repository's docs folder, by file name. */
  guide?: { label: string; file: string };
}

export const HELP: Record<HelpTopicId, HelpTopic> = {
  build: {
    title: "Build",
    summary: `Write a program's steps without code. An autonomous program is a routine of actions from INIT to STOP; a TeleOp is driving plus gamepad buttons. ${BRAND.name} turns both into Java.`,
    functions: [
      "Follow path drives one of the program's paths with Pedro Pathing.",
      "Wait pauses for a set time.",
      "Set mechanism state puts a mechanism, such as an intake or a lift, into one of its states.",
      "Together runs actions at once and ends when all have finished; Race ends as soon as the first one finishes.",
      "TeleOp programs set field-centric driving, slow mode, heading reset, and buttons that set mechanism states on a press, as a toggle, or while held.",
      "Code shows the Java the program becomes.",
    ],
    steps: [
      "Draw the program's paths in Pathing first.",
      "Choose + Add action, then select an action to edit it on the right. Drag or use the arrows to reorder.",
      "To use mechanisms, add them with their states on the Robot page.",
      "Problems, at the bottom, lists what still needs fixing. Click one to go to it.",
    ],
  },
  pathing: {
    title: "Pathing",
    summary: "Draw and time an autonomous program's paths, run the program in the simulator, and watch it on the robot. It is a rebuild of the Pedro Pathing Visualizer that edits your program directly.",
    functions: [
      "Develop draws and edits the paths, timed by your robot's speeds.",
      "Simulate runs the program before it touches the robot.",
      "Robot watches the real robot run, against the plan.",
      "File imports a Pedro Pathing .pp file and mirrors the program to the other alliance; Export saves a .pp file or copies the poses as Pedro code.",
    ],
    steps: [
      "Choose a mode at the top.",
      "Each mode has its own \"i\" button that explains it.",
    ],
    guide: { label: "Pathing guide", file: "pathing.md" },
  },
  develop: {
    title: "Develop mode",
    summary: "Draw and edit the program's paths on the field. The timeline plays the routine at the speeds, braking and turn rate from your robot profile.",
    functions: [
      "Drag the start pose, end points and curve handles. Each drag is one undo step.",
      "The tools on the left: select, pen (draw a path freehand), pick a coordinate, and add a path. On the right: grid with snap, ruler and protractor.",
      "The Inspector edits the selected path: its name, colors, points and heading rule (constant, linear, tangent, piecewise, or facing a point).",
      "Layers lists the paths, shows other programs faded under this one, and reads out the robot's pose, speed and planned mechanism states at the playhead.",
      "The playback bar plays the plan and warns when the routine runs past 30 seconds.",
    ],
    steps: [
      "Double-click the field, or use the add-path tool, to add a path that starts where the last one ends.",
      "Select a path to edit it in the Inspector.",
      "Press play to check the timing, then open Simulate to run the real program.",
    ],
    guide: { label: "Pathing guide", file: "pathing.md" },
  },
  simulate: {
    title: "Simulate mode",
    summary: "Run the program before it touches a robot. The desktop app builds your robot's Java and runs it in its simulator; the web app plays the estimate.",
    functions: [
      "Launch simulator builds your code with Gradle and starts the simulator, showing each stage as it goes.",
      "RUN, under the field, presses INIT and then START. INIT, START and STOP work one at a time too, and the match timer presses STOP.",
      "Drive TeleOp with a USB gamepad, the keyboard (WASD, Q and E to turn, J, K, U and I for buttons) or the on-screen buttons.",
      "The right panel shows the pose, each mechanism's state beside the plan's, the follower, Session data, and how the run's time compares.",
      "The field draws the run against the plan: a ghost where the plan has the robot, the robot's trail, and how far it is off the plan.",
    ],
    steps: [
      "On the desktop, connect your FTC SDK project on the Code tab first.",
      "Choose Launch simulator and wait for Ready. The first launch takes a few minutes.",
      "Press RUN, then watch the robot and its mechanisms. Change the program and launch again to compare.",
    ],
    guide: { label: "Simulator guide", file: "simulator.md" },
  },
  robotMode: {
    title: "Robot mode",
    summary: "Watch the real robot, or the virtual Control Hub, run against the plan.",
    functions: [
      "Connect robot reaches the Control Hub at its address; Find robot looks for it on robot Wi-Fi.",
      "The panel shows the OpMode the Driver Station is running and can request STOP. The app never starts OpModes on a real robot.",
      "Telemetry, the follower and Session data show what the robot reports; the run comparison sets its times beside the simulator's.",
      "Lumière Live runs this program on the robot from this computer, without rebuilding the robot code. Turn it on on the Robot page.",
      "On the desktop, Deploy code and Deploy APK are here too.",
    ],
    steps: [
      "Join robot Wi-Fi, then choose Connect robot (or Find robot).",
      "Start OpModes from the Driver Station and watch them here.",
    ],
    guide: { label: "Lumière Live guide", file: "live.md" },
  },
  code: {
    title: "Code",
    summary: `The Java ${BRAND.name} generates from your programs and mechanisms, and on the desktop, your linked FTC SDK project's TeamCode.`,
    functions: [
      "Generated files are locked: change the program instead. Eject a file to take it over and edit it by hand.",
      "Connect FTC SDK project links an existing robot project; Create FTC project makes a new one.",
      "Deploy code writes the generated files into TeamCode. Check compiles them, and Build APK builds the robot app.",
      "Paste AutoTune puts tuning results into Constants.java.",
    ],
    steps: [
      "Connect or create the FTC SDK project once.",
      "Deploy code after changing programs, then Check or Build APK.",
    ],
    guide: { label: "Connecting an FTC SDK project", file: "connect-ftc-sdk.md" },
  },
  robot: {
    title: "Robot setup",
    summary: "Describe the physical robot: its size and speeds, read from your Pedro Pathing constants, its configured hardware, and its mechanisms.",
    functions: [
      "Robot connection: the Control Hub's address, links to Panels and AutoTune, and Deploy APK on the desktop.",
      "Lumière Live pairs this computer with the robot code, so programs run from here without rebuilding.",
      "The robot profile reads the footprint, speeds and decelerations from Constants.java, and lists the hardware the robot reported. Pedro Pathing's own devices are marked.",
      "Mechanisms group devices into named states: a power, a servo position, or an encoder target with its travel range.",
    ],
    steps: [
      "Connect to the robot once (Pathing, Robot mode) so its configured hardware is listed here.",
      "Add mechanisms whose device names match the Robot Controller configuration, then give them states.",
      "Use those states in Build.",
    ],
    guide: { label: "Hardware checklist", file: "hardware-checklist.md" },
  },
  learn: {
    title: "Learn",
    summary: `How ${BRAND.name} fits together, with the guides and the Pedro Pathing and FTC documentation.`,
    functions: [
      "An overview of every tab and mode, the same text as each \"i\" button.",
      "Links to the guides, Pedro Pathing's documentation and the FTC documentation.",
    ],
    steps: ["Read the overview once, then use the \"i\" buttons when you need a reminder."],
  },
};

/** The order the Learn page presents the topics in. */
export const LEARN_ORDER: HelpTopicId[] = ["build", "pathing", "develop", "simulate", "robotMode", "code", "robot"];

/** A guide's address in the repository, or undefined when the build names no public repository. */
export function guideUrl(file: string): string | undefined {
  const base = repositoryUrl();
  return base ? `${base}/blob/main/docs/${file}` : undefined;
}
