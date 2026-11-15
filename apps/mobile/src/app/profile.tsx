import { router } from "expo-router";
import { API_URL } from "../api/config";
import { Button, Card, Muted, Screen, Title } from "../components/ui";
import { useDraft } from "../state/draft";
import { useSession } from "../state/session";

// TODO(profile): saved details for autofill (Profile service is not built yet).
export default function Profile() {
  const { userId, phone, signOut } = useSession();
  const setDraftId = useDraft((s) => s.setDraftId);
  return (
    <Screen>
      <Title>Profile</Title>
      <Card>
        <Muted>User id: {userId ?? "–"}</Muted>
        <Muted>Phone: {phone ?? "–"}</Muted>
        <Muted>API: {API_URL}</Muted>
      </Card>
      <Muted>Saved details for autofill will appear here.</Muted>
      <Button
        variant="secondary"
        title="Sign out"
        onPress={() => {
          signOut();
          setDraftId(null);
          router.replace("/login");
        }}
      />
    </Screen>
  );
}
