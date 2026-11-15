# @legalkart/api

Fastify backend for the rent agreement flow. Runs with no vendor accounts: OTPs print to the console. LegalKart takes no payment and buys no stamp; the customer buys the e-stamp on their state's government portal (see [docs/SYSTEM-DESIGN.md](../../docs/SYSTEM-DESIGN.md)).

```bash
npm run dev -w @legalkart/api     # API on :8080
```

```bash
npm test -w @legalkart/api
```

Data is in memory for now (`src/store.ts`); Postgres comes next.

## Flow and statuses

`DRAFT` → `AWAITING_VERIFICATION` (a tenant was added) → `READY_TO_STAMP` (stamp details shown) → `GENERATED`.

- Editing the form, the SRO, a party or a phone number is allowed until `GENERATED`. Any edit clears the stamp details and any certificate number and returns the document to `DRAFT`.
- A certificate number is optional and can be added before or after generating. After generating, adding one sets `needsRegeneration: true`; call `/generate` again.
- A certificate number is format-checked only. We never claim it is verified.

## Endpoints

Auth is a stub header `x-user-id` until phone-OTP login lands. Errors: `{code, message, details?}`. Money is integer paise.

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/pincodes/:pincode` | State, districts, area type, SRO candidates, `needsUserConfirmation` |
| GET | `/v1/templates/rent-agreement` | Template JSON; the app renders forms from it |
| POST | `/v1/rent-agreements` `{pincode, sroCode?}` | 201 `{document, resolution}` |
| GET | `/v1/rent-agreements/:id` | `{document, parties[], stampDetails}` |
| PUT | `/v1/rent-agreements/:id/sro` `{sroCode}` | Confirm the SRO |
| PUT | `/v1/rent-agreements/:id/form` | `{errors[]}` |
| POST | `/v1/rent-agreements/:id/parties` `{role, fullName, phoneE164, details?}` | 201 party |
| PATCH | `/v1/rent-agreements/:id/parties/:partyId` `{phoneE164}` | Resets that party's verification |
| POST | `/v1/rent-agreements/:id/parties/:partyId/otp` `{channel}` | `SMS` or `WHATSAPP` |
| POST | `/v1/rent-agreements/:id/verifications/:verificationId` `{otp}` | `{pendingPartyIds}` |
| GET | `/v1/rent-agreements/:id/preview` | Watermarked HTML draft |
| POST | `/v1/rent-agreements/:id/stamp-details` `{acceptDisclaimer: true}` | Duty, portal, fields to copy. Moves to `READY_TO_STAMP` |
| GET | `/v1/rent-agreements/:id/stamp-details` | The saved stamp details |
| PUT | `/v1/rent-agreements/:id/certificate` `{certificateNo}` | `{certificateNo, needsRegeneration}` |
| POST | `/v1/rent-agreements/:id/generate` | `{referenceNo, status, sha256, certificateNo, files: {pdf, docx}}` |
| GET | `/v1/rent-agreements/:id/files/:format` | `pdf` or `docx` |

Error codes: `VALIDATION`, `FORM_INCOMPLETE`, `PARTY_MISSING`, `DISCLAIMER_REQUIRED`, `VERIFICATION_PENDING`, `INVALID_OTP` (`details.attemptsLeft`), `LOCKED`, `EXPIRED`, `RESEND_TOO_SOON`, `RATE_LIMITED`, `STATE_NOT_SUPPORTED`, `NO_RATE`, `UNVERIFIED_RATE`, `INVALID_CERTIFICATE` (`details.example`), `CERTIFICATE_IN_USE`, `INVALID_STATE`, `NOT_FOUND`, `FORBIDDEN`.

## E-stamp portals

Configured in `src/estamp/handoff.ts`: SHCIL for Delhi and Karnataka, e-GRAS for Haryana. Portal steps and certificate formats must be confirmed with one real purchase per state before launch.
