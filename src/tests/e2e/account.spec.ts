import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Anonymous surface — safe to run against any deployment without a seeded DB.
// ---------------------------------------------------------------------------

test("profile pages require login in every portal", async ({ page }) => {
  for (const path of ["/admin/profile", "/teacher/profile", "/student/profile"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("admin management page requires login", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/login/);
});

test("account APIs reject anonymous calls", async ({ request }) => {
  for (const [method, url] of [
    ["GET", "/api/v1/users/me"],
    ["PATCH", "/api/v1/users/me"],
    ["POST", "/api/v1/users/me/change-password"],
    ["POST", "/api/v1/users"],
    ["DELETE", "/api/v1/users/ghost"],
  ] as const) {
    const res = await request.fetch(url, { method });
    expect(res.status(), `${method} ${url}`).toBe(401);
  }
});

test("admin-only user directory rejects anonymous callers", async ({ request }) => {
  const res = await request.get("/api/v1/users?adminsOnly=true");
  expect(res.status()).toBe(401);
});

// ---------------------------------------------------------------------------
// Live flows — require a seeded database.
// Run with: E2E_LIVE=1 [E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=...] npm run test:e2e
// ---------------------------------------------------------------------------

const LIVE = process.env.E2E_LIVE === "1";
test.skip(!LIVE, "Live account-management tests require E2E_LIVE=1 with a seeded database");

const SEED_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@institution.local";
const SEED_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "Admin123!";

test("seed admin profile is locked and protected in the UI", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', SEED_EMAIL);
  await page.fill('input[type="password"]', SEED_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await page.goto("/admin/profile");
  await expect(page.getByText(/Protected system account/i)).toBeVisible();
  await expect(page.locator("#profile-name")).toBeDisabled();
  await expect(page.locator("#profile-email")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save name" })).toHaveCount(0);

  // Direct API calls are also refused — UI hiding is not the security boundary.
  const res = await page.request.patch("/api/v1/users/me", { data: { name: "Not Allowed" } });
  expect(res.status()).toBe(403);
  const pw = await page.request.post("/api/v1/users/me/change-password", {
    data: { currentPassword: SEED_PASSWORD, newPassword: "Should1234!", confirmPassword: "Should1234!" },
  });
  expect(pw.status()).toBe(403);
});

test("seed admin can create a normal admin who can sign in but cannot touch the seed account", async ({ playwright, request }) => {
  const suffix = Date.now();
  const email = `e2e.admin.${suffix}@example.edu`;
  await request.post("/api/v1/auth/login", { data: { email: SEED_EMAIL, password: SEED_PASSWORD } });

  const created = await request.post("/api/v1/users", {
    data: { name: "E2E Normal Admin", email, password: "E2ePassw0rd!" },
  });
  expect(created.status()).toBe(201);
  const row = (await created.json()).data as { id: string; role: string; isSeedAdmin: boolean };
  expect(row.role).toBe("ADMIN");
  expect(row.isSeedAdmin).toBe(false);

  try {
    // The new admin authenticates with the initial password and gets normal admin access.
    const fresh = await playwright.request.newContext({
      baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    });
    const login = await fresh.post("/api/v1/auth/login", { data: { email, password: "E2ePassw0rd!" } });
    expect(login.ok()).toBeTruthy();
    const me = await fresh.get("/api/v1/auth/me");
    expect(((await me.json()).data as { role: string }).role).toBe("ADMIN");
    const list = await fresh.get("/api/v1/users?adminsOnly=true");
    expect(list.ok()).toBeTruthy();

    // ...but cannot modify or delete the protected seed admin.
    const seedId = ((await (await request.get("/api/v1/auth/me")).json()).data as { id: string }).id;
    expect((await fresh.delete(`/api/v1/users/${seedId}`)).status()).toBe(403);
    expect((await fresh.patch("/api/v1/users/me", { data: { role: "TEACHER" } })).status()).toBe(422);
    await fresh.dispose();
  } finally {
    // Cleanup: remove the disposable admin through the seed session.
    expect((await request.delete(`/api/v1/users/${row.id}`)).status()).toBe(200);
  }
});
