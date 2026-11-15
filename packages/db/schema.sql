-- =============================================================================
-- LegalKart Paper Generator — PostgreSQL 16 schema
-- =============================================================================
-- Conventions
--   * Money is stored in PAISE as BIGINT (never floats). ₹1 = 100 paise.
--   * Rates are stored in BASIS POINTS (bps) as INTEGER. 1% = 100 bps, 0.25% = 25 bps.
--   * All timestamps are TIMESTAMPTZ (UTC); display in Asia/Kolkata.
--   * PII columns suffixed _enc hold ciphertext (envelope-encrypted via AWS KMS
--     at the application layer). Never store a full Aadhaar number.
--   * New tables called out in the brief: pincodes, stamp_rates,
--     e_stamp_transactions, party_verifications.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy search on office / locality names
CREATE EXTENSION IF NOT EXISTS btree_gist; -- exclusion constraint on rate validity
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------
CREATE TYPE party_role AS ENUM (
  'LANDLORD', 'TENANT', 'LICENSOR', 'LICENSEE', 'SELLER', 'BUYER',
  'DONOR', 'DONEE', 'PRINCIPAL', 'ATTORNEY', 'DEPONENT', 'WITNESS',
  'CO_OWNER', 'GUARANTOR'
);
CREATE TYPE verification_channel AS ENUM ('SMS', 'WHATSAPP', 'VOICE');
CREATE TYPE verification_status  AS ENUM ('PENDING', 'SENT', 'VERIFIED', 'FAILED', 'EXPIRED', 'LOCKED');
CREATE TYPE document_status AS ENUM (
  'DRAFT',                 -- form being filled
  'AWAITING_VERIFICATION', -- parties added, OTP pending
  'READY_FOR_PAYMENT',     -- all mandatory parties verified, duty quoted
  'PAYMENT_PENDING',
  'PAID',
  'ESTAMP_PROCESSING',
  'ESTAMP_ISSUED',
  'GENERATED',             -- stamped PDF + DOCX produced
  'CANCELLED',
  'FAILED'
);
CREATE TYPE payment_status AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED');
CREATE TYPE estamp_status  AS ENUM (
  'INITIATED',        -- row created, not yet sent to vendor
  'SUBMITTED',        -- request accepted by vendor, awaiting certificate
  'ISSUED',           -- certificate number (UIN) received
  'FULFILMENT_PENDING', -- physical print / courier in progress
  'DELIVERED',
  'FAILED',
  'MANUAL_REVIEW',    -- ambiguous vendor response; ops must reconcile
  'REFUND_REQUESTED',
  'REFUNDED'
);
CREATE TYPE estamp_fulfilment AS ENUM ('DIGITAL_SELF_PRINT', 'ACC_PRINT_COURIER', 'ACC_PICKUP', 'FRANKING');
CREATE TYPE charge_type AS ENUM ('STAMP_DUTY', 'REGISTRATION_FEE', 'SURCHARGE', 'CESS', 'MUTATION_FEE', 'PROCESSING_FEE');
CREATE TYPE duty_basis  AS ENUM (
  'FIXED',                         -- flat amount (e.g. ₹100 affidavit)
  'CONSIDERATION',                 -- % of stated consideration
  'MAX_CONSIDERATION_MARKET_VALUE',-- % of max(consideration, circle-rate value)
  'AVG_ANNUAL_RENT_PLUS_DEPOSIT',  -- leases: % of (avg annual rent + premium/deposit)
  'TOTAL_RENT_PLUS_DEPOSIT',       -- leases: % of (total rent for term + deposit)
  'MH_LEAVE_AND_LICENCE',          -- Maharashtra L&L formula (rent for term + notional interest on deposit)
  'SLAB'                           -- slab table in `slabs`
);
CREATE TYPE area_type AS ENUM ('ANY', 'URBAN', 'RURAL', 'METRO', 'MUNICIPAL_CORPORATION', 'MUNICIPAL_COUNCIL', 'PANCHAYAT');

-- -----------------------------------------------------------------------------
-- Users & profiles (auto-fill source)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164    VARCHAR(16) NOT NULL UNIQUE CHECK (phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  email         CITEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  is_blocked    BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE user_profiles (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name          TEXT NOT NULL,
  relation_type      VARCHAR(4) CHECK (relation_type IN ('S/O', 'D/O', 'W/O', 'C/O')),
  relation_name      TEXT,
  date_of_birth      DATE,
  gender             VARCHAR(16),
  occupation         TEXT,
  pan_enc            BYTEA,          -- encrypted; PAN needed for high-value property deals
  pan_last4          CHAR(4),
  aadhaar_last4      CHAR(4),        -- display/masking only, full number never stored
  address_line1      TEXT,
  address_line2      TEXT,
  city               TEXT,
  pincode            CHAR(6),
  state_code         CHAR(2),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Saved counter-parties ("My landlord", "Tenant – Ravi") for quick re-use.
CREATE TABLE saved_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  details       JSONB NOT NULL,      -- same shape as document_parties.details
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Geography & jurisdiction
-- -----------------------------------------------------------------------------
CREATE TABLE states (
  code                   CHAR(2) PRIMARY KEY,           -- ISO 3166-2:IN suffix: DL, HR, KA, MH, UP ...
  name                   TEXT NOT NULL UNIQUE,
  lgd_code               INTEGER UNIQUE,                -- Local Government Directory code
  is_union_territory     BOOLEAN NOT NULL DEFAULT false,
  estamp_enabled         BOOLEAN NOT NULL DEFAULT false, -- go-live switch per state
  default_estamp_provider TEXT,                         -- 'SHCIL' | 'MH_GRAS' | 'HR_EGRAS' | 'AGGREGATOR_X' | 'MANUAL_OPS'
  stamp_act_ref          TEXT                           -- e.g. 'Maharashtra Stamp Act, 1958'
);

CREATE TABLE districts (
  id         SERIAL PRIMARY KEY,
  state_code CHAR(2) NOT NULL REFERENCES states(code),
  name       TEXT NOT NULL,
  lgd_code   INTEGER UNIQUE,
  UNIQUE (state_code, name)
);

CREATE TABLE sub_registrar_offices (
  id           SERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,      -- internal stable code, e.g. 'HR-GGN-SRO-WAZIRABAD'
  state_code   CHAR(2) NOT NULL REFERENCES states(code),
  district_id  INTEGER NOT NULL REFERENCES districts(id),
  name         TEXT NOT NULL,
  address      TEXT,
  phone        TEXT,
  igr_office_code TEXT,                   -- code used by the state IGR / registration portal
  is_active    BOOLEAN NOT NULL DEFAULT true
);

-- NEW TABLE: pincodes
-- One row per (pincode, post office). A pincode commonly has several post
-- offices and occasionally spans two districts, so the resolver returns a
-- candidate list rather than assuming 1:1.
-- Seed source: India Post "All India Pincode Directory" (data.gov.in, OGD licence).
CREATE TABLE pincodes (
  id            SERIAL PRIMARY KEY,
  pincode       CHAR(6) NOT NULL CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  office_name   TEXT NOT NULL,
  office_type   VARCHAR(8),               -- HO / SO / BO
  delivery      BOOLEAN,
  locality      TEXT,                     -- curated locality / sector name
  district_id   INTEGER NOT NULL REFERENCES districts(id),
  state_code    CHAR(2) NOT NULL REFERENCES states(code),
  area_type     area_type NOT NULL DEFAULT 'ANY',  -- curated: drives urban/rural duty differences
  latitude      NUMERIC(9,6),
  longitude     NUMERIC(9,6),
  source        TEXT NOT NULL DEFAULT 'INDIA_POST_OGD',
  source_updated_on DATE,
  UNIQUE (pincode, office_name)
);
CREATE INDEX pincodes_pincode_idx ON pincodes (pincode);
CREATE INDEX pincodes_office_trgm ON pincodes USING gin (office_name gin_trgm_ops);

-- Pincode → SRO jurisdiction. Not published by India Post; curated from state
-- IGR portals and ops research. confidence < 100 means "ask the user to confirm".
CREATE TABLE pincode_sro_map (
  pincode     CHAR(6) NOT NULL,
  sro_id      INTEGER NOT NULL REFERENCES sub_registrar_offices(id),
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  confidence  SMALLINT NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  notes       TEXT,
  PRIMARY KEY (pincode, sro_id)
);
CREATE UNIQUE INDEX pincode_sro_one_primary ON pincode_sro_map (pincode) WHERE is_primary;

-- -----------------------------------------------------------------------------
-- Document catalogue & templates
-- -----------------------------------------------------------------------------
CREATE TABLE document_types (
  code                    TEXT PRIMARY KEY,   -- 'RENT_AGREEMENT', 'LEAVE_AND_LICENCE', 'SALE_AGREEMENT', ...
  name                    TEXT NOT NULL,
  category                TEXT NOT NULL,      -- RENTAL | SALE | TRANSFER | AUTHORITY | DECLARATION
  requires_estamp         BOOLEAN NOT NULL DEFAULT true,
  registration_mandatory  BOOLEAN NOT NULL DEFAULT false, -- may be overridden per state in template rules
  esign_permitted         BOOLEAN NOT NULL DEFAULT false, -- IT Act 2000, First Schedule exclusions apply
  otp_required_roles      party_role[] NOT NULL DEFAULT '{}',
  is_active               BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key    TEXT NOT NULL,             -- 'rent-agreement.residential'
  version         TEXT NOT NULL,             -- semver
  document_type   TEXT NOT NULL REFERENCES document_types(code),
  state_codes     CHAR(2)[] NOT NULL DEFAULT '{}', -- empty = all states
  locale          VARCHAR(10) NOT NULL DEFAULT 'en-IN',
  definition      JSONB NOT NULL,            -- validated against schemas/document-template.schema.json
  status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'LEGAL_REVIEW', 'PUBLISHED', 'RETIRED')),
  reviewed_by     TEXT,                      -- advocate name / enrolment no.
  reviewed_at     TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,
  UNIQUE (template_key, version)
);

-- NEW TABLE: stamp_rates
-- Data-driven duty/fee rules. The engine picks the MOST SPECIFIC active row:
--   district match > state-wide (district_id NULL); specific area_type > 'ANY';
--   party-attribute rule (e.g. woman buyer) > generic.
-- Every row must carry a source reference and a verification date; rates are
-- legal data, not code, and change by state notification.
CREATE TABLE stamp_rates (
  id                 SERIAL PRIMARY KEY,
  state_code         CHAR(2) NOT NULL REFERENCES states(code),
  district_id        INTEGER REFERENCES districts(id),        -- NULL = state-wide
  area_type          area_type NOT NULL DEFAULT 'ANY',
  document_type      TEXT NOT NULL REFERENCES document_types(code),
  charge_type        charge_type NOT NULL,
  article_ref        TEXT,                    -- Schedule article, e.g. 'Art. 36 Sch. I-A'
  basis              duty_basis NOT NULL,
  rate_bps           INTEGER CHECK (rate_bps >= 0),   -- used for % bases
  fixed_amount_paise BIGINT  CHECK (fixed_amount_paise >= 0),
  min_amount_paise   BIGINT  CHECK (min_amount_paise >= 0),
  max_amount_paise   BIGINT  CHECK (max_amount_paise >= 0),
  slabs              JSONB,                   -- [{ "uptoPaise": 1000000000, "rateBps": 500 }, ...]
  conditions         JSONB NOT NULL DEFAULT '{}', -- e.g. {"buyerGender":"FEMALE"}, {"maxTermMonths":11}
  rounding_unit_paise BIGINT NOT NULL DEFAULT 100, -- round UP to this unit (₹1 default; some states ₹10/₹100)
  priority           SMALLINT NOT NULL DEFAULT 0,  -- tie-breaker, higher wins
  effective_from     DATE NOT NULL,
  effective_to       DATE,                    -- NULL = open-ended
  source_ref         TEXT NOT NULL,           -- notification no. / gazette / IGR URL
  verified_by        TEXT,
  verified_at        DATE,
  CHECK (
    (basis = 'FIXED' AND fixed_amount_paise IS NOT NULL) OR
    (basis = 'SLAB'  AND slabs IS NOT NULL) OR
    (basis NOT IN ('FIXED', 'SLAB') AND rate_bps IS NOT NULL)
  ),
  CHECK (max_amount_paise IS NULL OR min_amount_paise IS NULL OR max_amount_paise >= min_amount_paise),
  -- No two overlapping rows for the same scope + conditions.
  EXCLUDE USING gist (
    state_code WITH =,
    COALESCE(district_id, 0) WITH =,
    area_type WITH =,
    document_type WITH =,
    charge_type WITH =,
    md5(conditions::text) WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
  )
);
CREATE INDEX stamp_rates_lookup ON stamp_rates (state_code, document_type, charge_type, effective_from);

-- Optional: circle / guideline rates for market-value checks on sale deeds.
CREATE TABLE circle_rates (
  id              SERIAL PRIMARY KEY,
  state_code      CHAR(2) NOT NULL REFERENCES states(code),
  district_id     INTEGER NOT NULL REFERENCES districts(id),
  locality        TEXT NOT NULL,
  property_class  TEXT NOT NULL,          -- RESIDENTIAL_PLOT | FLAT | COMMERCIAL | AGRICULTURAL
  rate_paise_per_sqm BIGINT NOT NULL,
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  source_ref      TEXT NOT NULL
);

-- -----------------------------------------------------------------------------
-- Documents & parties
-- -----------------------------------------------------------------------------
CREATE TABLE documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    UUID NOT NULL REFERENCES users(id),
  template_id      UUID NOT NULL REFERENCES templates(id),
  document_type    TEXT NOT NULL REFERENCES document_types(code),
  status           document_status NOT NULL DEFAULT 'DRAFT',
  property_pincode CHAR(6),
  state_code       CHAR(2) REFERENCES states(code),
  district_id      INTEGER REFERENCES districts(id),
  sro_id           INTEGER REFERENCES sub_registrar_offices(id),
  area_type        area_type,
  form_data        JSONB NOT NULL DEFAULT '{}',   -- answers keyed by template field id
  duty_quote       JSONB,                         -- frozen breakdown used for payment
  duty_quote_hash  TEXT,                          -- sha256 of quote; payment must match
  reference_no     TEXT UNIQUE,                   -- human-facing 'LK-2026-000123'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX documents_owner_idx ON documents (owner_user_id, created_at DESC);

CREATE TABLE document_parties (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  role          party_role NOT NULL,
  sequence      SMALLINT NOT NULL DEFAULT 1,     -- Tenant 1, Tenant 2 ...
  is_entity     BOOLEAN NOT NULL DEFAULT false,  -- company / firm / HUF
  full_name     TEXT NOT NULL,
  phone_e164    VARCHAR(16) NOT NULL CHECK (phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  email         TEXT,
  details       JSONB NOT NULL DEFAULT '{}',     -- relation, age, address, occupation, signatory ...
  pan_enc       BYTEA,
  linked_user_id UUID REFERENCES users(id),      -- if the party also has an app account
  otp_required  BOOLEAN NOT NULL DEFAULT false,  -- copied from template at creation
  is_verified   BOOLEAN NOT NULL DEFAULT false,  -- denormalised from party_verifications
  verified_at   TIMESTAMPTZ,
  UNIQUE (document_id, role, sequence)
);

-- NEW TABLE: party_verifications
-- One row per OTP challenge. The OTP itself is never stored — only an HMAC
-- (keyed with a server-side pepper), so a DB leak cannot replay codes.
CREATE TABLE party_verifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id          UUID NOT NULL REFERENCES document_parties(id) ON DELETE CASCADE,
  document_id       UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  phone_e164        VARCHAR(16) NOT NULL,
  channel           verification_channel NOT NULL,
  status            verification_status NOT NULL DEFAULT 'PENDING',
  otp_hmac          TEXT NOT NULL,
  attempts          SMALLINT NOT NULL DEFAULT 0,
  max_attempts      SMALLINT NOT NULL DEFAULT 5,
  resend_count      SMALLINT NOT NULL DEFAULT 0,
  provider          TEXT NOT NULL,          -- 'MSG91' | 'GUPSHUP' | 'META_WA' ...
  provider_message_id TEXT,
  dlt_template_id   TEXT,                   -- TRAI DLT template id used (SMS)
  delivery_status   TEXT,                   -- from provider DLR webhook
  expires_at        TIMESTAMPTZ NOT NULL,
  verified_at       TIMESTAMPTZ,
  consent_text_version TEXT NOT NULL,       -- what the party agreed to by entering the OTP
  request_ip        INET,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (attempts <= max_attempts)
);
CREATE INDEX party_verifications_party_idx ON party_verifications (party_id, created_at DESC);
-- At most one live challenge per party.
CREATE UNIQUE INDEX party_verifications_one_live
  ON party_verifications (party_id) WHERE status IN ('PENDING', 'SENT');

-- -----------------------------------------------------------------------------
-- Payments & e-stamps
-- -----------------------------------------------------------------------------
CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         UUID NOT NULL REFERENCES documents(id),
  user_id             UUID NOT NULL REFERENCES users(id),
  gateway             TEXT NOT NULL,            -- 'RAZORPAY' | 'CASHFREE'
  gateway_order_id    TEXT NOT NULL UNIQUE,
  gateway_payment_id  TEXT UNIQUE,
  status              payment_status NOT NULL DEFAULT 'CREATED',
  amount_paise        BIGINT NOT NULL CHECK (amount_paise > 0),
  -- Breakdown: government money is a pass-through and is accounted separately
  -- from LegalKart's taxable service fee.
  govt_duty_paise     BIGINT NOT NULL DEFAULT 0,
  vendor_fee_paise    BIGINT NOT NULL DEFAULT 0, -- ACC / aggregator service charge
  service_fee_paise   BIGINT NOT NULL DEFAULT 0,
  gst_paise           BIGINT NOT NULL DEFAULT 0, -- GST on service + vendor fee
  duty_quote_hash     TEXT NOT NULL,
  method              TEXT,                      -- upi / card / netbanking
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_at         TIMESTAMPTZ,
  CHECK (amount_paise = govt_duty_paise + vendor_fee_paise + service_fee_paise + gst_paise)
);

-- NEW TABLE: e_stamp_transactions
CREATE TABLE e_stamp_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           UUID NOT NULL REFERENCES documents(id),
  payment_id            UUID NOT NULL REFERENCES payments(id),
  idempotency_key       TEXT NOT NULL UNIQUE,     -- sent to vendor; retries reuse it
  provider              TEXT NOT NULL,            -- 'SHCIL' | 'MH_GRAS' | 'HR_EGRAS' | 'AGGREGATOR_X' | 'MANUAL_OPS'
  provider_request_id   TEXT,
  status                estamp_status NOT NULL DEFAULT 'INITIATED',
  fulfilment_mode       estamp_fulfilment NOT NULL,
  state_code            CHAR(2) NOT NULL REFERENCES states(code),
  article_code          TEXT NOT NULL,            -- state stamp-schedule article for this instrument
  description_of_document TEXT NOT NULL,          -- printed on certificate
  property_description  TEXT,
  consideration_paise   BIGINT NOT NULL DEFAULT 0,
  stamp_duty_paise      BIGINT NOT NULL CHECK (stamp_duty_paise >= 0),
  first_party_name      TEXT NOT NULL,
  second_party_name     TEXT NOT NULL,
  duty_paid_by          TEXT NOT NULL,            -- name of party paying duty
  purchased_by          TEXT NOT NULL,
  -- Issued certificate (filled when status = ISSUED)
  certificate_no        TEXT UNIQUE,              -- e.g. 'IN-DL12345678901234X' (UIN / URN)
  unique_doc_reference  TEXT,                     -- vendor's UDRN / GRN where applicable
  issued_at             TIMESTAMPTZ,
  acc_code              TEXT,                     -- Authorised Collection Centre code
  certificate_file_key  TEXT,                     -- S3 key of certificate PDF/image
  verification_url      TEXT,                     -- public verify page for this certificate
  courier_awb           TEXT,
  raw_request           JSONB,                    -- redacted copies for audit
  raw_response          JSONB,
  failure_reason        TEXT,
  attempt_count         SMALLINT NOT NULL DEFAULT 0,
  next_poll_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'ISSUED' OR certificate_no IS NOT NULL)
);
CREATE INDEX e_stamp_poll_idx ON e_stamp_transactions (next_poll_at) WHERE status IN ('SUBMITTED', 'MANUAL_REVIEW');
-- One successful stamp per document (re-stamping requires cancelling the old row).
CREATE UNIQUE INDEX e_stamp_one_active_per_doc
  ON e_stamp_transactions (document_id)
  WHERE status IN ('INITIATED', 'SUBMITTED', 'ISSUED', 'FULFILMENT_PENDING', 'DELIVERED', 'MANUAL_REVIEW');

-- -----------------------------------------------------------------------------
-- Outputs, consent, audit, webhooks
-- -----------------------------------------------------------------------------
CREATE TABLE document_outputs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  format        TEXT NOT NULL CHECK (format IN ('PDF', 'DOCX', 'PREVIEW_PDF')),
  file_key      TEXT NOT NULL,         -- S3 object key (SSE-KMS)
  sha256        CHAR(64) NOT NULL,     -- printed in footer QR for tamper check
  template_version TEXT NOT NULL,
  e_stamp_id    UUID REFERENCES e_stamp_transactions(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id),
  party_id     UUID REFERENCES document_parties(id),
  purpose      TEXT NOT NULL,          -- 'TERMS', 'DPDP_NOTICE', 'DISCLAIMER_ACK', 'PARTY_OTP_CONSENT'
  text_version TEXT NOT NULL,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ,
  CHECK (user_id IS NOT NULL OR party_id IS NOT NULL)
);

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor       TEXT NOT NULL,           -- 'user:<uuid>' | 'system' | 'ops:<email>'
  action      TEXT NOT NULL,           -- 'PARTY_VERIFIED', 'ESTAMP_ISSUED', ...
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at);

-- Inbound webhooks (payment gateway, SMS DLR, e-stamp vendor) — dedupe by event id.
CREATE TABLE webhook_events (
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  PRIMARY KEY (provider, event_id)
);
