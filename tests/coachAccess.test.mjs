import { test } from "node:test";
import assert from "node:assert/strict";

import { newWorkspaceId, normalizeEmail } from "../src/lib/coachAccess.ts";
import { googleLinkEnabled, multiCoachEnabled } from "../src/lib/features.ts";
import { sanitizeSession } from "../src/lib/session.ts";

test("emails are compared normalized", () => {
  assert.equal(normalizeEmail("  New.Coach@Gmail.COM "), "new.coach@gmail.com");
  assert.equal(normalizeEmail(null), "");
});

test("workspace ids are opaque and random (never email or uid)", () => {
  const a = newWorkspaceId();
  const b = newWorkspaceId();
  assert.match(a, /^ws_[0-9a-f]{24}$/);
  assert.notEqual(a, b);
});

test("multi-coach and Google linking are off by default; a coach session is then rejected", () => {
  assert.equal(multiCoachEnabled(), false);
  assert.equal(googleLinkEnabled(), false);
  assert.equal(sanitizeSession({ role: "coach", uid: "u1", email: "x@gmail.com" }), null);
  assert.equal(sanitizeSession({ role: "public" })?.role, "public");
});
