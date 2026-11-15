# LegalKart

A mobile app for India that produces ready-to-sign property documents, starting with the residential rent agreement:

- pincode → state, district, Sub-Registrar Office and stamp duty
- tenant mobile verification by OTP
- the exact e-stamp to buy, with a handoff to the official government portal (the customer buys and pays there)
- agreement PDF and editable DOCX, with the e-stamp certificate number when the customer adds it

**Start with [docs/SYSTEM-DESIGN.md](docs/SYSTEM-DESIGN.md)**, the target architecture and plan. The editable source of that doc is a Claude Doc linked at its top.

> The repo is mid-rebuild. `apps/api` still contains the older reference flow (in-app payment and sandbox e-stamp purchase); the system design describes what replaces it.

## Layout

| Path | What it is |
|---|---|
| [`apps/api`](apps/api) | TypeScript/Fastify backend: pincode resolver, duty engine, OTP, documents, PDF/DOCX rendering |
| `apps/mobile` | Expo app (coming next) |
| [`packages/templates`](packages/templates) | Document templates and JSON Schemas for templates and filled documents |
| [`packages/db`](packages/db) | PostgreSQL 16 schema and an illustrative seed |
| [`docs`](docs) | System design, original spec, user guide, marketing plan, PDFs, sample outputs |
| [`docs/legacy`](docs/legacy) | Old React Native checkout sample, kept for reference |
| [`tools/docs-pdf`](tools/docs-pdf) | Builds `docs/pdf/` from the Markdown docs |

## Run it

Needs Node 22+.

```bash
npm install
```

```bash
npm test          # API test suite
```

```bash
npm run dev:api   # API on :8080 with sandbox providers; OTPs print to the console
```

```bash
npm run demo      # writes docs/samples/rent-agreement-sample.{pdf,docx,html} + instance JSON
```

PDF output needs Chromium. Set `CHROMIUM_PATH` (defaults to `/opt/pw-browsers/chromium`).

> All stamp-duty rates here are illustrative placeholders. Verify every rate against state notifications, with an advocate, before going live.
