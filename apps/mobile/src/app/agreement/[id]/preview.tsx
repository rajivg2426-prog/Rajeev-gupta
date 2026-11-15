import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { usePreview } from "../../../api/queries";
import { Button, ErrorBox, Loading, Muted, Screen } from "../../../components/ui";

export default function Preview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const preview = usePreview(id);

  return (
    <Screen scroll={false}>
      <Muted>Draft preview. The watermark is removed on the final document.</Muted>
      <View className="flex-1 overflow-hidden rounded-card border border-line">
        {preview.isPending ? (
          <Loading label="Rendering preview…" />
        ) : preview.isError ? (
          <ErrorBox error={preview.error} onRetry={() => preview.refetch()} />
        ) : (
          // TODO(preview): react-native-webview has no web implementation; use an iframe on web.
          <WebView originWhitelist={["*"]} source={{ html: preview.data }} />
        )}
      </View>
      <Button title="Looks good, get stamp details" onPress={() => router.push(`/agreement/${id}/stamp`)} />
      <Button variant="link" title="Edit details" onPress={() => router.push(`/agreement/${id}/details`)} />
    </Screen>
  );
}
