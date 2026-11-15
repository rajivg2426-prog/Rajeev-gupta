import "../../global.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ApiError } from "../api/client";
import { Loading } from "../components/ui";
import { useDraft } from "../state/draft";
import { useSession } from "../state/session";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Client errors (4xx) will not fix themselves on retry.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

/** Wait for persisted zustand stores before rendering routes that read them. */
function useStoresHydrated() {
  const [ready, setReady] = useState(() => useSession.persist.hasHydrated() && useDraft.persist.hasHydrated());
  useEffect(() => {
    const check = () => setReady(useSession.persist.hasHydrated() && useDraft.persist.hasHydrated());
    const unsubs = [useSession.persist.onFinishHydration(check), useDraft.persist.onFinishHydration(check)];
    check();
    return () => unsubs.forEach((u) => u());
  }, []);
  return ready;
}

export default function RootLayout() {
  const hydrated = useStoresHydrated();
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        {hydrated ? (
          <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
            <Stack.Screen name="index" options={{ title: "LegalKart" }} />
            <Stack.Screen name="login" options={{ title: "Sign in" }} />
            <Stack.Screen name="profile" options={{ title: "Profile" }} />
            <Stack.Screen name="new" options={{ title: "New rent agreement" }} />
            <Stack.Screen name="agreement/[id]/property" options={{ title: "Property" }} />
            <Stack.Screen name="agreement/[id]/details" options={{ title: "Agreement details" }} />
            <Stack.Screen name="agreement/[id]/parties" options={{ title: "Parties" }} />
            <Stack.Screen name="agreement/[id]/verify" options={{ title: "Tenant verification" }} />
            <Stack.Screen name="agreement/[id]/preview" options={{ title: "Draft preview" }} />
            <Stack.Screen name="agreement/[id]/stamp" options={{ title: "Stamp details" }} />
            <Stack.Screen name="agreement/[id]/certificate" options={{ title: "Add certificate" }} />
            <Stack.Screen name="agreement/[id]/done" options={{ title: "Done" }} />
          </Stack>
        ) : (
          <Loading />
        )}
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
