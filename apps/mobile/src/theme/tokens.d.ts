// Types for the CommonJS token module (tokens.js), which tailwind.config.js also requires.
export type ColorToken =
  | "canvas"
  | "surface"
  | "sunken"
  | "line"
  | "line-strong"
  | "ink"
  | "ink-2"
  | "ink-3"
  | "primary"
  | "primary-pressed"
  | "on-primary"
  | "primary-soft"
  | "success"
  | "success-soft"
  | "warn"
  | "warn-soft"
  | "danger"
  | "danger-soft"
  | "info"
  | "info-soft"
  | "paper"
  | "watermark";

export type Palette = Record<ColorToken, string>;
export type StatusTone = "neutral" | "warn" | "info" | "success";

export const palette: { light: Palette; dark: Palette };
export const theme: { extend: Record<string, unknown> };
export function globalCss(): string;
export const documentStatus: Record<"DRAFT" | "AWAITING_VERIFICATION" | "READY_TO_STAMP" | "GENERATED", { label: string; tone: StatusTone }>;
