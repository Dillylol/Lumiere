import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

/**
 * Neither the page nor any workspace panel scrolls sideways, and the page itself doesn't scroll at all:
 * the workbench is one screen tall, and its panels scroll inside it.
 */
async function expectNoHorizontalScroll(page: Page) {
  const overflowing = await page.evaluate(() => {
    const panels = [document.documentElement, ...document.querySelectorAll<HTMLElement>(".workbench-surface, .editor-scroll, .flow-canvas, .properties")];
    const sideways = panels.filter((panel) => panel.scrollWidth - panel.clientWidth > 1).map((panel) => panel.className || panel.tagName);
    const page = document.documentElement.scrollHeight - document.documentElement.clientHeight > 1 ? ["the page scrolls down"] : [];
    return [...sideways, ...page];
  });
  expect(overflowing).toEqual([]);
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
});

test("a device's settings live in the hardware list, and actions set it directly within its power limit", async ({ page }) => {
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  const workspace = page.getByRole("navigation", { name: "Workspace" });

  // Before the robot is scanned, devices are added by name.
  await workspace.getByRole("button", { name: "Robot", exact: true }).click();
  await page.getByLabel("Add a device by name").fill("intake");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const limit = page.getByLabel("intake power limit");
  await limit.fill("0.6");
  await limit.blur();
  await expectNoHorizontalScroll(page);

  // Build sets the motor directly, and its power limit cuts what is asked for.
  await workspace.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("combobox", { name: "Add action" }).selectOption("device:motor");
  const steps = page.locator(".flow-steps").first();
  await expect(steps).toContainText("intake: power 0");
  const properties = page.locator("aside.properties");
  await expect(properties.getByRole("heading", { name: "Motor" })).toBeVisible();
  await properties.getByLabel("Power", { exact: true }).fill("0.9");
  await expect(properties.getByRole("note")).toHaveText("Runs at 0.6: intake's power limit.");
  await expect(steps).toContainText("intake: power 0.9");
  const problems = page.getByRole("button", { name: /^Problems/ });
  if ((await problems.getAttribute("aria-expanded")) !== "true") await problems.click();
  await expect(page.getByRole("button", { name: `info: Main Auto · action 3: This action gives "intake" power 0.9. Its power limit is 0.6, so it runs at 0.6.` })).toBeVisible();

  // A set time makes it one timed action: the motor stops after.
  await properties.getByRole("checkbox", { name: "For a set time" }).check();
  await properties.getByLabel("Duration (s)").fill("2");
  await expect(steps).toContainText("intake: power 0.9 for 2.0 s, then off");
  await expect(properties).toContainText("Then it stops (power 0).");
  expect(await seriousViolations(page)).toEqual([]);
  await expectNoHorizontalScroll(page);

  // The hardware list says what uses the device, and a device in use can't be removed. It all saves.
  await page.reload();
  await workspace.getByRole("button", { name: "Robot", exact: true }).click();
  const intake = page.getByRole("table", { name: "Robot hardware" }).getByRole("row").filter({ has: page.getByRole("rowheader", { name: "intake" }) });
  await expect(intake).toContainText("1 action");
  await expect(page.getByLabel("intake power limit")).toHaveValue("0.6");
  await expect(intake.getByRole("button", { name: "Remove intake" })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);

  // The light and high-contrast themes keep the hardware list and the action's settings readable.
  for (const theme of ["light", "contrast"]) {
    await page.evaluate((value) => localStorage.setItem("lumiere-theme", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await workspace.getByRole("button", { name: "Robot", exact: true }).click();
    await expect(page.getByLabel("intake power limit")).toHaveValue("0.6");
    expect(await seriousViolations(page), `${theme}: Robot`).toEqual([]);
    await workspace.getByRole("button", { name: "Build", exact: true }).click();
    await page.locator(".flow-steps").first().getByText("intake: power 0.9").click();
    await expect(properties.getByRole("heading", { name: "Motor" })).toBeVisible();
    expect(await seriousViolations(page), `${theme}: Build`).toEqual([]);
  }
});
