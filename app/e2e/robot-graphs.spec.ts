import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

/** Sends a few follower poses a little over 100 ms apart, as a robot streams them. */
async function drive(page: Page, stream: WebSocketRoute, opMode: string, from: number, count: number) {
  for (let i = 0; i < count; i++) {
    stream.send(JSON.stringify({ type: "state", opMode, pose: { x: from + i * 3, y: 24, heading: 0 }, data: { shooterRpm: 3000 + i } }));
    await page.waitForTimeout(120);
  }
}

test("compares any autonomous with the open plan, and graphs the robot's data", async ({ page }) => {
  let stream: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/stream$/, (socket) => {
    stream = socket;
    socket.send(JSON.stringify({ type: "hello", protocol: 1, source: "robot", library: "test-hub" }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Square autonomous/ }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Pathing", exact: true }).click();
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Robot" }).click();
  await page.getByRole("button", { name: "Connect robot" }).click();
  await expect.poll(() => stream !== undefined).toBe(true);

  // One of the team's own autonomous OpModes, not this program's: it is compared with the plan anyway.
  stream!.send(JSON.stringify({ type: "manifest", devices: [], opModes: [{ name: "Team Auto", flavor: "autonomous" }, { name: "Team TeleOp", flavor: "teleop" }] }));
  stream!.send(JSON.stringify({ type: "lifecycle", opMode: "Team Auto", phase: "init" }));
  stream!.send(JSON.stringify({ type: "lifecycle", opMode: "Team Auto", phase: "running" }));
  await drive(page, stream!, "Team Auto", 24, 8);
  const telemetry = page.getByRole("complementary", { name: "Telemetry" });
  await expect(telemetry).toContainText("Comparing \"Team Auto\" with this program's plan, as if the robot started at its start pose. The ghost is the estimate.");
  await expect(page.getByRole("img", { name: /where the plan has the robot now/ })).toBeVisible();
  await expect(telemetry.getByLabel("Graph key")).toContainText("Plan: the estimate");
  await expect(telemetry.getByRole("img", { name: /^X:/ })).toHaveAccessibleName(/^X: 45\.0 in, plan \d/);
  await expect(telemetry.getByRole("img", { name: /^Off plan:/ })).toBeVisible();
  await expect(telemetry.getByRole("group", { name: "Values to graph" }).getByRole("button", { name: "shooterRpm" })).toBeVisible();

  // A TeleOp still streams its data, but is not compared with the plan.
  stream!.send(JSON.stringify({ type: "lifecycle", opMode: "Team Auto", phase: "stopped" }));
  stream!.send(JSON.stringify({ type: "lifecycle", opMode: "Team TeleOp", phase: "init" }));
  stream!.send(JSON.stringify({ type: "lifecycle", opMode: "Team TeleOp", phase: "running" }));
  await drive(page, stream!, "Team TeleOp", 60, 4);
  await expect(telemetry).not.toContainText("Comparing");
  await expect(page.getByRole("img", { name: /where the plan has the robot now/ })).toHaveCount(0);
  await expect(telemetry.getByRole("img", { name: /^X:/ })).toHaveAccessibleName("X: 69.0 in");
});
