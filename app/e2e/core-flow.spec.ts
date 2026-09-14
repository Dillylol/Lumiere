import { BRAND } from "../src/brand";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

/** Neither the page nor any workspace panel scrolls sideways. */
async function expectNoHorizontalScroll(page: Page) {
  const overflowing = await page.evaluate(() => {
    const panels = [document.documentElement, ...document.querySelectorAll<HTMLElement>(".workbench-surface, .editor-scroll, .flow-canvas, .field-main, .simulation-field, .properties, .studio-home-main")];
    return panels.filter((panel) => panel.scrollWidth - panel.clientWidth > 1).map((panel) => panel.className || panel.tagName);
  });
  expect(overflowing).toEqual([]);
}

/** The field fits inside the visible workspace without scrolling. */
async function expectFieldVisible(page: Page) {
  const [field, surface] = await Promise.all([page.locator(".studio-field").first().boundingBox(), page.locator(".workbench-surface").boundingBox()]);
  expect(field && surface).toBeTruthy();
  expect(field!.y).toBeGreaterThanOrEqual(surface!.y - 1);
  expect(field!.y + field!.height).toBeLessThanOrEqual(surface!.y + surface!.height + 1);
  expect(field!.height).toBeGreaterThan(180);
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((done) => {
      const request = indexedDB.deleteDatabase("ftc-studio-projects");
      request.onsuccess = request.onerror = request.onblocked = () => done(undefined);
    });
  });
  await page.reload();
  await expect(page).toHaveTitle(`${BRAND.name} · ${BRAND.tagline}`);
});

test("creates, edits, previews, and reopens an autonomous project", async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  await expect(page.getByRole("heading", { name: "Your projects" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("home.png") });

  await page.getByRole("button", { name: /Square autonomous/ }).click();
  const name = page.getByLabel("Project name");
  await name.fill("Validation Robot");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Program flow" })).toBeVisible();
  await expect(page.locator(".flow-step")).toHaveCount(5);
  expect(await seriousViolations(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("program-flow.png"), fullPage: true });

  // Edit the routine: add a wait, change its duration, move it up, then undo the move.
  await page.getByLabel("Add action").first().selectOption("wait");
  await expect(page.locator(".flow-step")).toHaveCount(6);
  await page.getByLabel("Duration (ms)").fill("1500");
  await expect(page.locator(".flow-step.selected")).toContainText("1500 ms");
  await page.getByRole("button", { name: "Move action 6 up" }).click();
  await expect(page.locator(".flow-step").nth(4)).toContainText("1500 ms");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".flow-step").nth(5)).toContainText("1500 ms");

  // Edit a path.
  await page.getByRole("button", { name: "Paths", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Path editor" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Waypoint/ })).toHaveCount(4);
  await expectFieldVisible(page);
  await page.getByLabel("End X (in)").fill("96");
  await page.getByRole("combobox", { name: "Heading", exact: true }).selectOption("constant");
  await expect(page.getByRole("spinbutton", { name: "Heading (°)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add curve handle" }).click();
  await expect(page.getByRole("button", { name: /^Control point/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Add path" }).click();
  await expect(page.getByRole("button", { name: /^Waypoint/ })).toHaveCount(5);
  // Drag the new waypoint, then nudge it with the keyboard.
  const waypoint = page.getByRole("button", { name: "Waypoint 5" });
  const box = (await waypoint.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 - 50, { steps: 6 });
  await page.mouse.up();
  const endX = page.getByLabel("End X (in)");
  const endY = page.getByLabel("End Y (in)");
  const dragged = Number(await endX.inputValue());
  expect(dragged).toBeGreaterThan(80);
  expect(Number(await endY.inputValue())).toBeGreaterThan(80);
  await waypoint.focus();
  await page.keyboard.press("ArrowRight");
  await expect(endX).toHaveValue(String(dragged + 1));
  expect(await seriousViolations(page)).toEqual([]);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("path-editor.png"), fullPage: true });

  // Generated Java reflects the project.
  await page.getByRole("button", { name: "Code", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Java editor" })).toBeVisible();
  await expect(page.getByText("Generated · read only")).toBeVisible();
  const javaFiles = page.locator(".file-explorer button");
  await expect(javaFiles.filter({ hasText: "MainAuto.java" })).toBeVisible();
  await javaFiles.filter({ hasText: "MainAuto.java" }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 10_000 });
  // Monaco renders only the visible lines, so check the package line at the top.
  await expect(page.locator(".view-lines").first()).toContainText("package org.firstinspires.ftc.teamcode.generated.validationrobot;");
  await expect(page.locator(".java-mode-list")).toContainText("Main Auto");
  await page.screenshot({ path: testInfo.outputPath("java.png"), fullPage: true });

  // Preview plays and resets.
  await page.getByRole("button", { name: "Simulate", exact: true }).first().click();
  await expect(page.getByText("Preview · ideal path motion")).toBeVisible();
  await expectFieldVisible(page);
  await page.getByRole("button", { name: "Run preview" }).last().click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Pause" }).click();
  const timeline = page.getByLabel("Preview timeline");
  expect(Number(await timeline.inputValue())).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(timeline).toHaveValue("0");
  await page.screenshot({ path: testInfo.outputPath("simulate.png") });
  expect(await seriousViolations(page)).toEqual([]);

  // Command palette.
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Commands" })).toBeVisible();
  await page.getByLabel("Search commands").fill("learn");
  await page.getByRole("button", { name: "Open Learn" }).click();
  await expect(page.getByRole("heading", { name: "Learn" })).toBeVisible();

  // Export.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export project" }).click();
  expect((await download).suggestedFilename()).toBe(`Validation Robot.${BRAND.projectExtension}`);

  // Saved work survives a reload.
  // The save status is hidden in narrow windows, so read it without requiring visibility.
  await expect(page.locator(".breadcrumb small")).toHaveText("Saved", { timeout: 5_000 });
  await page.reload();
  // The address keeps the open project, so a reload reopens its workspace at Build.
  await expect(page.getByRole("heading", { name: "Program flow" })).toBeVisible();
  await expect(page.locator(".flow-step")).toHaveCount(7);
  await page.getByRole("button", { name: "Paths", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Waypoint/ })).toHaveCount(5);
  await page.getByLabel("Selected path").selectOption({ index: 1 });
  await expect(page.getByLabel("End X (in)")).toHaveValue("96");
  await page.getByRole("button", { name: "All projects" }).click();
  await expect(page.getByRole("heading", { name: "Your projects" })).toBeVisible();
  await expect(page.locator(".project-open").filter({ hasText: "Validation Robot" })).toContainText("1 program ·");

  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("builds a TeleOp with a mechanism binding", async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  await page.getByRole("button", { name: /Field-centric TeleOp/ }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Drive controls" })).toBeVisible();

  await page.getByRole("button", { name: "Robot", exact: true }).click();
  await page.getByRole("button", { name: "Add mechanism" }).click();
  await page.getByLabel("Mechanism name").fill("Claw");
  await page.getByRole("button", { name: "Add state" }).click();
  await expect(page.getByLabel("State name")).toHaveCount(2);
  // Connecting an FTC SDK project is a desktop feature; the browser explains the alternative.
  await expect(page.getByRole("heading", { name: "FTC SDK project" })).toBeVisible();
  await expect(page.getByText(/The desktop app can connect this project to your FtcRobotController folder/)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("robot.png") });

  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("button", { name: "Add binding" }).click();
  await page.getByLabel("Button 1").selectOption("right_bumper");
  await expect(page.locator(".problem")).toContainText(/slow mode/i);
  await page.getByLabel("Button 1").selectOption("x");
  await page.getByLabel("Binding behavior").selectOption("toggle");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("teleop.png") });
  expect(await seriousViolations(page)).toEqual([]);

  // Programs can be added, deleted after confirming, and restored with undo.
  await page.getByRole("button", { name: "Add program" }).click();
  await page.getByLabel("Program name").fill("Second Auto");
  await page.getByRole("dialog").getByRole("button", { name: "Add program", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Programs" }).getByRole("button")).toHaveCount(2);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete program" }).click();
  await expect(page.getByRole("navigation", { name: "Programs" }).getByRole("button")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("navigation", { name: "Programs" }).getByRole("button", { name: "Second Auto" })).toBeVisible();
  await page.getByRole("navigation", { name: "Programs" }).getByRole("button", { name: "Main TeleOp" }).click();

  await page.getByRole("button", { name: "Code", exact: true }).first().click();
  await page.locator(".file-explorer button").filter({ hasText: "MainTeleOp.java" }).click();
  await expect(page.locator(".view-lines").first()).toContainText("package org.firstinspires.ftc.teamcode.generated.fieldcentricteleop;", { timeout: 10_000 });
  await expect(page.locator(".java-mode-list")).toContainText("Main TeleOp");
  await expect(page.locator(".file-explorer button").filter({ hasText: "Claw.java" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("settings, help, and import keep the home screen usable", async ({ page }) => {
  const errors = watchErrors(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Back to projects" }).click();
  await page.getByRole("button", { name: "Help" }).click();
  await expect(page.getByRole("heading", { name: "Help and shortcuts" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Back to projects" }).click();
  await page.setViewportSize({ width: 2560, height: 1400 });
  const home = await page.locator(".studio-home-main").boundingBox();
  expect(home?.width).toBeGreaterThan(2200);
  await expectNoHorizontalScroll(page);

  const project = {
    format: "ftc-robot-project",
    version: 2,
    id: "imported_robot",
    name: "Imported Robot",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    robot: { widthInches: 18, lengthInches: 18, maxVelocity: 40, maxAcceleration: 60 },
    subsystems: [],
    programs: [],
  };
  await page.locator('input[type="file"]').setInputFiles({ name: `robot.${BRAND.projectExtension}`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByRole("heading", { name: "Program flow" })).toBeVisible();
  await page.getByRole("button", { name: "All projects" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: `broken.${BRAND.projectExtension}`, mimeType: "application/json", buffer: Buffer.from("{ not json") });
  await expect(page.locator(".studio-notice")).toBeVisible();
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});
