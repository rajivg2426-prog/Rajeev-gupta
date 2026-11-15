import { zodResolver } from "@hookform/resolvers/zod";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { useForm, useWatch, type Path } from "react-hook-form";
import { Text, View } from "react-native";
import { useAgreement, useSaveForm, useTemplate } from "../../../api/queries";
import type { FormData, TemplateSection } from "../../../api/types";
import { TemplateFieldInput } from "../../../components/TemplateFieldInput";
import { Button, ErrorBox, Loading, Muted, Screen, StepHeader } from "../../../components/ui";
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

  return (
    <>
      {sections
        .filter((s) => isVisible(s.showIf, values))
        .map((s) => (
          <View key={s.id} className="gap-3">
            <Text className="text-body font-bold text-ink">{s.title}</Text>
            {s.fields
              .filter((f) => isVisible(f.showIf, values))
              .map((f) => (
                <TemplateFieldInput<RawForm>
                  key={f.id}
                  field={f}
                  name={`${s.id}.${f.id}` as Path<RawForm>}
                  control={control}
                  readOnly={f.type === "pincode"}
                />
              ))}
          </View>
        ))}
      {save.data && save.data.errors.length > 0 ? (
        <Text className="text-danger">Please fix {save.data.errors.length} field(s) above.</Text>
      ) : null}
      <ErrorBox error={save.error} />
      <Button title="Save and continue" onPress={onSubmit} loading={save.isPending} />
    </>
  );
}

export default function Details() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const template = useTemplate();
  const agreement = useAgreement(id);

  if (template.isPending || agreement.isPending) return <Loading />;
  if (template.isError) return <ErrorBox error={template.error} onRetry={() => template.refetch()} />;
  if (agreement.isError) return <ErrorBox error={agreement.error} onRetry={() => agreement.refetch()} />;

  const doc = agreement.data.document;
  // The pincode is fixed on the document; show it in the form read-only.
  const initial: FormData = { ...doc.formData, property: { ...(doc.formData?.property ?? {}), pincode: doc.propertyPincode } };

  return (
    <Screen>
      <StepHeader step={2} title="Agreement details" />
      <Muted>Amounts are in rupees. Fields marked * are required.</Muted>
      <DetailsForm id={id} sections={template.data.sections} initial={initial} />
    </Screen>
  );
}
