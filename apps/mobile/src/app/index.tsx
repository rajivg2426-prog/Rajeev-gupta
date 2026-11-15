import { Link, Redirect, router } from "expo-router";
import { Text, View } from "react-native";
import { isApiError } from "../api/client";
import { useAgreement } from "../api/queries";
import { Button, Card, ErrorBox, Loading, Muted, Screen, Title } from "../components/ui";
import { STATUS_LABEL, stepForStatus } from "../navigation/steps";
import { useDraft } from "../state/draft";
import { useSession } from "../state/session";

function CurrentDraft({ id }: { id: string }) {
  const setDraftId = useDraft((s) => s.setDraftId);
  const q = useAgreement(id);
  if (q.isPending) return <Loading />;
  if (q.isError) {
    // The local API keeps drafts in memory; after a restart the id is gone.
    if (isApiError(q.error, "NOT_FOUND") || (isApiError(q.error) && q.error.status === 404)) {
      return (
        <Card>
          <Muted>Your last draft is no longer on the server.</Muted>
          <Button variant="link" title="Clear it" onPress={() => setDraftId(null)} />
        </Card>
      );
    }
    return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  }
  const { document } = q.data;
  return (
    <Card>
      <Text className="text-body font-semibold text-ink">Rent agreement {document.referenceNo}</Text>
      <Muted>
        {STATUS_LABEL[document.status] ?? document.status}
        {document.propertyPincode ? ` · ${document.propertyPincode}` : ""}
      </Muted>
      <Button variant="secondary" title="Continue" onPress={() => router.push(stepForStatus(id, document.status))} />
    </Card>
  );
}

export default function Home() {
  const userId = useSession((s) => s.userId);
  const draftId = useDraft((s) => s.draftId);
  if (!userId) return <Redirect href="/login" />;

  return (
    <Screen>
      <Title>Your documents</Title>
      <Button title="New rent agreement" onPress={() => router.push("/new")} />
      {draftId ? <CurrentDraft id={draftId} /> : <Muted>No documents yet.</Muted>}
      {/* TODO(api): list all of the user's documents once GET /v1/documents exists. */}
      <View className="items-start">
        <Link href="/profile" className="text-brand font-semibold py-2">
          Profile
        </Link>
      </View>
    </Screen>
  );
}
