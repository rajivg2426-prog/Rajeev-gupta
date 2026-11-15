import { request, requestText } from "./client";
import type {
  AddPartyInput,
  AgreementBundle,
  CertificateResponse,
  CreateAgreementResponse,
  FormData,
  GenerateResponse,
  OtpChannel,
  OtpSent,
  OtpVerified,
  Party,
  PincodeResolution,
  RentAgreementTemplate,
  SaveFormResponse,
  StampDetails,
} from "./types";

const ra = (id: string) => `/v1/rent-agreements/${encodeURIComponent(id)}`;

export const api = {
  pincode: (pincode: string) => request<PincodeResolution>("GET", `/v1/pincodes/${encodeURIComponent(pincode)}`),
  template: () => request<RentAgreementTemplate>("GET", "/v1/templates/rent-agreement"),

  createAgreement: (input: { pincode: string; sroCode?: string }) =>
    request<CreateAgreementResponse>("POST", "/v1/rent-agreements", input),
  getAgreement: (id: string) => request<AgreementBundle>("GET", ra(id)),
  setSro: (id: string, sroCode: string) => request<unknown>("PUT", `${ra(id)}/sro`, { sroCode }),
  saveForm: (id: string, form: FormData) => request<SaveFormResponse>("PUT", `${ra(id)}/form`, form),

  addParty: (id: string, input: AddPartyInput) => request<Party>("POST", `${ra(id)}/parties`, input),
  updatePartyPhone: (id: string, partyId: string, phoneE164: string) =>
    request<Party>("PATCH", `${ra(id)}/parties/${encodeURIComponent(partyId)}`, { phoneE164 }),
  sendOtp: (id: string, partyId: string, channel: OtpChannel) =>
    request<OtpSent>("POST", `${ra(id)}/parties/${encodeURIComponent(partyId)}/otp`, { channel }),
  verifyOtp: (id: string, verificationId: string, otp: string) =>
    request<OtpVerified>("POST", `${ra(id)}/verifications/${encodeURIComponent(verificationId)}`, { otp }),

  previewHtml: (id: string) => requestText(`${ra(id)}/preview`),

  createStampDetails: (id: string) => request<StampDetails>("POST", `${ra(id)}/stamp-details`, { acceptDisclaimer: true }),
  getStampDetails: (id: string) => request<StampDetails>("GET", `${ra(id)}/stamp-details`),

  setCertificate: (id: string, certificateNo: string) =>
    request<CertificateResponse>("PUT", `${ra(id)}/certificate`, { certificateNo }),
  generate: (id: string) => request<GenerateResponse>("POST", `${ra(id)}/generate`),
  /** Path (not full URL) of a generated file; resolve with apiUrl(). */
  filePath: (id: string, format: "pdf" | "docx") => `${ra(id)}/files/${format}`,
};
