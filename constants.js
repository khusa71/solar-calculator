// Solar Calculator — constants & lookup tables
// All references map back to LOGIC.md sections.

// §3.1 DISCOM table — extended with `zone` and `settlement_period` per §17.1.6
// settlement_period: "Annual" credits at full retail; "Monthly" credits exports at APPC factor.
export const DISCOMS = [
  { key: 'RJ-KEDL',     state: 'Rajasthan',     discom: 'KEDL (Kota)',         tariff: 8.50, zone: 'VeryHigh', state_subsidy: 0,                  nm_factor: 0.50, settlement: 'Annual' },
  { key: 'RJ-JVVNL',    state: 'Rajasthan',     discom: 'JVVNL (Jaipur)',      tariff: 8.00, zone: 'VeryHigh', state_subsidy: 0,                  nm_factor: 0.50, settlement: 'Annual' },
  { key: 'RJ-AVVNL',    state: 'Rajasthan',     discom: 'AVVNL (Ajmer)',       tariff: 8.00, zone: 'VeryHigh', state_subsidy: 0,                  nm_factor: 0.50, settlement: 'Annual' },
  { key: 'MH-MSEDCL',   state: 'Maharashtra',   discom: 'MSEDCL',              tariff: 10.00, zone: 'Moderate', state_subsidy: 0,                 nm_factor: 0.45, settlement: 'Monthly' },
  { key: 'KA-BESCOM',   state: 'Karnataka',     discom: 'BESCOM',              tariff: 7.75, zone: 'Moderate', state_subsidy: 0,                  nm_factor: 0.50, settlement: 'Annual' },
  { key: 'GJ-UGVCL',    state: 'Gujarat',       discom: 'UGVCL',               tariff: 6.25, zone: 'VeryHigh', state_subsidy: 10000,              nm_factor: 0.50, settlement: 'Monthly' },
  { key: 'GJ-PGVCL',    state: 'Gujarat',       discom: 'PGVCL',               tariff: 6.25, zone: 'VeryHigh', state_subsidy: 10000,              nm_factor: 0.50, settlement: 'Monthly' },
  { key: 'DL-BSES-R',   state: 'Delhi',         discom: 'BSES Rajdhani',       tariff: 7.00, zone: 'High',     state_subsidy_per_kw: 2000, state_subsidy_cap: 10000, nm_factor: 1.00, settlement: 'Annual' },
  { key: 'DL-BSES-Y',   state: 'Delhi',         discom: 'BSES Yamuna',         tariff: 7.00, zone: 'High',     state_subsidy_per_kw: 2000, state_subsidy_cap: 10000, nm_factor: 1.00, settlement: 'Annual' },
  { key: 'DL-NDPL',     state: 'Delhi',         discom: 'Tata Power Delhi',    tariff: 6.50, zone: 'High',     state_subsidy_per_kw: 2000, state_subsidy_cap: 10000, nm_factor: 1.00, settlement: 'Annual' },
  { key: 'TN-TNEB',     state: 'Tamil Nadu',    discom: 'TNEB',                tariff: 6.50, zone: 'Moderate', state_subsidy: 0,                  nm_factor: 0.45, settlement: 'Annual' },
  { key: 'UP-UPPCL',    state: 'Uttar Pradesh', discom: 'UPPCL',               tariff: 7.00, zone: 'High',     state_subsidy: 0,                  nm_factor: 0.45, settlement: 'Annual' },
  { key: 'TS-TSSPDCL',  state: 'Telangana',     discom: 'TSSPDCL',             tariff: 7.00, zone: 'High',     state_subsidy: 0,                  nm_factor: 0.45, settlement: 'Annual' },
  { key: 'KL-KSEB',     state: 'Kerala',        discom: 'KSEB',                tariff: 6.50, zone: 'Lower',    state_subsidy: 0,                  nm_factor: 0.50, settlement: 'Annual' },
  { key: 'WB-CESC',     state: 'West Bengal',   discom: 'CESC',                tariff: 8.50, zone: 'Lower',    state_subsidy: 0,                  nm_factor: 0.40, settlement: 'Monthly' },
  { key: 'HR-DHBVN',    state: 'Haryana',       discom: 'DHBVN',               tariff: 6.50, zone: 'High',     state_subsidy: 0,                  nm_factor: 0.50, settlement: 'Annual' },
  { key: 'PB-PSPCL',    state: 'Punjab',        discom: 'PSPCL',               tariff: 6.00, zone: 'High',     state_subsidy: 0,                  nm_factor: 0.50, settlement: 'Annual' },
  { key: 'MP-MPPKVVCL', state: 'Madhya Pradesh',discom: 'MPPKVVCL',            tariff: 7.00, zone: 'VeryHigh', state_subsidy: 0,                  nm_factor: 0.50, settlement: 'Annual' },
  { key: 'BR-BSPHCL',   state: 'Bihar',         discom: 'BSPHCL',              tariff: 6.50, zone: 'High',     state_subsidy: 0,                  nm_factor: 0.45, settlement: 'Annual' },
  { key: 'OTHER',       state: 'Other',         discom: '—',                   tariff: 7.00, zone: 'Moderate', state_subsidy: 0,                  nm_factor: 0.45, settlement: 'Annual' },
];

// Slab tariff schedules per DISCOM. Required for honest bill inference and
// top-of-stack savings valuation. Solar offsets units off the highest slab
// first, so a flat-tariff approximation overstates savings for small users
// and understates the marginal rate for large users.
//
// Schema:
//   slabs: array of { upto: kWh ceiling (Infinity for top), rate: ₹/kWh }
//   fixed_charge_inr_mo: ₹/month independent of consumption
//   duty_pct: % of energy charge (electricity duty + cesses, decimal form)
//
// Sources are best-effort from public tariff orders (FY24/25). Each entry is
// flagged `_source: 'verified' | 'estimated' | 'fallback'`. Estimated entries
// match the slab *shape* of typical India residential / commercial schedules
// but specific rates may differ from the current order — verify before launch.
//
// Tariff category keys:
//   residential_lt:  Domestic, single/three-phase, low-tension supply
//   commercial_lt:   Non-domestic, low-tension (small shops, offices)
const FALLBACK_RESIDENTIAL = (avgRate) => ({
  slabs: [
    { upto: 100,      rate: avgRate * 0.65 },
    { upto: 300,      rate: avgRate * 0.90 },
    { upto: 500,      rate: avgRate * 1.05 },
    { upto: Infinity, rate: avgRate * 1.18 },
  ],
  fixed_charge_inr_mo: 100,
  duty_pct: 0.05,
  _source: 'fallback',
});

const FALLBACK_COMMERCIAL = (avgRate) => ({
  slabs: [
    { upto: 100,      rate: avgRate * 0.95 },
    { upto: 200,      rate: avgRate * 1.05 },
    { upto: 500,      rate: avgRate * 1.10 },
    { upto: Infinity, rate: avgRate * 1.15 },
  ],
  fixed_charge_inr_mo: 300,
  duty_pct: 0.06,
  _source: 'fallback',
});

export const TARIFF_SCHEDULES = {
  // ── Rajasthan (KEDL/JVVNL/AVVNL share residential structure) ──────────
  // Verified against the user-supplied 560-unit example bill.
  'RJ-KEDL': {
    residential_lt: {
      slabs: [
        { upto: 50,       rate: 4.75 },
        { upto: 150,      rate: 6.50 },
        { upto: 300,      rate: 7.35 },
        { upto: 500,      rate: 7.65 },
        { upto: Infinity, rate: 7.95 },
      ],
      fixed_charge_inr_mo: 450,
      duty_pct: 0.056,
      _source: 'verified',
    },
    commercial_lt: {
      slabs: [
        { upto: 100,      rate: 7.55 },
        { upto: 200,      rate: 8.55 },
        { upto: 500,      rate: 8.85 },
        { upto: Infinity, rate: 8.95 },
      ],
      fixed_charge_inr_mo: 300,
      duty_pct: 0.06,
      _source: 'verified',
    },
  },
  // RJ-JVVNL uses RERC published base schedule (not bundled like user's KEDL bill).
  // Source: RERC Tariff Order FY2024-25 — JVVNL Tariff PDF.
  // https://cescrajasthan.co.in/kedl/pages/event/uploads/JVVNL_Tariff-24.pdf
  'RJ-JVVNL': {
    residential_lt: {
      slabs: [
        { upto: 50,       rate: 3.00 },
        { upto: 150,      rate: 4.75 },
        { upto: 300,      rate: 5.75 },
        { upto: 500,      rate: 6.75 },
        { upto: Infinity, rate: 7.25 },
      ],
      fixed_charge_inr_mo: 275,        // tiered: ~₹250 (≤150u), ₹300 (≤300u), ₹400 (≤500u), ₹450 (>500u)
      duty_pct: 0.07,
      _source: 'verified',
      _effective_date: '2024-04-01',
      _notes: 'RERC unified schedule for JVVNL/AVVNL. KEDL bundles FSA into rates separately. Add FAC ~₹0.40/u.',
    },
    commercial_lt: {
      slabs: [
        { upto: 100,      rate: 7.55 },
        { upto: 200,      rate: 8.55 },
        { upto: 500,      rate: 8.85 },
        { upto: Infinity, rate: 8.95 },
      ],
      fixed_charge_inr_mo: 300,
      duty_pct: 0.06,
      _source: 'estimated',
      _notes: 'NDS small commercial ≤5kW. Verify against current RERC order.',
    },
  },
  'RJ-AVVNL': { residential_lt: null, commercial_lt: null, _ref: 'RJ-JVVNL', _notes: 'RERC unified across JVVNL/AVVNL.' },

  // ── Maharashtra MSEDCL ────────────────────────────────────────────────
  // Source: MERC MYT Order Case 217/2024.
  // https://www.mahadiscom.in/consumer/wp-content/uploads/2025/08/MSEDCL-MYT-Order_Case_no_217-of-2024.pdf
  'MH-MSEDCL': {
    residential_lt: {
      slabs: [
        { upto: 100,      rate: 3.46 },
        { upto: 300,      rate: 6.21 },
        { upto: 500,      rate: 9.45 },
        { upto: 1000,     rate: 10.41 },
        { upto: Infinity, rate: 11.21 },
      ],
      fixed_charge_inr_mo: 128,        // mid of ₹50-250 by load; ~₹128 typical 3-5kW
      duty_pct: 0.16,                  // MH residential duty 16% (highest in India)
      _source: 'verified',
      _effective_date: '2024-04-01',
      _notes: 'Add FAC ~₹0.40/u quarterly.',
    },
    commercial_lt: {
      slabs: [
        { upto: 20,       rate: 7.50 },
        { upto: Infinity, rate: 11.10 },
      ],
      fixed_charge_inr_mo: 350,
      duty_pct: 0.21,                  // MH commercial duty ~21%
      _source: 'estimated',
      _notes: 'LT-II Non-residential <20 kW. Detailed slabs vary by demand band.',
    },
  },

  // ── Karnataka BESCOM ──────────────────────────────────────────────────
  // Source: KERC Tariff Order 2024 — https://kerc.karnataka.gov.in/133/tariff-order-2024/en
  'KA-BESCOM': {
    residential_lt: {
      slabs: [
        { upto: 30,       rate: 3.15 },
        { upto: 100,      rate: 5.55 },
        { upto: 200,      rate: 7.10 },
        { upto: 500,      rate: 7.65 },
        { upto: Infinity, rate: 8.25 },
      ],
      fixed_charge_inr_mo: 110,        // ₹30-85/kW based on load
      duty_pct: 0.06,
      _source: 'verified',
      _effective_date: '2024-04-01',
      _notes: 'KERC LT-2a. Gruha Jyothi: first 200u free for eligible households (apply separately).',
    },
    commercial_lt: {
      slabs: [
        { upto: 50,       rate: 7.75 },
        { upto: Infinity, rate: 8.65 },
      ],
      fixed_charge_inr_mo: 180,        // ₹180/kW sanctioned load
      duty_pct: 0.06,
      _source: 'estimated',
      _notes: 'LT-3 commercial. Fixed charge actually per-kW.',
    },
  },

  // ── Tamil Nadu TNEB / TANGEDCO ────────────────────────────────────────
  // Source: TNERC Tariff Order Jul 2024.
  // https://www.eqmagpro.com/wp-content/uploads/2024/07/TO-Order-No-6150720241000_compressed.pdf
  'TN-TNEB': {
    residential_lt: {
      slabs: [
        { upto: 100,      rate: 0.00 },   // first 100u free (tariff-level)
        { upto: 200,      rate: 1.50 },
        { upto: 500,      rate: 3.00 },
        { upto: 1000,     rate: 4.50 },
        { upto: Infinity, rate: 6.00 },
      ],
      fixed_charge_inr_mo: 50,
      duty_pct: 0.05,
      _source: 'verified',
      _effective_date: '2024-07-01',
      _notes: 'TNERC LT-IA. First 100u is tariff-level free, not external subsidy. >500u/mo switches to non-telescopic structure (simplified here).',
    },
    commercial_lt: {
      slabs: [
        { upto: 100,      rate: 5.50 },
        { upto: Infinity, rate: 8.05 },
      ],
      fixed_charge_inr_mo: 107,        // ₹107/kW
      duty_pct: 0.05,
      _source: 'estimated',
      _notes: 'LT-V commercial. Peak hours +25% surcharge. Common-area at ₹8.55/u.',
    },
  },

  // ── Gujarat (DGVCL/MGVCL/PGVCL/UGVCL — uniform across all 4) ──────────
  // Source: GERC Tariff Schedule effective 01-04-2025.
  // https://gercin.org/wp-content/uploads/2025/04/Tariff-Schedule-of-DGVCL-MGVCL-PGVCL-UGVCL-w.e.f.-01.04.2025.pdf
  'GJ-UGVCL': {
    residential_lt: {
      slabs: [
        { upto: 50,       rate: 3.20 },
        { upto: 100,      rate: 3.65 },
        { upto: 250,      rate: 4.50 },
        { upto: Infinity, rate: 5.45 },
      ],
      fixed_charge_inr_mo: 25,         // ₹15 (≤2kW) or ₹25/kW (>2kW)
      duty_pct: 0.15,                  // GJ residential duty ~15%
      _source: 'estimated',
      _effective_date: '2024-06-01',
      _notes: 'GERC RGP urban. Uniform across DGVCL/MGVCL/PGVCL/UGVCL.',
    },
    commercial_lt: {
      slabs: [
        { upto: Infinity, rate: 4.90 },
      ],
      fixed_charge_inr_mo: 70,
      duty_pct: 0.20,
      _source: 'unverified',
      _notes: 'GLP non-RGP placeholder; verify with GERC schedule.',
    },
  },
  'GJ-PGVCL': { residential_lt: null, commercial_lt: null, _ref: 'GJ-UGVCL', _notes: 'GERC mandates identical schedule.' },

  // ── Delhi (uniform DERC schedule across BRPL/BYPL/TPDDL) ──────────────
  // Source: DERC Tariff Order F.17(86)/DERC/2024-25/TO/239 — https://www.derc.gov.in/tarriff-orders
  'DL-BSES-R': {
    residential_lt: {
      slabs: [
        { upto: 200,      rate: 3.00 },
        { upto: 400,      rate: 4.50 },
        { upto: 800,      rate: 6.50 },
        { upto: 1200,     rate: 7.00 },
        { upto: Infinity, rate: 8.00 },
      ],
      fixed_charge_inr_mo: 125,        // ₹20-25/kW; typical 5kW = ₹125
      duty_pct: 0.05,
      _source: 'verified',
      _effective_date: '2024-08-01',
      _notes: 'Pre-subsidy. Delhi govt: 0-200u free, 201-400u 50% off (apply separately). Add PPAC ~25-40% (BRPL ~30%, BYPL ~35-40%, TPDDL ~25-30%).',
    },
    commercial_lt: {
      slabs: [
        { upto: Infinity, rate: 8.50 },
      ],
      fixed_charge_inr_mo: 250,
      duty_pct: 0.05,
      _source: 'unverified',
      _notes: 'Non-domestic <3kW ~₹8.50/u; tiered 3-25kW. PPAC additional. Verify on DERC schedule.',
    },
  },
  'DL-BSES-Y': { residential_lt: null, commercial_lt: null, _ref: 'DL-BSES-R', _notes: 'Same DERC schedule; PPAC ~35-40%.' },
  'DL-NDPL':   { residential_lt: null, commercial_lt: null, _ref: 'DL-BSES-R', _notes: 'Same DERC schedule; PPAC ~25-30%.' },

  // ── Uttar Pradesh UPPCL (urban) ───────────────────────────────────────
  // Source: UPERC Tariff Order 2024-25 (effective 10-Oct-2024).
  // https://uppcl.org/site/writereaddata/siteContent/202410152002041985Tariff%20Order%2024-25.pdf
  'UP-UPPCL': {
    residential_lt: {
      slabs: [
        { upto: 100,      rate: 5.50 },
        { upto: 150,      rate: 5.50 },
        { upto: 300,      rate: 6.00 },
        { upto: Infinity, rate: 6.50 },
      ],
      fixed_charge_inr_mo: 110,        // ₹110/kW urban
      duty_pct: 0.05,
      _source: 'verified',
      _effective_date: '2024-10-10',
      _notes: 'UPERC LMV-1 urban single-phase. Rural & BPL have separate schedules.',
    },
    commercial_lt: {
      slabs: [
        { upto: Infinity, rate: 8.30 },
      ],
      fixed_charge_inr_mo: 150,        // ₹150/kW
      duty_pct: 0.05,
      _source: 'estimated',
      _notes: 'LMV-2 non-domestic small.',
    },
  },

  // ── Telangana TSSPDCL ─────────────────────────────────────────────────
  // Source: TGERC Order on extension of tariff for FY 2024-25.
  // https://www.tgerc.telangana.gov.in/file_upload/uploads/Tariff%20Orders/Current%20Year%20Orders/2024/7%20Order%20on%20extension%20of%20tariff%20for%20FY%202024-25.pdf
  'TS-TSSPDCL': {
    residential_lt: {
      slabs: [
        { upto: 50,       rate: 1.95 },
        { upto: 100,      rate: 3.10 },
        { upto: 200,      rate: 4.80 },
        { upto: 300,      rate: 7.70 },
        { upto: 400,      rate: 9.00 },
        { upto: 800,      rate: 9.50 },
        { upto: Infinity, rate: 10.00 },
      ],
      fixed_charge_inr_mo: 50,
      duty_pct: 0.06,
      _source: 'verified',
      _effective_date: '2024-04-01',
      _notes: 'TGERC Cat-I LT-1 (simplified). Gruha Jyothi: 200u free for eligible.',
    },
    commercial_lt: {
      slabs: [
        { upto: 50,       rate: 7.40 },
        { upto: Infinity, rate: 9.05 },
      ],
      fixed_charge_inr_mo: 100,
      duty_pct: 0.06,
      _source: 'estimated',
      _notes: 'LT-II non-domestic.',
    },
  },

  // ── Kerala KSEB ───────────────────────────────────────────────────────
  // Source: KSERC — https://erckerala.org/
  'KL-KSEB': {
    residential_lt: {
      slabs: [
        { upto: 50,       rate: 3.25 },
        { upto: 100,      rate: 4.05 },
        { upto: 150,      rate: 5.10 },
        { upto: 200,      rate: 6.95 },
        { upto: 250,      rate: 8.20 },
        { upto: Infinity, rate: 7.60 },   // simplified non-telescopic average
      ],
      fixed_charge_inr_mo: 65,         // ₹65/mo single-phase ≤100u
      duty_pct: 0.10,                  // KL duty ~10%
      _source: 'verified',
      _effective_date: '2024-11-01',
      _notes: 'KSERC LT-1A. >250u/mo switches to non-telescopic (simplified). KSEB bills bimonthly.',
    },
    commercial_lt: {
      slabs: [
        { upto: 50,       rate: 8.40 },
        { upto: 100,      rate: 9.05 },
        { upto: Infinity, rate: 9.65 },
      ],
      fixed_charge_inr_mo: 100,
      duty_pct: 0.10,
      _source: 'estimated',
      _notes: 'LT-VII commercial small.',
    },
  },

  // ── West Bengal CESC (Kolkata) ────────────────────────────────────────
  // Source: WBERC order 03-Sep-2024 — CESC tariff PDF 2024-25.
  // https://www.cesc.co.in/storage/uploads/tariff/Tariff_and_associated_conditions_2024-25.pdf
  'WB-CESC': {
    residential_lt: {
      slabs: [
        { upto: 25,       rate: 5.18 },
        { upto: 60,       rate: 5.69 },
        { upto: 100,      rate: 6.70 },
        { upto: 150,      rate: 7.45 },
        { upto: 300,      rate: 7.62 },
        { upto: Infinity, rate: 9.21 },
      ],
      fixed_charge_inr_mo: 75,         // ₹15/kW typical 5kW = ₹75
      duty_pct: 0.10,                  // WB govt duty ~10%
      _source: 'verified',
      _effective_date: '2024-04-01',
      _notes: 'Add ₹0.29/u monthly variable (MVCA) + ₹15 meter rent. Demand charge replaces fixed for ≥50 kVA.',
    },
    commercial_lt: {
      slabs: [
        { upto: Infinity, rate: 8.85 },
      ],
      fixed_charge_inr_mo: 150,
      duty_pct: 0.10,
      _source: 'unverified',
      _notes: 'Commercial slabs not extracted from PDF; placeholder ₹8.85/u.',
    },
  },

  // ── Haryana DHBVN ─────────────────────────────────────────────────────
  // Source: DHBVN Sales Circular D-09/2024 (HERC).
  // https://dhbvn.org.in/staticContent/saleregulation/salecircular/circular2024/09_D_2024.pdf
  'HR-DHBVN': {
    residential_lt: {
      slabs: [
        { upto: 50,       rate: 2.00 },
        { upto: 100,      rate: 2.50 },
        { upto: 150,      rate: 2.75 },
        { upto: 250,      rate: 5.25 },
        { upto: 500,      rate: 6.30 },
        { upto: 800,      rate: 7.10 },
        { upto: Infinity, rate: 7.10 },
      ],
      fixed_charge_inr_mo: 75,         // ₹75 (>2kW) Cat-II
      duty_pct: 0.10,                  // HR municipal tax + duty ~10%
      _source: 'verified',
      _effective_date: '2024-04-01',
      _notes: 'HERC + DHBVN D-09/2024. >800u/mo flat ₹7.10/u on full consumption. Add ₹50/kW for 301-500u and >500u.',
    },
    commercial_lt: {
      slabs: [
        { upto: Infinity, rate: 6.65 },
      ],
      fixed_charge_inr_mo: 170,        // ~₹170/kW NDS
      duty_pct: 0.10,
      _source: 'estimated',
      _notes: 'NDS small-power flat-rate simplified.',
    },
  },

  // ── Punjab PSPCL ──────────────────────────────────────────────────────
  // Source: PSERC tariff order 14-Jun-2024.
  // https://docs.pspcl.in/docs/cecommercial2420240614200653433.pdf
  'PB-PSPCL': {
    residential_lt: {
      slabs: [
        { upto: 100,      rate: 4.29 },
        { upto: 300,      rate: 6.76 },
        { upto: Infinity, rate: 7.75 },
      ],
      fixed_charge_inr_mo: 75,         // ₹25/kW DS ≤2kW; ~₹75 typical 3kW
      duty_pct: 0.13,                  // Punjab elec duty ~13% + cess
      _source: 'verified',
      _effective_date: '2024-06-16',
      _notes: 'DS ≤2kW slab. 2-7kW: 4.54/6.76/7.75. 7-20kW: 5.34/7.15/7.75. Punjab govt: 300u free for non-AC domestic (apply separately).',
    },
    commercial_lt: {
      slabs: [
        { upto: 100,      rate: 6.06 },
        { upto: 500,      rate: 6.36 },
        { upto: Infinity, rate: 6.96 },
      ],
      fixed_charge_inr_mo: 95,
      duty_pct: 0.13,
      _source: 'estimated',
      _notes: 'NRS commercial.',
    },
  },

  // ── Madhya Pradesh MPPKVVCL ───────────────────────────────────────────
  // Source: MPERC LT Tariff 2024-25.
  // https://portal.mpcz.in/upload_files/pdf/mperc_regulation/tariff_details/LT_tarrif/Tariff_LT_Year_24_25.pdf
  'MP-MPPKVVCL': {
    residential_lt: {
      slabs: [
        { upto: 50,       rate: 4.27 },
        { upto: 150,      rate: 5.21 },
        { upto: 300,      rate: 6.53 },
        { upto: Infinity, rate: 6.84 },
      ],
      fixed_charge_inr_mo: 75,         // ₹75/mo single-phase domestic
      duty_pct: 0.09,                  // MP residential duty ~9%
      _source: 'estimated',
      _effective_date: '2024-04-01',
      _notes: 'MPERC LV-1.1 domestic. Could not parse PDF directly; rates approximated from MPERC trajectory.',
    },
    commercial_lt: {
      slabs: [
        { upto: Infinity, rate: 6.95 },
      ],
      fixed_charge_inr_mo: 110,
      duty_pct: 0.15,
      _source: 'unverified',
      _notes: 'LV-2 non-domestic placeholder.',
    },
  },

  // ── Bihar BSPHCL ──────────────────────────────────────────────────────
  // Source: BERC FY24-25 Tariff Chart.
  // https://berc.co.in/images/pdf/tariff-order/tariff-order-DISCOM-2024-25/Tariff-chart.pdf
  'BR-BSPHCL': {
    residential_lt: {
      slabs: [
        { upto: 100,      rate: 4.27 },
        { upto: 200,      rate: 5.20 },
        { upto: 300,      rate: 6.05 },
        { upto: Infinity, rate: 7.42 },
      ],
      fixed_charge_inr_mo: 80,         // ₹80/kW DS-II urban
      duty_pct: 0.06,
      _source: 'estimated',
      _effective_date: '2024-04-01',
      _notes: 'BERC DS-II urban. Could not parse PDF directly. Bihar govt: 125u/mo free from Aug-2025 (apply separately).',
    },
    commercial_lt: {
      slabs: [
        { upto: 100,      rate: 7.94 },
        { upto: Infinity, rate: 8.36 },
      ],
      fixed_charge_inr_mo: 60,         // NDS-I ₹60/kW
      duty_pct: 0.06,
      _source: 'estimated',
      _notes: 'NDS-I LT urban metered.',
    },
  },

  // ── Other / fallback ──────────────────────────────────────────────────
  'OTHER': {
    residential_lt: FALLBACK_RESIDENTIAL(7.00),
    commercial_lt: FALLBACK_COMMERCIAL(7.00),
  },
};

// Resolve a DISCOM's tariff schedule for a given category.
// Handles the `_ref` indirection (DISCOMs that share schedules with another).
// Falls back to a flat-tariff-derived schedule if data is missing.
export function getTariffSchedule(discomKey, category) {
  const entry = TARIFF_SCHEDULES[discomKey];
  if (entry && entry._ref) {
    return getTariffSchedule(entry._ref, category);
  }
  if (entry && entry[category]) {
    return entry[category];
  }
  // Last-resort fallback: synthesize from the DISCOM's flat tariff
  const discom = DISCOMS.find((d) => d.key === discomKey);
  const avg = discom ? discom.tariff : 7.00;
  return category === 'commercial_lt' ? FALLBACK_COMMERCIAL(avg) : FALLBACK_RESIDENTIAL(avg);
}

// State → representative DISCOM key. Picked as the most populous / canonical for each state.
// For multi-DISCOM states the underlying tariffs differ slightly; the calculator uses this
// default unless an advanced user picks a specific DISCOM in the advanced panel.
export const STATE_DEFAULTS = {
  'Rajasthan':      'RJ-KEDL',      // Kota — matches the §5 worked-example baseline
  'Maharashtra':    'MH-MSEDCL',    // single DISCOM for most of the state
  'Karnataka':      'KA-BESCOM',
  'Gujarat':        'GJ-UGVCL',     // identical economics to PGVCL
  'Delhi':          'DL-BSES-R',    // BSES Rajdhani — south + west Delhi, largest by area
  'Tamil Nadu':     'TN-TNEB',
  'Uttar Pradesh':  'UP-UPPCL',
  'Telangana':      'TS-TSSPDCL',
  'Kerala':         'KL-KSEB',
  'West Bengal':    'WB-CESC',
  'Haryana':        'HR-DHBVN',
  'Punjab':         'PB-PSPCL',
  'Madhya Pradesh': 'MP-MPPKVVCL',
  'Bihar':          'BR-BSPHCL',
  'Other':          'OTHER',
};

// §3.2 Peak sun hours by zone (annual daily average)
export const PSH_BY_ZONE = {
  VeryHigh: 5.5,   // RJ, GJ, MP
  High:     5.0,   // UP, BR, HR, PB, TS, DL
  Moderate: 4.8,   // MH, KA, AP, TN, OD
  Lower:    4.2,   // KL, WB, NE, J&K, HP
};

// §3.3 Seasonal generation factors (multiplier on PSH × days)
export const SEASONAL_GEN_FACTOR = [
  /* Jan */ 0.85, /* Feb */ 0.85, /* Mar */ 0.95, /* Apr */ 0.95,
  /* May */ 0.95, /* Jun */ 0.75, /* Jul */ 0.75, /* Aug */ 0.75,
  /* Sep */ 0.95, /* Oct */ 0.95, /* Nov */ 0.85, /* Dec */ 0.85,
];

// §3.4 Average ambient temperature (°C) by zone × month
export const AMBIENT_TEMP = {
  VeryHigh: [16, 20, 26, 33, 38, 39, 33, 31, 31, 28, 22, 17],
  High:     [16, 19, 25, 31, 35, 33, 30, 29, 29, 26, 21, 17],
  Moderate: [22, 24, 27, 30, 31, 28, 26, 26, 26, 26, 24, 22],
  Lower:    [25, 26, 28, 29, 29, 27, 26, 26, 27, 27, 26, 26],
};

// §1.6 Panel temp coefficient per °C above 25°C
export const TECH_TEMP_COEFF = {
  TOPCon:   0.0029,
  MonoPERC: 0.0035,
};

// §3.7 Shading derating
export const SHADING_FACTOR = {
  None: 1.00,
  Partial: 0.88,
  Heavy: 0.75,
};

// §3.8 Roof type cost adder ₹/kW (mounting hardware premium)
export const ROOF_TYPE_ADDER = {
  FlatRCC: 0,
  SlopedTiled: 3000,
  Terrace: 0,
};

// Roof type generation factor — flat/terrace allow optimal tilt frames; sloped
// tiled roofs lock panels to the slope's pitch and azimuth, which is rarely
// optimal in India. Typical loss vs optimal: 5–15%; we use 7% as midpoint.
// User can still override via the shading input if their slope is unusually bad.
export const ROOF_GEN_FACTOR = {
  FlatRCC: 1.00,
  SlopedTiled: 0.93,
  Terrace: 1.00,
};

// §16.2 Bill shape curve — 12 monthly fractions in [0, 1] of (peak - low) range
export const BILL_SHAPE = [
  /* Jan */ 0.00, /* Feb */ 0.05, /* Mar */ 0.20, /* Apr */ 0.50,
  /* May */ 1.00, /* Jun */ 1.00, /* Jul */ 0.75, /* Aug */ 0.70,
  /* Sep */ 0.50, /* Oct */ 0.25, /* Nov */ 0.10, /* Dec */ 0.00,
];

// Days in each month (non-leap)
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// §16.10 Lifestyle stamps — store ₹ at a REFERENCE tariff, then scale by the
// user's state tariff. Same household consumes the same kWh; bill = kWh × tariff,
// so stamps auto-rescale when the state changes.
export const LIFESTYLE_REF_TARIFF = 8.0;   // ₹/unit baseline these were calibrated against
export const LIFESTYLE_STAMPS = [
  { id: 'no-ac',      label: '1 BHK, no AC',          summary: 'Fans + lights only',          peak: 1200,  low: 400  },
  { id: '1ac-night',  label: '2 BHK, 1 AC at night',  summary: 'Single AC, evening use',      peak: 2500,  low: 500  },
  { id: '2ac-evening',label: '2 BHK, 2 ACs',          summary: 'Two ACs, evening + night',    peak: 4500,  low: 600  },
  { id: '3ac-day',    label: '3 BHK, 3 ACs full day', summary: 'Heavy AC usage',              peak: 7500,  low: 900  },
  { id: 'villa',      label: '4 BHK / villa',         summary: 'Multiple ACs all day',        peak: 12000, low: 1500 },
];

// Rescale a stamp's bills to the user's state tariff
export function scaleStampToTariff(stamp, tariff) {
  const factor = tariff / LIFESTYLE_REF_TARIFF;
  // Round bills to a sensible step (50 for low, 100 for peak)
  return {
    peak: Math.round((stamp.peak * factor) / 50) * 50,
    low:  Math.round((stamp.low  * factor) / 50) * 50,
  };
}

// §15.3 Critical-load appliance checklist (watts continuous)
export const APPLIANCES = [
  { id: 'lights',  label: 'LED lights (whole house)',  watts: 80,   defaultOn: true,  warn: null },
  { id: 'fans',    label: 'Ceiling fans (3)',          watts: 200,  defaultOn: true,  warn: null },
  { id: 'fridge',  label: 'Refrigerator',              watts: 150,  defaultOn: true,  warn: null },
  { id: 'router',  label: 'Wi-Fi router + ONT',        watts: 25,   defaultOn: true,  warn: null },
  { id: 'tv',      label: 'TV + set-top box',          watts: 120,  defaultOn: false, warn: null },
  { id: 'chargers',label: 'Phone + laptop chargers',   watts: 60,   defaultOn: false, warn: null },
  { id: 'mixer',   label: 'Mixer / grinder',           watts: 500,  defaultOn: false, warn: null },
  { id: 'cooler',  label: 'Air cooler',                watts: 200,  defaultOn: false, warn: null },
  { id: 'ac',      label: 'Inverter AC (1.5 ton, eco)', watts: 1200, defaultOn: false, warn: 'Backing up an AC needs at least a 5 kWh battery.' },
  { id: 'geyser',  label: 'Instant geyser',            watts: 3000, defaultOn: false, warn: 'Instant geysers draw too much for backup.' },
];

// §14.2 Outage hours/day named stops
export const OUTAGE_STOPS = [
  { id: 'reliable',   label: 'Reliable',   hours: 0.0,  scenario: 'Urban metro, very rare outages' },
  { id: 'occasional', label: 'Occasional', hours: 0.25, scenario: 'Most South Indian metros, planned maintenance' },
  { id: 'frequent',   label: 'Frequent',   hours: 1.0,  scenario: 'Tier-2 cities, evening load-shedding' },
  { id: 'patchy',     label: 'Patchy',     hours: 2.5,  scenario: 'Tier-3 cities, semi-urban, monsoon months' },
  { id: 'severe',     label: 'Severe',     hours: 5.0,  scenario: 'Rural, festival-season grid stress' },
];

// §15.2 Roof size — "fits N cars" picker
export const ROOF_SIZES = [
  { id: 'small',  label: '1 car',   cars: 1, sqft: 80,  maxKw: 1.0 },
  { id: 'medium', label: '2 cars',  cars: 2, sqft: 160, maxKw: 1.5 },
  { id: 'large',  label: '3 cars',  cars: 3, sqft: 240, maxKw: 2.5 },
  { id: 'xl',     label: '4 cars',  cars: 4, sqft: 320, maxKw: 3.5 },
  { id: 'huge',   label: '5+ cars', cars: 5, sqft: 400, maxKw: 5.0 },
];

// Default cost & financial params
export const DEFAULTS = {
  cost_per_kw_gross: 65000,
  inverter_premium_hybrid_per_kw: 5000,
  inverter_premium_offgrid_per_kw: 15000,
  battery_cost_per_kwh: 35000,
  battery_size_factor: 1.0,           // kWh per kW solar (hybrid evening peak)
  autonomy_days_offgrid: 2,
  battery_dod: 0.80,
  roundtrip_eff: 0.92,
  battery_calendar_life_yr: 10,
  battery_cycle_life: 4500,
  battery_cost_decline_per_yr: 0.04,
  critical_load_panel_cost: 20000,    // §14.14
  inverter_standby_w: 30,
  outage_premium_factor: 2.0,
  inverter_factor: 0.97,
  soiling_factor: 0.97,
  degradation_per_yr: 0.005,
  degradation_floor: 0.85,
  tariff_escalation: 0.05,
  alt_return_rate: 0.12,
  fd_rate: 0.07,
  nifty_rate: 0.12,
  ltcg_rate: 0.125,
  slab_tax_rate: 0.20,                // §17 — assumed slab tax for FD interest
                                       // (typical middle-class slab; equity uses LTCG separately)
  analysis_horizon_years: 25,
  net_metering_enabled: true,
  appc_rate: 3.25,                     // ₹/unit for monthly-settlement export credit
  utilization_factor_offgrid: 0.85,
  diesel_kwh_cost: 25,
  central_subsidy_cap: 78000,
  grid_emission_kg_per_kwh: 0.82,
  car_size_sqft: 80,
  roof_utilization: 0.75,             // §15.2: 75% of gross area is usable
  sqft_per_kw: 80,
};
