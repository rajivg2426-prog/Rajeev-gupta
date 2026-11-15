import { useMutation } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { router, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { apiUrl, authHeaders } from "../../../api/client";
import { api } from "../../../api/endpoints";
import { useAgreement, useGenerate } from "../../../api/queries";
import type { AgreementBundle, FileFormat } from "../../../api/types";
import { describeAgreement } from "../../../components/describe";
import {
  BackHeader,
  Button,
  Caption,
  Card,
  ErrorNotice,
  ErrorState,
  Icon,
  Loading,
  Notice,
  NumberedSteps,
  Screen,
  StatusChip,
  Text,
} from "../../../components/ui";

const MIME: Record<FileFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Download into the app's document directory, then open the share sheet. */
async function downloadAndShare(path: string, name: string, format: FileFormat) {
  if (Platform.OS === "web") {
    // TODO(web): fetch with auth header and save via a Blob URL.
    throw new Error("Downloading is not supported on web yet");
  }
  const dest = new File(Paths.document, `${name}.${format}`);
  const file = await File.downloadFileAsync(apiUrl(path), dest, { headers: authHeaders(), idempotent: true });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: MIME[format], dialogTitle: `Share ${name}.${format}` });
  }
  return file.uri;
}

function Files({ id, referenceNo, hasPdf }: { id: string; referenceNo: string; hasPdf: boolean }) {
  const dl = useMutation({
    mutationFn: (format: FileFormat) => downloadAndShare(api.filePath(id, format), `LegalKart-${referenceNo}`, format),
  });
  return (
    <>
      {hasPdf ? (
        <Card hero>
          <View className="flex-row items-center gap-3">
            <View className="w-10 h-10 rounded-md bg-primary-soft items-center justify-center">
              <Icon name="file" size={22} color="primary" />
            </View>
            <View className="flex-1">
              <Text className="text-body font-semibold text-ink">Rent agreement (PDF)</Text>
              <Text className="text-label text-ink-2">Print this copy</Text>
            </View>
          </View>
          <Button title="Download and share PDF" icon="download" busy={dl.isPending && dl.variables === "pdf"} busyLabel="Downloading…" onPress={() => dl.mutate("pdf")} />
        </Card>
      ) : (
        <Notice tone="neutral">The PDF isn't available from this server. Use the Word file below.</Notice>
      )}
      <Card>
        <View className="flex-row items-center gap-3">
          <Icon name="edit" size={20} color="ink-2" />
          <View className="flex-1">
            <Text className="text-body font-medium text-ink">Editable Word file (DOCX)</Text>
            <Text className="text-label text-ink-2">For layout fixes only. Don't change names, amounts or dates.</Text>
          </View>
        </View>
        <Button size="md" variant="secondary" title="Download DOCX" icon="download" busy={dl.isPending && dl.variables === "docx"} busyLabel="Downloading…" onPress={() => dl.mutate("docx")} />
      </Card>
      {dl.isSuccess ? <Caption>Saved to {dl.data}</Caption> : null}
      <ErrorNotice error={dl.error} />
    </>
  );
}

function Ready({ id, bundle, hasPdf }: { id: string; bundle: AgreementBundle; hasPdf: boolean }) {
  const doc = bundle.document;
  const { title, tenants } = describeAgreement(bundle);
  return (
    <>
      <View className="gap-2">
        <StatusChip status="GENERATED" />
        <Text className="text-display font-bold text-ink">Your agreement is ready</Text>
        <Text className="text-body text-ink-2">{[title, tenants.join(", ")].filter(Boolean).join(" · ")}</Text>
      </View>

      {doc.certificateNo ? (
        <Notice tone="info" icon="shield">
          {`E-stamp certificate ${doc.certificateNo} is printed on every page. Verify it on the official portal before signing.`}
        </Notice>
      ) : (
        <Notice
          tone="warn"
          action={<Button size="md" variant="secondary" title="Add certificate number" onPress={() => router.push(`/agreement/${id}/certificate`)} />}
        >
          No certificate number on this copy. Each page says "Attach the e-stamp certificate before signing."
        </Notice>
      )}

      <Files id={id} referenceNo={doc.referenceNo} hasPdf={hasPdf} />

      <Card>
        <Text className="text-heading font-semibold text-ink">Before you sign</Text>
        <NumberedSteps
          variant="outline"
          steps={[
            "Print on A4. Put the e-stamp certificate on top as page 1.",
            "Landlord and tenant sign every page in ink, on or after the e-stamp date.",
            "Witnesses sign the last page. Keep one original each.",
          ]}
        />
      </Card>
      <Caption className="text-center">LegalKart is not a law firm. Verify the e-stamp certificate on the official portal before signing.</Caption>
    </>
  );
}

export default function Done() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const agreement = useAgreement(id);
  const generate = useGenerate(id);
  const started = useRef(false);

  const doc = agreement.data?.document;
  // Generate only when there are no files yet or a certificate number was added since.
  const needsFiles = !!doc && (doc.status !== "GENERATED" || doc.needsRegeneration);
  useEffect(() => {
    if (!needsFiles || started.current) return;
    started.current = true;
    generate.mutate();
  }, [needsFiles, generate]);

  const header = (
    <BackHeader
      label="Home"
      onBack={() => router.dismissTo("/")}
      right={doc ? <Text className="px-3 text-label font-mono text-ink-2">{doc.referenceNo}</Text> : undefined}
    />
  );

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
  if (generate.isError)
    return (
      <Screen header={header}>
        <ErrorState error={generate.error} onRetry={() => generate.mutate()} />
      </Screen>
    );
  if (needsFiles || generate.isPending)
    return (
      <Screen header={header}>
        <Loading label="Making your PDF and Word file…" />
      </Screen>
    );

  return (
    <Screen header={header}>
      <Ready id={id} bundle={agreement.data} hasPdf={generate.data ? generate.data.files.pdf !== null : true} />
    </Screen>
  );
}
