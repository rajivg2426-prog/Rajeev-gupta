// Minimal placeholder primitives. The real design system will replace these;
// screens should only rely on their props, not on how they look.
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { isApiError } from "../api/client";

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView edges={["bottom", "left", "right"]} className="flex-1 bg-surface">
      {scroll ? (
        <ScrollView contentContainerClassName="p-gutter gap-4" keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View className="flex-1 p-gutter gap-4">{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text className="text-title font-bold text-ink">{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text className="text-body text-ink-muted">{children}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  return <View className="rounded-card border border-line bg-surface p-4 gap-2">{children}</View>;
}

type ButtonVariant = "primary" | "secondary" | "link";

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
}) {
  const off = disabled || loading;
  const box =
    variant === "primary"
      ? "bg-brand rounded-card px-4 py-3 items-center"
      : variant === "secondary"
        ? "border border-brand rounded-card px-4 py-3 items-center"
        : "py-2";
  const label = variant === "primary" ? "text-brand-fg font-semibold" : "text-brand font-semibold";
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={off} className={`${box} ${off ? "opacity-50" : ""}`}>
      {loading ? <ActivityIndicator color={variant === "primary" ? "#fff" : undefined} /> : <Text className={label}>{title}</Text>}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-1">
      <Text className="text-body font-medium text-ink">{label}</Text>
      {children}
      {hint ? <Text className="text-caption text-ink-muted">{hint}</Text> : null}
      {error ? <Text className="text-caption text-danger">{error}</Text> : null}
    </View>
  );
}

export function Input(props: TextInputProps & { invalid?: boolean }) {
  const { invalid, className, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor="#9ca3af"
      className={`rounded-card border px-3 py-2 text-body text-ink ${invalid ? "border-danger" : "border-line"} ${className ?? ""}`}
      {...rest}
    />
  );
}

/** Single-choice chips; used for select, radio, role and channel pickers. */
export function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | "" | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            className={`rounded-card border px-3 py-2 ${on ? "border-brand bg-brand" : "border-line"}`}
          >
            <Text className={on ? "text-brand-fg" : "text-ink"}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Checkbox({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      className="flex-row items-center gap-3"
    >
      <View className={`h-5 w-5 rounded border items-center justify-center ${value ? "bg-brand border-brand" : "border-line"}`}>
        {value ? <Text className="text-brand-fg text-caption">✓</Text> : null}
      </View>
      <Text className="flex-1 text-body text-ink">{label}</Text>
    </Pressable>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <View className="items-center gap-2 py-8">
      <ActivityIndicator />
      <Muted>{label}</Muted>
    </View>
  );
}

export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const details = isApiError(error) ? error.detailMessages : [];
  return (
    <View className="rounded-card border border-danger p-3 gap-1">
      <Text className="text-danger font-semibold">{errorMessage(error)}</Text>
      {isApiError(error) ? <Text className="text-caption text-ink-muted">{error.code}</Text> : null}
      {details.map((d) => (
        <Text key={d} className="text-caption text-danger">
          • {d}
        </Text>
      ))}
      {onRetry ? <Button variant="link" title="Try again" onPress={onRetry} /> : null}
    </View>
  );
}

/** Placeholder step indicator for the agreement journey. */
export function StepHeader({ step, total = 7, title }: { step: number; total?: number; title: string }) {
  return (
    <View className="gap-1">
      <Text className="text-caption text-ink-muted">
        Step {step} of {total}
      </Text>
      <Title>{title}</Title>
    </View>
  );
}
