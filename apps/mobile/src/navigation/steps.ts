import type { Href } from "expo-router";
import type { DocumentStatus } from "../api/types";

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

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  DRAFT: "Draft",
  AWAITING_VERIFICATION: "Waiting for tenant OTP",
  READY_TO_STAMP: "Ready to stamp",
  GENERATED: "Ready to download",
};
