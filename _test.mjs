import { computeFull, defaultInput, formatINR, billFromUnits, unitsFromBill, savingsFromOffset, marginalRate } from './engine.js';
import { getTariffSchedule } from './constants.js';

const r = computeFull(defaultInput());

console.log('=== §5 Kota 3kW OnGrid baseline ===');
console.log('Annual bill:        ', formatINR(r.bills.annual), '(spec ~₹20,455)');
console.log('Annual generation:  ', Math.round(r.generation.annual), 'kWh (spec ~4,650)');
console.log('Net cost:           ', formatINR(r.costs.net), '(spec ₹1,17,000)');
console.log('Year 1 savings:     ', formatINR(r.savings_yr1.annual), '(spec ~₹26-28k)');
console.log('Payback:            ', r.metrics.payback_simple?.toFixed(2), 'yrs (spec ~4.4)');
console.log('IRR:                ', (r.metrics.irr * 100).toFixed(1) + '%', '(spec ~23-25%)');
console.log('Net gain 25yr:      ', formatINR(r.metrics.net_gain), '(spec ~₹10 lakh)');
// coverage_ratio = annual gen / annual cons (kWh). >100% means oversized;
// the excess clears at APPC. Don't read this as a clamped "% independence".
const cov = (r.metrics.coverage_ratio * 100).toFixed(0);
console.log('Gen/cons ratio:     ', cov + '%' + (r.metrics.coverage_ratio > 1 ? '  (over-generates — surplus settles at APPC)' : ''));
console.log();
console.log('=== Recommended size ===');
r.sizing_cards.forEach(c => console.log(`  ${c.label}: ${c.kw}kW · payback ${c.payback?.toFixed(1)}y · IRR ${(c.irr*100).toFixed(0)}% · ${formatINR(c.annual_savings)}/yr`));
console.log();

// §13.9 cross-type
console.log('=== §13.9 Cross-type Kota 3kW ===');
['OnGrid', 'Hybrid', 'OffGrid'].forEach(type => {
  const result = computeFull({ ...defaultInput(), system_type: type });
  console.log(`  ${type.padEnd(8)}: net=${formatINR(result.costs.net).padStart(12)} · y1 sav=${formatINR(result.savings_yr1.annual).padStart(10)} · payback=${(result.metrics.payback_simple || 99).toFixed(1)}y · IRR=${(result.metrics.irr*100).toFixed(1)}%`);
});
console.log();

// §14.12 Hybrid Patchy
console.log('=== §14.12 Hybrid Patchy 2.5hr/day ===');
const patchy = computeFull({ ...defaultInput(), system_type: 'Hybrid', outage_hours_per_day: 2.5 });
console.log('Battery sized:      ', patchy.costs.battery_kwh, 'kWh (spec 3.0)');
console.log('Outage value annual:', formatINR(patchy.outage.net), '(spec ~₹7,415)');
console.log('Standby drain:      ', formatINR(patchy.standby_drain), '(spec ~₹2,235)');
console.log('Net annual savings: ', formatINR(patchy.savings_yr1.annual + patchy.outage.net - patchy.standby_drain), '(spec ~₹32,180)');
console.log('Payback:            ', patchy.metrics.payback_simple?.toFixed(1), 'yrs (spec ~7.4)');
console.log('IRR:                ', (patchy.metrics.irr * 100).toFixed(1) + '%', '(spec ~14%)');
console.log();

// §7 — monthly decomposition reconciles with existing totals
console.log('=== §7 monthly decomposition reconciliation ===');
const decomp = r.monthly_decomposition;
const billAvoidedAnnual = decomp.monthly.reduce((s, m) => s + m.bill_avoided_inr, 0);
const surplusAnnual = decomp.year_end.surplus_inr;
const decompTotal = billAvoidedAnnual + surplusAnnual;
console.log('Bill avoided (sum of months):', formatINR(billAvoidedAnnual));
console.log('Surplus payout at year-end:  ', formatINR(surplusAnnual), `(${decomp.year_end.surplus_kwh.toFixed(0)} kWh × APPC)`);
console.log('Decomposition total:         ', formatINR(decompTotal));
console.log('Existing annual savings:     ', formatINR(r.savings_yr1.annual));
const reconErr = Math.abs(decompTotal - r.savings_yr1.annual);
console.log('Reconciliation error:        ', formatINR(reconErr), reconErr < 5 ? '✓' : '✗ FAIL');
console.log();

// Sample monthly view
console.log('Months sample (Jan, May, Aug, Dec):');
[0, 4, 7, 11].forEach((m) => {
  const x = decomp.monthly[m];
  console.log(`  M${m + 1}: gen=${x.gen_kwh.toFixed(0)} cons=${x.cons_kwh.toFixed(0)} self=${x.self_consumed_kwh.toFixed(0)} exp=${x.exported_kwh.toFixed(0)} imp=${x.imported_kwh.toFixed(0)} bankEom=${x.bank_balance_eom_kwh.toFixed(0)} avoided=${formatINR(x.bill_avoided_inr)}`);
});
console.log();

// §3 + §5 recommendation pipeline
console.log('=== §3 recommendation ===');
console.log(`Recommended kW:   ${r.recommendation.kw} kW`);
console.log(`Recommended type: ${r.recommendation.system_type}`);
console.log(`Reason (kW):      ${r.recommendation.reason_kw}`);
console.log(`Reason (type):    ${r.recommendation.reason_type}`);
console.log(`Coverage at reco: ${(r.recommendation.coverage_at_recommended * 100).toFixed(0)}%`);
console.log();

console.log('=== §5 system options ===');
r.system_options.forEach((o) => {
  const rec = o.recommended ? '★' : ' ';
  console.log(`  ${rec} ${o.type.padEnd(7)}: net=${formatINR(o.net_cost).padStart(10)} payback=${(o.payback_yrs ?? 99).toFixed(1)}y gain=${formatINR(o.gain_25y).padStart(12)} Δ=${formatINR(o.delta_to_recommended).padStart(11)}`);
});

// ── Slab tariff verification: user-supplied 560-unit RJ residential example ──
console.log();
console.log('=== Slab tariff: user-supplied 560-unit RJ residential example ===');
const rjRes = getTariffSchedule('RJ-KEDL', 'residential_lt');
const exampleBill = billFromUnits(560, rjRes);
console.log('Bill at 560 units:    ', formatINR(exampleBill), '(spec ₹4,671)');
const expectedEnergy = 50*4.75 + 100*6.50 + 150*7.35 + 200*7.65 + 60*7.95;
console.log('Expected energy:      ', formatINR(expectedEnergy), '(spec ₹3,997)');
console.log('Expected duty (5.6%): ', formatINR(expectedEnergy * 0.056), '(spec ₹224)');
console.log('Expected fixed:       ', formatINR(rjRes.fixed_charge_inr_mo), '(spec ₹450)');
console.log('Expected total:       ', formatINR(expectedEnergy * 1.056 + rjRes.fixed_charge_inr_mo));
console.log('Marginal rate at 560:  ₹' + marginalRate(560, rjRes).toFixed(2) + ' (spec ₹7.95)');
console.log();

// Inverse check
const reverseUnits = unitsFromBill(4671, rjRes);
console.log('Inverse: ₹4,671 →', reverseUnits.toFixed(1), 'units (spec 560)');
console.log();

// Top-of-stack savings: offset 100 units when consuming 560
const topSavings = savingsFromOffset(560, 100, rjRes);
const naiveSavings = 100 * (4671 / 560);  // average-rate naive valuation
console.log('Slab-aware savings on 100 kWh offset:', formatINR(topSavings), '(top of stack ₹7.95 + duty)');
console.log('Naive average-rate savings:          ', formatINR(naiveSavings), '(would overstate by:', formatINR(naiveSavings - topSavings) + ')');
console.log();

// Cross-DISCOM monthly settlement spot-check (Maharashtra MSEDCL is Monthly)
console.log('=== Monthly-settlement DISCOM (MSEDCL) ===');
const mh = computeFull({ ...defaultInput(), state_key: 'MH-MSEDCL' });
const mhDecomp = mh.monthly_decomposition;
const mhBillAvoid = mhDecomp.monthly.reduce((s, m) => s + m.bill_avoided_inr, 0);
const mhSurplus = mhDecomp.year_end.surplus_inr;
const mhTotal = mhBillAvoid + mhSurplus;
console.log('Bank end-of-Dec (kWh):', mhDecomp.year_end.surplus_kwh.toFixed(1), '(monthly settlement → expect 0)');
console.log('Per-month surplus sum:', formatINR(mhSurplus));
console.log('Decomp total:         ', formatINR(mhTotal));
console.log('Existing annual:      ', formatINR(mh.savings_yr1.annual));
const mhErr = Math.abs(mhTotal - mh.savings_yr1.annual);
console.log('Reconciliation error: ', formatINR(mhErr), mhErr < 5 ? '✓' : '✗ FAIL');
