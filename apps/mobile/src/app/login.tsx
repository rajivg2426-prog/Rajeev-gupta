import { zodResolver } from "@hookform/resolvers/zod";
import { router } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { DEV_USER_ID } from "../api/config";
import { Button, Field, Input, Muted, Screen, Title } from "../components/ui";
import { useSession } from "../state/session";

const phoneSchema = z.object({ phone: z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number") });
const otpSchema = z.object({ otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit OTP") });

// TODO(auth): call POST /v1/auth/otp and /v1/auth/verify once the Auth module exists, and
// keep the refresh token in expo-secure-store. For now any OTP signs in as the dev user.
export default function Login() {
  const signIn = useSession((s) => s.signIn);
  const [phone, setPhone] = useState<string | null>(null);

  const phoneForm = useForm({ resolver: zodResolver(phoneSchema), defaultValues: { phone: "" } });
  const otpForm = useForm({ resolver: zodResolver(otpSchema), defaultValues: { otp: "" } });

  return (
    <Screen>
      <Title>Sign in</Title>
      <Muted>Development build: OTP is not checked yet; you sign in as "{DEV_USER_ID}".</Muted>
      {phone === null ? (
        <>
          <Controller
            control={phoneForm.control}
            name="phone"
            render={({ field, fieldState }) => (
              <Field label="Mobile number" error={fieldState.error?.message}>
                <Input value={field.value} onChangeText={field.onChange} keyboardType="phone-pad" maxLength={10} placeholder="98XXXXXXXX" invalid={!!fieldState.error} />
              </Field>
            )}
          />
          <Button title="Send OTP" onPress={phoneForm.handleSubmit((v) => setPhone(v.phone))} />
        </>
      ) : (
        <>
          <Muted>OTP sent to +91 {phone}</Muted>
          <Controller
            control={otpForm.control}
            name="otp"
            render={({ field, fieldState }) => (
              <Field label="OTP" error={fieldState.error?.message}>
                <Input
                  value={field.value}
                  onChangeText={field.onChange}
                  keyboardType="number-pad"
                  maxLength={6}
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  invalid={!!fieldState.error}
                />
              </Field>
            )}
          />
          <Button
            title="Verify and continue"
            onPress={otpForm.handleSubmit(() => {
              signIn(DEV_USER_ID, `+91${phone}`);
              router.replace("/");
            })}
          />
          <Button variant="link" title="Change number" onPress={() => setPhone(null)} />
        </>
      )}
    </Screen>
  );
}
