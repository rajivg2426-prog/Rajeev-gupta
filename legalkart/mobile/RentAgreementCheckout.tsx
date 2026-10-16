// LegalKart mobile (React Native + Expo, TypeScript) — reference screens for
// the Rent Agreement flow: tenant OTP verification → duty quote → Razorpay
// payment → e-stamp → download. Talks to the API in ../server.
//
// Illustrative: not compiled in this repo. Dependencies in the real app:
//   @tanstack/react-query, react-native-razorpay, expo-file-system, expo-sharing
import { useMutation, useQuery } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import RazorpayCheckout from "react-native-razorpay";

const API = process.env.EXPO_PUBLIC_API_URL!;
const RAZORPAY_KEY_ID = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID!;

type ApiError = { code: string; message: string; details?: any };

async function api<T>(path: string, init: RequestInit & { token: string }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${init.token}`, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw body as ApiError;
  return body as T;
}

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------
// Party OTP verification card (one per tenant)
// ---------------------------------------------------------------------------
export function PartyOtpCard(props: {
  token: string;
  documentId: string;
  party: { id: string; fullName: string; phoneMasked: string; isVerified: boolean };
  onVerified: () => void;
}) {
  const { token, documentId, party } = props;
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => () => clearInterval(timer.current), []);
  const startCooldown = (s: number) => {
    setCooldown(s);
    clearInterval(timer.current);
    timer.current = setInterval(() => setCooldown((c) => (c <= 1 ? (clearInterval(timer.current), 0) : c - 1)), 1000);
  };

  const send = useMutation({
    mutationFn: (channel: "SMS" | "WHATSAPP") =>
      api<{ verificationId: string; channel: string; expiresAt: string }>(
        `/v1/rent-agreements/${documentId}/parties/${party.id}/otp`,
        { method: "POST", token, body: JSON.stringify({ channel }) },
      ),
    onSuccess: (r) => {
      setVerificationId(r.verificationId);
      setError(null);
      startCooldown(30);
    },
    onError: (e: ApiError) => setError(e.code === "RESEND_TOO_SOON" ? "Please wait a few seconds before resending." : e.message),
  });

  const verify = useMutation({
    mutationFn: () =>
      api<{ pendingPartyIds: string[] }>(`/v1/rent-agreements/${documentId}/verifications/${verificationId}`, {
        method: "POST", token, body: JSON.stringify({ otp: code }),
      }),
    onSuccess: () => props.onVerified(),
    onError: (e: ApiError) => {
      setCode("");
      setError(
        e.code === "INVALID_OTP" ? `Incorrect code. ${e.details?.attemptsLeft} attempt(s) left.`
        : e.code === "LOCKED" || e.code === "EXPIRED" ? "This code can no longer be used. Send a new one."
        : e.message,
      );
      if (e.code === "LOCKED" || e.code === "EXPIRED") setVerificationId(null);
    },
  });

  // Auto-submit when 6 digits are entered (iOS/Android OTP autofill fills it in one go).
  useEffect(() => {
    if (code.length === 6 && verificationId && !verify.isPending) verify.mutate();
  }, [code]);

  if (party.isVerified) {
    return (
      <View style={s.card}>
        <Text style={s.name}>{party.fullName}</Text>
        <Text style={s.ok}>✔ Mobile verified</Text>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <Text style={s.name}>{party.fullName}</Text>
      <Text style={s.muted}>We'll send a 6-digit code to {party.phoneMasked}. Ask the tenant to read it out or enter it on their phone.</Text>
      <Text style={s.consent}>
        By sharing the code, the tenant confirms they are a party to this rent agreement and consents to LegalKart processing their name and mobile number for it.
      </Text>

      {!verificationId ? (
        <View style={s.row}>
          <Btn label="Send via SMS" onPress={() => send.mutate("SMS")} busy={send.isPending} />
          <Btn label="Send via WhatsApp" onPress={() => send.mutate("WHATSAPP")} busy={send.isPending} secondary />
        </View>
      ) : (
        <>
          <TextInput
            style={s.otp}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"   // iOS SMS autofill
            autoComplete="sms-otp"          // Android autofill
            maxLength={6}
            placeholder="••••••"
            accessibilityLabel={`OTP for ${party.fullName}`}
          />
          <View style={s.row}>
            <Btn label="Verify" onPress={() => verify.mutate()} busy={verify.isPending} disabled={code.length !== 6} />
            <Btn label={cooldown ? `Resend in ${cooldown}s` : "Resend"} onPress={() => send.mutate("SMS")} disabled={cooldown > 0} secondary />
          </View>
        </>
      )}
      {error && <Text style={s.err}>{error}</Text>}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Quote → pay → e-stamp → download
// ---------------------------------------------------------------------------
type Quote = {
  quote: { lines: { chargeType: string; amountPaise: number; explanation: string; payableAt: "ESTAMP" | "SRO" }[]; estampAmountPaise: number };
  price: { govtDutyPaise: number; serviceFeePaise: number; vendorFeePaise: number; gstPaise: number; totalPaise: number };
};

export function EStampCheckout(props: { token: string; documentId: string; referenceNo: string; user: { name: string; phone: string } }) {
  const { token, documentId } = props;
  const [stage, setStage] = useState<"quote" | "paying" | "stamping" | "done">("quote");
  const [disclaimerAck, setDisclaimerAck] = useState(false);
  const [files, setFiles] = useState<{ pdf: string | null; docx: string } | null>(null);

  const quote = useQuery({
    queryKey: ["quote", documentId],
    queryFn: () => api<Quote>(`/v1/rent-agreements/${documentId}/quote`, { method: "POST", token }),
    retry: false,
  });

  const pay = async () => {
    try {
      setStage("paying");
      const order = await api<{ orderId: string; amountPaise: number }>(`/v1/rent-agreements/${documentId}/payments`, { method: "POST", token });
      const rz = await RazorpayCheckout.open({
        key: RAZORPAY_KEY_ID,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: "INR",
        name: "LegalKart",
        description: `E-stamp & rent agreement ${props.referenceNo}`,
        prefill: { name: props.user.name, contact: props.user.phone },
        theme: { color: "#1B5E20" },
      });
      setStage("stamping");
      const confirmed = await api<{ eStamp: { status: string; certificateNo: string | null } }>(
        `/v1/rent-agreements/${documentId}/payments/confirm`,
        { method: "POST", token, body: JSON.stringify({ orderId: rz.razorpay_order_id, paymentId: rz.razorpay_payment_id, signature: rz.razorpay_signature }) },
      );
      if (!confirmed.eStamp.certificateNo) {
        // Vendor is async (or ops fallback). Push notification arrives when issued.
        Alert.alert("Payment received", "Your e-stamp is being issued. We'll notify you as soon as it's ready.");
        return;
      }
      const gen = await api<{ files: { pdf: string | null; docx: string } }>(`/v1/rent-agreements/${documentId}/generate`, { method: "POST", token });
      setFiles(gen.files);
      setStage("done");
    } catch (e: any) {
      setStage("quote");
      // Razorpay returns code 0 / 2 when the user closes the sheet.
      if (e?.code === 0 || e?.code === 2) return;
      Alert.alert("Payment not completed", e?.message ?? e?.description ?? "Please try again.");
    }
  };

  const download = async (path: string, ext: "pdf" | "docx") => {
    const target = `${FileSystem.documentDirectory}Rent-Agreement-${props.referenceNo}.${ext}`;
    await FileSystem.downloadAsync(`${API}${path}`, target, { headers: { authorization: `Bearer ${token}` } });
    await Sharing.shareAsync(target);
  };

  if (quote.isLoading) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (quote.error) {
    const e = quote.error as unknown as ApiError;
    return <Text style={s.err}>{e.code === "VERIFICATION_PENDING" ? "Every tenant must verify their mobile number first." : e.message}</Text>;
  }
  const q = quote.data!;

  if (stage === "done" && files) {
    return (
      <View style={s.card}>
        <Text style={s.title}>Your stamped agreement is ready</Text>
        <Text style={s.muted}>Print every page on A4, attach the e-stamp certificate as page 1, and have all parties and witnesses sign in ink.</Text>
        {files.pdf && <Btn label="Download stamped PDF" onPress={() => download(files.pdf!, "pdf")} />}
        <Btn label="Download editable Word (DOCX)" onPress={() => download(files.docx, "docx")} secondary />
      </View>
    );
  }

  return (
    <View style={s.card}>
      <Text style={s.title}>Stamp duty & charges</Text>
      {q.quote.lines.map((l) => (
        <View key={l.chargeType} style={s.line}>
          <Text style={s.lineLabel}>{l.chargeType === "STAMP_DUTY" ? "Stamp duty (e-stamp)" : l.chargeType.replace(/_/g, " ").toLowerCase()}{l.payableAt === "SRO" ? " — paid at Sub-Registrar" : ""}</Text>
          <Text>{inr(l.amountPaise)}</Text>
        </View>
      ))}
      <Text style={s.explain}>{q.quote.lines[0]?.explanation}</Text>
      <View style={s.line}><Text style={s.lineLabel}>Service fee</Text><Text>{inr(q.price.serviceFeePaise)}</Text></View>
      <View style={s.line}><Text style={s.lineLabel}>E-stamp vendor charge</Text><Text>{inr(q.price.vendorFeePaise)}</Text></View>
      <View style={s.line}><Text style={s.lineLabel}>GST (18% on fees)</Text><Text>{inr(q.price.gstPaise)}</Text></View>
      <View style={[s.line, s.total]}><Text style={s.name}>Total</Text><Text style={s.name}>{inr(q.price.totalPaise)}</Text></View>

      <Pressable onPress={() => setDisclaimerAck(!disclaimerAck)} style={s.row} accessibilityRole="checkbox" accessibilityState={{ checked: disclaimerAck }}>
        <Text style={s.check}>{disclaimerAck ? "☑" : "☐"}</Text>
        <Text style={[s.muted, { flex: 1 }]}>
          I understand LegalKart is not a law firm, this is not legal advice, and I should have the agreement reviewed by an advocate before signing.
        </Text>
      </Pressable>

      <Btn
        label={stage === "paying" ? "Opening payment…" : stage === "stamping" ? "Buying e-stamp…" : `Pay ${inr(q.price.totalPaise)} & buy e-stamp`}
        onPress={pay}
        busy={stage !== "quote"}
        disabled={!disclaimerAck}
      />
    </View>
  );
}

function Btn(p: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; secondary?: boolean }) {
  const off = p.disabled || p.busy;
  return (
    <Pressable onPress={p.onPress} disabled={off} style={[s.btn, p.secondary && s.btn2, off && { opacity: 0.5 }]} accessibilityRole="button">
      {p.busy ? <ActivityIndicator color={p.secondary ? "#1B5E20" : "#fff"} /> : <Text style={[s.btnText, p.secondary && { color: "#1B5E20" }]}>{p.label}</Text>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, margin: 16, gap: 10, borderWidth: 1, borderColor: "#e3e3e3" },
  title: { fontSize: 18, fontWeight: "700" },
  name: { fontSize: 16, fontWeight: "600" },
  muted: { color: "#555", lineHeight: 20 },
  consent: { color: "#777", fontSize: 12, lineHeight: 17 },
  ok: { color: "#1B5E20", fontWeight: "600" },
  err: { color: "#B71C1C", margin: 16 },
  row: { flexDirection: "row", gap: 10, alignItems: "center" },
  otp: { fontSize: 28, letterSpacing: 12, textAlign: "center", borderBottomWidth: 2, borderColor: "#1B5E20", paddingVertical: 8 },
  line: { flexDirection: "row", justifyContent: "space-between" },
  lineLabel: { color: "#333", textTransform: "capitalize", flex: 1, paddingRight: 8 },
  explain: { color: "#777", fontSize: 12 },
  total: { borderTopWidth: 1, borderColor: "#ddd", paddingTop: 8 },
  check: { fontSize: 22 },
  btn: { backgroundColor: "#1B5E20", padding: 14, borderRadius: 10, alignItems: "center", flexGrow: 1 },
  btn2: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#1B5E20" },
  btnText: { color: "#fff", fontWeight: "600" },
});
