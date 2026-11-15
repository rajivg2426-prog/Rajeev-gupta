import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useAgreement, usePincode, useSetSro } from "../../../api/queries";
import { PincodeSummary, SroPicker } from "../../../components/SroPicker";
import { Button, ErrorBox, Loading, Muted, Screen, StepHeader } from "../../../components/ui";

export default function Property() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const agreement = useAgreement(id);
  const pincode = agreement.data?.document.propertyPincode ?? "";
  const lookup = usePincode(pincode);
  const setSro = useSetSro(id);
  const [sroCode, setSroCode] = useState("");

  if (agreement.isPending) return <Loading />;
  if (agreement.isError) return <ErrorBox error={agreement.error} onRetry={() => agreement.refetch()} />;

  const r = lookup.data;
  const chosen = sroCode || r?.autoSelectedSroCode || "";
  const next = () => router.push(`/agreement/${id}/details`);

  return (
    <Screen>
      <StepHeader step={1} title="Property" />
      <Muted>Pincode {pincode || "–"}</Muted>
      {lookup.isPending && pincode ? <Loading label="Looking up pincode…" /> : null}
      <ErrorBox error={lookup.error} onRetry={() => lookup.refetch()} />
      {r ? <PincodeSummary r={r} /> : null}
      {r && r.sroCandidates.length > 0 ? <SroPicker r={r} value={chosen} onChange={setSroCode} /> : null}
      <ErrorBox error={setSro.error} />
      <Button
        title="Confirm and continue"
        disabled={!chosen}
        loading={setSro.isPending}
        onPress={() => setSro.mutate(chosen, { onSuccess: next })}
      />
      {r && !r.needsUserConfirmation ? <Button variant="link" title="Skip" onPress={next} /> : null}
    </Screen>
  );
}
