import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { View } from "react-native";
import { formatInr } from "../../../api/money";
import { useAgreement } from "../../../api/queries";
import type { StampDetails } from "../../../api/types";
import { CopyRows, type CopyItem } from "../../../components/CopyRows";
import {
  BottomBar,
  Button,
  Caption,
  Card,
  EmptyState,
  ErrorState,
  Heading,
  Loading,
  Notice,
  NumberedSteps,
  Screen,
  StepHeader,
  Text,
} from "../../../components/ui";

const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");

/** Copy rows: show amounts formatted, copy them exactly as the API sends them (e.g. 4875). */
function copyItems(s: StampDetails): CopyItem[] {
  return s.fields.map((f) => {
    const amount = /amount/i.test(f.key) && /^\d+(\.\d+)?$/.test(f.value);
    return {
      key: f.key,
      label: amount ? `${f.label.replace(/\s*\(Rs\)$/, "")} · copies ${f.value}` : f.label,
      value: f.value,
      display: amount ? formatInr(Math.round(Number(f.value) * 100)) : undefined,
      emphasis: f.key === "stampDutyAmount",
    };
  });
}

function StampView({ id, s, stateName }: { id: string; s: StampDetails; stateName: string }) {
  const article = s.fields.find((f) => f.key === "article")?.value;
  const payer = s.fields.find((f) => f.key === "stampDutyPaidBy")?.value;
  const estampLines = s.lines.filter((l) => l.payableAt === "ESTAMP");
  const sroLines = s.lines.filter((l) => l.payableAt === "SRO");
  return (
    <Screen
      header={<StepHeader step={6} label="E-stamp" />}
      footer={
        <BottomBar>
          <Button title="Open government portal" iconRight="external" onPress={() => void WebBrowser.openBrowserAsync(s.portal.url)} />
          <Button variant="secondary" title="I've bought the e-stamp" onPress={() => router.push(`/agreement/${id}/certificate`)} />
        </BottomBar>
      }
    >
      <Heading
        title="Buy the e-stamp"
        body={`You buy it from the Government of ${stateName} and pay them directly. LegalKart doesn't sell stamps or take any payment.`}
      />

      <View className="rounded-xl bg-surface border border-line overflow-hidden">
        <View className="p-4 gap-1 bg-primary-soft">
          <Text className="text-label font-medium text-ink-2">Stamp duty to pay</Text>
          <Text className="text-amount font-bold text-ink tabular">{formatInr(s.dutyPaise)}</Text>
          {article ? <Text className="text-label text-ink-2">{article}</Text> : null}
        </View>
        <View className="p-4 gap-2">
          <Text className="text-label font-semibold text-ink">How it's worked out</Text>
          {estampLines.map((l, i) => (
            <Text key={`${l.chargeType}-${i}`} className="text-label text-ink-2">
              {l.explanation}
            </Text>
          ))}
          {sroLines.map((l, i) => (
            <Text key={`sro-${i}`} className="text-label text-ink-2">
              {`${l.chargeType.replace(/_/g, " ").toLowerCase()}: ${formatInr(l.amountPaise)}, paid at the Sub-Registrar Office, not on the portal`}
            </Text>
          ))}
          <Caption>
            {payer ? `Paid by ${payer}. ` : ""}Calculated {new Date(s.quotedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.
          </Caption>
        </View>
      </View>

      <Notice tone="warn">{`Enter exactly ${formatInr(s.dutyPaise)} on the portal. A lower amount leaves the agreement under-stamped.`}</Notice>

      <Card>
        <View className="gap-0.5">
          <Text className="text-heading font-semibold text-ink">On {s.portal.name}</Text>
          <Text className="text-label text-ink-3">{host(s.portal.url)}</Text>
        </View>
        <NumberedSteps steps={s.portal.steps} />
      </Card>

      <CopyRows items={copyItems(s)} />
      <Caption>Saved to this agreement. You can leave the app and come back any time.</Caption>
    </Screen>
  );
}

export default function Stamp() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const agreement = useAgreement(id);
  const header = <StepHeader step={6} label="E-stamp" />;

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

  const s = agreement.data.stampDetails;
  if (!s)
    return (
      <Screen header={header}>
        <EmptyState
          icon="file"
          title="Check the draft first"
          body="The stamp duty is worked out after you check the draft and accept the disclaimer."
          action={<Button size="md" title="Go to the draft" onPress={() => router.replace(`/agreement/${id}/preview`)} />}
        />
      </Screen>
    );
  const stateName = agreement.data.document.pincodeData && typeof agreement.data.document.pincodeData === "object"
    ? String((agreement.data.document.pincodeData as { stateName?: string }).stateName ?? s.stateCode)
    : s.stateCode;
  return <StampView id={id} s={s} stateName={stateName} />;
}
