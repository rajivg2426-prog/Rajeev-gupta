import { zodResolver } from "@hookform/resolvers/zod";
import { router, useLocalSearchParams } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { useSetCertificate } from "../../../api/queries";
import { Button, ErrorBox, Field, Input, Muted, Screen, StepHeader } from "../../../components/ui";

// The state-specific format check happens on the server (400 INVALID_CERTIFICATE).
const schema = z.object({
  certificateNo: z
    .string()
    .trim()
    .min(6, "Enter the certificate number printed on the e-stamp")
    .max(40, "That looks too long")
    .transform((s) => s.toUpperCase()),
});

export default function Certificate() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const save = useSetCertificate(id);
  const { control, handleSubmit } = useForm({ resolver: zodResolver(schema), defaultValues: { certificateNo: "" } });

  return (
    <Screen>
      <StepHeader step={6} title="Add certificate" />
      <Muted>
        Enter the e-stamp certificate number (for example IN-DL12345678901234A). It is printed on every page. LegalKart does not
        verify the certificate; check it on the official portal.
      </Muted>
      <Controller
        control={control}
        name="certificateNo"
        render={({ field, fieldState }) => (
          <Field label="Certificate number" error={fieldState.error?.message}>
            <Input value={field.value} onChangeText={field.onChange} autoCapitalize="characters" invalid={!!fieldState.error} />
          </Field>
        )}
      />
      <ErrorBox error={save.error} />
      <Button
        title="Save and generate"
        loading={save.isPending}
        onPress={handleSubmit((v) => save.mutate(v.certificateNo, { onSuccess: () => router.push(`/agreement/${id}/done`) }))}
      />
      <Button variant="link" title="Skip, download without it" onPress={() => router.push(`/agreement/${id}/done`)} />
    </Screen>
  );
}
