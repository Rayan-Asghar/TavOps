import { describe, expect, it } from "vitest";
import { maySignIn } from "./sign-in-eligibility";

const now = new Date("2026-09-04T12:00:00Z");
const active = { isActive: true, accessExpiresAt: null };

describe("maySignIn", () => {
  it("admits an active account with no expiry", () => {
    expect(maySignIn(active, now)).toBe(true);
  });

  it("refuses an account that does not exist", () => {
    // The Google path's most important case: a real Google identity that is
    // nobody here. Never auto-provisioned, always refused.
    expect(maySignIn(null, now)).toBe(false);
    expect(maySignIn(undefined, now)).toBe(false);
  });

  it("refuses a deactivated account", () => {
    expect(maySignIn({ isActive: false, accessExpiresAt: null }, now)).toBe(false);
  });

  it("refuses a collaborator past their expiry", () => {
    expect(
      maySignIn(
        { isActive: true, accessExpiresAt: new Date("2026-09-03T12:00:00Z") },
        now,
      ),
    ).toBe(false);
  });

  it("admits one whose expiry is still ahead", () => {
    expect(
      maySignIn(
        { isActive: true, accessExpiresAt: new Date("2026-09-05T12:00:00Z") },
        now,
      ),
    ).toBe(true);
  });

  it("treats the expiry instant itself as expired", () => {
    // <= rather than <, matching isActorExpired: the boundary belongs to the
    // side that denies, so access never outlives its stated end by a tick.
    expect(maySignIn({ isActive: true, accessExpiresAt: now }, now)).toBe(false);
  });

  it("refuses a deactivated account even when its expiry is in the future", () => {
    expect(
      maySignIn(
        { isActive: false, accessExpiresAt: new Date("2099-01-01T00:00:00Z") },
        now,
      ),
    ).toBe(false);
  });
});
