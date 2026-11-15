/**
 * LegalKart design tokens (Tailwind / NativeWind v4 theme).
 *
 * Direction: "stamp ink". A deep teal-green taken from Indian non-judicial
 * stamp paper, on cool green-tinted neutrals. One accent colour only; amber,
 * red, green and blue are reserved for status meaning.
 *
 * Colours are semantic and resolve through CSS variables (RGB triplets), so a
 * single class such as `bg-surface` works in light and dark. In the Expo app,
 * put the output of `globalCss()` into global.css (NativeWind reads :root and
 * the prefers-color-scheme media query).
 *
 * Fonts: Mukta (Ek Type; Latin + Devanagari, ready for Hindi later) and
 * IBM Plex Mono for reference and certificate numbers. In React Native each
 * weight is a separate font file; map font-medium/semibold/bold to
 * Mukta_500Medium / Mukta_600SemiBold / Mukta_700Bold in the Text wrapper.
 */
const palette = {
  light: {
    canvas: '#F3F6F5',        // app background
    surface: '#FFFFFF',       // cards, sheets, inputs
    sunken: '#E9EEEC',        // grouped rows, input prefixes, skeletons
    line: '#D3DCD8',          // borders and dividers
    'line-strong': '#9FB0AA', // input borders
    ink: '#13201C',           // primary text
    'ink-2': '#475853',       // secondary text
    'ink-3': '#6F7F7A',       // hints, placeholders
    primary: '#0E5C51',       // stamp-ink teal: primary actions, links, focus
    'primary-pressed': '#0A473F',
    'on-primary': '#FFFFFF',
    'primary-soft': '#DDEDE8',
    success: '#17703F',
    'success-soft': '#DDF1E4',
    warn: '#935207',
    'warn-soft': '#FBEBD3',
    danger: '#AE2A1F',
    'danger-soft': '#FBE2DE',
    info: '#28589A',
    'info-soft': '#E0EAF7',
    paper: '#FFFEFA',         // document preview paper
    watermark: '#C9372C',
  },
  dark: {
    canvas: '#0C1311',
    surface: '#141D1A',
    sunken: '#1B2622',
    line: '#28362F',
    'line-strong': '#4A5C55',
    ink: '#E6EEEB',
    'ink-2': '#A8B7B2',
    'ink-3': '#7D8C87',
    primary: '#52B9A7',
    'primary-pressed': '#43A694',
    'on-primary': '#03201B',
    'primary-soft': '#123A33',
    success: '#55C68D',
    'success-soft': '#123222',
    warn: '#E4A650',
    'warn-soft': '#3A2810',
    danger: '#F27A6E',
    'danger-soft': '#3D1814',
    info: '#86AEEA',
    'info-soft': '#16263E',
    paper: '#F4F2EA',
    watermark: '#C9372C',
  },
};

const hexToTriplet = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

const colors = Object.fromEntries(
  Object.keys(palette.light).map((k) => [k, `rgb(var(--lk-${k}) / <alpha-value>)`])
);

const theme = {
  extend: {
    colors,
    fontFamily: {
      sans: ['Mukta', 'system-ui', 'sans-serif'],
      mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
    },
    // Body never goes below 16px: many users are on mid-range Android phones
    // with large system font settings.
    fontSize: {
      caption: ['12px', { lineHeight: '16px' }],
      label: ['14px', { lineHeight: '20px' }],
      body: ['16px', { lineHeight: '24px' }],
      heading: ['18px', { lineHeight: '24px' }],
      title: ['22px', { lineHeight: '28px' }],
      display: ['28px', { lineHeight: '34px' }],
      amount: ['36px', { lineHeight: '42px' }],
    },
    // Spacing uses Tailwind's default 4px scale. Screen gutter = 5 (20px),
    // gap between form fields = 5, inside cards = 4 (16px).
    borderRadius: {
      sm: '6px',    // chips, small tags
      md: '10px',   // inputs, buttons
      lg: '14px',   // cards
      xl: '20px',   // sheets, hero cards
      full: '9999px',
    },
    minHeight: { touch: '48px' }, // every tappable row and button
    height: { touch: '48px', 'touch-lg': '56px' },
  },
};

/** CSS for global.css (Expo) or a <style> tag (web). */
function globalCss() {
  const block = (p) =>
    Object.entries(p).map(([k, v]) => `  --lk-${k}: ${hexToTriplet(v)};`).join('\n');
  return [
    `:root {\n${block(palette.light)}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${block(palette.dark).replace(/^/gm, '  ')}\n    color-scheme: dark;\n  }\n}`,
    `:root[data-theme="dark"] {\n${block(palette.dark)}\n  color-scheme: dark;\n}`,
  ].join('\n');
}

/** User-facing labels and colours for each document status. */
const documentStatus = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  AWAITING_VERIFICATION: { label: 'Tenant to verify', tone: 'warn' },
  READY_TO_STAMP: { label: 'Buy e-stamp', tone: 'info' },
  GENERATED: { label: 'Ready to sign', tone: 'success' },
};

module.exports = { palette, theme, globalCss, documentStatus };
