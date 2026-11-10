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
  await expect(profile).toContainText("Connect to the robot from Pathing → Robot");
  await expect(profile.getByLabel("Forward speed (in/s)")).toHaveValue("60");

  await workspace.getByRole("button", { name: "Pathing", exact: true }).click();
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Robot" }).click();
  await page.getByRole("button", { name: "Connect robot" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  stream!.send(JSON.stringify({ type: "manifest", opModes: [], devices: [
    { name: "left_front_drive", type: "motor" },
    { name: "pinpoint", type: "pinpoint" },
    { name: "claw", type: "servo" },
    { name: "ranger", type: "analog" },
    { name: "vl53l1x", type: "vl53l1x" },
  ], pedro: { constants: "org.firstinspires.ftc.teamcode.pedro.Constants", localizer: "pinpoint", devices: [
    { name: "left_front_drive", role: "frontLeft" },
    { name: "pinpoint", role: "pinpoint" },
  ] } }));

  await workspace.getByRole("button", { name: "Robot", exact: true }).click();
  await expect(profile.getByRole("row", { name: /^claw Servo —$/ })).toBeVisible();
  // The robot names the devices Pedro Pathing drives; sensors are listed but not used.
  await expect(profile.getByRole("row", { name: /^left_front_drive Motor Front left drive motor$/ })).toBeVisible();
  await expect(profile.getByRole("row", { name: /^ranger Analog input Listed only$/ })).toBeVisible();
  await expect(profile.getByRole("row", { name: /^vl53l1x vl53l1x \(custom driver\) Listed only$/ })).toBeVisible();
  await expect(profile.getByRole("table", { name: "Localizer devices" }).getByRole("row", { name: /^Pinpoint localizer \(reported by the robot\) pinpoint — — Configured$/ })).toBeVisible();
  await expect(profile).toContainText("It last changed");
  await expect(profile).toContainText("reads Pedro Pathing's devices from pedro.Constants");

  // The scan is saved with the project.
  await page.reload();
  await workspace.getByRole("button", { name: "Robot", exact: true }).click();
  await expect(profile.getByRole("row", { name: /^pinpoint goBILDA Pinpoint Pinpoint localizer$/ })).toBeVisible();
});
