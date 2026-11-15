import { create } from "zustand";
import { persist } from "zustand/middleware";
import { asyncJsonStorage } from "./storage";

interface DraftState {
  /** The rent agreement the user is working on, so reopening the app can resume it. */
  draftId: string | null;
  setDraftId: (id: string | null) => void;
}

export const useDraft = create<DraftState>()(
  persist(
    (set) => ({
      draftId: null,
      setDraftId: (draftId) => set({ draftId }),
    }),
    { name: "legalkart.draft", storage: asyncJsonStorage },
  ),
);
