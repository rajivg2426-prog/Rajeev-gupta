import { useColorScheme } from "react-native";
import { palette, type Palette } from "./tokens";

/**
 * Resolved hex colours for the current appearance, for the few places that need a
 * colour value instead of a class (SVG icons, ActivityIndicator, placeholder text,
 * navigator backgrounds). Follows the same system setting as the CSS variables.
 */
export function usePalette(): Palette {
  return palette[useColorScheme() === "dark" ? "dark" : "light"];
}
