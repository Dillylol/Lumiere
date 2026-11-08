import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import sample from "../../fixtures/projects/sample-robot.json" with { type: "json" };

async function openPathing(page: Page) {
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Pathing", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Pathing Visualizer/ })).toBeVisible();
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

test("draws, mirrors, times and plays a program's paths", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: /Square autonomous/ }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await openPathing(page);
  await expect(page.getByText("Based on the Pedro Pathing Visualizer", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Waypoint/ })).toHaveCount(4);
  await expect(page.getByRole("region", { name: "Routine timeline" }).getByRole("button")).not.toHaveCount(0);

  // A drag is one undo step.
  await page.locator(".path-pick").nth(1).click();
  const endX = page.getByLabel("End X (in)");
  const before = await endX.inputValue();
  await drag(page, "Waypoint 2", 40, -40);
  await expect(endX).not.toHaveValue(before);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(endX).toHaveValue(before);

  // Mirroring changes the data, so the start pose moves to the other side.
  const startX = Number(await page.getByLabel("Start X (in)").inputValue());
  await page.getByRole("button", { name: "Mirror", exact: true }).click();
  await expect(page.getByLabel("Start X (in)")).toHaveValue(String(144 - startX));
  await page.getByRole("button", { name: "Mirrored copy" }).click();
  await expect(page.getByRole("navigation", { name: "Programs" }).getByRole("button", { name: /\(mirrored\)$/ })).toBeVisible();

  // Every heading rule is editable, including piecewise rules.
  await page.getByRole("combobox", { name: "Heading", exact: true }).selectOption("piecewise");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Rule 2", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".timeline-time")).not.toHaveText(/^0\.0 s/);
  expect(errors).toEqual([]);
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
  await page.getByRole("button", { name: "Export .pp" }).click();
  const exported = JSON.parse(await readFile(await (await pending).path(), "utf8"));
  exported.lines[0].name = "Renamed in a .pp";
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.accept(); });
  await page.getByLabel("Open a Pedro Pathing .pp file").setInputFiles({
    name: "roundtrip.pp", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.locator(".path-pick").first()).toContainText("Renamed in a .pp");
  expect(dialogs[0]).toContain("including its mechanism steps");
  await page.screenshot({ path: info.outputPath("pathing.png") });
});
