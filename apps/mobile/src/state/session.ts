import { create } from "zustand";
import { persist } from "zustand/middleware";
import { secureJsonStorage } from "./storage";

interface SessionState {
  /** Sent as `x-user-id` until real auth exists. TODO(auth): store the refresh token instead. */
  userId: string | null;
  phone: string | null;
  signIn: (userId: string, phone: string | null) => void;
  signOut: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      userId: null,
      phone: null,
      signIn: (userId, phone) => set({ userId, phone }),
      signOut: () => set({ userId: null, phone: null }),
    }),
    { name: "legalkart.session", storage: secureJsonStorage },
  ),
);
