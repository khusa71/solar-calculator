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
