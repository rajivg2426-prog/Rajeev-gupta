# LegalKart Paper Generator

Specification and reference implementation for a mobile app that produces ready-to-sign Indian property documents. It covers:
- pincode-based jurisdiction and stamp-duty mapping
- OTP verification of tenants and buyers
- online e-stamp purchase
- stamped PDF and editable DOCX output

**Start with [SPEC.md](SPEC.md).** It covers the tech stack, database schema, integration flows, template JSON Schema, build plan and sample code.

| | |
|---|---|
| [`SPEC.md`](SPEC.md) | Full product and technical specification, sections (a)–(f) |
| [`db/`](db) | PostgreSQL 16 schema and an illustrative seed |
| [`schemas/`](schemas) | JSON Schemas for templates and filled documents |
| [`templates/`](templates) | Residential Rent Agreement template |
| [`server/`](server) | TypeScript/Fastify reference backend (`npm test`, `npm run demo`) |
| [`mobile/`](mobile) | React Native OTP and e-stamp checkout screens |
| [`samples/`](samples) | Generated stamped PDF (sandbox certificate), DOCX and instance JSON |

> All stamp-duty rates here are illustrative placeholders. Verify every rate against state notifications, with an advocate, before going live.
