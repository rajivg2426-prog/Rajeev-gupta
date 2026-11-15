import { router } from "expo-router";
import { View } from "react-native";
import { formatPhone } from "../components/describe";
import { Avatar, Button, Caption, EmptyState, Notice, Screen, SectionLabel, TabBar, Text } from "../components/ui";
import { useDraft } from "../state/draft";
import { useSession } from "../state/session";

// TODO(profile): saved details, data download, privacy notice and account deletion need the Profile service.
export default function Profile() {
  const { userId, phone, signOut } = useSession();
  const setDraftId = useDraft((s) => s.setDraftId);
  return (
    <Screen contentClassName="pt-4 gap-6" footer={<TabBar active="profile" />}>
      <View className="items-center gap-2 pt-2">
        <Avatar name={userId ?? "?"} tone="primary" size="lg" />
        <Text className="text-title font-semibold text-ink">{phone ? formatPhone(phone.startsWith("+") ? phone : `+91${phone}`) : "Your account"}</Text>
      </View>

      <View className="gap-3">
        <SectionLabel>Saved details</SectionLabel>
        <EmptyState
          icon="user"
          title="Coming soon"
          body={'Save your name, address and PAN once and we fill them in for you when you tap "This is me".'}
        />
      </View>

      <Notice tone="neutral" icon="lock">
        Your data is stored in India. Only the last 4 digits of Aadhaar are ever saved.
      </Notice>

      <Button
        variant="secondary"
        size="md"
        icon="logout"
        title="Log out"
        onPress={() => {
          signOut();
          setDraftId(null);
          router.replace("/login");
        }}
      />
      <Caption className="text-center">LegalKart 1.0.0 · Not a law firm</Caption>
    </Screen>
  );
}
