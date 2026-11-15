import { zodResolver } from "@hookform/resolvers/zod";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { useForm, useWatch, type Path } from "react-hook-form";
import { View } from "react-native";
import { useAgreement, useSaveForm, useTemplate } from "../../../api/queries";
import type { FormData, TemplateSection } from "../../../api/types";
import { TemplateFieldInput } from "../../../components/TemplateFieldInput";
import { BottomBar, Button, ErrorNotice, ErrorState, Loading, Notice, Screen, StepHeader, Text } from "../../../components/ui";
import { apiFromRaw, isVisible, rawFromApi, sectionsSchema, type RawForm } from "../../../forms/templateForm";

function DetailsForm({ id, sections, initial }: { id: string; sections: TemplateSection[]; initial: FormData }) {
  const schema = useMemo(() => sectionsSchema(sections), [sections]);
  const defaults = useMemo(() => rawFromApi(sections, initial), [sections, initial]);
  const { control, handleSubmit, setError } = useForm<RawForm>({ resolver: zodResolver(schema), defaultValues: defaults });
  const values = useWatch({ control }) as RawForm;
  const save = useSaveForm(id);

  const onSubmit = handleSubmit((raw) =>
    save.mutate(apiFromRaw(sections, raw, initial), {
      onSuccess: ({ errors }) => {
        if (errors.length === 0) return router.push(`/agreement/${id}/parties`);
        // Server paths are "section.field", the same shape as the form names.
        errors.forEach((e) => setError(e.path as Path<RawForm>, { type: "server", message: e.message }));
      },
    }),
  );

  const fieldErrors = save.data?.errors.length ?? 0;
  return (
    <Screen
      header={<StepHeader step={2} label="Details" />}
      contentClassName="gap-8"
      footer={
        <BottomBar>
          <Button title="Continue" busy={save.isPending} busyLabel="Saving…" onPress={() => void onSubmit()} />
        </BottomBar>
      }
    >
      <Text className="text-title font-semibold text-ink">Agreement details</Text>
      {sections
        .filter((s) => isVisible(s.showIf, values))
        .map((s) => (
          <View key={s.id} className="gap-5">
            <Text className="text-heading font-semibold text-ink">{s.title}</Text>
            {s.fields
              .filter((f) => isVisible(f.showIf, values) && f.type !== "pincode")
              .map((f) => (
                <TemplateFieldInput<RawForm> key={f.id} field={f} name={`${s.id}.${f.id}` as Path<RawForm>} control={control} />
              ))}
          </View>
        ))}
      {fieldErrors > 0 ? (
        <Notice tone="danger">{`Please fix ${fieldErrors} field${fieldErrors > 1 ? "s" : ""} above.`}</Notice>
      ) : null}
      <ErrorNotice error={save.error} />
    </Screen>
  );
}

export default function Details() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const template = useTemplate();
  const agreement = useAgreement(id);

  const header = <StepHeader step={2} label="Details" />;
  if (template.isPending || agreement.isPending)
    return (
      <Screen header={header}>
        <Loading />
      </Screen>
    );
  if (template.isError || agreement.isError)
    return (
      <Screen header={header}>
        <ErrorState
          error={template.error ?? agreement.error}
          onRetry={() => {
            void template.refetch();
            void agreement.refetch();
          }}
        />
      </Screen>
    );

  const doc = agreement.data.document;
  // The pincode is fixed on the document (chosen on the Property step), so it is not edited here.
  const initial: FormData = { ...doc.formData, property: { ...(doc.formData?.property ?? {}), pincode: doc.propertyPincode } };
  return <DetailsForm id={id} sections={template.data.sections} initial={initial} />;
}
