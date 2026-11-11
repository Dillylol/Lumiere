import { expect, test, type WebSocketRoute } from "@playwright/test";

test("pairs this computer with Lumière Live, sends the open program, and shows what the robot found", async ({ page }) => {
  let stream: WebSocketRoute | undefined;
  const received: { type: string; [key: string]: unknown }[] = [];
  await page.routeWebSocket(/\/stream$/, (socket) => {
    stream = socket;
    socket.onMessage((data) => {
      const message = JSON.parse(String(data));
      if (message.type !== "ping") received.push(message);
    });
    socket.send(JSON.stringify({ type: "hello", protocol: 1, source: "robot", library: "test-hub", capabilities: { live: 2 } }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Square autonomous/ }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  const workspace = page.getByRole("navigation", { name: "Workspace" });

  // Live runs are turned on for this computer on the Robot page.
  await workspace.getByRole("button", { name: "Robot", exact: true }).click();
  const live = page.getByRole("region", { name: "Lumière Live" });
  await expect(live).toContainText("Off.");
  await live.getByLabel("Live runs from this computer").check();
  await expect(live).toContainText("Only this computer is paired.");
  // Power limits are each device's, in the hardware list; Lumière Live has no limit of its own.
  await expect(live).toContainText("Set power limits for first tests");
  await expect(live.getByLabel("Mechanism power limit")).toHaveCount(0);

  await workspace.getByRole("button", { name: "Pathing", exact: true }).click();
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Robot" }).click();
  const controls = page.getByRole("complementary", { name: "Robot controls" });
  await expect(controls).toContainText("On the Driver Station, choose Lumière Live and press INIT.");
  await page.getByRole("button", { name: "Connect robot" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  expect(received).toEqual([]);

  // The robot says whether Lumière Live is installed.
  stream!.send(JSON.stringify({ type: "manifest", devices: [], opModes: [{ name: "Example Auto", flavor: "autonomous" }] }));
  await expect(controls).toContainText("Lumière Live isn't installed on this robot yet.");
  stream!.send(JSON.stringify({ type: "manifest", devices: [], opModes: [{ name: "Lumière Live", group: "Lumière", flavor: "autonomous" }] }));
  await expect(controls).toContainText("On the Driver Station, choose Lumière Live and press INIT.");
  await expect(controls).toContainText("Before competitions, turn Live runs off and deploy");

  // The Driver Station initializes Lumière Live: the app pairs, then sends the program once paired.
  const report = (fields: object) => JSON.stringify({ type: "live", opMode: "Lumière Live", state: "waiting", started: false, paired: false,
    dryRun: false, powerCap: 0.6, silenceMs: 1000, program: null, problems: [], notes: [], ...fields });
  stream!.send(JSON.stringify({ type: "lifecycle", opMode: "Lumière Live", phase: "init" }));
  stream!.send(report({}));
  await expect.poll(() => received.map((message) => message.type)).toEqual(["auth"]);
  expect(received[0].token).toMatch(/^[0-9a-f]{64}$/);
  stream!.send(report({ paired: true }));
  await expect.poll(() => received.map((message) => message.type)).toEqual(["auth", "program"]);
  const program = received[1].program as { format: number; name: string; revision: string; paths: unknown[] };
  expect(program.format).toBe(2);
  expect(program.paths.length).toBeGreaterThan(0);

  const summary = { name: program.name, revision: program.revision, steps: 4, paths: program.paths.length, mechanisms: 1 };
  stream!.send(report({ paired: true, state: "rejected", program: summary, problems: ["\"lift\" in Lift is not in the robot's configuration."] }));
  await expect(controls).toContainText(`"${program.name}" can't run on this robot: 1 problem.`);
  await expect(controls).toContainText("\"lift\" in Lift is not in the robot's configuration.");

  stream!.send(report({ paired: true, state: "accepted", program: summary, notes: ["\"lift\" in Lift is given power 1 in \"Up\"; its power limit cuts that to 0.6."] }));
  await expect(controls).toContainText(`"${program.name}" passed`);
  await expect(controls).toContainText("Press START on the Driver Station to run it.");
  await expect(controls).toContainText("its power limit cuts that to 0.6.");
  await expect(controls).not.toContainText("Mechanism power limit");

  // START on the Driver Station: the run is this program's, so it is drawn against the plan.
  stream!.send(report({ paired: true, state: "accepted", started: true, program: summary, run: { phase: "running", reason: null } }));
  stream!.send(JSON.stringify({ type: "lifecycle", opMode: "Lumière Live", phase: "running" }));
  for (const dx of [0, 6, 12, 18]) stream!.send(JSON.stringify({ type: "state", opMode: "Lumière Live", pose: { x: 24 + dx, y: 26, heading: 0 } }));
  await expect(controls).toContainText(`Running "${program.name}" from this computer. Keep this window open`);
  await expect(page.getByRole("img", { name: /the robot's position, where it has driven .*where the plan has the robot now/ })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Telemetry" }).getByLabel("Robot pose")).toContainText("Off plan2.0in");
  stream!.send(report({ paired: true, state: "accepted", started: true, program: summary,
    run: { phase: "stopped", reason: "Lumière Live stopped: the paired computer was silent for more than 1.0 s." } }));
  await expect(controls.getByRole("alert")).toHaveText("Stopped. Lumière Live stopped: the paired computer was silent for more than 1.0 s.");

  // The robot ends the OpMode straight away; why the run stopped, and the run itself, stay until the next INIT.
  stream!.send(report({ paired: false, state: "closed", started: true, program: summary,
    run: { phase: "stopped", reason: "Lumière Live stopped: the paired computer was silent for more than 1.0 s." } }));
  stream!.send(JSON.stringify({ type: "lifecycle", opMode: "Lumière Live", phase: "stopped" }));
  await expect(controls).toContainText("Ended");
  await expect(controls.getByRole("alert")).toHaveText("Stopped. Lumière Live stopped: the paired computer was silent for more than 1.0 s.");
  await expect(page.getByRole("img", { name: /where the plan has the robot now/ })).toBeVisible();
  stream!.send(JSON.stringify({ type: "lifecycle", opMode: "Example Auto", phase: "init" }));
  await expect(controls.getByRole("alert")).toHaveCount(0);
  await expect(controls).toContainText("On the Driver Station, choose Lumière Live and press INIT.");
});
