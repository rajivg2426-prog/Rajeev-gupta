import { Text as RNText, type TextProps } from "react-native";
import { fontFamilyFor } from "../theme/fonts";

const TABULAR = /(?:^|\s)tabular(?:\s|$)/;

/**
 * The app's only Text. Reads the weight from the class list (`font-medium`,
 * `font-semibold`, `font-bold`, `font-mono`) and sets the matching font family;
 * fontWeight is reset so Android does not synthesise or fall back to Roboto.
 * Add `tabular` for tabular figures (amounts, phone numbers, timers).
 */
export function Text({ className, style, ...rest }: TextProps & { className?: string }) {
  const tabular = TABULAR.test(className ?? "");
  return (
    <RNText
      className={className}
      style={[{ fontFamily: fontFamilyFor(className), fontWeight: "normal" }, tabular ? { fontVariant: ["tabular-nums"] } : null, style]}
      {...rest}
    />
  );
}
