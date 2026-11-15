import { ImageResponse } from "next/og";

export const alt = "LendLoop: borrow what you need, lend what you don't";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          color: "#fff",
          background: "linear-gradient(135deg, #1e40af 0%, #2563eb 55%, #3b82f6 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="84" height="84" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="9" fill="#0f1f5c" />
            <g fill="none" stroke="#bfdbfe" strokeWidth="2.6" strokeLinecap="round" opacity="0.8">
              <rect x="-8.2" y="-4.6" width="16.4" height="9.2" rx="4.6" transform="translate(19.9 12.1) rotate(-45)" />
            </g>
            <g fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round">
              <rect x="-8.2" y="-4.6" width="16.4" height="9.2" rx="4.6" transform="translate(12.1 19.9) rotate(-45)" />
            </g>
          </svg>
          <div style={{ display: "flex", fontSize: 54, fontWeight: 800, letterSpacing: -1 }}>
            Lend<span style={{ color: "#bfdbfe" }}>Loop</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 92, fontWeight: 800, lineHeight: 1.05, letterSpacing: -3 }}>
            Borrow what you need.
          </div>
          <div style={{ display: "flex", fontSize: 92, fontWeight: 800, lineHeight: 1.05, letterSpacing: -3, color: "#bfdbfe" }}>
            Lend what you don&apos;t.
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, fontSize: 28, fontWeight: 600 }}>
          {["Next.js", "Clerk", "Convex", "n8n"].map((t) => (
            <div
              key={t}
              style={{ display: "flex", padding: "8px 22px", borderRadius: 999, background: "rgba(255,255,255,0.16)" }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
