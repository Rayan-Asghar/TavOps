"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/",
    });
    return {};
  } catch (err) {
    if (err instanceof AuthError) {
      // Never distinguish "no such account" from "wrong password" — that turns
      // the form into an oracle for which staff addresses exist.
      return { error: "Email or password is incorrect." };
    }
    throw err;
  }
}

/**
 * Hands off to Google. There is no state to return: either the redirect
 * happens, or NextAuth sends the browser back to /login with an error in the
 * query string, which the page renders.
 *
 * `signIn` throws a redirect by design, so it must NOT sit inside a try/catch
 * that swallows it — the NEXT_REDIRECT error is the mechanism, not a failure.
 */
export async function googleLoginAction() {
  await signIn("google", { redirectTo: "/" });
}

export async function logoutAction() {
  await signOut({ redirect: false });
  redirect("/login");
}
