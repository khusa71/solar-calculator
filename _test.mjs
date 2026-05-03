import { computeFull, defaultInput, formatINR } from './engine.js';

const r = computeFull(defaultInput());

console.log('=== §5 Kota 3kW OnGrid baseline ===');
console.log('Annual bill:        ', formatINR(r.bills.annual), '(spec ~₹20,455)');
console.log('Annual generation:  ', Math.round(r.generation.annual), 'kWh (spec ~4,650)');
console.log('Net cost:           ', formatINR(r.costs.net), '(spec ₹1,17,000)');
console.log('Year 1 savings:     ', formatINR(r.savings_yr1.annual), '(spec ~₹26-28k)');
console.log('Payback:            ', r.metrics.payback_simple?.toFixed(2), 'yrs (spec ~4.4)');
console.log('IRR:                ', (r.metrics.irr * 100).toFixed(1) + '%', '(spec ~23-25%)');
console.log('Net gain 25yr:      ', formatINR(r.metrics.net_gain), '(spec ~₹10 lakh)');
console.log('Energy independence:', (r.metrics.energy_independence * 100).toFixed(0) + '%');
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
