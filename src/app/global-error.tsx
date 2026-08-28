"use client";

/**
 * Last resort: an error thrown by the root layout itself, which the route-level
 * error.tsx cannot catch because it sits inside that layout.
 *
 * This replaces the root layout when active, so it has to render its own
 * <html> and <body> and cannot rely on globals.css being present. Everything
 * here is therefore inline, and deliberately plain.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f5f5f3",
          color: "#111111",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <p
            style={{
              margin: 0,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: ".14em",
              color: "#fb0044",
            }}
          >
            TAVRENOPS
          </p>
          <h1 style={{ fontSize: 26, margin: "8px 0 12px", fontWeight: 800 }}>
            The app failed to start
          </h1>
          <p style={{ fontSize: 13, color: "#727272", margin: "0 0 24px" }}>
            This is not a page-level problem. If it persists, an admin should
            check the server logs.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                color: "#9a9a9a",
                margin: "0 0 24px",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              background: "#fb0044",
              color: "#fff",
              border: 0,
              padding: "10px 18px",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
