import { expect, test, type WebSocketRoute } from "@playwright/test";

test("reads the robot's configured hardware into the robot profile", async ({ page }) => {
  let stream: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/stream$/, socket => {
    stream = socket;
    socket.send(JSON.stringify({ type: "hello", protocol: 1, source: "robot", library: "test-hub" }));
    // A hub that is still starting reports no devices; that must not replace a real scan.
    socket.send(JSON.stringify({ type: "manifest", devices: [], opModes: [] }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  const workspace = page.getByRole("navigation", { name: "Workspace" });

  await workspace.getByRole("button", { name: "Robot", exact: true }).click();
  const profile = page.getByRole("region", { name: "Robot profile" });
  await expect(profile.getByRole("status")).toHaveText("Not linked to Pedro constants");
  await expect(profile).toContainText("Connect to the robot from Simulate → Robot");
  await expect(profile.getByLabel("Forward speed (in/s)")).toHaveValue("60");

  await workspace.getByRole("button", { name: "Simulate", exact: true }).click();
  await page.getByRole("group", { name: "Run on" }).getByRole("button", { name: "Robot" }).click();
  await page.getByRole("button", { name: "Connect robot" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  stream!.send(JSON.stringify({ type: "manifest", opModes: [], devices: [
    { name: "left_front_drive", type: "motor" },
    { name: "pinpoint", type: "pinpoint" },
    { name: "claw", type: "servo" },
  ] }));

  await workspace.getByRole("button", { name: "Robot", exact: true }).click();
  await expect(profile.getByRole("row", { name: /^claw Servo —$/ })).toBeVisible();
  await expect(profile.getByRole("row", { name: /^left_front_drive Motor —$/ })).toBeVisible();
  await expect(profile).toContainText("Read from the robot's configuration");

  // The scan is saved with the project.
  await page.reload();
  await workspace.getByRole("button", { name: "Robot", exact: true }).click();
  await expect(profile.getByRole("row", { name: /^pinpoint goBILDA Pinpoint —$/ })).toBeVisible();
});
