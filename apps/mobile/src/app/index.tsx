import { Redirect, router } from "expo-router";
import { Pressable, View } from "react-native";
import { isApiError } from "../api/client";
import { useAgreement } from "../api/queries";
import type { AgreementBundle } from "../api/types";
import { describeAgreement } from "../components/describe";
import { Button, EmptyState, ErrorState, Icon, Loading, Screen, SectionLabel, StatusChip, TabBar, Text } from "../components/ui";
import { stepForStatus } from "../navigation/steps";
import { useDraft } from "../state/draft";
import { useSession } from "../state/session";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function edited(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Edited today";
  return `Edited ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function DocumentCard({ id, bundle }: { id: string; bundle: AgreementBundle }) {
  const { document: doc } = bundle;
  const { title, subtitle } = describeAgreement(bundle);
  const done = doc.status === "GENERATED";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(stepForStatus(id, doc.status))}
      className="rounded-lg bg-surface border border-line p-4 gap-3 active:bg-sunken"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 min-w-0 gap-0.5">
          <Text numberOfLines={2} className="text-body font-semibold text-ink">
            {title}
          </Text>
          <Text className="text-label text-ink-2">{subtitle}</Text>
        </View>
        <View className="mt-0.5">
          <Icon name="chevron-right" size={20} color="ink-3" />
        </View>
      </View>
      <View className="flex-row items-center justify-between">
        <StatusChip status={doc.status} />
        {done ? <Text className="font-mono text-caption text-ink-3">{doc.referenceNo}</Text> : <Text className="text-caption text-ink-3">{edited(doc.updatedAt)}</Text>}
      </View>
      {done && !doc.certificateNo ? (
        <View className="flex-row items-center gap-1.5 pt-2 border-t border-line">
          <Icon name="alert" size={16} color="warn" />
          <Text className="text-caption text-ink-2">
            No certificate number yet.{" "}
            <Text className="text-caption font-semibold text-primary" onPress={() => router.push(`/agreement/${id}/certificate`)}>
              Add it
            </Text>
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function CurrentDraft({ id }: { id: string }) {
  const setDraftId = useDraft((s) => s.setDraftId);
  const q = useAgreement(id);
  if (q.isPending) return <Loading />;
  if (q.isError) {
    // The local API keeps drafts in memory; after a restart the id is gone.
    if (isApiError(q.error, "NOT_FOUND") || (isApiError(q.error) && q.error.status === 404)) {
      return (
        <EmptyState
          icon="file"
          title="Your last draft is no longer on the server"
          body="Start a new agreement with the property pincode."
          action={<Button variant="secondary" size="md" title="Clear it" onPress={() => setDraftId(null)} />}
        />
      );
    }
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  }
  const done = q.data.document.status === "GENERATED";
  return (
    <View className="gap-3">
      <SectionLabel>{done ? "Completed" : "In progress"}</SectionLabel>
      <DocumentCard id={id} bundle={q.data} />
    </View>
  );
}

export default function Home() {
  const userId = useSession((s) => s.userId);
  const draftId = useDraft((s) => s.draftId);
  if (!userId) return <Redirect href="/login" />;

  return (
    <Screen contentClassName="pt-4 gap-6" footer={<TabBar active="home" />}>
        <View className="gap-0.5">
          <Text className="text-label text-ink-2">Hello</Text>
          <Text className="text-display font-bold text-ink">Your agreements</Text>
        </View>
        {draftId ? (
          <>
            <View className="rounded-xl bg-primary p-5 gap-4">
              <View className="gap-1">
                <Text className="text-heading font-semibold text-on-primary">New rent agreement</Text>
                <Text className="text-label text-on-primary/80">Residential, up to 11 months. Delhi, Haryana and Karnataka. About 10 minutes.</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/new")}
                className="self-start h-touch px-5 rounded-md bg-surface flex-row items-center gap-2 active:bg-sunken"
              >
                <Icon name="plus" size={20} color="primary" />
                <Text className="text-body font-semibold text-primary">Start with pincode</Text>
              </Pressable>
            </View>
            <CurrentDraft id={draftId} />
          </>
        ) : (
          <EmptyState
            icon="file"
            title="No agreements yet"
            body="Start one with the property pincode. It takes about 10 minutes, and your progress is saved."
            action={<Button size="md" icon="plus" title="New rent agreement" onPress={() => router.push("/new")} />}
          />
        )}
      {/* TODO(api): list all of the user's documents once GET /v1/documents exists. */}
    </Screen>
  );
}
