import { router } from "expo-router";
import { useState } from "react";
import { usePincode, useCreateAgreement } from "../api/queries";
import { PincodeSummary, SroPicker } from "../components/SroPicker";
import { Button, ErrorBox, Field, Input, Loading, Muted, StepHeader, Screen } from "../components/ui";
import { useDraft } from "../state/draft";

/** Creating a draft needs a pincode, so Home starts here. */
export default function NewAgreement() {
  const setDraftId = useDraft((s) => s.setDraftId);
  const [pincode, setPincode] = useState("");
  const [sroCode, setSroCode] = useState("");
  const lookup = usePincode(pincode);
  const create = useCreateAgreement();

  const r = lookup.data;
  const needsSro = !!r?.needsUserConfirmation;
  const canCreate = !!r && (!needsSro || !!sroCode);

  const onCreate = () =>
    create.mutate(
      { pincode, sroCode: needsSro ? sroCode : (r?.autoSelectedSroCode ?? undefined) },
      {
        onSuccess: ({ document, resolution }) => {
          setDraftId(document.id);
          const confirmLater = resolution.needsUserConfirmation && !sroCode;
          router.replace(confirmLater ? `/agreement/${document.id}/property` : `/agreement/${document.id}/details`);
        },
      },
    );

  return (
    <Screen>
      <StepHeader step={1} title="Where is the property?" />
      <Field label="Property pincode" hint="We use it to find the state, Sub-Registrar Office and stamp duty.">
        <Input
          value={pincode}
          onChangeText={(t) => {
            setPincode(t.replace(/\D/g, ""));
            setSroCode("");
          }}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="110001"
        />
      </Field>
      {lookup.isFetching ? <Loading label="Looking up pincode…" /> : null}
      {lookup.isError ? <ErrorBox error={lookup.error} onRetry={() => lookup.refetch()} /> : null}
      {r ? <PincodeSummary r={r} /> : null}
      {r && needsSro ? <SroPicker r={r} value={sroCode} onChange={setSroCode} /> : null}
      {r && !needsSro && r.autoSelectedSroCode ? <Muted>Sub-Registrar Office selected automatically.</Muted> : null}
      <ErrorBox error={create.error} />
      <Button title="Start agreement" onPress={onCreate} disabled={!canCreate} loading={create.isPending} />
    </Screen>
  );
}
