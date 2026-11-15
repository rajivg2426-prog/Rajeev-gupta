import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useAgreement, usePincode, useSetSro } from "../../../api/queries";
import { Field, PincodeInput } from "../../../components/inputs";
import { PincodeSummary, SroPicker } from "../../../components/SroPicker";
import { BottomBar, Button, ErrorNotice, ErrorState, Heading, Loading, Notice, Screen, StepHeader } from "../../../components/ui";

export default function Property() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const agreement = useAgreement(id);
  const pincode = agreement.data?.document.propertyPincode ?? "";
  const lookup = usePincode(pincode);
  const setSro = useSetSro(id);
  const [sroCode, setSroCode] = useState("");

  const header = <StepHeader step={1} label="Property" />;
  if (agreement.isPending)
    return (
      <Screen header={header}>
        <Loading />
      </Screen>
    );
  if (agreement.isError)
    return (
      <Screen header={header}>
        <ErrorState error={agreement.error} onRetry={() => agreement.refetch()} />
      </Screen>
    );

  const r = lookup.data;
  const chosen = sroCode || r?.autoSelectedSroCode || "";
  const next = () => router.push(`/agreement/${id}/details`);

  return (
    <Screen
      header={header}
      footer={
        <BottomBar>
          <Button title="Continue" busyLabel="Saving…" disabled={!chosen} busy={setSro.isPending} onPress={() => setSro.mutate(chosen, { onSuccess: next })} />
          {r && !r.needsUserConfirmation ? <Button variant="text" title="Skip" onPress={next} /> : null}
        </BottomBar>
      }
    >
      <Heading title="Where is the property?" body="The pincode decides the state, the stamp duty and the government office." />
      <Field label="Property pincode">
        <PincodeInput value={pincode} editable={false} found={!!r} />
      </Field>
      {lookup.isPending && pincode ? <Loading label="Looking up pincode…" /> : null}
      {lookup.isError ? <ErrorState error={lookup.error} onRetry={() => lookup.refetch()} /> : null}
      {r ? <PincodeSummary r={r} /> : null}
      {r && r.sroCandidates.length > 0 ? <SroPicker r={r} value={chosen} onChange={setSroCode} /> : null}
      <Notice tone="neutral">The state can't be changed after this step. To use another pincode, start a new agreement.</Notice>
      <ErrorNotice error={setSro.error} />
    </Screen>
  );
}
