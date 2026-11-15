import { View } from "react-native";
import type { AreaType, PincodeResolution } from "../api/types";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { RadioCard } from "./ui";

const AREA: Record<AreaType, string> = {
  ANY: "",
  URBAN: "Urban area",
  RURAL: "Rural area",
  METRO: "Metro area",
  MUNICIPAL_CORPORATION: "Municipal corporation",
  MUNICIPAL_COUNCIL: "Municipal council",
  PANCHAYAT: "Panchayat area",
};

/** Where the pincode is: district and state, area type, post offices. */
export function PincodeSummary({ r }: { r: PincodeResolution }) {
  const district = r.districts.map((d) => d.name).join(", ");
  const detail = [AREA[r.areaType], r.postOffices.length ? `Post office: ${r.postOffices.slice(0, 2).join(", ")}` : ""].filter(Boolean).join(" · ");
  return (
    <View className="rounded-lg bg-surface border border-line p-4 flex-row gap-3">
      <View className="w-10 h-10 rounded-full bg-primary-soft items-center justify-center">
        <Icon name="pin" size={20} color="primary" />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-body font-semibold text-ink">{district ? `${district}, ${r.stateName}` : r.stateName}</Text>
        {detail ? <Text className="text-label text-ink-2">{detail}</Text> : null}
      </View>
    </View>
  );
}

/** Lets the user pick a Sub-Registrar Office when the API is not confident enough. */
export function SroPicker({ r, value, onChange }: { r: PincodeResolution; value: string; onChange: (code: string) => void }) {
  const n = r.sroCandidates.length;
  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text className="text-heading font-semibold text-ink">Which Sub-Registrar Office?</Text>
        <Text className="text-label text-ink-2">
          {n > 1 ? `${n === 2 ? "Two" : n} offices serve ${r.pincode}. Pick the one for your property. ` : ""}
          Your property tax bill or society office usually names it.
        </Text>
      </View>
      {r.sroCandidates.map((c) => (
        <RadioCard
          key={c.code}
          selected={c.code === value}
          title={c.name}
          subtitle={c.isPrimary ? "Most addresses in this pincode" : "Some addresses in this pincode"}
          onPress={() => onChange(c.code)}
        />
      ))}
    </View>
  );
}
