import { zodResolver } from "@hookform/resolvers/zod";
import { router, useLocalSearchParams } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { isApiError } from "../../../api/client";
import { useSetCertificate } from "../../../api/queries";
import { Field, TextField } from "../../../components/inputs";
import { BottomBar, Button, Caption, ErrorNotice, Heading, Notice, Screen, StepHeader } from "../../../components/ui";

// The state-specific format check happens on the server (400 INVALID_CERTIFICATE).
const schema = z.object({
  certificateNo: z
    .string()
    .trim()
    .min(6, "Enter the certificate number printed on the e-stamp")
    .max(40, "That looks too long")
    .transform((s) => s.toUpperCase().replace(/\s+/g, "")),
});

export default function Certificate() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const save = useSetCertificate(id);
  const { control, handleSubmit } = useForm({ resolver: zodResolver(schema), defaultValues: { certificateNo: "" } });
  const formatError = isApiError(save.error, "INVALID_CERTIFICATE") ? save.error : null;
  const example = formatError?.details?.example as string | undefined;

  const submit = handleSubmit((v) => save.mutate(v.certificateNo, { onSuccess: () => router.push(`/agreement/${id}/done`) }));

  return (
    <Screen
      header={<StepHeader step={6} label="E-stamp" />}
      footer={
        <BottomBar>
          <Button title="Add and make final PDF" busy={save.isPending} busyLabel="Saving…" onPress={() => void submit()} />
          <Button variant="text" title="Skip, download without it" onPress={() => router.push(`/agreement/${id}/done`)} />
          <Caption className="text-center">
            Without a number, each page says "Attach the e-stamp certificate before signing." You can add it later.
          </Caption>
        </BottomBar>
      }
    >
      <Heading title="Add the certificate number" body="We print it in the footer of every page, so the agreement and the e-stamp stay together." />
      <Controller
        control={control}
        name="certificateNo"
        render={({ field, fieldState }) => (
          <Field
            label="E-stamp certificate number"
            hint="Printed as Certificate No. near the top of the e-stamp."
            error={fieldState.error?.message ?? (formatError ? `${formatError.message}${example ? `, for example ${example}` : ""}.` : undefined)}
          >
            <TextField
              value={field.value}
              onChangeText={(t) => {
                if (save.error) save.reset();
                field.onChange(t);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              invalid={!!fieldState.error || !!formatError}
              className="font-mono"
            />
          </Field>
        )}
      />
      {!formatError ? <ErrorNotice error={save.error} /> : null}
      <Notice tone="info" icon="shield">
        We only check the number's format. We can't confirm your purchase. Check the certificate on the official portal before you sign.
      </Notice>
    </Screen>
  );
}
