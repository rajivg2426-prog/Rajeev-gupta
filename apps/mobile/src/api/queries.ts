import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./endpoints";
import type { AddPartyInput, FormData, OtpChannel } from "./types";

export const keys = {
  template: ["template", "rent-agreement"] as const,
  pincode: (pincode: string) => ["pincode", pincode] as const,
  agreement: (id: string) => ["agreement", id] as const,
  preview: (id: string) => ["agreement", id, "preview"] as const,
  stamp: (id: string) => ["agreement", id, "stamp"] as const,
};

export function useTemplate() {
  return useQuery({ queryKey: keys.template, queryFn: api.template, staleTime: 60 * 60 * 1000 });
}

export function usePincode(pincode: string) {
  return useQuery({
    queryKey: keys.pincode(pincode),
    queryFn: () => api.pincode(pincode),
    enabled: /^[1-9]\d{5}$/.test(pincode),
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export function useAgreement(id: string) {
  return useQuery({ queryKey: keys.agreement(id), queryFn: () => api.getAgreement(id), enabled: !!id });
}

export function usePreview(id: string) {
  return useQuery({ queryKey: keys.preview(id), queryFn: () => api.previewHtml(id), enabled: !!id, staleTime: 0 });
}

/** Invalidate everything we cache for one agreement (status, parties, stamp details). */
function useInvalidateAgreement(id: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.agreement(id) });
}

export function useCreateAgreement() {
  return useMutation({ mutationFn: api.createAgreement });
}

export function useSetSro(id: string) {
  const invalidate = useInvalidateAgreement(id);
  return useMutation({ mutationFn: (sroCode: string) => api.setSro(id, sroCode), onSuccess: invalidate });
}

export function useSaveForm(id: string) {
  const invalidate = useInvalidateAgreement(id);
  return useMutation({ mutationFn: (form: FormData) => api.saveForm(id, form), onSuccess: invalidate });
}

export function useAddParty(id: string) {
  const invalidate = useInvalidateAgreement(id);
  return useMutation({ mutationFn: (input: AddPartyInput) => api.addParty(id, input), onSuccess: invalidate });
}

export function useUpdatePartyPhone(id: string) {
  const invalidate = useInvalidateAgreement(id);
  return useMutation({
    mutationFn: (v: { partyId: string; phoneE164: string }) => api.updatePartyPhone(id, v.partyId, v.phoneE164),
    onSuccess: invalidate,
  });
}

export function useSendOtp(id: string) {
  return useMutation({ mutationFn: (v: { partyId: string; channel: OtpChannel }) => api.sendOtp(id, v.partyId, v.channel) });
}

export function useVerifyOtp(id: string) {
  const invalidate = useInvalidateAgreement(id);
  return useMutation({
    mutationFn: (v: { verificationId: string; otp: string }) => api.verifyOtp(id, v.verificationId, v.otp),
    onSuccess: invalidate,
  });
}

export function useCreateStampDetails(id: string) {
  const invalidate = useInvalidateAgreement(id);
  return useMutation({ mutationFn: () => api.createStampDetails(id), onSuccess: invalidate });
}

export function useSetCertificate(id: string) {
  const invalidate = useInvalidateAgreement(id);
  return useMutation({ mutationFn: (certificateNo: string) => api.setCertificate(id, certificateNo), onSuccess: invalidate });
}

export function useGenerate(id: string) {
  const invalidate = useInvalidateAgreement(id);
  return useMutation({ mutationFn: () => api.generate(id), onSuccess: invalidate });
}
