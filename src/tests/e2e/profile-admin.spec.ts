import { test, expect } from "@playwright/test";

// Account management routes follow the same guard contract as the rest of the portals:
// without a session, middleware/layout redirect to the login page.
test("admin profile page requires login", async ({ page }) => {
  await page.goto("/admin/profile");
  await expect(page).toHaveURL(/\/login/);
});

test("admin accounts page requires login", async ({ page }) => {
  await page.goto("/admin/admins");
  await expect(page).toHaveURL(/\/login/);
});

test("teacher profile page requires login", async ({ page }) => {
  await page.goto("/teacher/profile");
  await expect(page).toHaveURL(/\/login/);
});

test("student profile page requires login", async ({ page }) => {
  await page.goto("/student/profile");
  await expect(page).toHaveURL(/\/login/);
});
