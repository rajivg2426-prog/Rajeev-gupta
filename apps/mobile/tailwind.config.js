const tokens = require("./src/theme/tokens");

// Theme comes straight from the approved design's token module (design/ui/tailwind.tokens.js).
// Colours resolve through the CSS variables in global.css, so one class works in light and dark.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: tokens.theme,
  plugins: [],
};
