import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { isApiError } from "../../../api/client";
import { formatInr } from "../../../api/money";
import { useAgreement, useCreateStampDetails } from "../../../api/queries";
import type { StampDetails } from "../../../api/types";
import { Button, Card, Checkbox, ErrorBox, Loading, Muted, Screen, StepHeader } from "../../../components/ui";

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <View className="flex-row items-center gap-3 border-b border-line py-2">
      <View className="flex-1">
        <Text className="text-caption text-ink-muted">{label}</Text>
        <Text className="text-body text-ink" selectable>
          {value}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={async () => {
          await Clipboard.setStringAsync(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="rounded-card border border-brand px-3 py-1"
      >
        <Text className="text-brand">{copied ? "Copied" : "Copy"}</Text>
      </Pressable>
    </View>
  );
}

function StampView({ id, s }: { id: string; s: StampDetails }) {
  return (
    <>
      <Card>
        <Muted>Stamp duty to pay on the government portal</Muted>
        <Text className="text-title font-bold text-ink">{formatInr(s.dutyPaise)}</Text>
        {s.lines.map((l, i) => (
          <View key={`${l.chargeType}-${i}`} className="gap-0.5 border-t border-line pt-2">
            <View className="flex-row justify-between">
              <Text className="text-body text-ink">{l.chargeType.replace(/_/g, " ")}</Text>
              <Text className="text-body text-ink">{formatInr(l.amountPaise)}</Text>
            </View>
            <Text className="text-caption text-ink-muted">
              {l.explanation}
              {l.articleRef ? ` (${l.articleRef})` : ""} · pay at {l.payableAt === "ESTAMP" ? "e-stamp portal" : "Sub-Registrar Office"}
            </Text>
          </View>
        ))}
      </Card>

      <Card>
        <Text className="text-body font-bold text-ink">Enter these on {s.portal.name}</Text>
        {s.fields.map((f) => (
          <CopyRow key={f.key} label={f.label} value={f.value} />
        ))}
      </Card>

      <Card>
        <Text className="text-body font-bold text-ink">Steps</Text>
        {s.portal.steps.map((step, i) => (
          <Text key={i} className="text-body text-ink">
            {i + 1}. {step}
          </Text>
        ))}
      </Card>

      <Button title="Open government portal" onPress={() => WebBrowser.openBrowserAsync(s.portal.url)} />
      <Muted>{s.disclaimer}</Muted>
      <Muted>Quoted {new Date(s.quotedAt).toLocaleString()}</Muted>
      <Button variant="secondary" title="I have the certificate number" onPress={() => router.push(`/agreement/${id}/certificate`)} />
    </>
  );
}

export default function Stamp() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const agreement = useAgreement(id);
  const create = useCreateStampDetails(id);
  const [accepted, setAccepted] = useState(false);

  if (agreement.isPending) return <Loading />;
  if (agreement.isError) return <ErrorBox error={agreement.error} onRetry={() => agreement.refetch()} />;

  const stamp = create.data ?? agreement.data.stampDetails;
  const err = create.error;
  const fixRoute = isApiError(err, "VERIFICATION_PENDING")
    ? { title: "Verify tenants", href: `/agreement/${id}/verify` as const }
    : isApiError(err, "FORM_INCOMPLETE")
      ? { title: "Complete the details", href: `/agreement/${id}/details` as const }
      : isApiError(err, "PARTY_MISSING")
        ? { title: "Add parties", href: `/agreement/${id}/parties` as const }
        : null;

  return (
    <Screen>
      <StepHeader step={5} title="Stamp details" />
      {stamp ? (
        <StampView id={id} s={stamp} />
      ) : (
        <>
          <Muted>
            LegalKart is not a law firm. We calculate the stamp duty from published state rates and show you what to enter on the
            official e-stamp portal; you buy the stamp paper directly from the government.
          </Muted>
          <Checkbox label="I understand and want to see the stamp details" value={accepted} onChange={setAccepted} />
          <ErrorBox error={err} />
          {fixRoute ? <Button variant="secondary" title={fixRoute.title} onPress={() => router.push(fixRoute.href)} /> : null}
          <Button title="Show stamp details" disabled={!accepted} loading={create.isPending} onPress={() => create.mutate()} />
        </>
      )}
    </Screen>
  );
}
