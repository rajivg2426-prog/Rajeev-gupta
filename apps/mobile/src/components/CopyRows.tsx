import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "./Icon";
import { Text } from "./Text";

export interface CopyItem {
  key: string;
  label: string;
  /** Copied exactly as given (the portal-ready value from the API). */
  value: string;
  /** What to show, when it differs from what is copied (e.g. "₹4,875" for "4875"). */
  display?: string;
  emphasis?: boolean;
}

const FLASH_MS = 2000;

/**
 * Copy-to-clipboard rows. Tapping copies the value exactly; the row turns green with
 * "Copied" for 2 seconds, and the last copied row keeps a small tick so people can
 * track where they are on the portal form.
 */
export function CopyRows({ items }: { items: CopyItem[] }) {
  const [flash, setFlash] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = async (item: CopyItem) => {
    await Clipboard.setStringAsync(item.value);
    setFlash(item.key);
    setLast(item.key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), FLASH_MS);
  };

  return (
    <View className="rounded-lg bg-surface border border-line overflow-hidden">
      {items.map((item, i) => {
        const on = flash === item.key;
        const done = !on && last === item.key;
        return (
          <View
            key={item.key}
            className={`flex-row items-center gap-3 px-4 py-3 ${i < items.length - 1 ? "border-b border-line" : ""} ${on ? "bg-success-soft" : ""}`}
          >
            <View className="flex-1 min-w-0">
              <View className="flex-row items-center gap-1">
                {done ? <Icon name="check" size={12} color="success" strokeWidth={3} /> : null}
                <Text className="text-caption text-ink-3">{item.label}</Text>
              </View>
              <Text selectable className={`text-body text-ink ${item.emphasis ? "font-semibold tabular" : ""}`}>
                {item.display ?? item.value}
              </Text>
            </View>
            {on ? (
              <View className="h-10 px-3 rounded-md flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
                <Icon name="check" size={16} color="success" />
                <Text className="text-label font-semibold text-success">Copied</Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Copy ${item.label}`}
                onPress={() => copy(item)}
                className="h-10 px-3 rounded-md border border-line flex-row items-center gap-1.5 active:bg-sunken"
              >
                <Icon name="copy" size={16} color="primary" />
                <Text className="text-label font-semibold text-primary">Copy</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}
