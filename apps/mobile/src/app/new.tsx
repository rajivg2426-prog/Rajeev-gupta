import { router } from "expo-router";
import { useState } from "react";
import { isApiError } from "../api/client";
import { usePincode, useCreateAgreement } from "../api/queries";
import { Field, PincodeInput } from "../components/inputs";
import { PincodeSummary, SroPicker } from "../components/SroPicker";
import { BottomBar, Button, EmptyState, ErrorNotice, Heading, Loading, Notice, Screen, StepHeader } from "../components/ui";
import { useDraft } from "../state/draft";

/** Creating a draft needs a pincode, so Home starts here (step 1, Property). */
export default function NewAgreement() {
  const setDraftId = useDraft((s) => s.setDraftId);
  const [pincode, setPincode] = useState("");
  const [sroCode, setSroCode] = useState("");
  const lookup = usePincode(pincode);
  const create = useCreateAgreement();

  const r = lookup.data && lookup.data.pincode === pincode ? lookup.data : undefined;
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

  const notSupported = isApiError(create.error, "STATE_NOT_SUPPORTED") || isApiError(lookup.error, "STATE_NOT_SUPPORTED");
  const reset = () => {
    setPincode("");
    setSroCode("");
    create.reset();
  };

  return (
    <Screen
      header={<StepHeader step={1} label="Property" exit={false} />}
      footer={
        <BottomBar>
          <Button title="Continue" busyLabel="Starting…" onPress={onCreate} disabled={!canCreate} busy={create.isPending} />
        </BottomBar>
      }
    >
      <Heading title="Where is the property?" body="The pincode decides the state, the stamp duty and the government office." />
      <Field label="Property pincode">
        <PincodeInput
          value={pincode}
          onChangeText={(t) => {
            setPincode(t);
            setSroCode("");
            create.reset();
          }}
          found={!!r}
          invalid={lookup.isError}
          placeholder="110001"
          autoFocus
        />
      </Field>
      {lookup.isFetching && !r ? <Loading label="Looking up pincode…" /> : null}
      {notSupported ? (
        <EmptyState
          icon="pin"
          tone="warn"
          title="This state isn't covered yet"
          body={(create.error ?? lookup.error) instanceof Error ? (create.error ?? lookup.error)!.message : undefined}
          action={<Button variant="secondary" size="md" title="Change pincode" onPress={reset} />}
        />
      ) : lookup.isError ? (
        <ErrorNotice error={lookup.error} action={<Button variant="secondary" size="sm" className="self-start" title="Try again" onPress={() => lookup.refetch()} />} />
      ) : null}
      {r ? <PincodeSummary r={r} /> : null}
      {r && needsSro ? <SroPicker r={r} value={sroCode} onChange={setSroCode} /> : null}
      {r ? <Notice tone="neutral">The state can't be changed after this step. To use another pincode, start a new agreement.</Notice> : null}
      {!notSupported ? <ErrorNotice error={create.error} /> : null}
    </Screen>
  );
}
