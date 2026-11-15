import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { isApiError } from "../../../api/client";
import { useAgreement, useSendOtp, useUpdatePartyPhone, useVerifyOtp } from "../../../api/queries";
import type { OtpChannel, OtpSent, Party } from "../../../api/types";
import { formatPhone } from "../../../components/describe";
import { Field, OtpInput, PhoneInput } from "../../../components/inputs";
import {
  Avatar,
  BottomBar,
  Button,
  Card,
  Chip,
  ErrorNotice,
  ErrorState,
  Heading,
  Icon,
  Loading,
  Notice,
  Screen,
  Segmented,
  StepHeader,
  Text,
  TextLink,
} from "../../../components/ui";

const CHANNELS: { value: OtpChannel; label: string; icon: "sms" | "message" }[] = [
  { value: "SMS", label: "SMS", icon: "sms" },
  { value: "WHATSAPP", label: "WhatsApp", icon: "message" },
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

const firstName = (p: Party) => p.fullName.split(" ")[0] ?? p.fullName;

function VerifiedCard({ party }: { party: Party }) {
  return (
    <Card>
      <View className="flex-row items-center gap-3">
        <Avatar name={party.fullName} />
        <View className="flex-1 min-w-0">
          <Text className="text-body font-semibold text-ink">{party.fullName}</Text>
          <Text className="text-label text-ink-2 tabular">{formatPhone(party.phoneE164)}</Text>
        </View>
        <Chip tone="success" label="Verified" />
      </View>
    </Card>
  );
}

/** The tenant being verified now (a hook: returns the screen body and its bottom bar). */
function useActiveTenant({ id, party, onDone }: { id: string; party: Party; onDone: () => void }) {
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
  const name = firstName(party);

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
  const doVerify = () => sent && verify.mutate({ verificationId: sent.verificationId, otp }, { onSuccess: onDone });

  const attemptsLeft = isApiError(verify.error) ? (verify.error.details?.attemptsLeft as number | undefined) : undefined;
  const wrongCode = isApiError(verify.error, "INVALID_OTP");
  const mmss = `${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}`;

  const body = (
    <>
      <Heading
        title="Verify the tenant's phone"
        body={sent ? `We've sent ${name} a 6-digit code. Ask them to read it out to you, then type it below.` : `We'll send ${name} a 6-digit code. Ask them to read it out to you.`}
      />
      <Card hero className="gap-5">
        <View className="flex-row items-center gap-3">
          <Avatar name={party.fullName} />
          <View className="flex-1 min-w-0">
            <Text className="text-body font-semibold text-ink">{party.fullName}</Text>
            <Text className="text-label text-ink-2 tabular">{formatPhone(party.phoneE164)}</Text>
          </View>
          <Chip tone="warn" label="Waiting" />
        </View>

        {editPhone ? (
          <View className="gap-3">
            <Field label={`${name}'s mobile number`} hint="Changing the number means sending a new code.">
              <PhoneInput value={phone} onChangeText={setPhone} />
            </Field>
            <ErrorNotice error={updatePhone.error} />
            <View className="flex-row gap-2">
              <Button
                className="flex-1"
                size="md"
                variant="secondary"
                title="Save number"
                busy={updatePhone.isPending}
                busyLabel="Saving…"
                disabled={phone.length !== 10}
                onPress={() =>
                  updatePhone.mutate(
                    { partyId: party.id, phoneE164: `+91${phone}` },
                    {
                      onSuccess: () => {
                        setEditPhone(false);
                        setSent(null);
                        setResendAt(null);
                      },
                    },
                  )
                }
              />
              <Button className="flex-1" size="md" variant="text" title="Cancel" onPress={() => setEditPhone(false)} />
            </View>
          </View>
        ) : (
          <>
            <Field label="Send code by">
              <Segmented options={CHANNELS} value={channel} onChange={setChannel} />
            </Field>
            {sent ? (
              <Field label={`Code ${name} reads out`}>
                <OtpInput value={otp} onChange={(v) => (verify.reset(), setOtp(v))} error={wrongCode} autoFocus />
                {wrongCode ? (
                  <Text className="text-caption text-danger">
                    That code doesn't match.{attemptsLeft !== undefined ? ` ${attemptsLeft} ${attemptsLeft === 1 ? "try" : "tries"} left.` : ""}
                  </Text>
                ) : null}
                <View className="flex-row items-center justify-between pt-1">
                  {wait > 0 ? (
                    <View className="flex-row items-center gap-1.5">
                      <Icon name="clock" size={16} color="ink-2" />
                      <Text className="text-label text-ink-2">
                        Resend in <Text className="text-label font-medium text-ink tabular">{mmss}</Text>
                      </Text>
                    </View>
                  ) : (
                    <TextLink title="Resend code" onPress={doSend} />
                  )}
                  <TextLink title="Wrong number?" onPress={() => setEditPhone(true)} />
                </View>
              </Field>
            ) : (
              <TextLink title="Wrong number?" onPress={() => setEditPhone(true)} />
            )}
          </>
        )}
      </Card>
      <ErrorNotice error={send.error} />
      {verify.error && !wrongCode ? <ErrorNotice error={verify.error} /> : null}
      <Notice tone="neutral" icon="shield">
        {`By sharing the code, ${name} agrees to be named in this agreement. The code confirms they use this phone number. It is not an identity check.`}
      </Notice>
    </>
  );

  const footer = (
    <BottomBar>
      {sent ? (
        <Button title="Verify" disabled={otp.length !== 6 || editPhone} busy={verify.isPending} busyLabel="Checking…" onPress={doVerify} />
      ) : (
        <Button title="Send code" disabled={editPhone} busy={send.isPending} busyLabel="Sending code…" onPress={doSend} />
      )}
    </BottomBar>
  );
  return { body, footer };
}

function ActiveTenantScreen({ id, party, verified, header }: { id: string; party: Party; verified: Party[]; header: React.ReactNode }) {
  const { body, footer } = useActiveTenant({ id, party, onDone: () => undefined });
  return (
    <Screen header={header} footer={footer}>
      {verified.map((p) => (
        <VerifiedCard key={p.id} party={p} />
      ))}
      {body}
    </Screen>
  );
}

export default function Verify() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const agreement = useAgreement(id);
  const header = <StepHeader step={4} label="Verify tenant" />;

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

  const toVerify = agreement.data.parties.filter((p) => p.otpRequired);
  const verified = toVerify.filter((p) => p.isVerified);
  const next = toVerify.find((p) => !p.isVerified);

  // Verify one tenant at a time; the agreement refetches after each success.
  if (next) return <ActiveTenantScreen key={next.id} id={id} party={next} verified={verified} header={header} />;

  return (
    <Screen
      header={header}
      footer={
        <BottomBar>
          <Button title="Continue to preview" onPress={() => router.push(`/agreement/${id}/preview`)} />
        </BottomBar>
      }
    >
      <Heading title={toVerify.length ? "Tenants verified" : "No tenant to verify"} body={toVerify.length ? "Every tenant has confirmed their phone number." : undefined} />
      {verified.map((p) => (
        <VerifiedCard key={p.id} party={p} />
      ))}
    </Screen>
  );
}
