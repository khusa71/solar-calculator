// Solar Calculator — pure-function computation engine
// All section refs map to LOGIC.md.

import {
  DISCOMS, PSH_BY_ZONE, SEASONAL_GEN_FACTOR, AMBIENT_TEMP, TECH_TEMP_COEFF,
  SHADING_FACTOR, ROOF_TYPE_ADDER, ROOF_GEN_FACTOR, BILL_SHAPE, DAYS_IN_MONTH, DEFAULTS,
  getTariffSchedule,
} from './constants.js';

const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// §3.6 Central PM Surya Ghar subsidy (closed form, fractional kW supported)
export function centralSubsidy(kw) {
  const band1 = Math.min(kw, 2) * 30000;
  const band2 = Math.max(0, Math.min(kw, 3) - 2) * 18000;
  return Math.min(DEFAULTS.central_subsidy_cap, band1 + band2);
}

// §3.1 State subsidy resolves to ₹ — handles per-kW Delhi case
export function stateSubsidyFor(discom, kw) {
  if (!discom) return 0;
  if (discom.state_subsidy_per_kw) {
    return Math.min(discom.state_subsidy_cap || Infinity, discom.state_subsidy_per_kw * kw);
  }
  return discom.state_subsidy || 0;
}

export function getDiscom(stateKey) {
  return DISCOMS.find((d) => d.key === stateKey) || DISCOMS.find((d) => d.key === 'OTHER');
}

// §16.2 12-month bill array from two anchors (back-compat: ₹ shape, used for
// flat-tariff fallback paths and chart axis preview before slab integration).
export function deriveBillArray(billPeak, billLow) {
  return BILL_SHAPE.map((s) => Math.round(billLow + (billPeak - billLow) * s));
}

// ── Slab tariff math ──────────────────────────────────────────────────────
//
// Real Indian electricity bills are slab-based: the first 50 units cost less
// than the 51st, and so on. Solar offsets units off the *top* of the stack —
// every kWh saved is valued at the marginal slab rate, not the average.
//
// `schedule` shape (from constants.js TARIFF_SCHEDULES):
//   { slabs: [{upto, rate}...], fixed_charge_inr_mo, duty_pct }

// Bill in ₹ for a given monthly consumption in kWh.
// Includes energy charges + duty + fixed charge. Excludes any meter rent or
// state-level cess that varies (kept out for tractability; user can override
// peak/low if their actual bill differs materially).
export function billFromUnits(units, schedule) {
  if (units <= 0) return schedule.fixed_charge_inr_mo;
  let energyCharge = 0;
  let prev = 0;
  let remaining = units;
  for (const slab of schedule.slabs) {
    const ceiling = slab.upto === Infinity ? Infinity : slab.upto;
    const bandSize = ceiling === Infinity ? remaining : Math.max(0, Math.min(ceiling - prev, remaining));
    energyCharge += bandSize * slab.rate;
    remaining -= bandSize;
    prev = ceiling;
    if (remaining <= 0) break;
  }
  const duty = energyCharge * schedule.duty_pct;
  return energyCharge + duty + schedule.fixed_charge_inr_mo;
}

// Inverse: kWh consumption that produces this monthly ₹ bill, for the given
// schedule. Bisects in [0, 5000] kWh — tight enough for residential and
// small-commercial users. Returns 0 if the bill is at/below fixed charge alone.
export function unitsFromBill(bill, schedule) {
  if (bill <= schedule.fixed_charge_inr_mo) return 0;
  let lo = 0, hi = 5000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const computed = billFromUnits(mid, schedule);
    if (computed > bill) hi = mid; else lo = mid;
    if (hi - lo < 0.05) break;
  }
  return (lo + hi) / 2;
}

// ₹ saved by offsetting `offsetUnits` of consumption when the user would
// otherwise have consumed `currentUnits`. Peels off the top of the slab stack —
// this is the correct top-marginal valuation. Excludes fixed charge (which
// solar can't reduce).
export function savingsFromOffset(currentUnits, offsetUnits, schedule) {
  const safeOffset = Math.min(offsetUnits, currentUnits);
  if (safeOffset <= 0) return 0;
  const billCurrent = billFromUnits(currentUnits, schedule) - schedule.fixed_charge_inr_mo;
  const billReduced = billFromUnits(currentUnits - safeOffset, schedule) - schedule.fixed_charge_inr_mo;
  return billCurrent - billReduced;
}

// Top-of-stack rate (₹/kWh) at the user's current consumption — what the next
// kWh of solar offset is actually worth. Used for the spread story in §7.
export function marginalRate(units, schedule) {
  if (units <= 0) return schedule.slabs[0].rate;
  let prev = 0;
  for (const slab of schedule.slabs) {
    const ceiling = slab.upto === Infinity ? Infinity : slab.upto;
    if (units <= ceiling) return slab.rate;
    prev = ceiling;
  }
  return schedule.slabs[schedule.slabs.length - 1].rate;
}

// Blended ₹/kWh — bill divided by units, for context only. Always ≤ marginal.
export function blendedRate(units, schedule) {
  if (units <= 0) return 0;
  return billFromUnits(units, schedule) / units;
}

// §4.4 Monthly generation Year 1 (kWh) for given kW
export function deriveMonthlyGenerationYr1(kw, zone, panelTech, shading, roofType) {
  const psh = PSH_BY_ZONE[zone];
  const ambient = AMBIENT_TEMP[zone];
  const shadingF = SHADING_FACTOR[shading];
  const techCoeff = TECH_TEMP_COEFF[panelTech];
  const roofF = (roofType && ROOF_GEN_FACTOR[roofType]) || 1.0;

  return Array.from({ length: 12 }, (_, m) => {
    const days = DAYS_IN_MONTH[m];
    const base = kw * psh * days * SEASONAL_GEN_FACTOR[m];
    const panelTemp = ambient[m] + 25;
    const tempLoss = Math.max(0, (panelTemp - 25)) * techCoeff;
    const tempFactor = 1 - tempLoss;
    return base * tempFactor * shadingF * roofF * DEFAULTS.inverter_factor * DEFAULTS.soiling_factor;
  });
}

// Back-compat flat-tariff savings model — kept for paths that haven't been
// upgraded to slab-aware. New code should use deriveMonthlyDecomposition with
// a slab schedule, which gives the correct top-of-stack savings valuation.
export function deriveMonthlySavingsYr1(billArr, genArr, tariff, nmEnabled, nmFactor, settlement) {
  if (!nmEnabled) {
    const selfCons = 0.65;
    return billArr.map((bill, m) => {
      const gen = genArr[m];
      const consumption = bill / tariff;
      const daytime = consumption * selfCons;
      return Math.min(gen, daytime) * tariff;
    });
  }

  if (settlement === 'Annual') {
    const annualGen = sum(genArr);
    const annualCons = sum(billArr) / tariff;
    const annualOffsetUnits = Math.min(annualGen, annualCons);
    const annualSurplusUnits = Math.max(0, annualGen - annualCons);
    const totalBill = sum(billArr);
    const annualOffsetValue = annualOffsetUnits * tariff;
    const annualSurplusValue = annualSurplusUnits * DEFAULTS.appc_rate;
    return billArr.map((bill, m) => {
      const billShare = totalBill > 0 ? bill / totalBill : 0;
      const genShare = annualGen > 0 ? genArr[m] / annualGen : 0;
      const offsetPart = annualOffsetValue * billShare;
      const surplusPart = annualSurplusValue * genShare;
      return Math.min(bill, offsetPart) + surplusPart;
    });
  }

  return billArr.map((bill, m) => {
    const gen = genArr[m];
    const consumption = bill / tariff;
    const offset = Math.min(gen, consumption);
    const exportU = Math.max(0, gen - consumption);
    return Math.min(offset * tariff, bill) + exportU * DEFAULTS.appc_rate;
  });
}

// Decomposed monthly output for §7 (bill-change view).
// Per-month breakdown of generation flow with slab-aware savings valuation:
// solar offsets units off the top of the slab stack each month.
//
// `schedule` is the slab tariff schedule for the user's DISCOM × category.
// `consArr` is monthly consumption in kWh (derived from input bills via slab inversion).
//
// Modes:
//   Annual settlement  → kWh exports bank across months; year-end surplus at APPC
//   Monthly settlement → no bank; each month's export settles at APPC immediately
//   No net metering    → self-consumption capped at 65% (no banking, no exports)
//   OffGrid            → no grid interaction (handled separately by caller)
export function deriveMonthlyDecomposition(consArr, genArr, schedule, nmEnabled, settlement) {
  const months = Array.from({ length: 12 }, (_, m) => ({
    cons: consArr[m],
    gen: genArr[m],
  }));

  if (!nmEnabled) {
    const selfConsRatio = 0.65;
    return {
      monthly: months.map(({ cons, gen }) => {
        const daytimeCons = cons * selfConsRatio;
        const selfCons = Math.min(gen, daytimeCons);
        const imported = cons - selfCons;
        // Slab-aware savings: peel selfCons off the top of cons-stack
        const billAvoided = savingsFromOffset(cons, selfCons, schedule);
        return {
          gen_kwh: gen,
          cons_kwh: cons,
          self_consumed_kwh: selfCons,
          exported_kwh: 0,
          imported_kwh: imported,
          bank_drawn_kwh: 0,
          grid_import_kwh: imported,
          bank_balance_eom_kwh: 0,
          bill_avoided_inr: billAvoided,
        };
      }),
      year_end: { surplus_kwh: 0, surplus_inr: 0 },
    };
  }

  if (settlement === 'Annual') {
    // Bank carries kWh credits across months; sweep at year-end at APPC
    let bank = 0;
    const monthly = months.map(({ cons, gen }) => {
      const selfCons = Math.min(gen, cons);
      const exported = Math.max(0, gen - cons);
      const importNeed = Math.max(0, cons - gen);
      const bankDrawn = Math.min(bank, importNeed);
      const gridImport = importNeed - bankDrawn;
      bank += exported - bankDrawn;
      // Slab-aware savings: (selfCons + bankDrawn) units came off top of cons stack this month
      const offset = selfCons + bankDrawn;
      const billAvoided = savingsFromOffset(cons, offset, schedule);
      return {
        gen_kwh: gen,
        cons_kwh: cons,
        self_consumed_kwh: selfCons,
        exported_kwh: exported,
        imported_kwh: importNeed,
        bank_drawn_kwh: bankDrawn,
        grid_import_kwh: gridImport,
        bank_balance_eom_kwh: bank,
        bill_avoided_inr: billAvoided,
      };
    });
    const surplusKwh = bank;
    return {
      monthly,
      year_end: { surplus_kwh: surplusKwh, surplus_inr: surplusKwh * DEFAULTS.appc_rate },
    };
  }

  // Monthly settlement: surplus settles at APPC each month
  const monthlyRows = months.map(({ cons, gen }) => {
    const selfCons = Math.min(gen, cons);
    const exported = Math.max(0, gen - cons);
    const imported = Math.max(0, cons - gen);
    const billAvoided = savingsFromOffset(cons, selfCons, schedule);
    return {
      gen_kwh: gen,
      cons_kwh: cons,
      self_consumed_kwh: selfCons,
      exported_kwh: exported,
      imported_kwh: imported,
      bank_drawn_kwh: 0,
      grid_import_kwh: imported,
      bank_balance_eom_kwh: 0,
      bill_avoided_inr: billAvoided,
      monthly_surplus_inr: exported * DEFAULTS.appc_rate,
    };
  });
  const monthlySurplus = monthlyRows.reduce((acc, r) => acc + (r.monthly_surplus_inr || 0), 0);
  return {
    monthly: monthlyRows,
    year_end: { surplus_kwh: 0, surplus_inr: monthlySurplus },
  };
}

// §13.4 + §14.7 + §14.14 — type-conditional cost model
export function deriveCosts(input, discom) {
  const {
    system_kw, system_type, panel_tech, roof_type, cost_per_kw_gross,
    state_subsidy_override, critical_load_kw, outage_hours_per_day,
    annual_consumption_kwh, autonomy_days, battery_size_factor,
  } = input;

  const solarHardware = system_kw * cost_per_kw_gross;
  const roofAdder = system_kw * (ROOF_TYPE_ADDER[roof_type] || 0);

  let batteryKwh = 0;
  let batteryCost = 0;
  let inverterPremium = 0;
  let criticalPanel = 0;

  if (system_type === 'Hybrid') {
    // §14.7 combined sizing rule
    const eveningRule = system_kw * (battery_size_factor || DEFAULTS.battery_size_factor);
    const outageRule = (critical_load_kw * outage_hours_per_day * 1.5) / DEFAULTS.roundtrip_eff;
    batteryKwh = Math.ceil(Math.max(eveningRule, outageRule) * 2) / 2;  // round up to 0.5
    batteryCost = batteryKwh * DEFAULTS.battery_cost_per_kwh;
    inverterPremium = system_kw * DEFAULTS.inverter_premium_hybrid_per_kw;
    criticalPanel = DEFAULTS.critical_load_panel_cost;
  } else if (system_type === 'OffGrid') {
    const dailyConsumption = annual_consumption_kwh / 365;
    const usableKwh = dailyConsumption * (autonomy_days || DEFAULTS.autonomy_days_offgrid);
    batteryKwh = Math.ceil((usableKwh / 0.70) * 2) / 2;
    batteryCost = batteryKwh * DEFAULTS.battery_cost_per_kwh;
    inverterPremium = system_kw * DEFAULTS.inverter_premium_offgrid_per_kw;
    criticalPanel = DEFAULTS.critical_load_panel_cost;
  }

  const grossCost = solarHardware + roofAdder + batteryCost + inverterPremium + criticalPanel;

  let central = 0, stateSub = 0;
  if (system_type !== 'OffGrid') {
    central = centralSubsidy(system_kw);
    stateSub = state_subsidy_override !== null && state_subsidy_override !== undefined
      ? state_subsidy_override
      : stateSubsidyFor(discom, system_kw);
  }
  const totalSubsidy = central + stateSub;
  const netCost = Math.max(0, grossCost - totalSubsidy);

  return {
    solar_hardware: solarHardware,
    roof_adder: roofAdder,
    battery_kwh: batteryKwh,
    battery_cost: batteryCost,
    inverter_premium: inverterPremium,
    critical_panel_cost: criticalPanel,
    gross: grossCost,
    central_subsidy: central,
    state_subsidy: stateSub,
    total_subsidy: totalSubsidy,
    net: netCost,
  };
}

// §14.8 — annual outage value (hybrid only; off-grid uses different framing)
export function annualOutageValue(input, batteryKwh, tariff) {
  const { critical_load_kw, outage_hours_per_day, outage_timing } = input;
  if (outage_hours_per_day <= 0 || critical_load_kw <= 0) return { gross: 0, rteLoss: 0, net: 0, deliveredKwh: 0 };

  const batteryHrsAvail = (batteryKwh * DEFAULTS.battery_dod * DEFAULTS.roundtrip_eff) / critical_load_kw;
  const truncatedHrs = Math.min(outage_hours_per_day, batteryHrsAvail);
  const dailyDelivered = critical_load_kw * truncatedHrs;

  const solarCoverage = outage_timing === 'Daytime' ? 0.70 : 0;
  const batteryDrainPerOutage = dailyDelivered * (1 - solarCoverage);

  const annualDelivered = dailyDelivered * 365;
  const grossValue = annualDelivered * tariff * DEFAULTS.outage_premium_factor;

  const annualBatteryDrain = batteryDrainPerOutage * 365;
  const rteLossKwh = annualBatteryDrain * (1 / DEFAULTS.roundtrip_eff - 1);
  const rteLossInr = rteLossKwh * tariff;

  return {
    gross: grossValue,
    rteLoss: rteLossInr,
    net: grossValue - rteLossInr,
    deliveredKwh: annualDelivered,
    batteryHrsAvail,
  };
}

// §14.10 standby drain (hybrid + off-grid only)
export function inverterStandbyDrain(systemType, tariff) {
  if (systemType === 'OnGrid') return 0;
  const annualKwh = (DEFAULTS.inverter_standby_w * 24 * 365) / 1000;
  return annualKwh * tariff;
}

// §14.11 dynamic battery replacement year
export function batteryReplacementYear(outageHrsPerDay) {
  const cycles = outageHrsPerDay > 0 ? 365 : 200;
  const cyclingLifeYears = DEFAULTS.battery_cycle_life / cycles;
  return Math.min(DEFAULTS.battery_calendar_life_yr, cyclingLifeYears);
}

// §13.6 future battery replacement cost
export function batteryReplacementCost(batteryKwh, replYear) {
  const futureCostPerKwh = DEFAULTS.battery_cost_per_kwh * Math.pow(1 - DEFAULTS.battery_cost_decline_per_yr, replYear);
  return batteryKwh * futureCostPerKwh;
}

// §4.6 + §13.6 + §14.10 — 25-year cashflow array.
// Battery replacements recur across the horizon: every replInterval years, each
// priced at that year (cost decline compounds). A 25-yr horizon with a 10-yr
// battery sees replacements at Y10 and Y20 — both must be deducted, not just one.
export function deriveYearArray(savingsYr1Annual, costs, input, batteryKwh, outageNet, standbyDrain) {
  const H = input.analysis_horizon_years;
  const years = [];
  let cumCash = -costs.net;

  const replInterval = batteryKwh > 0 ? batteryReplacementYear(input.outage_hours_per_day) : null;
  const replacements = [];
  if (replInterval !== null) {
    const intervalYrs = Math.max(1, Math.round(replInterval));
    for (let y = intervalYrs; y < H; y += intervalYrs) {
      // Skip a replacement landing on the final year — it would just be wasted capex
      replacements.push({ year: y, cost: batteryReplacementCost(batteryKwh, y) });
    }
  }
  const replByYear = new Map(replacements.map((r) => [r.year, r.cost]));

  // Outage value & standby drain are recurring lines (do NOT escalate with tariff — they're modeled flat for simplicity)
  for (let n = 1; n <= H; n++) {
    const degradation = Math.max(DEFAULTS.degradation_floor, 1 - DEFAULTS.degradation_per_yr * (n - 1));
    const escalation = Math.pow(1 + input.tariff_escalation, n - 1);
    let yearSavings = savingsYr1Annual * degradation * escalation;
    yearSavings += outageNet - standbyDrain;

    if (replByYear.has(n)) {
      yearSavings -= replByYear.get(n);
    }

    cumCash += yearSavings;
    years.push({
      year: n,
      degradation,
      escalation,
      savings: yearSavings,
      cumCashflow: cumCash,
    });
  }

  return { years, replacements };
}

// §4.7 IRR via binary search
export function computeIRR(cashflows) {
  const allNonPositive = cashflows.every((c) => c <= 0);
  if (allNonPositive) return null;

  const npv = (r) => cashflows.reduce((acc, c, t) => acc + c / Math.pow(1 + r, t), 0);

  let lo = -0.99, hi = 5.0, mid = 0;
  for (let i = 0; i < 200; i++) {
    mid = (lo + hi) / 2;
    const v = npv(mid);
    if (Math.abs(v) < 1) return mid;
    if (v > 0) lo = mid; else hi = mid;
  }
  return mid;
}

// §4.7 simple payback with linear interpolation
export function computePayback(netCost, years) {
  let cum = -netCost;
  for (let i = 0; i < years.length; i++) {
    const prev = cum;
    const yearSavings = years[i].savings;
    cum += yearSavings;
    if (cum >= 0) {
      const fraction = -prev / yearSavings;
      return i + fraction;
    }
  }
  return null;
}

// §4.7 discounted payback
export function computeDiscountedPayback(netCost, years, rate = 0.06) {
  let cum = -netCost;
  for (let i = 0; i < years.length; i++) {
    const disc = years[i].savings / Math.pow(1 + rate, i + 1);
    const prev = cum;
    cum += disc;
    if (cum >= 0) {
      return i + (-prev / disc);
    }
  }
  return null;
}

// NPV-optimal sizing with sensibility caps: sweep 1–10 kW in 0.5 steps and
// pick the kW with the highest 25-year net wealth, subject to (a) IRR still
// beats the user's alt_return_rate (the engine should not recommend a system
// that loses to equity), and (b) annual generation does not exceed the
// coverage cap. The cap is settlement-aware:
//   • Annual-settlement DISCOMs (most): 120% — winter excess banks across
//     months and helps in summer, so a small surplus buffer is fine.
//   • Monthly-settlement DISCOMs (MH, GJ, WB): 105% — every month's surplus
//     clears at the low APPC rate immediately with no banking, so even a
//     small annual surplus means real cash leaking at APPC every month.
// Falls back to 1 kW if even the floor exceeds the cap (very small bills).
const COVERAGE_CAP_ANNUAL  = 1.20;
const COVERAGE_CAP_MONTHLY = 1.05;
export function pickOptimalSize(input) {
  const altFloor = input.alt_return_rate ?? 0;
  // Sniff settlement from the input's discom — `compute` does the same.
  const discom = getDiscom(input.state_key);
  const cap = discom?.settlement === 'Monthly' ? COVERAGE_CAP_MONTHLY : COVERAGE_CAP_ANNUAL;
  let bestKw = 1.0;
  let bestNetConstrained = -Infinity;
  let foundUnderCap = false;
  for (let kw = 1.0; kw <= 10.0 + 1e-9; kw += 0.5) {
    const r = compute({ ...input, system_kw: kw });
    const net = r.metrics.net_gain;
    const irr = r.metrics.irr;
    if (net == null) continue;
    const coverage = r.consumption.annual_kwh > 0
      ? r.generation.annual / r.consumption.annual_kwh
      : Infinity;
    if (coverage <= cap && (irr == null || irr >= altFloor) && net > bestNetConstrained) {
      bestNetConstrained = net;
      bestKw = kw;
      foundUnderCap = true;
    }
  }
  // For very small bills where even 1 kW exceeds the cap, return the floor.
  // The model would otherwise reward oversizing because it escalates APPC
  // surplus at the retail rate; 1 kW is the honest answer.
  return foundUnderCap ? bestKw : 1.0;
}

// §4.9 sizing recommendation — NPV-optimal "Recommended", with a smaller and
// a larger flanking card. The flanks expose the trade-off (smaller = higher
// IRR but less rupees gained; larger = bigger % of bill covered).
export function deriveSizingCards(input, discom) {
  const optimalKw = pickOptimalSize(input);

  // Bill-coverage size: covers annual consumption. May or may not equal IRR-optimal.
  const annualUnits = sum(deriveBillArray(input.bill_peak_summer, input.bill_low_winter)) / discom.tariff;
  const refGen = sum(deriveMonthlyGenerationYr1(1, discom.zone, input.panel_tech, input.shading, input.roof_type));
  const billCoverKw = clamp(Math.ceil(annualUnits / refGen / 0.5) * 0.5, 1.0, 10.0);

  // Build 3 cards: Smaller / Recommended / Larger. If billCoverKw differs
  // meaningfully from the NPV-optimum, use it as the "Larger" anchor so the
  // trade-off is obvious.
  const larger = billCoverKw > optimalKw + 0.5 ? billCoverKw : Math.min(10.0, optimalKw + 1.0);
  const sizes = [
    { label: 'Smaller',     kw: Math.max(1.0, optimalKw - 1.0) },
    { label: 'Best gain',   kw: optimalKw, recommended: true },
    { label: billCoverKw > optimalKw + 0.5 ? 'Covers bill' : 'Larger', kw: larger },
  ];

  return sizes.map((s) => {
    const r = compute({ ...input, system_kw: s.kw });
    return {
      label: s.label,
      recommended: !!s.recommended,
      kw: s.kw,
      net_cost: r.costs.net,
      payback: r.metrics.payback_simple,
      irr: r.metrics.irr,
      savings_pct: r.savings_yr1.pct_of_bill,
      area_sqft: s.kw * DEFAULTS.sqft_per_kw,
      annual_savings: r.savings_yr1.annual,
    };
  });
}

// §13.3 + §14.13 — recommend system type from grid outage hours.
// Thresholds: ≥2 hr/day average outages → hybrid is the financially better
// pick because outage value covers most of the battery premium.
export function recommendSystemType(outageHoursPerDay) {
  if (outageHoursPerDay >= 2) return 'Hybrid';
  return 'OnGrid';
}

// §13.3 — advisory note shown when the user overrides the recommendation.
export function systemTypeAdvisory(selectedType, recommendedType, outageHrs) {
  if (selectedType === recommendedType) return null;
  if (selectedType === 'Hybrid' && recommendedType === 'OnGrid') {
    return "You're paying extra for backup you may not need at this outage level. The financial-only choice is on-grid.";
  }
  if (selectedType === 'OnGrid' && recommendedType === 'Hybrid') {
    return `You'll lose power during outages (~${outageHrs} hr/day). Consider hybrid for critical loads.`;
  }
  if (selectedType === 'OffGrid') {
    return "You give up the ₹78,000 subsidy and pay ~3× more upfront. Pick this only for genuine off-grid use.";
  }
  return null;
}

// Decision verdict — compares 25-year gain on the same outlay across paths.
// Solar's gain = bills_avoided − net_cost. Equity's gain = corpus_post_LTCG
// − cost_basis. Both represent what each rupee of investment yields over the
// horizon; bills are paid from salary in either path, so they don't subtract
// from the corpus.
export function verdictFor(irr, altRate, solarGain, equityGain) {
  if (irr === null) return { tone: 'neutral', headline: 'Not enough data', body: 'Adjust your bill or system size to see a verdict.' };

  // Fall back to the rate comparison if gain metrics weren't passed
  if (solarGain === undefined || equityGain === undefined) {
    const delta = irr - altRate;
    if (delta > 0.05) return { tone: 'positive', headline: 'Solar wins clearly', body: `${(irr * 100).toFixed(0)}% return beats your ${(altRate * 100).toFixed(0)}% alternative by a wide margin.` };
    if (delta > -0.05) return { tone: 'neutral',  headline: 'Comparable to equity', body: 'Choose solar for inflation hedge + energy security.' };
    return { tone: 'caution', headline: 'Marginal returns', body: 'Solar makes sense if you\'ll live here >10 years; otherwise invest.' };
  }

  const fmtL = (v) => (v < 0 ? '−' : '') + '₹' + (Math.abs(v) / 100000).toFixed(1) + 'L';
  const gap = solarGain - equityGain;
  const irrPct = (irr * 100).toFixed(0);

  if (gap > 200000) {
    return { tone: 'positive', headline: 'Solar wins on rupees AND electricity',
      body: `Solar's ${fmtL(solarGain)} gain beats equity's ${fmtL(equityGain)} on the same outlay — IRR ${irrPct}%. And solar gives you the electricity for free; equity doesn't.` };
  }
  if (gap > -100000) {
    return { tone: 'neutral', headline: 'Solar ≈ equity on rupees, plus your electricity',
      body: `Solar (${fmtL(solarGain)}) and equity (${fmtL(equityGain)}) end up within a lakh of each other on raw returns. Solar covers your bills on top of that; pick it unless you need the liquidity.` };
  }
  if (solarGain > 0) {
    return { tone: 'positive', headline: 'Equity grows more, but solar covers your bills',
      body: `Equity gains ${fmtL(Math.abs(gap))} more in absolute rupees on the same outlay (${fmtL(equityGain)} vs ${fmtL(solarGain)}). But equity doesn't pay your electricity bill — solar does. If you'd otherwise spend that money on bills anyway, solar is the better hedge.` };
  }
  return { tone: 'caution', headline: 'Wrong size for this bill',
    body: `Solar loses money at this size (${fmtL(solarGain)}); equity gains ${fmtL(equityGain)}. Try a different kW or revisit the inputs.` };
}

// Pretty-print the headline sentence per §12.3
export function headlineFor(input, costs, metrics) {
  const kw = input.system_kw;
  const payback = metrics.payback_simple !== null ? metrics.payback_simple.toFixed(1) : '—';
  const netGain = metrics.net_gain;
  const netGainStr = formatLakh(netGain);
  return {
    kw,
    payback,
    netGain,
    netGainStr,
    horizon: input.analysis_horizon_years,
    subsidy: costs.total_subsidy,
  };
}

export function formatLakh(rupees) {
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(1)} lakh`;
  if (rupees >= 1000) return `₹${(rupees / 1000).toFixed(0)}k`;
  return `₹${Math.round(rupees)}`;
}

export function formatINR(rupees) {
  return '₹' + Math.round(rupees).toLocaleString('en-IN');
}

// Master pipeline — returns the engine output shape per §6.2.
// Uses slab tariff math when a schedule is available for the user's DISCOM ×
// category. Falls back to flat-tariff math (legacy path) when not.
export function compute(input) {
  const discom = getDiscom(input.state_key);
  const tariffCategory = input.tariff_category || 'residential_lt';
  const schedule = getTariffSchedule(discom.key, tariffCategory);
  const flatTariff = input.tariff_per_unit ?? discom.tariff;

  // Step 1: Convert user's input bills (₹) into kWh using slab inversion.
  // The seasonal shape applies to *consumption*, not ₹ — bill ₹ is then
  // re-derived from kWh via the slab schedule. This is more accurate than
  // applying the shape to ₹ directly, which compresses slab non-linearity.
  //
  // Edge case: when input bill ≤ fixed charge (e.g. ₹400 with KEDL ₹450 fixed),
  // unitsFromBill returns 0. Without correction, those months read as "0 cons
  // → 100% export", inflating the bank balance and surplus credit (M1/M12 banks
  // hundreds of kWh of "phantom surplus"). Floor each month at 5 kWh — a real
  // home's baseline draw (lights, router, fridge cycling) — so the bank and
  // surplus charts reflect actual flows, not a slab-inversion artefact.
  const peakKwh = unitsFromBill(input.bill_peak_summer, schedule);
  const lowKwh = unitsFromBill(input.bill_low_winter, schedule);
  const consArr = BILL_SHAPE.map((s) => Math.max(5, lowKwh + (peakKwh - lowKwh) * s));
  const billArr = consArr.map((u) => Math.round(billFromUnits(u, schedule)));
  const annualBill = sum(billArr);
  const annualConsumption = sum(consArr);

  // Marginal & blended rates at peak consumption — used for the spread story.
  // Marginal rate is the all-in retail rate (energy + duty), since solar offsets
  // both the energy charge AND the duty levied on it. The bare slab rate alone
  // would understate what each top-of-stack kWh actually saves — the annual
  // ₹ figures (via savingsFromOffset → billFromUnits) include duty, so the
  // displayed per-kWh rate must too for them to reconcile.
  const peakMarginal = marginalRate(peakKwh, schedule) * (1 + (schedule.duty_pct || 0));
  const peakBlended = blendedRate(peakKwh, schedule);

  // Inject derived consumption back in for off-grid battery sizing
  const enrichedInput = { ...input, annual_consumption_kwh: annualConsumption };

  const costs = deriveCosts(enrichedInput, discom);

  const genArr = deriveMonthlyGenerationYr1(input.system_kw, discom.zone, input.panel_tech, input.shading, input.roof_type);
  const annualGen = sum(genArr);

  // Decomposition (slab-aware). OffGrid uses a degenerate shape (no grid).
  let decomposition;
  if (input.system_type === 'OffGrid') {
    const utilisation = DEFAULTS.utilization_factor_offgrid;
    decomposition = {
      monthly: consArr.map((cons, m) => {
        const gen = genArr[m];
        const useful = gen * utilisation;
        const selfCons = Math.min(useful, cons);
        const billAvoided = savingsFromOffset(cons, selfCons, schedule);
        return {
          gen_kwh: gen,
          cons_kwh: cons,
          self_consumed_kwh: selfCons,
          exported_kwh: 0,
          imported_kwh: cons - selfCons,
          bank_drawn_kwh: 0,
          grid_import_kwh: 0,
          bank_balance_eom_kwh: 0,
          bill_avoided_inr: billAvoided,
        };
      }),
      year_end: { surplus_kwh: 0, surplus_inr: 0 },
    };
  } else {
    decomposition = deriveMonthlyDecomposition(
      consArr, genArr, schedule, input.net_metering_enabled, discom.settlement,
    );
  }

  // Annual savings from decomposition: sum monthly bill-avoided + year-end surplus.
  // This replaces the flat-tariff deriveMonthlySavingsYr1 result and gives the
  // top-of-stack valuation that real bills require.
  const annualBillAvoided = decomposition.monthly.reduce((s, m) => s + m.bill_avoided_inr, 0);
  const annualSurplus = decomposition.year_end.surplus_inr;
  const annualSavingsYr1 = annualBillAvoided + annualSurplus;
  // Per-month savings ₹ array (for back-compat with year_array escalation logic
  // and the existing UI that may still read savings_yr1.monthly[]):
  const savingsArr = decomposition.monthly.map((m, idx) => {
    const monthlySurplus = m.monthly_surplus_inr || 0;
    return m.bill_avoided_inr + monthlySurplus;
  });
  // For Annual settlement, year-end surplus lands once — attribute to December
  if (decomposition.year_end.surplus_inr > 0 && discom.settlement === 'Annual') {
    savingsArr[11] = (savingsArr[11] || 0) + decomposition.year_end.surplus_inr;
  }
  const offgridReframe = input.system_type === 'OffGrid'
    ? {
        billAvoided: annualBill,
        dieselBaseline: annualConsumption * DEFAULTS.diesel_kwh_cost,
        basisChosen: (annualConsumption * DEFAULTS.diesel_kwh_cost) > annualBill ? 'diesel' : 'bill',
      }
    : null;

  // Representative ₹/kWh for outage value & standby drain — use marginal rate
  // since outage import would land at top slab, and standby drain occupies the
  // top slab too. This is more accurate than the prior flat-tariff default.
  const tariff = peakMarginal || flatTariff;

  // Outage modeling for hybrid
  const outageInfo = input.system_type === 'Hybrid'
    ? annualOutageValue(input, costs.battery_kwh, tariff)
    : { gross: 0, rteLoss: 0, net: 0, deliveredKwh: 0, batteryHrsAvail: null };

  const standbyDrain = inverterStandbyDrain(input.system_type, tariff);

  const yearArr = deriveYearArray(annualSavingsYr1, costs, input, costs.battery_kwh, outageInfo.net, standbyDrain);
  const cashflows = [-costs.net, ...yearArr.years.map((y) => y.savings)];

  const irr = computeIRR(cashflows);
  const paybackSimple = computePayback(costs.net, yearArr.years);
  const paybackDisc = computeDiscountedPayback(costs.net, yearArr.years);
  const totalSavings = sum(yearArr.years.map((y) => y.savings));
  const netGain = totalSavings - costs.net;

  // Alternative investment gain over horizon (post-tax). Earlier versions of
  // this engine subtracted cumulative bills from the alt corpus on the theory
  // that the alt-investor "still owes" 25 years of electricity bills. That
  // produced misleadingly negative numbers (e.g. "Equity: −₹12L") because in
  // reality households fund electricity from monthly salary, not from the
  // investment corpus. The honest comparison is gain-on-the-same-outlay:
  //   • Solar gains: bills_avoided − net_cost (= net_gain below)
  //   • FD/Equity gains: corpus_post_tax − cost_basis (the *_gain values)
  // Both compare what each rupee of solar vs. each rupee of investment yields
  // over the horizon. Bills are paid from salary in either path, so they
  // don't subtract from corpus.
  const H = input.analysis_horizon_years;
  const fdCorpusPre = costs.net * Math.pow(1 + DEFAULTS.fd_rate, H);
  const fdCorpusPost = costs.net + (fdCorpusPre - costs.net) * (1 - DEFAULTS.slab_tax_rate);
  const niftyCorpusPre = costs.net * Math.pow(1 + DEFAULTS.nifty_rate, H);
  const niftyCorpusPost = costs.net + (niftyCorpusPre - costs.net) * (1 - DEFAULTS.ltcg_rate);
  const altCorpusPre = costs.net * Math.pow(1 + input.alt_return_rate, H);
  const altCorpusPost = costs.net + (altCorpusPre - costs.net) * (1 - DEFAULTS.ltcg_rate);

  const fdGain = fdCorpusPost - costs.net;
  const niftyGain = niftyCorpusPost - costs.net;
  const altGain = altCorpusPost - costs.net;

  // Cumulative bills the household would pay over the horizon (geometric
  // series with tariff escalation). Used for the chart on §8 and the §9
  // panel's "if you do nothing" reference figure. NOT subtracted from alt
  // gains (see fdGain/niftyGain/altGain above for the comparison metric).
  const esc = input.tariff_escalation;
  const billsPaidByYear = (t) => esc > 0
    ? annualBill * (Math.pow(1 + esc, t) - 1) / esc
    : annualBill * t;
  const billsTotal = billsPaidByYear(H);

  const energyIndependence = annualConsumption > 0 ? annualGen / annualConsumption : null;
  const co2OffsetKg = annualGen * DEFAULTS.grid_emission_kg_per_kwh;

  const verdict = verdictFor(irr, input.alt_return_rate, netGain, niftyGain);

  return {
    discom,
    tariff,                       // top-slab marginal rate at peak consumption (₹/kWh)
    tariff_schedule: schedule,    // full slab schedule for UI (§6 finance, §7 spread)
    tariff_category: tariffCategory,
    rates: {
      marginal: peakMarginal,     // top-of-stack rate at peak — what solar saves
      blended: peakBlended,       // bill ÷ units at peak — context only
      appc: DEFAULTS.appc_rate,   // export sell-back rate (the spread)
      spread: peakMarginal - DEFAULTS.appc_rate,
    },
    consumption: {
      peak_kwh: peakKwh,
      low_kwh: lowKwh,
      monthly: consArr,
      annual_kwh: annualConsumption,
    },
    bills: { monthly: billArr, annual: annualBill },
    generation: { monthly: genArr, annual: annualGen },
    savings_yr1: {
      monthly: savingsArr,
      annual: annualSavingsYr1,
      // pct_of_bill is "what % of your bill solar covers" — capped naturally at
      // 100% by using bill_offset (the portion of total savings that actually
      // reduces the bill, max = bill itself). Surplus credit is income, not
      // bill reduction, and lives in surplus_credit / §7's surplus row instead.
      // Without this cap, oversized systems show "cuts 218%" which is nonsense.
      pct_of_bill: annualBill > 0 ? Math.min(annualBill, annualSavingsYr1) / annualBill : 0,
      residual_bill: Math.max(0, annualBill - annualSavingsYr1),
      // Split annual savings into the bill-offset portion (capped at bill,
      // valued at retail) and the APPC surplus credit (only when gen > cons).
      // For Annual settlement: surplus_credit = (gen − cons) × APPC.
      // For Monthly settlement: surplus_credit = sum of monthly export credits.
      // For OffGrid: surplus_credit = 0 (capped at bill).
      bill_offset: Math.min(annualBill, annualSavingsYr1),
      surplus_credit: Math.max(0, annualSavingsYr1 - annualBill),
    },
    monthly_decomposition: decomposition,
    costs,
    outage: outageInfo,
    standby_drain: standbyDrain,
    year_array: yearArr.years,
    battery_replacements: yearArr.replacements,
    metrics: {
      irr,
      payback_simple: paybackSimple,
      payback_discounted: paybackDisc,
      total_savings: totalSavings,
      net_gain: netGain,
      // Pre-tax corpora (raw mark-to-market) — kept for back-compat
      fd_corpus: fdCorpusPre,
      nifty_corpus_pre: niftyCorpusPre,
      nifty_corpus_post: niftyCorpusPost,
      alt_corpus: altCorpusPre,
      // Post-tax corpora and gain on the same outlay as solar. The gain
      // numbers are the apples-to-apples comparison metric for §9: how much
      // wealth this rupee of investment produces over the horizon.
      fd_corpus_post: fdCorpusPost,
      alt_corpus_post: altCorpusPost,
      fd_gain: fdGain,
      nifty_gain: niftyGain,
      alt_gain: altGain,
      bills_total: billsTotal,
      bills_paid_by_year: billsPaidByYear,
      // coverage_ratio is gen/cons in kWh — can exceed 100% when oversized.
      // energy_independence is the legacy alias; UI now prefers coverage_ratio
      // since "independence > 100%" reads as a bug to most users.
      coverage_ratio: energyIndependence,
      energy_independence: energyIndependence,
      co2_offset_kg: co2OffsetKg,
    },
    verdict,
    headline: null,           // filled below
    offgrid_reframe: offgridReframe,
  };
}

// Convenience wrapper that also fills headline + sizing cards (top-level call)
export function computeFull(input) {
  const result = compute(input);
  result.headline = headlineFor(input, result.costs, result.metrics);
  result.sizing_cards = deriveSizingCards(input, result.discom);
  result.recommendation = deriveRecommendation(input, result);
  result.system_options = deriveSystemOptions(input, result);
  return result;
}

// §3 spine — the engine's pick of kW + system_type, with a one-line reason for each.
// Used by the UI to default the slider thumb and the system-type tabs.
export function deriveRecommendation(input, result) {
  const recommendedKw = pickOptimalSize(input);
  const recommendedType = recommendSystemType(input.outage_hours_per_day);

  // Reason for kW: anchor to the constraint that drove the pick.
  const annualUnits = result.bills.annual / result.tariff;
  const annualGenAtKw = sum(deriveMonthlyGenerationYr1(
    recommendedKw, result.discom.zone, input.panel_tech, input.shading, input.roof_type,
  ));
  const coverage = annualUnits > 0 ? annualGenAtKw / annualUnits : 0;

  // Reason copy is settlement-aware: monthly DISCOMs (no inter-month banking)
  // size tighter to consumption because every month's surplus clears at APPC
  // immediately. Annual DISCOMs allow some annual surplus that banks across
  // months. Both end up at the NPV-optimal point given their settlement rules.
  const isMonthly = result.discom?.settlement === 'Monthly';
  let reasonKw;
  if (recommendedKw <= 1.5) {
    reasonKw = isMonthly
      ? 'Your bill is small and your DISCOM settles every month at APPC — anything bigger exports more than it saves.'
      : 'Your bill is small enough that anything bigger exports more than it saves — surplus clears at the low APPC rate.';
  } else if (coverage >= 0.95 && coverage <= 1.10) {
    reasonKw = isMonthly
      ? 'Sized to match your annual consumption. Your DISCOM settles each month at APPC (no banking), so we kept generation tight to consumption to avoid leaking surplus at the low rate every month.'
      : 'Sized to roughly match your annual consumption — biggest 25-year gain, with winter excess banking against summer draws under your DISCOM\'s annual settlement.';
  } else if (coverage > 1.10) {
    reasonKw = isMonthly
      ? 'Some annual surplus is unavoidable at this bill, but each month\'s excess will clear at the APPC rate (your DISCOM doesn\'t bank kWh across months).'
      : 'Sized for max 25-year net gain — covers your bill with some surplus that banks across months and settles at the lower APPC rate at year-end.';
  } else {
    reasonKw = isMonthly
      ? 'Sized for max 25-year net gain under monthly settlement — covers most of what you use without leaking surplus at APPC each month.'
      : 'Sized to maximize 25-year net gain — covers most of what you use without exporting too much at the low APPC rate.';
  }

  // Reason for system type
  let reasonType;
  if (recommendedType === 'OnGrid') {
    reasonType = 'Your grid is reliable, so on-grid wins on cost. Hybrid only pays back if outages cost you money.';
  } else if (recommendedType === 'Hybrid') {
    reasonType = `Outages average ~${input.outage_hours_per_day} hr/day — hybrid earns back the battery premium through outage cover.`;
  } else {
    reasonType = 'Off-grid only makes sense when grid extension is impractical.';
  }

  // Compute metrics AT the recommended kW so the §3 headline can describe the
  // recommendation honestly even after the user overrides the slider. Without
  // this, payback/pct in renderRecommendation come from `result` (= the picked
  // size) and get glued to `recommendedKw`, producing "we recommend X kW —
  // pays back in <Y kW's payback>" sentences.
  const recoResult = input.system_kw === recommendedKw
    ? result
    : compute({ ...input, system_kw: recommendedKw });

  return {
    kw: recommendedKw,
    system_type: recommendedType,
    reason_kw: reasonKw,
    reason_type: reasonType,
    coverage_at_recommended: coverage,
    payback_at_reco: recoResult.metrics.payback_simple,
    pct_at_reco: recoResult.savings_yr1.pct_of_bill,
  };
}

// §5 modes — deltas for each system type at the user's current kW.
// Each option reports payback / 25y net gain / how it differs from the recommendation.
// Used by the three-mode pedagogy section so the user sees concrete trade-offs.
export function deriveSystemOptions(input, result) {
  const TYPES = ['OnGrid', 'Hybrid', 'OffGrid'];
  const recommendedType = result.recommendation
    ? result.recommendation.system_type
    : recommendSystemType(input.outage_hours_per_day);

  const computed = TYPES.map((type) => {
    if (type === input.system_type) {
      // Use the already-computed result for the user's current type
      return {
        type,
        recommended: type === recommendedType,
        net_cost: result.costs.net,
        payback_yrs: result.metrics.payback_simple,
        gain_25y: result.metrics.net_gain,
        irr: result.metrics.irr,
      };
    }
    const r = compute({ ...input, system_type: type });
    return {
      type,
      recommended: type === recommendedType,
      net_cost: r.costs.net,
      payback_yrs: r.metrics.payback_simple,
      gain_25y: r.metrics.net_gain,
      irr: r.metrics.irr,
    };
  });

  // Compute delta_to_recommended (gain_25y delta — negative = worse)
  const recommendedRow = computed.find((o) => o.type === recommendedType);
  const recommendedGain = recommendedRow ? recommendedRow.gain_25y : 0;
  return computed.map((o) => ({
    ...o,
    delta_to_recommended: o.gain_25y - recommendedGain,
  }));
}

// Default input — what loads on first paint
export function defaultInput() {
  return {
    bill_peak_summer: 3500,
    bill_low_winter: 400,
    state_key: 'RJ-KEDL',
    tariff_per_unit: null,
    tariff_category: 'residential_lt',  // 'residential_lt' | 'commercial_lt'
    system_kw: 3.0,
    panel_tech: 'TOPCon',
    system_type: 'OnGrid',
    roof_type: 'FlatRCC',
    roof_area_sqft: 240,
    shading: 'None',
    phase: 'Single',
    cost_per_kw_gross: DEFAULTS.cost_per_kw_gross,
    state_subsidy_override: null,
    tariff_escalation: DEFAULTS.tariff_escalation,
    alt_return_rate: DEFAULTS.alt_return_rate,
    analysis_horizon_years: DEFAULTS.analysis_horizon_years,
    net_metering_enabled: DEFAULTS.net_metering_enabled,
    outage_hours_per_day: 0,
    outage_timing: 'Evening',
    critical_load_kw: 0.5,
    autonomy_days: DEFAULTS.autonomy_days_offgrid,
    battery_size_factor: DEFAULTS.battery_size_factor,
  };
}
