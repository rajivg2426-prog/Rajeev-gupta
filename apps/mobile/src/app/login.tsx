import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { DEV_USER_ID } from "../api/config";
import { Field, OtpInput, PhoneInput } from "../components/inputs";
import { BackHeader, BottomBar, Button, Caption, Icon, Logo, Notice, Screen, Text } from "../components/ui";
import { useSession } from "../state/session";

const PHONE = /^[6-9]\d{9}$/;
const RESEND_SECONDS = 45;

const spaced = (d: string) => `${d.slice(0, 5)} ${d.slice(5)}`;

function useCountdown(until: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// TODO(auth): call POST /v1/auth/otp and /v1/auth/verify once the Auth module exists, and
// keep the refresh token in expo-secure-store. For now any OTP signs in as the dev user.
export default function Login() {
  const signIn = useSession((s) => s.signIn);
  const [digits, setDigits] = useState("");
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [resendAt, setResendAt] = useState<number | null>(null);
  const wait = useCountdown(resendAt);

  const send = () => {
    if (!PHONE.test(digits)) return setPhoneError("Enter a 10-digit Indian mobile number");
    setPhoneError(undefined);
    setSentTo(digits);
    setOtp("");
    setResendAt(Date.now() + RESEND_SECONDS * 1000);
  };

  const logIn = () => {
    signIn(DEV_USER_ID, `+91${sentTo}`);
    router.replace("/");
  };

  if (sentTo === null) {
    return (
      <Screen
        contentClassName="pt-10 gap-8"
        footer={
          <BottomBar plain>
            <Button title="Send code" onPress={send} disabled={digits.length !== 10} />
            <Caption className="text-center">By continuing you agree to the Terms and Privacy notice. Your data is stored in India.</Caption>
          </BottomBar>
        }
      >
        <View className="gap-5">
          <Logo size={56} />
          <View className="gap-2">
            <Text className="text-display font-bold text-ink">Rent agreements, ready to sign</Text>
            <Text className="text-body text-ink-2">
              Fill in the details, verify the tenant, and get the exact e-stamp to buy from your state government.
            </Text>
          </View>
        </View>
        <Field label="Your mobile number" hint="We'll send a 6-digit code by SMS." error={phoneError}>
          <PhoneInput large value={digits} onChangeText={setDigits} invalid={!!phoneError} autoFocus onSubmitEditing={send} />
        </Field>
      </Screen>
    );
  }

  return (
    <Screen
      header={<BackHeader onBack={() => setSentTo(null)} />}
      contentClassName="pt-4 gap-8"
      footer={
        <BottomBar plain>
          <Button title="Log in" onPress={logIn} disabled={otp.length !== 6} />
        </BottomBar>
      }
    >
      <View className="gap-2">
        <Text className="text-title font-semibold text-ink">Enter the code</Text>
        <Text className="text-body text-ink-2">
          Sent by SMS to <Text className="text-body font-medium text-ink tabular">+91 {spaced(sentTo)}</Text>.{" "}
          <Text className="text-body font-semibold text-primary" onPress={() => setSentTo(null)} accessibilityRole="link">
            Change
          </Text>
        </Text>
      </View>
      <View className="gap-3">
        <OtpInput size="lg" value={otp} onChange={setOtp} autoFocus />
        {wait > 0 ? (
          <View className="flex-row items-center gap-1.5">
            <Icon name="clock" size={16} color="ink-3" />
            <Text className="text-label text-ink-2">
              Resend code in <Text className="text-label font-medium text-ink tabular">{mmss(wait)}</Text>
            </Text>
          </View>
        ) : (
          <Button variant="text" size="md" className="self-start px-0" title="Resend code" onPress={send} />
        )}
      </View>
      <Notice tone="neutral">{`Development build: the code is not checked yet. Any 6 digits sign you in as "${DEV_USER_ID}".`}</Notice>
    </Screen>
  );
}
