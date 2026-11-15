import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono";
import { Mukta_400Regular, Mukta_500Medium, Mukta_600SemiBold, Mukta_700Bold } from "@expo-google-fonts/mukta";

/** Passed to useFonts in the root layout. Each weight is its own family in React Native. */
export const FONT_ASSETS = {
  Mukta_400Regular,
  Mukta_500Medium,
  Mukta_600SemiBold,
  Mukta_700Bold,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
};

export const FONT = {
  regular: "Mukta_400Regular",
  medium: "Mukta_500Medium",
  semibold: "Mukta_600SemiBold",
  bold: "Mukta_700Bold",
  mono: "IBMPlexMono_400Regular",
  monoMedium: "IBMPlexMono_500Medium",
} as const;

const WEIGHT = /(?:^|\s)font-(medium|semibold|bold)(?:\s|$)/;
const MONO = /(?:^|\s)font-mono(?:\s|$)/;

/**
 * Maps Tailwind weight/family classes to the loaded font family. `font-mono` uses
 * IBM Plex Mono (500 for any heavier weight, the heaviest we load).
 */
export function fontFamilyFor(className: string | undefined): string {
  const c = className ?? "";
  const weight = WEIGHT.exec(c)?.[1] as "medium" | "semibold" | "bold" | undefined;
  if (MONO.test(c)) return weight ? FONT.monoMedium : FONT.mono;
  return weight ? FONT[weight] : FONT.regular;
}
