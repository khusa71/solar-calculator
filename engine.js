// Solar Calculator — pure-function computation engine
// All section refs map to LOGIC.md.

import {
  DISCOMS, PSH_BY_ZONE, SEASONAL_GEN_FACTOR, AMBIENT_TEMP, TECH_TEMP_COEFF,
  SHADING_FACTOR, ROOF_TYPE_ADDER, ROOF_GEN_FACTOR, BILL_SHAPE, DAYS_IN_MONTH, DEFAULTS,
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

// §16.2 12-month bill array from two anchors
export function deriveBillArray(billPeak, billLow) {
  return BILL_SHAPE.map((s) => Math.round(billLow + (billPeak - billLow) * s));
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

// §4.5 corrected per §5 fix + §17.1.6 settlement-period model
//
// Annual settlement: gen banks against consumption across months. Total annual
// offset = min(annual_gen, annual_cons) × retail_tariff. Truly-surplus annual
// kWh (gen − cons, if positive) settles at APPC.
//
// Monthly settlement: each month independent. Within-month gen offsets
// consumption at retail; surplus that month clears at APPC (or NM factor if
// state-specific factor given).
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

    // Allocate offset value proportionally to bill, surplus proportionally to gen
    return billArr.map((bill, m) => {
      const billShare = totalBill > 0 ? bill / totalBill : 0;
      const genShare = annualGen > 0 ? genArr[m] / annualGen : 0;
      const offsetPart = annualOffsetValue * billShare;
      const surplusPart = annualSurplusValue * genShare;
      return Math.min(bill, offsetPart) + surplusPart;
    });
  }

  // Monthly settlement
  return billArr.map((bill, m) => {
    const gen = genArr[m];
    const consumption = bill / tariff;
    const offset = Math.min(gen, consumption);
    const exportU = Math.max(0, gen - consumption);
    const exportRate = DEFAULTS.appc_rate;
    return Math.min(offset * tariff, bill) + exportU * exportRate;
  });
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

// IRR-optimal sizing: sweep 1–5 kW in 0.5 steps and pick the kW with highest
// IRR for the user's actual DISCOM settlement period. For annual-settlement
// DISCOMs this lands close to "annual match"; for monthly-settlement DISCOMs
// the optimum is smaller because surplus exports clear at the low APPC rate.
export function pickOptimalSize(input) {
  let bestKw = 1.0;
  let bestIrr = -Infinity;
  for (let kw = 1.0; kw <= 5.0 + 1e-9; kw += 0.5) {
    const r = compute({ ...input, system_kw: kw });
    if (r.metrics.irr !== null && r.metrics.irr > bestIrr) {
      bestIrr = r.metrics.irr;
      bestKw = kw;
    }
  }
  return bestKw;
}

// §4.9 sizing recommendation — IRR-optimal "Recommended", with a smaller and a
// larger flanking card. The flanks expose the trade-off (smaller = higher IRR,
// larger = bigger % of bill covered).
export function deriveSizingCards(input, discom) {
  const optimalKw = pickOptimalSize(input);

  // Bill-coverage size: covers annual consumption. May or may not equal IRR-optimal.
  const annualUnits = sum(deriveBillArray(input.bill_peak_summer, input.bill_low_winter)) / discom.tariff;
  const refGen = sum(deriveMonthlyGenerationYr1(1, discom.zone, input.panel_tech, input.shading, input.roof_type));
  const billCoverKw = clamp(Math.ceil(annualUnits / refGen / 0.5) * 0.5, 1.0, 5.0);

  // Build 3 cards: Smaller / Best IRR / Larger. If billCoverKw differs meaningfully,
  // use it as the "Larger" anchor so the trade-off is obvious.
  const larger = billCoverKw > optimalKw + 0.5 ? billCoverKw : Math.min(5.0, optimalKw + 0.5);
  const sizes = [
    { label: 'Smaller',        kw: Math.max(1.0, optimalKw - 0.5) },
    { label: 'Best IRR',       kw: optimalKw, recommended: true },
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

// Decision verdict — compares post-tax net wealth, not just IRR.
// IRR alone misleads at large outlays: a 14% IRR on ₹3.6L can lose to a 12%
// equity alt because the alt-investor's compounding base equals solar's outlay
// and equity's absolute wealth gain (post-tax) outpaces solar's bill savings.
// We compare net_gain (solar's lifetime wealth) vs nifty_net_wealth (the
// passive equity benchmark, same horizon, post-LTCG, less bills paid).
export function verdictFor(irr, altRate, solarWealth, equityWealth) {
  if (irr === null) return { tone: 'neutral', headline: 'Not enough data', body: 'Adjust your bill or system size to see a verdict.' };

  // Fall back to the rate comparison if wealth metrics weren't passed
  if (solarWealth === undefined || equityWealth === undefined) {
    const delta = irr - altRate;
    if (delta > 0.05) return { tone: 'positive', headline: 'Solar wins clearly', body: `${(irr * 100).toFixed(0)}% return beats your ${(altRate * 100).toFixed(0)}% alternative by a wide margin.` };
    if (delta > -0.05) return { tone: 'neutral',  headline: 'Comparable to equity', body: 'Choose solar for inflation hedge + energy security.' };
    return { tone: 'caution', headline: 'Marginal returns', body: 'Solar makes sense if you\'ll live here >10 years; otherwise invest.' };
  }

  const fmtL = (v) => (v < 0 ? '−' : '') + '₹' + (Math.abs(v) / 100000).toFixed(1) + 'L';
  const gap = solarWealth - equityWealth;
  const irrPct = (irr * 100).toFixed(0);

  if (gap > 200000) {
    return { tone: 'positive', headline: 'Solar wins clearly',
      body: `Solar's ${fmtL(solarWealth)} net wealth beats passive equity's ${fmtL(equityWealth)} by ${fmtL(Math.abs(gap))} — IRR ${irrPct}%.` };
  }
  if (gap > -100000) {
    return { tone: 'neutral', headline: 'Comparable to equity',
      body: `Solar (${fmtL(solarWealth)}) and equity (${fmtL(equityWealth)}) end up close. Solar adds inflation hedge + energy security; equity adds liquidity.` };
  }
  if (solarWealth > 0) {
    return { tone: 'caution', headline: 'Equity wins on cash, but…',
      body: `Equity ends ${fmtL(Math.abs(gap))} ahead in cash. Solar still gains ${fmtL(solarWealth)} net and gives outage cover that cash can't price.` };
  }
  return { tone: 'caution', headline: 'Wrong system at this outlay',
    body: `At this size and outlay, equity (${fmtL(equityWealth)}) outpaces solar (${fmtL(solarWealth)}). Try a smaller kW or on-grid.` };
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

// Master pipeline — returns the engine output shape per §6.2
export function compute(input) {
  const discom = getDiscom(input.state_key);
  const tariff = input.tariff_per_unit ?? discom.tariff;

  const billArr = deriveBillArray(input.bill_peak_summer, input.bill_low_winter);
  const annualBill = sum(billArr);
  const annualConsumption = annualBill / tariff;

  // Inject derived consumption back in for off-grid battery sizing
  const enrichedInput = { ...input, annual_consumption_kwh: annualConsumption };

  const costs = deriveCosts(enrichedInput, discom);

  const genArr = deriveMonthlyGenerationYr1(input.system_kw, discom.zone, input.panel_tech, input.shading, input.roof_type);
  const annualGen = sum(genArr);

  let savingsArr;
  let offgridReframe = null;
  if (input.system_type === 'OffGrid') {
    // §13.7 reframe — use bill-avoided OR diesel baseline (whichever higher)
    const billAvoided = annualBill;
    const dieselBaseline = annualConsumption * DEFAULTS.diesel_kwh_cost;
    const baseline = Math.max(billAvoided, dieselBaseline);
    const utilisation = DEFAULTS.utilization_factor_offgrid;
    const monthlyUseful = genArr.map((g) => g * utilisation);
    savingsArr = billArr.map((b, m) => Math.min(b, monthlyUseful[m] * tariff));
    offgridReframe = { billAvoided, dieselBaseline, basisChosen: dieselBaseline > billAvoided ? 'diesel' : 'bill' };
  } else {
    savingsArr = deriveMonthlySavingsYr1(billArr, genArr, tariff, input.net_metering_enabled, discom.nm_factor, discom.settlement);
  }

  const annualSavingsYr1 = sum(savingsArr);

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

  // Alternative investment corpus at horizon (post-tax, after bills paid).
  //
  // To compare like-for-like with solar's net_gain, every alt row is rendered
  // as net wealth: post-tax investment gain MINUS the cumulative bills the
  // alt-investor still has to pay (escalating with tariff_escalation). Without
  // this subtraction, alt corpora look 2–3× larger than they actually leave
  // the household at horizon end — the bug §17 calls out in the audit.
  const H = input.analysis_horizon_years;
  const fdCorpusPre = costs.net * Math.pow(1 + DEFAULTS.fd_rate, H);
  const fdCorpusPost = costs.net + (fdCorpusPre - costs.net) * (1 - DEFAULTS.slab_tax_rate);
  const niftyCorpusPre = costs.net * Math.pow(1 + DEFAULTS.nifty_rate, H);
  const niftyCorpusPost = costs.net + (niftyCorpusPre - costs.net) * (1 - DEFAULTS.ltcg_rate);
  const altCorpusPre = costs.net * Math.pow(1 + input.alt_return_rate, H);
  const altCorpusPost = costs.net + (altCorpusPre - costs.net) * (1 - DEFAULTS.ltcg_rate);

  // Cumulative bills the alt-investor would pay over the horizon (geometric
  // series with tariff escalation). At Y0 = 0, at Y_t = annualBill × ((1+e)^t − 1)/e.
  const esc = input.tariff_escalation;
  const billsPaidByYear = (t) => esc > 0
    ? annualBill * (Math.pow(1 + esc, t) - 1) / esc
    : annualBill * t;
  const billsTotal = billsPaidByYear(H);

  const fdGainPostTax     = Math.max(0, fdCorpusPost - costs.net);
  const niftyGainPostTax  = Math.max(0, niftyCorpusPost - costs.net);
  const altGainPostTax    = Math.max(0, altCorpusPost - costs.net);
  const fdNetWealth       = fdGainPostTax - billsTotal;
  const niftyNetWealth    = niftyGainPostTax - billsTotal;
  const altNetWealth      = altGainPostTax - billsTotal;

  const energyIndependence = annualConsumption > 0 ? annualGen / annualConsumption : null;
  const co2OffsetKg = annualGen * DEFAULTS.grid_emission_kg_per_kwh;

  const verdict = verdictFor(irr, input.alt_return_rate, netGain, niftyNetWealth);

  return {
    discom,
    tariff,
    bills: { monthly: billArr, annual: annualBill },
    consumption: { annual_kwh: annualConsumption },
    generation: { monthly: genArr, annual: annualGen },
    savings_yr1: {
      monthly: savingsArr,
      annual: annualSavingsYr1,
      pct_of_bill: annualBill > 0 ? annualSavingsYr1 / annualBill : 0,
      residual_bill: Math.max(0, annualBill - annualSavingsYr1),
      // Split annual savings into the bill-offset portion (capped at bill,
      // valued at retail) and the APPC surplus credit (only when gen > cons).
      // For Annual settlement: surplus_credit = (gen − cons) × APPC.
      // For Monthly settlement: surplus_credit = sum of monthly export credits.
      // For OffGrid: surplus_credit = 0 (capped at bill).
      bill_offset: Math.min(annualBill, annualSavingsYr1),
      surplus_credit: Math.max(0, annualSavingsYr1 - annualBill),
    },
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
      // Post-tax + bill-subtracted "net wealth" — what to actually compare with solar
      fd_corpus_post: fdCorpusPost,
      alt_corpus_post: altCorpusPost,
      bills_total: billsTotal,
      bills_paid_by_year: billsPaidByYear,
      fd_net_wealth: fdNetWealth,
      nifty_net_wealth: niftyNetWealth,
      alt_net_wealth: altNetWealth,
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
  return result;
}

// Default input — what loads on first paint
export function defaultInput() {
  return {
    bill_peak_summer: 3500,
    bill_low_winter: 400,
    state_key: 'RJ-KEDL',
    tariff_per_unit: null,
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
