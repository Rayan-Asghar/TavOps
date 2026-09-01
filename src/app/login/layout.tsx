import type { Metadata } from "next";

/**
 * The login page is a client component, and a client component cannot export
 * metadata. A layout is the only place to title this route.
 */
export const metadata: Metadata = { title: "Sign in" };

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
