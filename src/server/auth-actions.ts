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

export async function logoutAction() {
  await signOut({ redirect: false });
  redirect("/login");
}
