import { createElement } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { usePalette } from "../theme/palette";
import type { ColorToken } from "../theme/tokens";

// The design's inline icon set (24×24, 2px stroke, round caps), copied verbatim
// from the approved design file so the shapes match exactly.
const SOURCE = {
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  message: '<path d="M21 11.5a8.4 8.4 0 0 1-12.5 7.4L3 21l2.1-5.5A8.4 8.4 0 1 1 21 11.5z"/>',
  sms: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  "wifi-off":
    '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.8"/><path d="M19 12.9a10 10 0 0 0-2.4-1.7"/><path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M22 8.8A15 15 0 0 0 10.7 5"/><path d="M12 20h.01"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
} as const;

export type IconName = keyof typeof SOURCE;

type Shape = { tag: "path" | "circle" | "rect"; attrs: Record<string, string> };

const COMPONENT = { path: Path, circle: Circle, rect: Rect } as const;

function parse(src: string): Shape[] {
  const shapes: Shape[] = [];
  for (const m of src.matchAll(/<(path|circle|rect)\s([^>]*?)\/>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2].matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    shapes.push({ tag: m[1] as Shape["tag"], attrs });
  }
  return shapes;
}

const SHAPES = Object.fromEntries(Object.entries(SOURCE).map(([k, v]) => [k, parse(v)])) as Record<IconName, Shape[]>;

export function Icon({ name, size = 20, color = "ink", strokeWidth = 2 }: { name: IconName; size?: number; color?: ColorToken; strokeWidth?: number }) {
  const stroke = usePalette()[color];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {SHAPES[name].map((s, i) => createElement(COMPONENT[s.tag] as unknown as React.ComponentType<Record<string, string | number>>, { key: i, ...s.attrs }))}
    </Svg>
  );
}

/** The LegalKart mark from the design (document with a tick seal). */
export function Logo({ size = 56 }: { size?: number }) {
  const p = usePalette();
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Rect width={40} height={40} rx={10} fill={p.primary} />
      <Path d="M13 9h10l6 6v16a1 1 0 0 1-1 1H13a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z" fill={p["on-primary"]} opacity={0.95} />
      <Path d="M23 9v6h6" fill={p["primary-soft"]} />
      <Circle cx={25} cy={27} r={4.5} fill={p.primary} />
      <Path d="m23 27 1.4 1.4 2.6-2.8" fill="none" stroke={p["on-primary"]} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
