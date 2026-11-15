import { useMutation } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { router, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useRef } from "react";
import { Platform, Text } from "react-native";
import { apiUrl, authHeaders } from "../../../api/client";
import { useGenerate } from "../../../api/queries";
import type { FileFormat, GenerateResponse } from "../../../api/types";
import { Button, Card, ErrorBox, Loading, Muted, Screen, StepHeader } from "../../../components/ui";

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

function FileButtons({ g }: { g: GenerateResponse }) {
  const dl = useMutation({
    mutationFn: (v: { path: string; format: FileFormat }) => downloadAndShare(v.path, `LegalKart-${g.referenceNo}`, v.format),
  });
  return (
    <Card>
      <Text className="text-body font-bold text-ink">Reference {g.referenceNo}</Text>
      <Muted>{g.certificateNo ? `E-stamp certificate ${g.certificateNo}` : "No certificate number: attach the e-stamp before signing."}</Muted>
      <Text className="text-caption text-ink-muted" selectable>
        {g.sha256 ? `SHA-256 ${g.sha256}` : ""}
      </Text>
      {g.files.pdf ? (
        <Button title="Download / share PDF" loading={dl.isPending && dl.variables?.format === "pdf"} onPress={() => dl.mutate({ path: g.files.pdf!, format: "pdf" })} />
      ) : (
        <Muted>PDF is not available on this server; use the DOCX.</Muted>
      )}
      <Button
        variant="secondary"
        title="Download / share DOCX"
        loading={dl.isPending && dl.variables?.format === "docx"}
        onPress={() => dl.mutate({ path: g.files.docx, format: "docx" })}
      />
      {dl.isSuccess ? <Muted>Saved to {dl.data}</Muted> : null}
      <ErrorBox error={dl.error} />
    </Card>
  );
}

export default function Done() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const generate = useGenerate(id);
  const started = useRef(false);

  // Generating is idempotent on the server; run it once when the screen opens.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    generate.mutate();
  }, [generate]);

  return (
    <Screen>
      <StepHeader step={7} total={7} title="Your agreement is ready" />
      {generate.isPending ? <Loading label="Generating PDF and DOCX…" /> : null}
      <ErrorBox error={generate.error} onRetry={() => generate.mutate()} />
      {generate.data ? <FileButtons g={generate.data} /> : null}
      <Button variant="link" title="Add certificate later" onPress={() => router.push(`/agreement/${id}/certificate`)} />
      <Button variant="link" title="Back to home" onPress={() => router.dismissTo("/")} />
    </Screen>
  );
}
