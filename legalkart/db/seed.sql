-- =============================================================================
-- LegalKart — SAMPLE seed data for development and tests.
--
-- !! THE RATES BELOW ARE ILLUSTRATIVE PLACEHOLDERS, NOT LEGAL ADVICE !!
-- Stamp duty and registration fees change by state notification and often
-- depend on area, property class, gender of transferee and instrument article.
-- Before go-live every stamp_rates row must be re-sourced from the state IGR /
-- revenue department, signed off by an advocate (verified_by / verified_at),
-- and given a real source_ref. Rows with verified_at IS NULL must never be
-- used for a live e-stamp purchase (the engine enforces this in production).
-- =============================================================================

INSERT INTO states (code, name, lgd_code, is_union_territory, estamp_enabled, default_estamp_provider, stamp_act_ref) VALUES
  ('DL', 'Delhi',       7,  true,  true,  'SHCIL',      'Indian Stamp Act, 1899 (as applicable to Delhi)'),
  ('HR', 'Haryana',     6,  false, true,  'HR_EGRAS',   'Indian Stamp Act, 1899 (Haryana amendments)'),
  ('KA', 'Karnataka',   29, false, true,  'SHCIL',      'Karnataka Stamp Act, 1957'),
  ('MH', 'Maharashtra', 27, false, false, 'MH_GRAS',    'Maharashtra Stamp Act, 1958');

INSERT INTO districts (id, state_code, name) VALUES
  (1, 'DL', 'South Delhi'),
  (2, 'HR', 'Gurugram'),
  (3, 'KA', 'Bengaluru Urban'),
  (4, 'MH', 'Mumbai Suburban');
SELECT setval('districts_id_seq', 4);

INSERT INTO sub_registrar_offices (id, code, state_code, district_id, name) VALUES
  (1, 'DL-SD-SR-V',        'DL', 1, 'Sub-Registrar V, Mehrauli'),
  (2, 'HR-GGN-WAZIRABAD',  'HR', 2, 'Sub-Registrar Wazirabad, Gurugram'),
  (3, 'HR-GGN-GURGAON',    'HR', 2, 'Sub-Registrar Gurugram'),
  (4, 'KA-BLR-JAYANAGAR',  'KA', 3, 'Sub-Registrar Jayanagar'),
  (5, 'MH-MUM-ANDHERI-1',  'MH', 4, 'Joint Sub-Registrar Andheri-1');
SELECT setval('sub_registrar_offices_id_seq', 5);

-- Post-office rows (subset). Real seed: India Post directory from data.gov.in.
INSERT INTO pincodes (pincode, office_name, office_type, delivery, district_id, state_code, area_type) VALUES
  ('110017', 'Malviya Nagar S.O',  'SO', true, 1, 'DL', 'METRO'),
  ('110017', 'Saket S.O',          'SO', true, 1, 'DL', 'METRO'),
  ('122001', 'Gurgaon H.O',        'HO', true, 2, 'HR', 'URBAN'),
  ('122001', 'Sector 12 Gurgaon',  'SO', true, 2, 'HR', 'URBAN'),
  ('560034', 'Koramangala S.O',    'SO', true, 3, 'KA', 'URBAN'),
  ('400053', 'Azad Nagar S.O',     'SO', true, 4, 'MH', 'METRO');

INSERT INTO pincode_sro_map (pincode, sro_id, is_primary, confidence, notes) VALUES
  ('110017', 1, true, 90, NULL),
  ('122001', 3, true, 70, 'Some sectors fall under Wazirabad SRO — confirm with user'),
  ('122001', 2, false, 30, NULL),
  ('560034', 4, true, 80, NULL),
  ('400053', 5, true, 80, NULL);

INSERT INTO document_types (code, name, category, requires_estamp, registration_mandatory, esign_permitted, otp_required_roles) VALUES
  ('RENT_AGREEMENT',    'Residential Rent Agreement (≤ 11 months)', 'RENTAL', true, false, false, '{TENANT}'),
  ('LEAVE_AND_LICENCE', 'Leave & Licence Agreement (Maharashtra)',  'RENTAL', true, true,  false, '{LICENSEE}'),
  ('SALE_AGREEMENT',    'Agreement to Sell',                        'SALE',   true, false, false, '{BUYER}'),
  ('AFFIDAVIT_GENERAL', 'General Affidavit',                        'DECLARATION', true, false, false, '{}');

-- Rent agreement duty (ILLUSTRATIVE)
INSERT INTO stamp_rates (state_code, document_type, charge_type, article_ref, basis, rate_bps, fixed_amount_paise, min_amount_paise, max_amount_paise, conditions, effective_from, source_ref) VALUES
  ('DL', 'RENT_AGREEMENT', 'STAMP_DUTY', 'Lease ≤ 1 yr', 'FIXED',                         NULL, 10000, NULL, NULL,  '{"maxTermMonths":11}', '2024-04-01', 'ILLUSTRATIVE — verify with Delhi Revenue Dept'),
  ('HR', 'RENT_AGREEMENT', 'STAMP_DUTY', 'Lease ≤ 5 yr', 'AVG_ANNUAL_RENT_PLUS_DEPOSIT',  150,  NULL,  10000, NULL,  '{"maxTermMonths":11}', '2024-04-01', 'ILLUSTRATIVE — verify with IGR Haryana'),
  ('KA', 'RENT_AGREEMENT', 'STAMP_DUTY', 'Art. 30 lease ≤ 1 yr', 'AVG_ANNUAL_RENT_PLUS_DEPOSIT', 50, NULL, NULL, 50000, '{"maxTermMonths":11}', '2024-04-01', 'ILLUSTRATIVE — verify with Kaveri / IGR Karnataka'),
  ('MH', 'LEAVE_AND_LICENCE', 'STAMP_DUTY', 'Art. 36A', 'MH_LEAVE_AND_LICENCE',         25,   NULL,  10000, NULL,  '{}',                     '2024-04-01', 'ILLUSTRATIVE — verify with IGR Maharashtra');

INSERT INTO stamp_rates (state_code, area_type, document_type, charge_type, basis, fixed_amount_paise, conditions, effective_from, source_ref) VALUES
  ('MH', 'METRO', 'LEAVE_AND_LICENCE', 'REGISTRATION_FEE', 'FIXED', 100000, '{}', '2024-04-01', 'ILLUSTRATIVE — verify with IGR Maharashtra'),
  ('MH', 'RURAL', 'LEAVE_AND_LICENCE', 'REGISTRATION_FEE', 'FIXED',  50000, '{}', '2024-04-01', 'ILLUSTRATIVE — verify with IGR Maharashtra');

-- Agreement to sell: gender-based concession example (ILLUSTRATIVE)
INSERT INTO stamp_rates (state_code, area_type, document_type, charge_type, basis, rate_bps, conditions, priority, effective_from, source_ref) VALUES
  ('HR', 'URBAN', 'SALE_AGREEMENT', 'STAMP_DUTY', 'MAX_CONSIDERATION_MARKET_VALUE', 700, '{}',                        0, '2024-04-01', 'ILLUSTRATIVE'),
  ('HR', 'URBAN', 'SALE_AGREEMENT', 'STAMP_DUTY', 'MAX_CONSIDERATION_MARKET_VALUE', 500, '{"buyerGender":"FEMALE"}',  10, '2024-04-01', 'ILLUSTRATIVE');

INSERT INTO stamp_rates (state_code, document_type, charge_type, basis, fixed_amount_paise, effective_from, source_ref) VALUES
  ('DL', 'AFFIDAVIT_GENERAL', 'STAMP_DUTY', 'FIXED', 1000, '2024-04-01', 'ILLUSTRATIVE'),
  ('HR', 'AFFIDAVIT_GENERAL', 'STAMP_DUTY', 'FIXED', 1500, '2024-04-01', 'ILLUSTRATIVE');
