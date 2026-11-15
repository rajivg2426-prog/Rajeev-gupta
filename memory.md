# LegalKart — working memory and rules for every change

Read this before changing anything in this repo, whether you are a person or an AI agent. Every change must follow the **system design** and the **design language** below. If a change needs to break one of these rules, update the design first (see "Changing the rules"), then the code.

## 1. Sources of truth

| What | Where | Wins over |
|---|---|---|
| System design: architecture, flows, services, decisions | [`docs/SYSTEM-DESIGN.md`](docs/SYSTEM-DESIGN.md) (snapshot of the editable Claude Doc linked at its top) | Code, `docs/SPEC.md`, old guides |
| Design language: colours, type, spacing, components | [`design/ui/tailwind.tokens.js`](design/ui/tailwind.tokens.js) | Anything hard-coded in the app |
| Approved screens | [`design/ui/screens/`](design/ui/screens) (01-login … 11-profile) | The current look of `apps/mobile` |
| API contract | [`apps/api/README.md`](apps/api/README.md) | Mobile client types |

`docs/SPEC.md` and `docs/USER-GUIDE.md` are **historical**. They describe in-app payment and stamp purchase, which no longer exist. Do not build from them.

## 2. Product rules (never break these)

1. **LegalKart never buys an e-stamp and never collects stamp duty.** The customer buys and pays on the state's government portal (SHCIL for DL and KA, e-GRAS for HR). There are no in-app payments at launch. A ₹10 per-document fee is planned behind a switch that stays off.
2. **The app tells the customer exactly what to buy.** Duty comes from the duty engine and verified `stamp_rates` rows, never from code or templates. The amount shown must be the amount the portal asks for.
3. **A certificate number is optional and format-checked only.** Never say or imply that LegalKart verified a stamp. Agreements without a number say "Attach the e-stamp certificate before signing."
4. **We never automate, scrape or pre-fill government portals.** We only link to them and show the fields to copy.
5. **Tenants verify their mobile number by OTP before stamp details are shown.** At launch the tenant reads the code aloud to the landlord. OTP proves control of a number, not identity.
6. **Not a law firm.** The disclaimer is accepted before stamp details are shown. Template text is legal text: wording changes need an advocate's review.
7. **No e-sign for leases or sale documents** until counsel confirms. Wet-ink signature blocks only.
8. **Personal data:** never store full Aadhaar numbers, only the last 4 digits. Data stays in India.

## 3. Architecture rules

- **Monorepo:** `apps/api` (Fastify), `apps/mobile` (Expo), `packages/templates`, `packages/db`. Shared types will move to `packages/shared`.
- **Document status machine:** `DRAFT → AWAITING_VERIFICATION → READY_TO_STAMP → GENERATED`. Each API call checks the status. Any edit before generation clears the stamp details and certificate and returns to `DRAFT`. A generated agreement is final except for adding a certificate number, which regenerates the files.
- **The mobile app is a thin client.** It never computes duty, builds a PDF or decides a status. It shows what the API returns.
- **Money is integer paise** everywhere. Rates are basis points. Duty always rounds up. Display uses Indian grouping (₹2,75,000).
- **Templates are data.** New document types are new template JSON + rate rows, not new flow code. Templates are versioned; bump the version when wording changes.
- **Every vendor sits behind an adapter with a sandbox implementation.** Local development must work with no vendor accounts.
- **Changing the API contract** means updating, in the same change: `apps/api/README.md`, `apps/mobile/src/api/types.ts`, and the tests.

## 4. Design language (mobile UI)

The direction is **"stamp ink"**: one deep teal-green accent on cool green-grey neutrals. Colour is used only where it carries meaning.

- **Use tokens, never raw values.** Only the semantic Tailwind/NativeWind classes from `design/ui/tailwind.tokens.js`, such as `bg-surface`, `bg-canvas`, `text-ink`, `text-ink-2`, `text-ink-3`, `border-line`, `bg-primary` and `text-danger`. No hex colours, no arbitrary pixel values, no inline style colours. Every class must work in light and dark.
- **One accent.** Teal (`primary`) is for actions, links and focus. Amber, red, green and blue (`warn`, `danger`, `success`, `info`) mean status only and never decorate.
- **Type:** Mukta for text and IBM Plex Mono only for reference and certificate numbers. The scale is `text-caption 12`, `label 14`, `body 16`, `heading 18`, `title 22`, `display 28`, `amount 36`. Body text is never below 16px. Weights: 400 body, 500 labels, 600 headings, 700 amounts and display. Use the app's `Text` wrapper so weights map to the right font file.
- **Spacing:** Tailwind's 4px scale. Screen gutter 20px (`px-5`), field gap 20px, card padding 16px, 32px between sections.
- **Radii:** `rounded-sm` for chips, `rounded-md` for inputs and buttons, `rounded-lg` for cards, `rounded-xl` for sheets and the duty card.
- **Touch:** every tappable element is at least 48px (`min-h-touch`/`h-touch`). The primary button is 56px (`h-touch-lg`).
- **Buttons:**
  - one primary button per screen, pinned in the bottom bar
  - outlined secondary for the second choice
  - text buttons for skip, edit and resend
  - a busy button keeps its size and says what is happening
  - destructive buttons only on Profile, always confirmed
- **Status chips:** use the labels in `documentStatus` from the tokens file ("Draft", "Tenant to verify", "Buy e-stamp", "Ready to sign"). Each chip has its own mark (hollow dot, dot, diamond, tick) so it reads without colour.
- **Copy rows** copy portal-ready values exactly as the API sends them (an amount copies as `4875`, with no ₹ or commas). Show "Copied" for 2 seconds.
- **Inputs:** money has a ₹ prefix with lakh grouping. Phone has a +91 prefix and shows as 5 + 5 digits. The pincode input is mono and letter-spaced. The OTP field is one hidden input behind display boxes, with SMS autofill.
- **Accessibility:** status never relies on colour alone, and nothing depends on hover (there is none on mobile).
- **Copy tone:** plain, short, says what happens next. Never "legal advice", never "verified stamp".

## 5. How to make a change

1. Read the relevant section of `docs/SYSTEM-DESIGN.md` and, for UI, the matching screen in `design/ui/screens/`.
2. **New or changed UI:** design it in the design artifact first and get it approved. Then update `design/ui/` and port it, reusing the existing components in `apps/mobile/src/components`.
3. **New or changed behaviour:** if it changes a flow, status, service boundary or decision, update the system design first. Edit the Claude Doc, then refresh `docs/SYSTEM-DESIGN.md`.
4. Keep the API, the mobile types and the docs in step (section 3).
5. **Before you finish:**
   - `npm test` (API) passes.
   - `npm run typecheck` (API) passes.
   - `npm run typecheck -w @legalkart/mobile` passes.
   - For mobile changes, `npx expo export --platform android` (in `apps/mobile`) bundles.
6. **Tick the execution plan** in the system design when an item is done.

## 6. Changing the rules

These rules change only with the owner's decision. Record the decision in the system design's "Decisions" table, update this file in the same change, and say so in the commit message.

## 7. Current state (update as work lands)

- **Done:**
  - monorepo
  - government-portal e-stamp flow in the API (in-memory store, sandbox OTP)
  - Expo app wired to the API
  - approved UI design saved in `design/ui/` and ported into all app screens
- **Next:**
  - Postgres + Drizzle
  - phone-OTP login
  - S3 file storage
  - real SMS/WhatsApp providers
- **Before launch:**
  - an advocate verifies every stamp rate and the template wording
  - confirm portal steps and certificate formats with one real purchase per state
