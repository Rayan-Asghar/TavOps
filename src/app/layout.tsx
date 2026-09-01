import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter, Geist_Mono } from "next/font/google";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";

// tavren.io loads Inter 300-700; matching it keeps the two properties looking
// like one product rather than a marketing site and an unrelated admin panel.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // Every route used to render the same tab title, which is useless in a tool
  // people keep open in ten tabs. Pages set their own; this wraps them.
  title: { template: "%s · TavrenOPS", default: "TavrenOPS" },
  description: "Tavren internal operations",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Read at render time so the first paint is already the right colour. An
  // explicit choice stamps the attribute; "system" stamps nothing and lets the
  // guarded prefers-color-scheme block in globals.css decide.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={theme === "system" ? undefined : theme}
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
