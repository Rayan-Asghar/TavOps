/**
 * An error whose message is written FOR the person who triggered it.
 *
 * Server actions used to return `err.message` verbatim for anything they
 * caught, which meant a Postgres constraint violation or a driver failure was
 * rendered straight into the browser — leaking schema detail and showing a
 * developer something they cannot act on.
 *
 * The rule is now safe-by-default: an error is only shown if it says it is
 * meant to be shown. Domain rules ("that task is not on this project") throw
 * this; everything else is logged against a reference and shown as a generic
 * line. Adding a new user-visible failure is a deliberate act.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}
