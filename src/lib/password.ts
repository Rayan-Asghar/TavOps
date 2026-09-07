import { randomInt } from "node:crypto";

/**
 * Generating a password somebody will retype.
 *
 * Extracted from `user-actions.ts` so the seed script can use the same
 * generator. That mattered the moment the seed stopped handing every account
 * the same literal: nine people sharing `tavren123` is one leak, and a second
 * implementation of "make a password" is how one of them ends up weaker.
 *
 * `randomInt` from node:crypto, not `Math.random`. A password a person keeps is
 * not a place to save a few nanoseconds on entropy.
 */

// No 0/O/1/l/I: these get transcribed by hand into a chat message, and an
// ambiguous character turns into a support request.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generatePassword(length = 16): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
