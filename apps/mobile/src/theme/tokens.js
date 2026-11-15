// Placeholder design tokens. The UI design session will replace these values;
// keep the shape (colors, fontSize, spacing, borderRadius) so tailwind.config.js
// keeps working. Plain CommonJS so tailwind.config.js can require it.
module.exports = {
  colors: {
    brand: { DEFAULT: "#1f4e79", fg: "#ffffff" },
    surface: { DEFAULT: "#ffffff", muted: "#f3f4f6" },
    ink: { DEFAULT: "#111827", muted: "#6b7280" },
    line: "#d1d5db",
    danger: "#b91c1c",
    success: "#15803d",
  },
  fontSize: {
    caption: ["12px", "16px"],
    body: ["15px", "22px"],
    title: ["20px", "28px"],
  },
  spacing: {
    gutter: "16px",
  },
  borderRadius: {
    card: "12px",
  },
};
