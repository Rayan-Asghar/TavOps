import { describe, expect, it } from "vitest";
import { isSessionStillValid } from "./session-validity";

const now = new Date("2026-09-05T12:00:00Z");
const account = { isActive: true, accessExpiresAt: null, sessionVersion: 1 };
const claims = { sessionVersion: 1 };

describe("isSessionStillValid", () => {
  it("admits a current session", () => {
    expect(isSessionStillValid(claims, account, now)).toEqual({ valid: true });
  });

  it("rejects a deactivated account immediately, not in twelve hours", () => {
    // The whole point: deactivation used to take effect whenever the token
    // happened to expire.
    expect(
      isSessionStillValid(claims, { ...account, isActive: false }, now),
    ).toEqual({ valid: false, reason: "deactivated" });
  });

  it("rejects a token naming a user who no longer exists", () => {
    expect(isSessionStillValid(claims, null, now)).toEqual({
      valid: false,
      reason: "deactivated",
    });
  });

  it("rejects a lapsed contractor", () => {
    expect(
      isSessionStillValid(
        claims,
        { ...account, accessExpiresAt: new Date("2026-09-04T12:00:00Z") },
        now,
      ),
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("treats the expiry instant itself as expired", () => {
    // <= not <, matching isActorExpired: the boundary denies.
    expect(
      isSessionStillValid(claims, { ...account, accessExpiresAt: now }, now),
    ).toMatchObject({ valid: false, reason: "expired" });
  });

  it("admits one whose expiry is still ahead", () => {
    expect(
      isSessionStillValid(
        claims,
        { ...account, accessExpiresAt: new Date("2026-09-06T12:00:00Z") },
        now,
      ),
    ).toEqual({ valid: true });
  });

  it("rejects a token issued before the version was bumped", () => {
    expect(
      isSessionStillValid({ sessionVersion: 1 }, { ...account, sessionVersion: 2 }, now),
    ).toEqual({ valid: false, reason: "revoked" });
  });

  it("rejects a token claiming a version AHEAD of the row", () => {
    // Not merely `<`. A forged or replayed higher version must not pass just
    // because it is bigger than the truth.
    expect(
      isSessionStillValid({ sessionVersion: 9 }, { ...account, sessionVersion: 2 }, now),
    ).toEqual({ valid: false, reason: "revoked" });
  });

  it("reports deactivation ahead of a stale version", () => {
    // Both are true; the reason given should be the one that is not about to
    // be fixed by signing in again.
    expect(
      isSessionStillValid(
        { sessionVersion: 1 },
        { isActive: false, accessExpiresAt: null, sessionVersion: 5 },
        now,
      ),
    ).toEqual({ valid: false, reason: "deactivated" });
  });
});
