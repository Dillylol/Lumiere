import { readFile } from "node:fs/promises";
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import sample from "../../fixtures/projects/sample-robot.json" with { type: "json" };

async function openPathing(page: Page) {
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Pathing", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Pathing Visualizer/ })).toBeVisible();
}

async function newSquareProject(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Square autonomous/ }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await openPathing(page);
}

async function drag(page: Page, name: string, dx: number, dy: number) {
  const handle = page.getByRole("button", { name, exact: true });
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}

const pathRow = (page: Page, name: string) => page.getByRole("tree", { name: "Paths" }).getByRole("button", { name, exact: true });
const spin = (page: Page, name: string) => page.getByRole("spinbutton", { name, exact: true });

async function fileMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("draws, mirrors, times and plays a program's paths", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await newSquareProject(page);
  await expect(page.getByText("Based on the Pedro Pathing Visualizer", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Waypoint/ })).toHaveCount(4);
  // The playback track marks where each path ends.
  await expect(page.getByRole("button", { name: /^Jump to the end of/ })).toHaveCount(4);

  // A drag is one undo step.
  await pathRow(page, "Path 2").click();
  const endX = spin(page, "End X");
  const before = await endX.inputValue();
  await drag(page, "Waypoint 2", 40, -40);
  await expect(endX).not.toHaveValue(before);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(endX).toHaveValue(before);

  // Mirroring changes the data, so the start pose moves across the middle of the floor (x = 70.75).
  await page.getByRole("button", { name: "Start, field and robot" }).click();
  const startX = Number(await spin(page, "Start X").inputValue());
  await fileMenu(page, "Mirror to the other alliance");
  await expect(spin(page, "Start X")).toHaveValue(String(141.5 - startX));
  await fileMenu(page, "Mirrored copy as a new program");
  await expect(page.getByRole("navigation", { name: "Programs" }).getByRole("button", { name: /\(mirrored\)$/ })).toBeVisible();

  // Every heading rule is editable, including piecewise rules.
  await pathRow(page, "Path 1").click();
  await page.getByRole("group", { name: "Heading type" }).getByRole("button", { name: "Piecewise" }).click();
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Rule 2", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Play (Space)" }).click();
  await expect(page.locator(".pv-time")).not.toHaveText(/^0\.0s/);
  expect(errors).toEqual([]);
});

test("offers the Visualizer's grid, measuring tools, pen and panels", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await newSquareProject(page);
  const view = page.getByRole("toolbar", { name: "Field view" });

  // The grid steps through its sizes and shows its lines; snapping appears while it is on.
  await view.getByRole("button", { name: "Grid (G)" }).click();
  await expect(view.getByRole("button", { name: /^Grid: 1 in/ })).toHaveAttribute("aria-pressed", "true");
  await expect(view.getByRole("button", { name: "Snapping to the grid" })).toBeVisible();
  await expect(page.locator(".pv-grid line")).not.toHaveCount(0);
  await view.getByRole("button", { name: /^Grid: 1 in/ }).click();
  await expect(view.getByRole("button", { name: /^Grid: 3 in/ })).toBeVisible();

  await view.getByRole("button", { name: "Ruler (R)" }).click();
  await expect(page.getByRole("button", { name: "Ruler end 2" })).toBeVisible();
  await view.getByRole("button", { name: "Protractor" }).click();
  await expect(page.getByRole("button", { name: "Protractor arm" })).toBeVisible();

  // A pen stroke becomes one more path, continuing from the last one.
  await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Pen: draw a path (P)" }).click();
  const scene = page.locator(".pv-scene");
  await scene.scrollIntoViewIfNeeded();
  const box = (await scene.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.25);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(box.x + box.width * (0.55 + i * 0.025), box.y + box.height * (0.25 + Math.sin(i / 4) * 0.08));
  await page.mouse.up();
  await expect(page.getByRole("button", { name: /^Waypoint/ })).toHaveCount(5);
  await expect(pathRow(page, "Path 5")).toBeVisible();

  // Both side panels hide and come back.
  await page.getByRole("button", { name: "Hide layers" }).click();
  await page.getByRole("button", { name: "Hide inspector" }).click();
  await expect(page.getByRole("tree", { name: "Paths" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show layers" }).click();
  await page.getByRole("button", { name: "Show inspector" }).click();
  await expect(page.getByRole("tree", { name: "Paths" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("draws a robot's run against the plan in Robot mode", async ({ page }) => {
  let stream: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/stream$/, (socket) => {
    stream = socket;
    socket.send(JSON.stringify({ type: "hello", protocol: 1, source: "robot", library: "test-hub" }));
  });
  await newSquareProject(page);
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Robot" }).click();
  await expect(page.getByRole("region", { name: "Field" }).getByRole("button", { name: /^Waypoint/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Connect robot" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Robot (connected)" })).toBeVisible();

  // The robot runs this program's OpMode two inches off the first path.
  for (const message of [
    { type: "lifecycle", opMode: "Main Auto", phase: "init" },
    { type: "lifecycle", opMode: "Main Auto", phase: "running" },
    ...[0, 6, 12, 18].map((dx) => ({ type: "state", opMode: "Main Auto", pose: { x: 24 + dx, y: 26, heading: 0 } })),
  ]) stream!.send(JSON.stringify(message));
  await expect(page.getByRole("img", { name: /the robot's position, where it has driven .*where the plan has the robot now/ })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Telemetry" }).getByLabel("Robot pose")).toContainText("Off plan2.0in");
  await expect(page.locator(".pv-step[aria-current=step]")).toHaveCount(1);

  // Develop keeps the connection while the paths are edited.
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Develop" }).click();
  await expect(page.getByRole("button", { name: /^Waypoint/ })).toHaveCount(4);
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Robot (connected)" }).click();
  await expect(page.getByText("Main Auto · RUNNING")).toBeVisible();
});

test("opens a TeleOp in Simulate, which the desktop app runs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Field-centric TeleOp/ }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Pathing", exact: true }).click();
  const modes = page.getByRole("group", { name: "Mode" });
  await expect(modes.getByRole("button", { name: "Develop" })).toBeDisabled();
  await expect(modes.getByRole("button", { name: "Simulate" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("TeleOp runs in the desktop app's simulator", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "File", exact: true })).toHaveCount(0);
});

test("keeps mechanism steps through path edits and asks before a .pp replaces them", async ({ page }, info) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "Sample.lum", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(sample)),
  });
  await expect(page.getByRole("heading", { name: "Program flow" })).toBeVisible();
  const mechanismSteps = await page.locator(".flow-step").count();
  await openPathing(page);
  await drag(page, "Waypoint 1", 30, 20);
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Build", exact: true }).click();
  await expect(page.locator(".flow-step")).toHaveCount(mechanismSteps);

  await openPathing(page);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: "Pedro Pathing file (.pp)" }).click();
  const exported = JSON.parse(await readFile(await (await pending).path(), "utf8"));
  exported.lines[0].name = "Renamed in a .pp";
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.accept(); });
  await page.getByLabel("Open a Pedro Pathing .pp file").setInputFiles({
    name: "roundtrip.pp", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.getByRole("tree", { name: "Paths" }).getByRole("treeitem").first()).toContainText("Renamed in a .pp");
  expect(dialogs[0]).toContain("including its mechanism steps");
  await page.screenshot({ path: info.outputPath("pathing.png") });
});
