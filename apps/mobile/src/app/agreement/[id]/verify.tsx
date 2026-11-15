import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { isApiError } from "../../../api/client";
import { useAgreement, useSendOtp, useUpdatePartyPhone, useVerifyOtp } from "../../../api/queries";
import type { OtpChannel, OtpSent, Party } from "../../../api/types";
import { Button, Card, Choice, ErrorBox, Field, Input, Loading, Muted, Screen, StepHeader } from "../../../components/ui";

const CHANNELS: { value: OtpChannel; label: string }[] = [
  { value: "SMS", label: "SMS" },
  { value: "WHATSAPP", label: "WhatsApp" },
];
const RESEND_SECONDS = 30;

function useCountdown(until: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

function OtpCard({ id, party }: { id: string; party: Party }) {
  const [channel, setChannel] = useState<OtpChannel>("SMS");
  const [sent, setSent] = useState<OtpSent | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [otp, setOtp] = useState("");
  const [editPhone, setEditPhone] = useState(false);
  const [phone, setPhone] = useState(party.phoneE164.replace(/^\+91/, ""));
  const wait = useCountdown(resendAt);
  const send = useSendOtp(id);
  const verify = useVerifyOtp(id);
  const updatePhone = useUpdatePartyPhone(id);

  if (party.isVerified) {
    return (
      <Card>
        <Text className="text-body font-bold text-ink">{party.fullName}</Text>
        <Text className="text-success">Verified</Text>
      </Card>
    );
  }

  const doSend = () =>
    send.mutate(
      { partyId: party.id, channel },
      {
        onSuccess: (r) => {
          setSent(r);
          setOtp("");
          verify.reset();
          setResendAt(Date.now() + RESEND_SECONDS * 1000);
        },
      },
    );

  const attemptsLeft = isApiError(verify.error) ? (verify.error.details?.attemptsLeft as number | undefined) : undefined;

  return (
    <Card>
      <Text className="text-body font-bold text-ink">{party.fullName}</Text>
      {editPhone ? (
        <>
          <Field label="Tenant's mobile number">
            <Input value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, ""))} keyboardType="phone-pad" maxLength={10} />
          </Field>
          <ErrorBox error={updatePhone.error} />
          <Button
            variant="secondary"
            title="Save number"
            loading={updatePhone.isPending}
            onPress={() =>
              updatePhone.mutate(
                { partyId: party.id, phoneE164: `+91${phone}` },
                { onSuccess: () => (setEditPhone(false), setSent(null)) },
              )
            }
          />
        </>
      ) : (
        <>
          <Muted>{party.phoneE164}</Muted>
          <Button variant="link" title="Change number" onPress={() => setEditPhone(true)} />
        </>
      )}
      <Choice options={CHANNELS} value={channel} onChange={setChannel} />
      <ErrorBox error={send.error} />
      <Button
        variant={sent ? "secondary" : "primary"}
        title={sent ? (wait > 0 ? `Resend in ${wait}s` : "Resend OTP") : "Send OTP"}
        disabled={wait > 0 || editPhone}
        loading={send.isPending}
        onPress={doSend}
      />
      {sent ? (
        <>
          <Muted>
            Sent by {sent.channel === "WHATSAPP" ? "WhatsApp" : "SMS"} to {sent.phoneMasked}. Ask the tenant for the 6-digit code.
          </Muted>
          <Field label="OTP">
            <Input
              value={otp}
              onChangeText={(t) => setOtp(t.replace(/\D/g, ""))}
              keyboardType="number-pad"
              maxLength={6}
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              invalid={!!verify.error}
            />
          </Field>
          <ErrorBox error={verify.error} />
          {attemptsLeft !== undefined ? <Text className="text-danger">{attemptsLeft} attempt(s) left</Text> : null}
          <Button
            title="Verify"
            disabled={otp.length !== 6}
            loading={verify.isPending}
            onPress={() => verify.mutate({ verificationId: sent.verificationId, otp })}
          />
        </>
      ) : null}
    </Card>
  );
}

export default function Verify() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const agreement = useAgreement(id);

  if (agreement.isPending) return <Loading />;
  if (agreement.isError) return <ErrorBox error={agreement.error} onRetry={() => agreement.refetch()} />;

  const toVerify = agreement.data.parties.filter((p) => p.otpRequired);
  const pending = toVerify.filter((p) => !p.isVerified).length;

  return (
    <Screen>
      <StepHeader step={4} title="Tenant verification" />
      <Muted>Each tenant confirms with a one-time code sent to their phone.</Muted>
      {toVerify.length === 0 ? <Muted>No tenants need verification.</Muted> : null}
      {toVerify.map((p) => (
        <OtpCard key={p.id} id={id} party={p} />
      ))}
      <Button title="Continue to preview" disabled={pending > 0} onPress={() => router.push(`/agreement/${id}/preview`)} />
      <Button variant="link" title="Back to parties" onPress={() => router.push(`/agreement/${id}/parties`)} />
    </Screen>
  );
}
