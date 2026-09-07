import { describe, expect, it } from "vitest";
import {
  INVITE_TTL_MS,
  hashInviteToken,
  inviteExpiryFrom,
  inviteTokenMatches,
  isInviteExpired,
  mintInviteToken,
} from "./invite-token";

/**
 * The boundary cases, which is the whole reason this is a pure module rather
 * than living inside the server action.
 */
describe("invite tokens", () => {
  it("mints a URL-safe token with no characters needing escaping", () => {
    for (let i = 0; i < 50; i++) {
      // base64url only: a token that has to be percent-encoded is a token that
      // gets mangled by whatever chat client carries it.
      expect(mintInviteToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("mints a different token every time", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintInviteToken()));
    expect(seen.size).toBe(200);
  });

  it("round-trips: the token it minted matches the hash it stored", () => {
    const token = mintInviteToken();
    expect(inviteTokenMatches(token, hashInviteToken(token))).toBe(true);
  });

  it("refuses a token that is not the one stored", () => {
    const stored = hashInviteToken(mintInviteToken());
    expect(inviteTokenMatches(mintInviteToken(), stored)).toBe(false);
  });

  it("refuses a tampered token, including a single flipped character", () => {
    const token = mintInviteToken();
    const stored = hashInviteToken(token);
    const flipped =
      (token[0] === "A" ? "B" : "A") + token.slice(1);
    expect(inviteTokenMatches(flipped, stored)).toBe(false);
  });

  it("does not store the token itself", () => {
    // The point of hashing. If this ever fails, a database read hands over
    // working credentials.
    const token = mintInviteToken();
    expect(hashInviteToken(token)).not.toContain(token);
  });

  it("answers false rather than throwing on a malformed stored hash", () => {
    // `timingSafeEqual` throws on a length mismatch, and a row could hold
    // anything after a bad migration. A crash here would be a 500 on a public
    // page, which is worse than a refusal.
    const token = mintInviteToken();
    expect(inviteTokenMatches(token, "")).toBe(false);
    expect(inviteTokenMatches(token, "not-hex")).toBe(false);
    expect(inviteTokenMatches(token, "ab")).toBe(false);
  });

  describe("expiry", () => {
    const now = new Date("2026-09-07T12:00:00Z");

    it("treats a missing expiry as expired, never as forever", () => {
      // Fail closed: a row with no expiry is a row whose invite was cleared.
      expect(isInviteExpired(null, now)).toBe(true);
      expect(isInviteExpired(undefined, now)).toBe(true);
    });

    it("is exclusive at the boundary — exactly now is expired", () => {
      expect(isInviteExpired(new Date(now.getTime() + 1), now)).toBe(false);
      expect(isInviteExpired(new Date(now.getTime()), now)).toBe(true);
      expect(isInviteExpired(new Date(now.getTime() - 1), now)).toBe(true);
    });

    it("mints an expiry seven days out", () => {
      expect(inviteExpiryFrom(now).getTime() - now.getTime()).toBe(
        INVITE_TTL_MS,
      );
      expect(isInviteExpired(inviteExpiryFrom(now), now)).toBe(false);
    });

    it("expires a freshly-minted token one millisecond after its window", () => {
      const expiry = inviteExpiryFrom(now);
      const justAfter = new Date(now.getTime() + INVITE_TTL_MS + 1);
      expect(isInviteExpired(expiry, justAfter)).toBe(true);
    });
  });
});
