import { type Page } from "@playwright/test";

export const E2E_ADMIN_EMAIL = "e2e-admin@test.local";
export const E2E_USER_EMAIL = "e2e-user@test.local";

/**
 * Sign in as a test user by navigating the browser to the E2E auth endpoint.
 * The server creates the DB session and sets the cookie via Set-Cookie header,
 * so the cookie lives in the browser's native jar and is automatically included
 * in all subsequent page.request API calls — no addCookies() needed.
 */
export async function signInAs(
  page: Page,
  email: string,
  name: string,
  role: "user" | "admin" = "user"
) {
  const params = new URLSearchParams({ email, name, role });
  await page.goto(`/api/e2e/signin?${params}`);
  // The endpoint redirects to /groups on success
  await page.waitForURL(/\/groups/, { timeout: 15_000 });
}

/**
 * Create a group via API and return its roomId.
 * The signed-in user becomes the creator/manager.
 */
export async function createGroup(
  page: Page,
  name: string,
  entryFee = 10
): Promise<string> {
  const res = await page.request.post("/api/rooms", {
    data: { name, entryFee },
  });
  if (!res.ok()) throw new Error(`createGroup failed: ${res.status()}`);
  const data = await res.json();
  return data.id as string;
}

/**
 * Advance the room's status via the admin PATCH API.
 * Caller must be signed in as creator or platform admin.
 */
export async function setRoomStatus(
  page: Page,
  roomId: string,
  status: string
) {
  const res = await page.request.patch(`/api/admin/groups/${roomId}`, {
    data: { status },
  });
  if (!res.ok()) throw new Error(`setRoomStatus(${status}) failed: ${res.status()}`);
}

/** Run Phase 1 (group stage) simulation for the room. Requires admin role. */
export async function runPhase1(page: Page, roomId: string) {
  const res = await page.request.post(`/api/admin/groups/${roomId}/test`, {
    data: { phase: 1 },
  });
  if (!res.ok()) throw new Error(`Phase 1 simulation failed: ${res.status()}`);
}

/** Run Phase 2 (KO stage) simulation for the room. Requires admin role. */
export async function runPhase2(page: Page, roomId: string) {
  const res = await page.request.post(`/api/admin/groups/${roomId}/test`, {
    data: { phase: 2 },
  });
  if (!res.ok()) throw new Error(`Phase 2 simulation failed: ${res.status()}`);
}

/** Clean up simulation data for the room. Requires admin role. */
export async function runCleanup(page: Page, roomId: string) {
  const res = await page.request.delete(`/api/admin/groups/${roomId}/test`);
  if (!res.ok()) throw new Error(`Cleanup failed: ${res.status()}`);
}
