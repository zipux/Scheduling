"use client";

/**
 * Last-resort boundary for a failure in the root layout itself. It renders its
 * own document without the app's providers, so the text is fixed English and
 * the styles are inline (DECISIONS.md).
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", color: "#111", background: "#fff" }}>
        <title>Something went wrong · Shiftwise</title>
        <main role="alert" style={{ maxWidth: 420, margin: "0 auto", padding: "64px 16px", textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong.</h1>
          <p style={{ color: "#555", fontSize: 14 }}>Shiftwise couldn&apos;t load. Your data is safe — try again, or go back to the start.</p>
          {error.digest && <p style={{ color: "#555", fontSize: 12, fontFamily: "monospace" }}>Reference: {error.digest}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 24 }}>
            <button type="button" onClick={() => retry()} style={{ minHeight: 48, borderRadius: 8, border: 0, background: "#111", color: "#fff", fontSize: 16 }}>
              Try again
            </button>
            {/* A full reload on purpose: the root layout is what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ minHeight: 48, lineHeight: "48px", borderRadius: 8, border: "1px solid #ccc", color: "#111", textDecoration: "none" }}>
              Go to start
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
