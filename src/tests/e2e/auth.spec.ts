import { test, expect } from "@playwright/test";

// Unauthenticated users are redirected to login for protected portals.
test("admin portal requires login", async ({ page }) => {
  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /educational management system/i })).toBeVisible();
});

test("teacher portal requires login", async ({ page }) => {
  await page.goto("/teacher/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("student portal requires login", async ({ page }) => {
  await page.goto("/student/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("health endpoint responds", async ({ request }) => {
  const res = await request.get("/api/v1/health");
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json.data.status).toBe("ok");
});

test("protected API requires auth", async ({ request }) => {
  const res = await request.get("/api/v1/students");
  expect(res.status()).toBe(401);
});
