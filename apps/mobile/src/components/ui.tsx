// LegalKart design system primitives (ported from the approved UI design).
// Classes use the token names from src/theme/tokens.js exactly as the design does.
import { router } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isApiError } from "../api/client";
import type { DocumentStatus } from "../api/types";
import { usePalette } from "../theme/palette";
import { documentStatus, type ColorToken, type StatusTone } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

export { Text } from "./Text";
export { Icon, Logo, type IconName } from "./Icon";

// ------------------------------------------------------------------ layout

/**
 * One app screen: canvas background, top safe area, optional header, a scrolling
 * body with the 20px gutter, and an optional bottom bar (where the one primary
 * action lives) that sits above the home indicator and the keyboard.
 */
export function Screen({
  header,
  footer,
  children,
  scroll = true,
  contentClassName = "gap-6",
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  contentClassName?: string;
}) {
  const insets = useSafeAreaInsets();
  const bottomPad = footer ? 32 : 32 + insets.bottom;
  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      {header}
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {scroll ? (
          <ScrollView
            className="flex-1"
            contentContainerClassName={`px-5 pt-3 ${contentClassName}`}
            contentContainerStyle={{ paddingBottom: bottomPad }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View className={`flex-1 px-5 pt-3 ${contentClassName}`} style={{ paddingBottom: footer ? 12 : 12 + insets.bottom }}>
            {children}
          </View>
        )}
        {footer}
      </KeyboardAvoidingView>
    </View>
  );
}

/** Pinned bottom bar: one primary action, optionally a second choice and a caption. */
export function BottomBar({ children, plain }: { children: ReactNode; plain?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className={`px-5 pt-3 gap-2 ${plain ? "" : "border-t border-line bg-surface"}`}
      style={{ paddingBottom: Math.max(20, insets.bottom + 8) }}
    >
      {children}
    </View>
  );
}

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4} className="w-12 h-12 rounded-full items-center justify-center active:bg-sunken">
      <Icon name={icon} size={24} />
    </Pressable>
  );
}

/** Back button row, with optional content on the right (e.g. a reference number). */
export function BackHeader({ onBack = goBack, right, label = "Back" }: { onBack?: () => void; right?: ReactNode; label?: string }) {
  return (
    <View className="h-14 px-2 flex-row items-center justify-between">
      <IconButton icon="chevron-left" label={label} onPress={onBack} />
      {right}
    </View>
  );
}

export const JOURNEY_STEPS = 6;

/** Journey header: back, "Step n of 6 · Label", "Save and exit", progress bar. */
export function StepHeader({
  step,
  label,
  total = JOURNEY_STEPS,
  partial,
  exit = true,
}: {
  step: number;
  label: string;
  total?: number;
  /** The current step is only partly done (shown at half strength). */
  partial?: boolean;
  exit?: boolean;
}) {
  return (
    <View className="px-2 pb-3 gap-2">
      <View className="h-12 flex-row items-center gap-1">
        <IconButton icon="chevron-left" label="Back" onPress={goBack} />
        <Text className="flex-1 text-label font-medium text-ink-2">
          Step {step} of {total} · {label}
        </Text>
        {exit ? (
          <Pressable accessibilityRole="button" onPress={() => router.dismissTo("/")} className="h-12 justify-center px-3">
            <Text className="text-label font-semibold text-primary">Save and exit</Text>
          </Pressable>
        ) : null}
      </View>
      <View className="px-3 flex-row gap-1" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: step }}>
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            className={`flex-1 h-1 rounded-full ${i < step - 1 || (i === step - 1 && !partial) ? "bg-primary" : i === step - 1 ? "bg-primary/50" : "bg-line"}`}
          />
        ))}
      </View>
    </View>
  );
}

/** Screen title with optional supporting line. */
export function Heading({ title, body, size = "title" }: { title: string; body?: ReactNode; size?: "title" | "display" }) {
  return (
    <View className="gap-1">
      <Text className={size === "display" ? "text-display font-bold text-ink" : "text-title font-semibold text-ink"}>{title}</Text>
      {body ? <Text className="text-body text-ink-2">{body}</Text> : null}
    </View>
  );
}

export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Text className={`text-caption uppercase tracking-wider font-semibold text-ink-3 ${className}`}>{children}</Text>;
}

export function Caption({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Text className={`text-caption text-ink-3 ${className}`}>{children}</Text>;
}

// ----------------------------------------------------------------- buttons

type ButtonVariant = "primary" | "secondary" | "text" | "destructive";

export function Button({
  title,
  onPress,
  variant = "primary",
  size,
  busy,
  busyLabel,
  disabled,
  icon,
  iconRight,
  className = "",
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** lg = 56px (bottom-bar actions), md = 48px. */
  size?: "lg" | "md" | "sm";
  busy?: boolean;
  /** Says what is happening while busy, e.g. "Sending code…". */
  busyLabel?: string;
  disabled?: boolean;
  icon?: IconName;
  iconRight?: IconName;
  className?: string;
}) {
  const p = usePalette();
  const off = !!disabled || !!busy;
  const s = size ?? (variant === "primary" || variant === "secondary" ? "lg" : "md");
  const height = s === "lg" ? "h-touch-lg" : s === "md" ? "h-touch" : "h-10";
  const box = {
    primary: `bg-primary active:bg-primary-pressed ${disabled ? "bg-primary/40" : ""}`,
    secondary: `bg-surface border border-line-strong active:bg-sunken ${disabled ? "opacity-50" : ""}`,
    text: `active:bg-sunken ${disabled ? "opacity-50" : ""}`,
    destructive: `border border-danger/40 active:bg-danger-soft ${disabled ? "opacity-50" : ""}`,
  }[variant];
  const tone: ColorToken = { primary: "on-primary", secondary: "ink", text: "primary", destructive: "danger" }[variant] as ColorToken;
  const label = {
    primary: "text-on-primary",
    secondary: "text-ink",
    text: "text-primary",
    destructive: "text-danger",
  }[variant];
  const textSize = s === "sm" ? "text-label" : "text-body";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: !!busy }}
      onPress={onPress}
      disabled={off}
      className={`${height} px-5 rounded-md flex-row items-center justify-center ${busy ? "gap-3" : "gap-2"} ${box} ${className}`}
    >
      {busy ? <ActivityIndicator size="small" color={p[tone]} /> : icon ? <Icon name={icon} size={20} color={tone} /> : null}
      <Text className={`${textSize} font-semibold ${label}`}>{busy && busyLabel ? busyLabel : title}</Text>
      {iconRight && !busy ? <Icon name={iconRight} size={20} color={tone} /> : null}
    </Pressable>
  );
}

/** Dashed "add" button used under party lists. */
export function AddButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="h-touch rounded-md border border-dashed border-line-strong flex-row items-center justify-center gap-2 active:bg-sunken"
    >
      <Icon name="plus" size={20} color="primary" />
      <Text className="text-label font-semibold text-primary">{title}</Text>
    </Pressable>
  );
}

/** Inline text link (e.g. "Change", "Wrong number?"). */
export function TextLink({ title, onPress, className = "" }: { title: string; onPress: () => void; className?: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={8}>
      <Text className={`text-label font-semibold text-primary ${className}`}>{title}</Text>
    </Pressable>
  );
}

// ------------------------------------------------------------ cards, notices

export function Card({ children, className = "", hero }: { children: ReactNode; className?: string; hero?: boolean }) {
  return <View className={`${hero ? "rounded-xl" : "rounded-lg"} bg-surface border border-line p-4 gap-3 ${className}`}>{children}</View>;
}

type NoticeTone = "info" | "warn" | "danger" | "neutral";

const NOTICE: Record<NoticeTone, { box: string; icon: ColorToken; text: string; defaultIcon: IconName }> = {
  info: { box: "bg-info-soft", icon: "info", text: "text-ink", defaultIcon: "info" },
  warn: { box: "bg-warn-soft", icon: "warn", text: "text-ink", defaultIcon: "alert" },
  danger: { box: "bg-danger-soft", icon: "danger", text: "text-ink", defaultIcon: "alert" },
  neutral: { box: "bg-sunken", icon: "ink-3", text: "text-ink-2", defaultIcon: "info" },
};

/** Info (neutral facts), caution (invalid if missed), error (can't continue), neutral (quiet aside). */
export function Notice({ tone = "neutral", icon, children, action }: { tone?: NoticeTone; icon?: IconName; children: ReactNode; action?: ReactNode }) {
  const t = NOTICE[tone];
  return (
    <View className={`rounded-md ${t.box} p-3 gap-3`}>
      <View className="flex-row gap-2.5">
        <Icon name={icon ?? t.defaultIcon} size={20} color={t.icon} />
        <View className="flex-1">{typeof children === "string" ? <Text className={`text-label ${t.text}`}>{children}</Text> : children}</View>
      </View>
      {action}
    </View>
  );
}

// ------------------------------------------------------------------ chips

const CHIP: Record<StatusTone, { box: string; text: string }> = {
  neutral: { box: "bg-sunken", text: "text-ink-2" },
  warn: { box: "bg-warn-soft", text: "text-warn" },
  info: { box: "bg-info-soft", text: "text-info" },
  success: { box: "bg-success-soft", text: "text-success" },
};

/** Each tone has its own mark (hollow dot, dot, diamond, tick) so status reads without colour. */
export function Chip({ tone, label }: { tone: StatusTone; label: string }) {
  const c = CHIP[tone];
  const mark =
    tone === "neutral" ? (
      <View className="w-2 h-2 rounded-full border-2 border-ink-3" />
    ) : tone === "warn" ? (
      <View className="w-2 h-2 rounded-full bg-warn" />
    ) : tone === "info" ? (
      <View className="w-2 h-2 bg-info" style={{ transform: [{ rotate: "45deg" }] }} />
    ) : (
      <Icon name="check" size={14} color="success" />
    );
  return (
    <View className={`self-start flex-row items-center ${tone === "success" ? "gap-1" : "gap-1.5"} px-2 py-0.5 rounded-sm ${c.box}`}>
      {mark}
      <Text className={`text-caption font-semibold ${c.text}`}>{label}</Text>
    </View>
  );
}

export function StatusChip({ status }: { status: DocumentStatus }) {
  const s = documentStatus[status] ?? { label: status, tone: "neutral" as const };
  return <Chip tone={s.tone} label={s.label} />;
}

export function Avatar({ name, tone = "neutral", size = "md" }: { name: string; tone?: "primary" | "neutral"; size?: "md" | "lg" }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase())
      .filter((_, i, a) => i === 0 || i === a.length - 1)
      .join("") || "?";
  const box = size === "lg" ? "w-16 h-16" : "w-10 h-10";
  return (
    <View className={`${box} rounded-full items-center justify-center ${tone === "primary" ? "bg-primary-soft" : "bg-sunken"}`}>
      <Text className={`${size === "lg" ? "text-title" : "text-label"} font-bold ${tone === "primary" ? "text-primary" : "text-ink-2"}`}>{initials}</Text>
    </View>
  );
}

/** Numbered instructions. `soft` = filled teal discs (portal steps), `outline` = grey rings. */
export function NumberedSteps({ steps, variant = "soft" }: { steps: ReactNode[]; variant?: "soft" | "outline" }) {
  return (
    <View className={variant === "soft" ? "gap-2" : "gap-3"}>
      {steps.map((s, i) => (
        <View key={i} className="flex-row gap-3">
          <View
            className={`w-6 h-6 rounded-full items-center justify-center ${variant === "soft" ? "bg-primary-soft" : "border border-line-strong"}`}
          >
            <Text className={`text-caption font-bold ${variant === "soft" ? "text-primary" : "text-ink-2"}`}>{i + 1}</Text>
          </View>
          <View className="flex-1">{typeof s === "string" ? <Text className="text-label text-ink-2">{s}</Text> : s}</View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------- choice controls

/** Single choice as pills (select fields such as Configuration). */
export function PillChoice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | "" | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            className={`h-10 px-4 rounded-full items-center justify-center ${on ? "border-2 border-primary bg-primary-soft" : "border border-line-strong bg-surface"}`}
          >
            <Text className={on ? "text-label font-semibold text-primary" : "text-label font-medium text-ink"}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Segmented control (radio fields, OTP channel). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: IconName }[];
  value: T | "" | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <View className="flex-row p-1 rounded-md bg-sunken gap-1" accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            className={`flex-1 h-10 px-1 rounded-sm flex-row items-center justify-center gap-1.5 ${on ? "bg-surface border border-line" : ""}`}
          >
            {o.icon ? <Icon name={o.icon} size={16} color={on ? "ink" : "ink-2"} /> : null}
            <Text numberOfLines={1} className={on ? "text-label font-semibold text-ink" : "text-label font-medium text-ink-2"}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Large radio card (Sub-Registrar Office choice). */
export function RadioCard({ selected, title, subtitle, onPress }: { selected: boolean; title: string; subtitle?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`rounded-lg bg-surface p-4 flex-row items-start gap-3 ${selected ? "border-2 border-primary" : "border border-line"}`}
    >
      <View className={`w-6 h-6 mt-0.5 rounded-full border-2 items-center justify-center ${selected ? "border-primary" : "border-line-strong"}`}>
        {selected ? <View className="w-3 h-3 rounded-full bg-primary" /> : null}
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-body font-semibold text-ink">{title}</Text>
        {subtitle ? <Text className="text-label text-ink-2">{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

export function Checkbox({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      className="flex-row items-start gap-3 min-h-touch pt-1"
    >
      <View className={`w-6 h-6 rounded-sm items-center justify-center ${value ? "bg-primary" : "border-2 border-line-strong bg-surface"}`}>
        {value ? <Icon name="check" size={16} color="on-primary" /> : null}
      </View>
      <Text className="flex-1 text-body text-ink">{label}</Text>
    </Pressable>
  );
}

/** On/off row with a switch (boolean template fields). */
export function SwitchRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} className="min-h-touch flex-row items-center gap-3">
      <View className="flex-1">
        <Text className="text-body font-medium text-ink">{label}</Text>
        {hint ? <Text className="text-label text-ink-2">{hint}</Text> : null}
      </View>
      <View className={`w-12 h-7 rounded-full p-0.5 flex-row ${value ? "bg-primary justify-end" : "bg-line-strong justify-start"}`}>
        <View className="w-6 h-6 rounded-full bg-surface" />
      </View>
    </Pressable>
  );
}

/** Grouped list rows inside a card (preview edit links, profile details). */
export function RowGroup({ children }: { children: ReactNode }) {
  return <View className="rounded-lg bg-surface border border-line overflow-hidden">{children}</View>;
}

export function Row({
  children,
  onPress,
  last,
  className = "",
}: {
  children: ReactNode;
  onPress?: () => void;
  last?: boolean;
  className?: string;
}) {
  const cls = `min-h-touch px-4 py-3 flex-row items-center gap-3 ${last ? "" : "border-b border-line"} ${className}`;
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} className={`${cls} active:bg-sunken`}>
      {children}
    </Pressable>
  ) : (
    <View className={cls}>{children}</View>
  );
}

// ---------------------------------------------------------------- tab bar

export function TabBar({ active }: { active: "home" | "profile" }) {
  const insets = useSafeAreaInsets();
  const item = (key: "home" | "profile", icon: IconName, label: string, href: "/" | "/profile") => {
    const on = active === key;
    return (
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        onPress={() => (on ? undefined : router.replace(href))}
        className="flex-1 items-center justify-center gap-0.5"
      >
        <Icon name={icon} size={24} color={on ? "primary" : "ink-3"} />
        <Text className={`text-caption ${on ? "font-semibold text-primary" : "font-medium text-ink-3"}`}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View className="border-t border-line bg-surface flex-row pt-2" style={{ paddingBottom: Math.max(12, insets.bottom), minHeight: 60 }} accessibilityRole="tablist">
      {item("home", "home", "Home", "/")}
      {item("profile", "user", "Profile", "/profile")}
    </View>
  );
}

// -------------------------------------------------- loading, empty, errors

export function Loading({ label = "Loading…" }: { label?: string }) {
  const p = usePalette();
  return (
    <View className="items-center gap-3 py-10">
      <ActivityIndicator color={p.primary} />
      <Text className="text-label text-ink-2">{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  tone = "primary",
  title,
  body,
  action,
}: {
  icon: IconName;
  tone?: "primary" | "warn" | "danger";
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const soft = { primary: "bg-primary-soft", warn: "bg-warn-soft", danger: "bg-danger-soft" }[tone];
  return (
    <View className="rounded-lg bg-surface border border-line p-6 items-center gap-3">
      <View className={`w-14 h-14 rounded-full items-center justify-center ${soft}`}>
        <Icon name={icon} size={28} color={tone} />
      </View>
      <Text className="text-heading font-semibold text-ink text-center">{title}</Text>
      {body ? <Text className="text-label text-ink-2 text-center">{body}</Text> : null}
      {action ? <View className="mt-1">{action}</View> : null}
    </View>
  );
}

export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

/** Whole-screen error: network failures get the "Can't reach LegalKart" state. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const network = isApiError(error, "NETWORK");
  const retry = onRetry ? <Button size="md" title="Try again" icon="refresh" onPress={onRetry} /> : undefined;
  if (network) {
    return (
      <EmptyState
        icon="wifi-off"
        tone="danger"
        title="Can't reach LegalKart"
        body="Check your internet connection. Everything you've typed is saved on this phone."
        action={retry}
      />
    );
  }
  return <EmptyState icon="alert" tone="danger" title={errorMessage(error)} body={isApiError(error) ? errorDetails(error).join("\n") || undefined : undefined} action={retry} />;
}

function errorDetails(error: unknown): string[] {
  return isApiError(error) ? error.detailMessages : [];
}

/** Inline error for a failed action; the step can't continue until it is fixed. */
export function ErrorNotice({ error, action }: { error: unknown; action?: ReactNode }) {
  if (!error) return null;
  const details = errorDetails(error);
  return (
    <Notice tone="danger" action={action}>
      <View className="gap-1">
        <Text className="text-label text-ink">{errorMessage(error)}</Text>
        {details.map((d) => (
          <Text key={d} className="text-caption text-ink-2">
            {d}
          </Text>
        ))}
      </View>
    </Notice>
  );
}
