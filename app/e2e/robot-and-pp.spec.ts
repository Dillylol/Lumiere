import { expect, test, type WebSocketRoute } from "@playwright/test";

test("follows the robot stream and reconnects without a second client", async ({ page }) => {
  const connections: WebSocketRoute[] = [];
  const commands: { type: string }[] = [];
  await page.routeWebSocket(/\/stream$/, socket => {
    connections.push(socket);
    socket.onMessage(message => commands.push(JSON.parse(String(message))));
    socket.send(JSON.stringify({ type: "hello", protocol: 1, source: "robot", library: "test-hub" }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  // The live robot view is Pathing's Robot mode, and the Simulate tab is gone.
  const workspace = page.getByRole("navigation", { name: "Workspace" });
  await expect(workspace.getByRole("button", { name: "Simulate" })).toHaveCount(0);
  await workspace.getByRole("button", { name: "Pathing", exact: true }).click();
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Robot" }).click();
  const robot = page.locator(".pathing");
  await robot.getByRole("button", { name: "Connect robot" }).click();
  await expect(robot.getByText("Connected", { exact: true })).toBeVisible();

  const stream = connections[0];
  for (const message of [
    { type: "lifecycle", opMode: "Example Auto", phase: "init" },
    { type: "lifecycle", opMode: "Example Auto", phase: "running" },
    { type: "path", points: [[24, 24], [36, 32]] },
    {
      type: "state", opMode: "Example Auto", loopMs: 12.4, follower: "follow",
      pose: { x: 24, y: 24, heading: 0 }, target: { x: 36, y: 32, heading: 0 },
      data: { encoder: [1, 2, 3] },
    },
  ]) stream.send(JSON.stringify(message));

  await expect(robot.getByText("Example Auto · RUNNING")).toBeVisible();
  await expect(robot.getByText(/^RUNNING · (?!0\.0 s)\d+\.\d s$/)).toBeVisible();
  await expect(robot.getByText("12.4 ms")).toBeVisible();
  await expect(robot.getByText("Following a path")).toBeVisible();
  await expect(robot.getByText("[1,2,3]")).toBeVisible();
  await expect(robot.getByRole("img", { name: /path the robot is following and the follower's target pose/ })).toBeVisible();
  await expect(robot.getByRole("combobox", { name: "OpMode" })).toHaveCount(0);
  await expect(robot.getByRole("button", { name: "START", exact: true })).toHaveCount(0);
  await robot.getByRole("button", { name: "STOP" }).click();
  await expect.poll(() => commands.filter(command => command.type !== "ping")).toEqual([{ type: "stop" }]);

  await stream.close({ code: 1011 });
  await expect(robot.getByText("Reconnecting…")).toBeVisible();
  await expect(robot.getByRole("button", { name: "Connect robot" })).toHaveCount(0);
  await expect(robot.getByText("Example Auto · RUNNING")).toHaveCount(0);
  await expect(robot.getByText("Connected", { exact: true })).toBeVisible();
  expect(connections).toHaveLength(2);
  await robot.getByRole("button", { name: "Disconnect" }).click();
  await expect(robot.getByText("Disconnected", { exact: true })).toBeVisible();
  await expect(robot.getByText("robot · library test-hub")).toHaveCount(0);
});

test("reports .pp conversion and ignored settings when opening a project", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "Robot path.PP",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      version: "2.0.0",
      startPoint: { x: 24, y: 24, headingDeg: 0 },
      robot: { rLength: 19, rWidth: 16 },
      lines: [{
        id: "curve",
        endPoint: { x: 72, y: 24 },
        throughPoints: [{ x: 48, y: 48 }],
      }],
    })),
  });
  await expect(page.getByRole("heading", { name: "Program flow" })).toBeVisible();
  const notice = page.getByRole("alert");
  await expect(notice).toContainText("19 × 16 in");
  await expect(notice).toContainText("converted to Bezier control points");
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
  await page.getByRole("button", { name: "Pathing", exact: true }).click();
  await expect(page.getByRole("button", { name: "Control point 1 of path 1" })).toBeVisible();
});
