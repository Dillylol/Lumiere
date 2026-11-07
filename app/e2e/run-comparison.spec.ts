import { expect, test, type WebSocketRoute } from "@playwright/test";

test("compares reported routine time with the latest matching simulator result", async ({ page }) => {
  let stream: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/stream$/, socket => {
    stream = socket;
    socket.send(JSON.stringify({ type: "hello", protocol: 1, source: "robot", library: "test-hub" }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("heading", { name: "Program flow" }).waitFor();
  await page.evaluate(() => {
    const projectId = location.hash.split("/").at(-1);
    localStorage.setItem("lumiere-run-timings:" + projectId, JSON.stringify([{
      source: "simulator",
      opMode: "Main Auto",
      elapsedMs: 2400,
      metric: "routine",
      revision: "fixture-v1",
    }]));
  });

  await page.getByRole("button", { name: "Robot", exact: true }).click();
  await page.getByRole("button", { name: "Connect robot" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  const comparison = page.getByRole("region", { name: "Run comparison" });
  await expect(comparison).toContainText("2.4 s");
  await expect(comparison).toContainText("Awaiting run");

  const report = (revision: string, elapsedMs: number) => {
    for (const message of [
      { type: "lifecycle", phase: "init", opMode: "Main Auto" },
      { type: "lifecycle", phase: "running", opMode: "Main Auto" },
      { type: "state", opMode: "Main Auto", loopMs: 16, data: {
        "lumiere.routineElapsedMs": elapsedMs,
        "lumiere.routineRevision": revision,
      } },
      { type: "lifecycle", phase: "stopped", opMode: "Main Auto" },
    ]) stream?.send(JSON.stringify(message));
  };

  report("fixture-other", 4500);
  await expect(comparison).toContainText("different or unverified routine revisions");
  report("fixture-v1", 3000);
  await expect(comparison).toContainText("3.0 s");
  await expect(comparison).toContainText("Robot ran 0.6 s longer");

  await page.reload();
  await page.getByRole("button", { name: "Robot", exact: true }).click();
  await expect(comparison).toContainText("Robot ran 0.6 s longer");
});
