import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function savePath(page: Page, filename: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save .pp", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(filename);
  return JSON.parse(await readFile(await download.path(), "utf8"));
}

test("exchanges .pp files and applies Visualizer drafts to testing", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await page.getByRole("button", { name: /Square autonomous/ }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  const workspace = page.getByRole("navigation", { name: "Workspace" });
  const openVisualizer = async () => {
    await workspace.getByRole("button", { name: "Paths", exact: true }).click();
    await page.getByRole("button", { name: "Visualizer", exact: true }).click();
  };
  const apply = page.getByRole("button", { name: "Apply & test", exact: true });
  await openVisualizer();
  const editor = page.frameLocator('iframe[title="Pedro Pathing Visualizer"]');
  await expect(editor.getByText("Pedro Pathing Visualizer", { exact: true }).first()).toBeVisible();
  await expect(editor.getByAltText("Field")).toHaveJSProperty("complete", true);
  expect(await editor.getByAltText("Field").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

  // The Visualizer opens on the selected program.
  await expect(page.getByRole("status")).toHaveText(/Opened Main Auto\.pp/);
  await expect(apply).toBeEnabled();
  const program = await savePath(page, "Main Auto.pp");
  expect(program.version).toBe("2.0.0");
  expect(program.lines).toHaveLength(4);

  program.lines[0].name = "Visualized path";
  await page.getByLabel("Open a Pedro Pathing .pp file").setInputFiles({
    name: "roundtrip.pp", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(program)),
  });
  await expect(page.getByRole("status")).toHaveText("Opened roundtrip.pp");
  await expect(editor.getByText("Visualized path", { exact: true }).first()).toBeVisible();
  await workspace.getByRole("button", { name: "Build", exact: true }).click();
  await openVisualizer();
  expect((await savePath(page, "roundtrip.pp")).lines[0].name).toBe("Visualized path");
  await page.screenshot({ path: info.outputPath("pedro-visualizer.png") });

  await apply.click();
  await expect(page.locator(".simulation").getByRole("button", { name: "Run preview", exact: true })).toBeVisible();
  await openVisualizer();
  await expect(apply).toBeEnabled();
  await workspace.getByRole("button", { name: "Build", exact: true }).click();
  await expect(page.locator(".flow-canvas").getByText("Visualized path", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".flow-canvas").getByText("Path 1", { exact: true })).toBeVisible();
  // The applied draft has no changes of its own, so the Visualizer follows the program back.
  await openVisualizer();
  await expect(page.getByRole("status")).toHaveText(/Opened Main Auto\.pp/);
  await expect(editor.getByText("Path 1", { exact: true }).first()).toBeVisible();
  await expect(apply).toBeEnabled();
  await workspace.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByLabel("Add action", { exact: true }).selectOption("together");
  await openVisualizer();
  await page.getByRole("button", { name: "Load selected program" }).click();
  await apply.click();
  await expect(page.getByRole("status")).toContainText("This program includes mechanisms or parallel actions.");
  await workspace.getByRole("button", { name: "Build", exact: true }).click();
  // The step's own button; "Together" is also an option in each "Add action" menu.
  await expect(page.locator(".flow-canvas").getByRole("button", { name: /Together\s+Run child actions/ })).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(errors).toEqual([]);
});
