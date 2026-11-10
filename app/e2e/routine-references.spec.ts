import { expect, test, type Page } from "@playwright/test";

/** Opens Problems once it lists `count` problems; it may already have opened itself. */
async function openProblems(page: Page, count: number) {
  const tab = page.getByRole("button", { name: `Problems ${count}` });
  await expect(tab).toBeVisible();
  if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
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

test("mechanism actions never break saving, and Problems say what to choose and where", async ({ page }) => {
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Program flow" })).toBeVisible();

  // Without a mechanism that has states, mechanism actions can't be added.
  const add = page.getByRole("combobox", { name: "Add action" });
  const stateOption = add.locator('option[value="state"]');
  await expect(stateOption).toBeDisabled();
  await expect(stateOption).toHaveText("Set mechanism state (add a mechanism with states on the Robot page)");

  // A new mechanism starts with a state, so the action can be added and starts on it.
  await page.getByRole("button", { name: "Robot", exact: true }).click();
  await page.getByRole("button", { name: "Add mechanism" }).click();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await expect(stateOption).toBeEnabled();
  await add.selectOption("state");
  const steps = page.locator(".flow-steps").first();
  await expect(steps).toContainText("Mechanism 1: Safe");

  // Clearing the mechanism leaves an action to finish, not a project that can't be saved.
  await page.locator("aside.properties select").first().selectOption("");
  await expect(steps).toContainText("Choose a mechanism");
  await openProblems(page, 1);
  const problem = page.getByRole("button", { name: "error: Main Auto · action 3: Choose a mechanism and a state for this action." });
  await expect(problem).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  // Small windows hide the breadcrumb, so its text is read rather than seen.
  await expect(page.locator(".breadcrumb small")).toHaveText("Saved", { timeout: 5_000 });

  // It was saved: it is still there after a reload, and its problem selects it.
  await page.reload();
  await expect(page.locator(".flow-steps").first()).toContainText("Choose a mechanism");
  await openProblems(page, 1);
  await page.getByRole("button", { name: /Main Auto · action 3: Choose a mechanism/ }).click();
  await expect(page.locator("aside.properties h3")).toHaveText("Mechanism state");
});
