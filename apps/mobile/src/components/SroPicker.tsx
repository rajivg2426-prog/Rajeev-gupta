import { Text, View } from "react-native";
import type { PincodeResolution } from "../api/types";
import { Choice } from "./ui";

export function PincodeSummary({ r }: { r: PincodeResolution }) {
  return (
    <View className="gap-1">
      <Text className="text-body text-ink">
        {r.stateName} · {r.districts.map((d) => d.name).join(", ") || "District unknown"}
      </Text>
      {r.postOffices.length ? <Text className="text-caption text-ink-muted">{r.postOffices.slice(0, 3).join(", ")}</Text> : null}
    </View>
  );
}

/** Lets the user pick a Sub-Registrar Office when the API is not confident enough. */
export function SroPicker({ r, value, onChange }: { r: PincodeResolution; value: string; onChange: (code: string) => void }) {
  const options = r.sroCandidates.map((c) => ({
    value: c.code,
    label: `${c.name}${c.isPrimary ? " (usual)" : ""} · ${Math.round(c.confidence)}%`,
  }));
  return (
    <View className="gap-2">
      <Text className="text-body font-medium text-ink">Which Sub-Registrar Office covers this property?</Text>
      <Choice options={options} value={value} onChange={onChange} />
    </View>
  );
}
