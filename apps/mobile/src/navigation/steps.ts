import type { Href } from "expo-router";
import type { DocumentStatus } from "../api/types";
import { documentStatus } from "../theme/tokens";

/** Every status maps to a screen, so reopening the app lands on the right step. */
export function stepForStatus(id: string, status: DocumentStatus): Href {
  switch (status) {
    case "DRAFT":
      return `/agreement/${id}/details`;
    case "AWAITING_VERIFICATION":
      return `/agreement/${id}/verify`;
    case "READY_TO_STAMP":
      return `/agreement/${id}/stamp`;
    case "GENERATED":
      return `/agreement/${id}/done`;
  }
}

/** User-facing status labels come from the design tokens (they say what happens next). */
export const STATUS_LABEL: Record<DocumentStatus, string> = Object.fromEntries(
  Object.entries(documentStatus).map(([k, v]) => [k, v.label]),
) as Record<DocumentStatus, string>;
