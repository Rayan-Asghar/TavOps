/**
 * What a one-click server action hands back to the button that called it.
 *
 * The bare `<form action={fn}>` sites all returned void, so a refusal and a
 * success were indistinguishable — and several of those refusals were bare
 * `return;` statements that said nothing at all.
 */
export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /**
   * Serialised payload an undo can replay. Opaque to the button: only the
   * action that produced it knows how to read it back.
   */
  undoToken?: string;
};
