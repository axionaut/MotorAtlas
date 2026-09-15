import { test, expect } from "@playwright/test";

test("Pages app imports, preserves evidence, compares and survives reload without a backend", async ({ page }) => {
  const unexpected: string[] = [];
  page.on("pageerror", (error) => unexpected.push(error.message));
  page.on("request", (request) => {
    if (/chatgpt|cloudflare|\/api\/(catalog|overview|observations|compare)/.test(request.url())) unexpected.push(request.url());
  });
  await page.route("https://vpic.nhtsa.dot.gov/**", (route) => route.fulfill({ json: { Results: [
    { Make_ID: 448, Make_Name: "Toyota", Model_ID: 2208, Model_Name: "Corolla" },
    { Make_ID: 448, Make_Name: "Toyota", Model_ID: 2209, Model_Name: "Camry" },
  ] } }));
  await page.goto(process.env.MOTORATLAS_TEST_URL || "http://127.0.0.1:4173/MotorAtlas/");
  await expect(page.getByRole("heading", { name: "MotorAtlas", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Ingestion", exact: true }).click();
  await page.getByRole("button", { name: "Run ingestion", exact: true }).click();
  await expect(page.getByText("2026 Toyota Corolla · US", { exact: true })).toBeVisible();
  await page.getByText("2026 Toyota Corolla · US", { exact: true }).click();
  await page.getByLabel("Attribute", { exact: true }).fill("power_kw");
  await page.getByLabel("Value", { exact: true }).fill("100");
  await page.getByLabel("Unit", { exact: true }).fill("kW");
  await page.getByRole("button", { name: "Preserve observation" }).click();
  await expect(page.getByText("100 kW", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).first().click();
  await page.reload();
  await page.getByRole("checkbox", { name: "Compare 2026 Toyota Corolla · US" }).check();
  await page.getByRole("checkbox", { name: "Compare 2026 Toyota Camry · US" }).check();
  await page.getByRole("tab", { name: /Compare/ }).click();
  await expect(page.getByText("100 kW", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  expect((await download).suggestedFilename()).toMatch(/^motoratlas-.*\.json$/);
  expect(unexpected).toEqual([]);
});
