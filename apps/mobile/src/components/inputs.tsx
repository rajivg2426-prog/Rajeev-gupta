// Inputs from the design system: text, pincode, money, phone, OTP, stepper, suffix.
import { useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";
import { cleanRupeesInput, groupRupeesInput } from "../api/money";
import { FONT } from "../theme/fonts";
import { usePalette } from "../theme/palette";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

/** Label, control, then hint or error (error replaces the hint). */
export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label?: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={`gap-2 ${className}`}>
      {label ? <Text className="text-label font-medium text-ink-2">{label}</Text> : null}
      {children}
      {error ? <FieldError message={error} /> : hint ? typeof hint === "string" ? <Text className="text-caption text-ink-3">{hint}</Text> : hint : null}
    </View>
  );
}

export function FieldError({ message }: { message: string }) {
  return (
    <View className="flex-row items-start gap-1.5" accessibilityRole="alert">
      <Icon name="alert" size={16} color="danger" />
      <Text className="flex-1 text-caption text-danger">{message}</Text>
    </View>
  );
}

function useFocus(props: Pick<TextInputProps, "onFocus" | "onBlur">) {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    onFocus: (e: Parameters<NonNullable<TextInputProps["onFocus"]>>[0]) => {
      setFocused(true);
      props.onFocus?.(e);
    },
    onBlur: (e: Parameters<NonNullable<TextInputProps["onBlur"]>>[0]) => {
      setFocused(false);
      props.onBlur?.(e);
    },
  };
}

/** Border for an input box: strong line at rest, 2px teal when focused, 2px red when invalid. */
function frame(focused: boolean, invalid?: boolean) {
  return invalid ? "border-2 border-danger" : focused ? "border-2 border-primary" : "border border-line-strong";
}

type BaseProps = Omit<TextInputProps, "style"> & { invalid?: boolean; className?: string };

export function TextField({ invalid, className = "", multiline, editable = true, ...rest }: BaseProps & { icon?: IconName }) {
  const p = usePalette();
  const f = useFocus(rest);
  return (
    <TextInput
      placeholderTextColor={p["ink-3"]}
      multiline={multiline}
      textAlignVertical={multiline ? "top" : "center"}
      editable={editable}
      {...rest}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
      style={{ fontFamily: FONT.regular }}
      className={`${multiline ? "min-h-[96px] py-3" : "h-touch"} px-4 rounded-md ${frame(f.focused, invalid)} ${editable ? "bg-surface" : "bg-sunken"} text-body text-ink ${className}`}
    />
  );
}

/** A box with an inline prefix/suffix segment (₹, +91, %) or trailing icon. */
function Affixed({
  focused,
  invalid,
  prefix,
  suffix,
  trailing,
  large,
  children,
}: {
  focused: boolean;
  invalid?: boolean;
  prefix?: string;
  suffix?: string;
  trailing?: ReactNode;
  large?: boolean;
  children: ReactNode;
}) {
  return (
    <View className={`${large ? "h-touch-lg" : "h-touch"} rounded-md ${frame(focused, invalid)} bg-surface flex-row items-stretch overflow-hidden`}>
      {prefix ? (
        <View className="px-4 bg-sunken border-r border-line justify-center">
          <Text className={`text-body ${prefix === "₹" ? "font-semibold" : "font-medium"} text-ink-2`}>{prefix}</Text>
        </View>
      ) : null}
      <View className="flex-1 min-w-0 flex-row items-center">{children}</View>
      {trailing ? <View className="pr-4 justify-center">{trailing}</View> : null}
      {suffix ? (
        <View className="px-4 bg-sunken border-l border-line justify-center">
          <Text className="text-body text-ink-2">{suffix}</Text>
        </View>
      ) : null}
    </View>
  );
}

const innerInput = "flex-1 min-w-0 h-full px-4 text-ink";

/** Rupee amount. Shows Indian lakh grouping as you type; `value` stays plain rupees ("275000"). */
export function MoneyInput({ value, onChangeText, invalid, ...rest }: BaseProps & { value: string; onChangeText: (rupees: string) => void }) {
  const p = usePalette();
  const f = useFocus(rest);
  return (
    <Affixed focused={f.focused} invalid={invalid} prefix="₹">
      <TextInput
        placeholderTextColor={p["ink-3"]}
        keyboardType="decimal-pad"
        {...rest}
        value={groupRupeesInput(value)}
        onChangeText={(t) => onChangeText(cleanRupeesInput(t))}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
        style={{ fontFamily: FONT.semibold, fontVariant: ["tabular-nums"] }}
        className={`${innerInput} text-body`}
      />
    </Affixed>
  );
}

/** Indian mobile number: fixed +91, ten digits shown as 5 + 5 for reading aloud. `value` is the 10 digits. */
export function PhoneInput({
  value,
  onChangeText,
  invalid,
  large,
  ...rest
}: BaseProps & { value: string; onChangeText: (digits: string) => void; large?: boolean }) {
  const p = usePalette();
  const f = useFocus(rest);
  const shown = value.length > 5 ? `${value.slice(0, 5)} ${value.slice(5)}` : value;
  return (
    <Affixed focused={f.focused} invalid={invalid} prefix="+91" large={large}>
      <TextInput
        placeholderTextColor={p["ink-3"]}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        {...rest}
        value={shown}
        onChangeText={(t) => {
          let d = t.replace(/\D/g, "");
          if (d.length > 10 && d.startsWith("91")) d = d.slice(-10);
          onChangeText(d.slice(0, 10));
        }}
        maxLength={11}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
        style={{ fontFamily: FONT.regular, fontVariant: ["tabular-nums"], letterSpacing: 0.4 }}
        className={`${innerInput} ${large ? "text-heading" : "text-body"}`}
      />
    </Affixed>
  );
}

/** Six-digit pincode in mono with wide spacing; shows "Found" once the API resolves it. */
export function PincodeInput({
  value,
  onChangeText,
  found,
  invalid,
  editable = true,
  ...rest
}: BaseProps & { value: string; onChangeText?: (digits: string) => void; found?: boolean }) {
  const p = usePalette();
  const f = useFocus(rest);
  return (
    <View
      className={`h-touch-lg px-4 rounded-md ${frame(f.focused, invalid)} ${editable ? "bg-surface" : "bg-sunken"} flex-row items-center gap-3`}
    >
      <TextInput
        placeholderTextColor={p["ink-3"]}
        keyboardType="number-pad"
        textContentType="postalCode"
        autoComplete="postal-code"
        maxLength={6}
        editable={editable}
        {...rest}
        value={value}
        onChangeText={(t) => onChangeText?.(t.replace(/\D/g, "").slice(0, 6))}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
        style={{ fontFamily: FONT.mono, letterSpacing: 6.6 }}
        className="flex-1 min-w-0 h-full text-title text-ink"
      />
      {found ? (
        <View className="flex-row items-center gap-1">
          <Icon name="check" size={16} color="success" />
          <Text className="text-label font-semibold text-success">Found</Text>
        </View>
      ) : !editable ? (
        <Icon name="lock" size={16} color="ink-3" />
      ) : null}
    </View>
  );
}

/** Text box with a unit segment on the right (e.g. %). */
export function SuffixInput({ suffix, invalid, ...rest }: BaseProps & { suffix: string }) {
  const p = usePalette();
  const f = useFocus(rest);
  return (
    <Affixed focused={f.focused} invalid={invalid} suffix={suffix}>
      <TextInput
        placeholderTextColor={p["ink-3"]}
        {...rest}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
        style={{ fontFamily: FONT.regular, fontVariant: ["tabular-nums"] }}
        className={`${innerInput} text-body`}
      />
    </Affixed>
  );
}

/** Text box with a trailing icon (dates). */
export function IconInput({ icon, invalid, ...rest }: BaseProps & { icon: IconName }) {
  const p = usePalette();
  const f = useFocus(rest);
  return (
    <Affixed focused={f.focused} invalid={invalid} trailing={<Icon name={icon} size={20} color="ink-3" />}>
      <TextInput
        placeholderTextColor={p["ink-3"]}
        {...rest}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
        style={{ fontFamily: FONT.regular }}
        className={`${innerInput} text-body`}
      />
    </Affixed>
  );
}

/** − value + for small bounded whole numbers (months, day of month). `value` is the digits as a string. */
export function Stepper({
  value,
  onChange,
  min,
  max,
  invalid,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
  invalid?: boolean;
  label: string;
}) {
  const n = value.trim() === "" ? null : Number(value);
  const set = (next: number) => onChange(String(Math.min(max, Math.max(min, next))));
  const canDec = n === null || n > min;
  const canInc = n === null || n < max;
  const btn = (sign: "−" | "+", enabled: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${sign === "+" ? "Increase" : "Decrease"} ${label}`}
      disabled={!enabled}
      onPress={onPress}
      className="w-11 h-full items-center justify-center active:bg-sunken"
    >
      <Text className={`text-heading ${enabled ? "text-ink-3" : "text-ink-3/40"}`}>{sign}</Text>
    </Pressable>
  );
  return (
    <View
      className={`h-touch rounded-md ${invalid ? "border-2 border-danger" : "border border-line-strong"} bg-surface flex-row items-center overflow-hidden`}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: n ?? undefined }}
    >
      {btn("−", canDec, () => set(n === null ? min : n - 1))}
      <Text className="flex-1 text-center text-body font-semibold text-ink tabular">{n === null ? "–" : n}</Text>
      {btn("+", canInc, () => set(n === null ? min : n + 1))}
    </View>
  );
}

/**
 * OTP entry: one hidden TextInput (so SMS autofill and paste work) under display-only boxes.
 * `error` paints every box red for a wrong code.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  error,
  size = "md",
  autoFocus,
  editable = true,
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  error?: boolean;
  size?: "md" | "lg";
  autoFocus?: boolean;
  editable?: boolean;
}) {
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const box = size === "lg" ? "w-[52px] h-[60px]" : "w-[46px] h-14";
  const cursorAt = Math.min(value.length, length - 1);
  return (
    <Pressable onPress={() => ref.current?.focus()} accessible={false} className="relative">
      <View className="flex-row gap-2 justify-between">
        {Array.from({ length }, (_, i) => {
          const digit = value[i];
          const active = focused && !error && i === cursorAt && value.length < length;
          const cls = error
            ? "border-2 border-danger bg-danger-soft"
            : active
              ? "border-2 border-primary bg-surface"
              : digit
                ? "border border-line-strong bg-surface"
                : "border border-line-strong bg-sunken";
          return (
            <View key={i} className={`${box} rounded-md items-center justify-center ${cls}`}>
              {digit ? (
                <Text className="text-title font-semibold text-ink tabular">{digit}</Text>
              ) : active ? (
                <View className={`w-0.5 ${size === "lg" ? "h-7" : "h-6"} bg-primary`} />
              ) : null}
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, "").slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus={autoFocus}
        editable={editable}
        caretHidden
        accessibilityLabel={`${length}-digit code`}
        // Transparent but laid over the boxes, so a tap anywhere focuses it.
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.02, color: "transparent" }}
      />
    </Pressable>
  );
}
