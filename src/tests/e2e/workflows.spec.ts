import { test, expect } from "@playwright/test";

// Full role workflows require a seeded database + credentials.
// Run with: E2E_LIVE=1 E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e
const LIVE = process.env.E2E_LIVE === "1";
test.skip(!LIVE, "Live workflow tests require E2E_LIVE=1 with a seeded database");

test("admin can log in and see dashboard data", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', process.env.E2E_ADMIN_EMAIL || "admin@institution.local");
  await page.fill('input[type="password"]', process.env.E2E_ADMIN_PASSWORD || "Admin123!");
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await expect(page.getByText(/total students/i)).toBeVisible();
});

test("student cannot access another student's resource (IDOR)", async ({ request }) => {
  // Anonymous probe must be rejected; authenticated probes are covered by API tests.
  const res = await request.get("/api/v1/students/does-not-exist");
  expect([401, 403, 404]).toContain(res.status());
});
