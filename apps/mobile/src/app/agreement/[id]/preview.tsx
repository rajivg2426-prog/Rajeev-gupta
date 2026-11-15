import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { isApiError } from "../../../api/client";
import { useAgreement, useCreateStampDetails, usePreview } from "../../../api/queries";
import {
  BottomBar,
  Button,
  Caption,
  Card,
  Checkbox,
  Chip,
  ErrorNotice,
  ErrorState,
  Loading,
  Row,
  RowGroup,
  Screen,
  StepHeader,
  Text,
} from "../../../components/ui";

const DISCLAIMER =
  "LegalKart prepares documents from a standard template. We are not a law firm and this is not legal advice. Stamp duty rules vary by state and can change. We recommend an advocate reviews the agreement before you sign.";

export default function Preview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const preview = usePreview(id);
  const agreement = useAgreement(id);
  const create = useCreateStampDetails(id);
  const [accepted, setAccepted] = useState(false);

  const tenants = agreement.data?.parties.filter((p) => p.otpRequired) ?? [];
  const allVerified = tenants.length > 0 && tenants.every((p) => p.isVerified);
  const err = create.error;
  const fix = isApiError(err, "VERIFICATION_PENDING")
    ? { title: "Verify the tenant", href: `/agreement/${id}/verify` as const }
    : isApiError(err, "FORM_INCOMPLETE")
      ? { title: "Complete the details", href: `/agreement/${id}/details` as const }
      : isApiError(err, "PARTY_MISSING")
        ? { title: "Add parties", href: `/agreement/${id}/parties` as const }
        : null;

  return (
    <Screen
      header={<StepHeader step={5} label="Preview" />}
      contentClassName="gap-5"
      footer={
        <BottomBar>
          <Button
            title="See stamp duty"
            disabled={!accepted}
            busy={create.isPending}
            busyLabel="Working out the duty…"
            onPress={() => create.mutate(undefined, { onSuccess: () => router.push(`/agreement/${id}/stamp`) })}
          />
        </BottomBar>
      }
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-title font-semibold text-ink">Check the draft</Text>
        {allVerified ? <Chip tone="success" label={tenants.length > 1 ? "Tenants verified" : "Tenant verified"} /> : null}
      </View>

      <View className="h-[360px] rounded-sm bg-paper border border-line overflow-hidden">
        {preview.isPending ? (
          <Loading label="Preparing the draft…" />
        ) : preview.isError ? (
          <ErrorState error={preview.error} onRetry={() => preview.refetch()} />
        ) : (
          // TODO(web): react-native-webview has no web implementation; use an iframe on web.
          <WebView originWhitelist={["*"]} source={{ html: preview.data }} nestedScrollEnabled />
        )}
      </View>
      <Caption className="-mt-2">Scroll inside the page to read the full draft. The watermark is removed on the final agreement.</Caption>

      <RowGroup>
        <Row onPress={() => router.push(`/agreement/${id}/property`)}>
          <Text className="flex-1 text-body text-ink">Property and SRO</Text>
          <Text className="text-label font-semibold text-primary">Edit</Text>
        </Row>
        <Row onPress={() => router.push(`/agreement/${id}/details`)}>
          <Text className="flex-1 text-body text-ink">Rent and terms</Text>
          <Text className="text-label font-semibold text-primary">Edit</Text>
        </Row>
        <Row last onPress={() => router.push(`/agreement/${id}/parties`)}>
          <Text className="flex-1 text-body text-ink">Parties</Text>
          <Text className="text-label font-semibold text-primary">Edit</Text>
        </Row>
      </RowGroup>
      <Caption className="-mt-2">Changing the tenant's phone number means verifying it again.</Caption>

      <Card>
        <Text className="text-body font-semibold text-ink">Before you see the stamp duty</Text>
        <Text className="text-label text-ink-2">{DISCLAIMER}</Text>
        <Checkbox label="I understand and want to continue" value={accepted} onChange={setAccepted} />
      </Card>

      <ErrorNotice error={err} action={fix ? <Button size="md" variant="secondary" title={fix.title} onPress={() => router.push(fix.href)} /> : undefined} />
    </Screen>
  );
}
