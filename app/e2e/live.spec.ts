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
    socket.send(JSON.stringify({ type: "hello", protocol: 1, source: "robot", library: "test-hub" }));
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
  await expect(live.getByLabel("Mechanism power limit")).toHaveValue("0.6");

  await workspace.getByRole("button", { name: "Pathing", exact: true }).click();
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Robot" }).click();
  const controls = page.getByRole("complementary", { name: "Robot controls" });
  await expect(controls).toContainText("On the Driver Station, choose Lumière Live and press INIT.");
  await page.getByRole("button", { name: "Connect robot" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  expect(received).toEqual([]);

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
  expect(program.format).toBe(1);
  expect(program.paths.length).toBeGreaterThan(0);

  const summary = { name: program.name, revision: program.revision, steps: 4, paths: program.paths.length, mechanisms: 1 };
  stream!.send(report({ paired: true, state: "rejected", program: summary, problems: ["\"lift\" in Lift is not in the robot's configuration."] }));
  await expect(controls).toContainText(`"${program.name}" can't run on this robot: 1 problem.`);
  await expect(controls).toContainText("\"lift\" in Lift is not in the robot's configuration.");

  stream!.send(report({ paired: true, state: "accepted", program: summary, notes: ["\"lift\" in Lift runs at power 1; Lumière Live limits mechanisms to 0.6."] }));
  await expect(controls).toContainText(`"${program.name}" passed`);
  await expect(controls).toContainText("Press START on the Driver Station to run it.");
  await expect(controls).toContainText("Lumière Live limits mechanisms to 0.6.");
  await expect(controls).toContainText("Mechanism power limit 0.6");

  // START on the Driver Station: the run, then a stop the robot explains.
  stream!.send(report({ paired: true, state: "accepted", started: true, program: summary, run: { phase: "running", reason: null } }));
  await expect(controls).toContainText(`Running "${program.name}" from this computer. Keep this window open`);
  stream!.send(report({ paired: true, state: "accepted", started: true, program: summary,
    run: { phase: "stopped", reason: "Lumière Live stopped: the paired computer was silent for more than 1.0 s." } }));
  await expect(controls.getByRole("alert")).toHaveText("Stopped. Lumière Live stopped: the paired computer was silent for more than 1.0 s.");
});
