// The Solar Ledger — system-type diagrams
// Renders three billing-focused schematics (On-grid, Hybrid, Off-grid).
// Left column: editorial line-art schematic of the energy flow.
// Right column: explicit arithmetic — bill − (kWh generated × tariff) = new bill.
// Engine is run once per system type so each pane shows honest numbers.
// All static markup is hardcoded (no user input) and parsed via DOMParser.

import { computeFull, pickOptimalSize } from './engine.js';

/* ──────────────────────────────────────────────────────────
   Shared SVG component fragments
   ────────────────────────────────────────────────────────── */

const SUN = (cx, cy) => `
  <g transform="translate(${cx},${cy})">
    <circle class="sun-disc" cx="0" cy="0" r="9"/>
    <g class="sun-rays">
      <line x1="0"     y1="-16"  x2="0"     y2="-12"/>
      <line x1="0"     y1="12"   x2="0"     y2="16"/>
      <line x1="-16"   y1="0"    x2="-12"   y2="0"/>
      <line x1="12"    y1="0"    x2="16"    y2="0"/>
      <line x1="-11.3" y1="-11.3" x2="-8.5" y2="-8.5"/>
      <line x1="8.5"   y1="8.5"  x2="11.3"  y2="11.3"/>
      <line x1="11.3"  y1="-11.3" x2="8.5"  y2="-8.5"/>
      <line x1="-8.5"  y1="8.5"  x2="-11.3" y2="11.3"/>
    </g>
  </g>
`;

const PANEL = (cx, cy) => `
  <g class="ink" transform="translate(${cx},${cy})">
    <polygon points="-50,16 50,16 40,-16 -60,-16"/>
    <line x1="-55" y1="0"   x2="45"  y2="0"/>
    <line x1="-30" y1="-16" x2="-20" y2="16"/>
    <line x1="-5"  y1="-16" x2="5"   y2="16"/>
    <line x1="20"  y1="-16" x2="30"  y2="16"/>
  </g>
`;

const HOUSE = (cx, cy) => `
  <g class="ink" transform="translate(${cx},${cy})">
    <polygon points="-30,-12 0,-38 30,-12"/>
    <rect x="-30" y="-12" width="60" height="34"/>
  </g>
`;

const BATTERY = (cx, cy) => `
  <g class="ink" transform="translate(${cx},${cy})">
    <rect x="-22" y="-15" width="44" height="30"/>
    <rect x="-15" y="-18" width="8"  height="3"/>
    <rect x="7"   y="-18" width="8"  height="3"/>
    <line x1="-10" y1="-7" x2="-10" y2="9"/>
    <line x1="0"   y1="-7" x2="0"   y2="9"/>
    <line x1="10"  y1="-7" x2="10"  y2="9"/>
  </g>
`;

const METER = (cx, cy) => `
  <g class="ink" transform="translate(${cx},${cy})">
    <rect x="-15" y="-17" width="30" height="34" rx="2"/>
    <rect x="-11" y="-13" width="22" height="7"/>
    <text x="0" y="-7.5" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="6" fill="#1B1916">8421</text>
    <circle cx="-6" cy="5" r="3.2"/>
    <line x1="-6" y1="5" x2="-6" y2="2.5"/>
    <circle cx="6"  cy="5" r="3.2"/>
    <line x1="6"  y1="5" x2="7"  y2="2.5"/>
  </g>
`;

const GRID_POLE = (cx, cy) => `
  <g class="ink" transform="translate(${cx},${cy})">
    <line x1="0" y1="-50" x2="0" y2="80"/>
    <line x1="-22" y1="-28" x2="22" y2="-28"/>
    <circle cx="-18" cy="-30" r="2"/>
    <circle cx="0"   cy="-30" r="2"/>
    <circle cx="18"  cy="-30" r="2"/>
    <line x1="-12" y1="80" x2="12" y2="80"/>
    <line x1="-9"  y1="83" x2="9"  y2="83"/>
  </g>
`;

const INVERTER = (cx, cy) => `
  <g class="ink" transform="translate(${cx},${cy})">
    <rect x="-14" y="-22" width="28" height="44" rx="2"/>
    <rect x="-10" y="-17" width="20" height="9"/>
    <line x1="-7" y1="-12" x2="7" y2="-12"/>
    <line x1="-7" y1="-9.5" x2="7" y2="-9.5"/>
    <circle cx="-6" cy="3" r="2.2"/>
    <circle cx="0"  cy="3" r="2.2"/>
    <circle cx="6"  cy="3" r="2.2"/>
    <line x1="-8" y1="13" x2="8" y2="13"/>
    <line x1="-6" y1="16" x2="6" y2="16"/>
  </g>
`;

/* Callout label: small dot on the component, dashed leader line, monospace
   uppercase label off to the side. anchor = 'middle' | 'start' | 'end'. */
const CALLOUT = (cx, cy, lx, ly, text, anchor = 'middle') => {
  const dx = anchor === 'start' ? 5 : anchor === 'end' ? -5 : 0;
  return `
    <g class="callout">
      <circle class="callout__dot" cx="${cx}" cy="${cy}" r="1.6"/>
      <line class="callout__lead" x1="${cx}" y1="${cy}" x2="${lx}" y2="${ly}"/>
      <text class="callout__lbl" x="${lx + dx}" y="${ly + 3}" text-anchor="${anchor}">${text}</text>
    </g>
  `;
};

/* ──────────────────────────────────────────────────────────
   Energy-packet helpers
   - FLOW renders the dashed marching path (existing behaviour)
   - PACKET overlays bright dots that travel along that path
   - Packets fade in at start and out at end so they feel emitted
     and absorbed, not teleported.
   ────────────────────────────────────────────────────────── */
const DUR_BY_KIND = { energy: 2.0, export: 2.4, import: 2.4, store: 2.6 };

const FLOW = (id, kind, d) =>
  `<path id="${id}" class="flow flow--${kind}" d="${d}"/>`;

const PACKET = (pathId, kind, opts = {}) => {
  const dur = opts.dur ?? DUR_BY_KIND[kind] ?? 2.0;
  const count = opts.count ?? 2;
  const r = opts.r ?? 2.8;
  let out = '';
  for (let i = 0; i < count; i++) {
    const offset = -(dur / count) * i;
    const begin = offset === 0 ? '0s' : `${offset.toFixed(2)}s`;
    out +=
      `<circle class="packet packet--${kind}" r="0">` +
        `<animateMotion dur="${dur}s" begin="${begin}" repeatCount="indefinite">` +
          `<mpath href="#${pathId}"/>` +
        `</animateMotion>` +
        `<animate attributeName="r" dur="${dur}s" begin="${begin}" repeatCount="indefinite" ` +
                 `values="0;${r};${r};0" keyTimes="0;0.12;0.88;1"/>` +
      `</circle>`;
  }
  return out;
};

/* ──────────────────────────────────────────────────────────
   Three schematics — story-driven
   ────────────────────────────────────────────────────────── */
const SVG_ONGRID = `
  <svg class="sys-diagram__svg" viewBox="0 0 660 250" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <text class="diag-title" x="330" y="22" text-anchor="middle">ON-GRID · PANELS OFFSET WHAT YOU BUY</text>

    ${SUN(80, 80)}
    ${PANEL(200, 130)}
    ${HOUSE(380, 170)}
    ${METER(485, 180)}
    ${GRID_POLE(595, 155)}

    ${FLOW('ong-sun', 'energy', 'M 96 88 Q 140 100 162 116')}
    ${FLOW('ong-pnl', 'energy', 'M 250 142 Q 300 160 348 168')}
    ${FLOW('ong-mx1', 'export', 'M 410 174 L 470 174')}
    ${FLOW('ong-mx2', 'export', 'M 500 174 L 580 134')}
    ${FLOW('ong-mi1', 'import', 'M 580 152 L 500 192')}
    ${FLOW('ong-mi2', 'import', 'M 470 192 L 410 192')}

    <g class="packets">
      ${PACKET('ong-sun', 'energy')}
      ${PACKET('ong-pnl', 'energy')}
      ${PACKET('ong-mx1', 'export')}
      ${PACKET('ong-mx2', 'export')}
      ${PACKET('ong-mi1', 'import')}
      ${PACKET('ong-mi2', 'import')}
    </g>

    ${CALLOUT(80, 71, 80, 46, 'SUN')}
    ${CALLOUT(210, 114, 200, 78, 'SOLAR PANEL')}
    ${CALLOUT(380, 132, 380, 102, 'HOUSE')}
    ${CALLOUT(485, 163, 485, 232, 'METER')}
    ${CALLOUT(595, 127, 595, 92, 'GRID')}

    <text class="annot annot--export" x="540" y="148" text-anchor="middle">+ EXPORT</text>
    <text class="annot annot--import" x="540" y="212" text-anchor="middle">− IMPORT</text>
  </svg>
`;

const SVG_HYBRID = `
  <svg class="sys-diagram__svg" viewBox="0 0 680 320" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <text class="diag-title" x="340" y="22" text-anchor="middle">HYBRID · BATTERY COVERS THE EVENING PEAK</text>

    ${SUN(80, 75)}
    ${PANEL(200, 135)}
    ${HOUSE(450, 140)}
    ${METER(545, 145)}
    ${GRID_POLE(625, 145)}
    ${BATTERY(180, 270)}
    ${INVERTER(335, 260)}

    ${FLOW('hyb-sun', 'energy', 'M 96 83 Q 140 105 162 122')}
    ${FLOW('hyb-pin', 'store',  'M 232 149 Q 290 200 320 240')}
    ${FLOW('hyb-bin', 'store',  'M 215 268 L 308 262')}
    ${FLOW('hyb-inh', 'energy', 'M 348 244 Q 400 190 432 152')}
    ${FLOW('hyb-grb', 'store',  'M 540 162 Q 450 222 354 240')}
    ${FLOW('hyb-mi1', 'import', 'M 605 130 L 565 142')}
    ${FLOW('hyb-mi2', 'import', 'M 530 142 L 480 142')}
    ${FLOW('hyb-mx1', 'export', 'M 480 132 L 530 132')}
    ${FLOW('hyb-mx2', 'export', 'M 565 132 L 605 120')}

    <g class="packets">
      ${PACKET('hyb-sun', 'energy')}
      ${PACKET('hyb-pin', 'store')}
      ${PACKET('hyb-bin', 'store')}
      ${PACKET('hyb-inh', 'energy')}
      ${PACKET('hyb-grb', 'store', { count: 1 })}
      ${PACKET('hyb-mi1', 'import', { count: 1 })}
      ${PACKET('hyb-mi2', 'import', { count: 1 })}
      ${PACKET('hyb-mx1', 'export', { count: 1 })}
      ${PACKET('hyb-mx2', 'export', { count: 1 })}
    </g>

    ${CALLOUT(80, 66, 80, 42, 'SUN')}
    ${CALLOUT(210, 119, 200, 82, 'SOLAR PANEL')}
    ${CALLOUT(450, 102, 450, 72, 'HOUSE')}
    ${CALLOUT(545, 128, 545, 92, 'METER')}
    ${CALLOUT(625, 117, 625, 82, 'GRID')}
    ${CALLOUT(180, 285, 180, 308, 'BATTERY')}
    ${CALLOUT(335, 282, 335, 305, 'INVERTER')}

    <text class="annot annot--store"  x="282" y="206" text-anchor="middle">CHARGE · SOLAR</text>
    <text class="annot annot--store"  x="475" y="195" text-anchor="middle">CHARGE · GRID (OFF-PEAK)</text>
    <text class="annot annot--note"   x="396" y="222" text-anchor="middle">EVENING DRAW</text>
    <text class="annot annot--import" x="555" y="160" text-anchor="middle">FALLBACK</text>
  </svg>
`;

const SVG_OFFGRID = `
  <svg class="sys-diagram__svg" viewBox="0 0 620 300" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <text class="diag-title" x="310" y="22" text-anchor="middle">OFF-GRID · BATTERY DOES EVERYTHING</text>

    ${SUN(80, 75)}
    ${PANEL(200, 130)}
    ${HOUSE(490, 145)}
    ${BATTERY(180, 260)}
    ${INVERTER(335, 250)}

    <g class="ink ink--soft" transform="translate(575, 145)" opacity="0.5">
      <line x1="0" y1="-30" x2="0" y2="40"/>
      <line x1="-12" y1="-15" x2="12" y2="-15"/>
    </g>
    <line class="strike" x1="558" y1="118" x2="595" y2="178"/>
    <text class="annot annot--note" x="575" y="105" text-anchor="middle">NO GRID</text>

    ${FLOW('off-sun', 'energy', 'M 96 83 Q 140 100 162 117')}
    ${FLOW('off-pin', 'store',  'M 232 144 Q 290 195 320 230')}
    ${FLOW('off-bin', 'store',  'M 215 258 L 308 252')}
    ${FLOW('off-inh', 'energy', 'M 348 234 Q 410 180 470 152')}

    <g class="packets">
      ${PACKET('off-sun', 'energy')}
      ${PACKET('off-pin', 'store')}
      ${PACKET('off-bin', 'store')}
      ${PACKET('off-inh', 'energy')}
    </g>

    ${CALLOUT(80, 66, 80, 42, 'SUN')}
    ${CALLOUT(210, 114, 200, 78, 'SOLAR PANEL')}
    ${CALLOUT(490, 107, 490, 78, 'HOUSE')}
    ${CALLOUT(180, 275, 180, 295, 'BATTERY (LARGE)')}
    ${CALLOUT(335, 272, 335, 295, 'INVERTER')}

    <text class="annot annot--store" x="280" y="200" text-anchor="middle">CHARGE</text>
    <text class="annot annot--note"  x="402" y="218" text-anchor="middle">DRAW</text>
  </svg>
`;

/* ──────────────────────────────────────────────────────────
   DOMParser-based safe construction
   ────────────────────────────────────────────────────────── */
const parser = new DOMParser();

function parseSvg(svgString) {
  const doc = parser.parseFromString(svgString.trim(), 'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}

const PANES = [
  {
    id: 'OnGrid',
    svg: SVG_ONGRID,
    title: 'On-grid',
    gist: 'Solar offsets your bill. Grid is your virtual battery.',
    label: 'On-grid: panels offset what you would buy. Surplus is exported, deficit imported, your bill is the difference.',
  },
  {
    id: 'Hybrid',
    svg: SVG_HYBRID,
    title: 'Hybrid',
    gist: 'Battery covers the evening peak. Outage backup included.',
    label: 'Hybrid: battery covers the evening peak so the grid is barely used.',
  },
  {
    id: 'OffGrid',
    svg: SVG_OFFGRID,
    title: 'Off-grid',
    gist: 'No grid. Battery does everything.',
    label: 'Off-grid: no grid connection. Battery does everything.',
  },
];

const fmtINR  = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtKwh  = (n) => Math.round(n).toLocaleString('en-IN') + ' kWh';

// One-liner explaining why the effective rate per kWh differs from the
// headline tariff. The blended rate falls below tariff when surplus exports
// clear at APPC (~₹3.25/unit), or for off-grid when battery RTE losses cap
// realised value. Hybrid w/ NM bills like on-grid — battery's value lives in
// outage cover (modeled separately as outage_value), not in this rate.
function effectiveRateNote(systemId, tariff, hasSurplus) {
  const t = tariff.toFixed(2);
  if (systemId === 'OnGrid' || systemId === 'Hybrid') {
    return hasSurplus
      ? `tariff ₹${t} blended with APPC ₹3.25 on surplus exports`
      : `tariff ₹${t} (no surplus — full retail offset)`;
  }
  if (systemId === 'OffGrid') return `tariff ₹${t} less battery round-trip losses`;
  return '';
}

/* ──────────────────────────────────────────────────────────
   DOM construction helpers (no innerHTML)
   ────────────────────────────────────────────────────────── */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (v != null && v !== false) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

function calcRow(op, label, valNode, modifier = '', sublabel = '') {
  const row = el('div', { class: 'calc-row' + (modifier ? ' calc-row--' + modifier : '') });
  row.appendChild(el('span', { class: 'calc-row__op', 'aria-hidden': 'true' }, op));
  const labelWrap = el('span', { class: 'calc-row__label' }, label);
  if (sublabel) labelWrap.appendChild(el('em', { class: 'calc-row__sub' }, sublabel));
  row.appendChild(labelWrap);
  row.appendChild(valNode);
  return row;
}

function valueNode(text, unit, accent = '') {
  const span = el('span', { class: 'calc-row__val' + (accent ? ' calc-row__val--' + accent : '') }, text);
  if (unit) span.appendChild(el('span', { class: 'calc-row__unit' }, unit));
  return span;
}

function buildBillPane(systemId, state, r) {
  // Monthly figures from the engine (run for THIS system type)
  const monthlyBill    = r.bills.annual / 12;
  const monthlyGen     = r.generation.annual / 12;
  const monthlySaved   = r.savings_yr1.annual / 12;
  const monthlyResid   = r.savings_yr1.residual_bill / 12;
  const monthlyOffset  = r.savings_yr1.bill_offset / 12;
  const monthlySurplus = r.savings_yr1.surplus_credit / 12;
  const tariff         = r.tariff;
  const hasSurplus     = monthlySurplus > 1;  // > ₹1/mo to avoid noise

  // Effective rate per kWh — closes the math:
  //   monthlyGen × effRate = monthlySaved
  // For OnGrid/Hybrid w/ NM this falls below tariff because surplus exports
  // clear at APPC. For OffGrid it falls because of battery RTE + utilization.
  const effRate = monthlyGen > 0 ? monthlySaved / monthlyGen : 0;

  // Annual surplus units (kWh) — used in the sublabel to make the APPC haircut concrete
  const annualSurplusKwh = Math.max(0, r.generation.annual - r.bills.annual / tariff);

  const wrap = el('div', { class: 'sys-bill' });
  wrap.appendChild(el('span', { class: 'sys-bill__title' }, 'Worked example · your bill'));

  const calc = el('div', { class: 'sys-bill__calc' });

  calc.appendChild(calcRow(
    ' ',
    'Your bill',
    valueNode(fmtINR(monthlyBill), '/mo'),
  ));

  calc.appendChild(calcRow(
    ' ',
    'Solar generates',
    valueNode(fmtKwh(monthlyGen), '/mo'),
  ));

  calc.appendChild(calcRow(
    '×',
    'Effective rate',
    valueNode('₹' + effRate.toFixed(2), '/kWh'),
    '',
    effectiveRateNote(systemId, tariff, hasSurplus),
  ));

  // Bill-offset row — capped at the bill (can't go negative). When there is
  // surplus, this is exactly the bill; when undersized, it's less than the bill.
  calc.appendChild(calcRow(
    '−',
    'Bill offset',
    valueNode(fmtINR(monthlyOffset), '/mo', 'minus'),
    'minus',
  ));

  calc.appendChild(calcRow(
    '=',
    'After bill',
    valueNode(fmtINR(monthlyResid), '/mo', 'accent'),
    'total',
  ));

  // Surplus credit — only for grid-tied systems with oversize generation.
  // The kWh sold back at APPC, NOT at retail. Without this row, the visual
  // implied retail-rate cash on the surplus.
  if (hasSurplus) {
    const surplusSub = `${Math.round(annualSurplusKwh).toLocaleString('en-IN')} kWh/yr exported at APPC ₹3.25`;
    calc.appendChild(calcRow(
      '+',
      'Surplus credit',
      valueNode(fmtINR(monthlySurplus), '/mo', 'save'),
      'minus',
      surplusSub,
    ));
  }

  calc.appendChild(calcRow(
    ' ',
    'You keep',
    valueNode(fmtINR(monthlySaved), '/mo', 'save'),
    'save',
  ));
  wrap.appendChild(calc);

  // Reasoning steps — system-specific
  const steps = el('ul', { class: 'sys-bill__steps' });
  if (systemId === 'OnGrid') {
    steps.appendChild(el('li', {}, el('strong', {}, 'Day'), ' Panels run the house. Surplus rolls the meter ', el('em', {}, 'backward'), ' — that\'s an export credit.'));
    steps.appendChild(el('li', {}, el('strong', {}, 'Night'), ' Grid runs the house at your slab rate.'));
    steps.appendChild(el('li', {}, el('strong', {}, 'Bill'), ' DISCOM nets export against import each month.'));
  } else if (systemId === 'Hybrid') {
    steps.appendChild(el('li', {}, el('strong', {}, 'Day'), ' Panels feed the house ', el('em', {}, 'and'), ' charge the battery.'));
    steps.appendChild(el('li', {}, el('strong', {}, 'Off-peak'), ' Grid can also top up the battery on cheap night tariffs (optional).'));
    steps.appendChild(el('li', {}, el('strong', {}, 'Evening'), ' Battery powers the house — grid stays idle. ', el('em', {}, 'That\'s where savings come from.')));
    steps.appendChild(el('li', {}, el('strong', {}, 'Outage'), ' Battery isolates and keeps critical loads on.'));
  } else {
    steps.appendChild(el('li', {}, el('strong', {}, 'Always'), ' Sun → Panels → Battery → House. No grid in the loop.'));
    steps.appendChild(el('li', {}, el('strong', {}, 'Sizing'), ' Battery must hold enough for your ', el('em', {}, 'worst'), ' week of weather.'));
    steps.appendChild(el('li', {}, el('strong', {}, 'No fallback'), ' Battery empty = lights out. There is no grid to lean on.'));
  }
  wrap.appendChild(steps);

  // Trade-off line at the bottom
  const tradeoff = el('p', { class: 'sys-bill__tradeoff' });
  if (systemId === 'OnGrid') {
    tradeoff.appendChild(el('b', {}, 'TRADE-OFF · '));
    tradeoff.appendChild(document.createTextNode('Cheapest system. No backup during outages.'));
  } else if (systemId === 'Hybrid') {
    tradeoff.appendChild(el('b', {}, 'TRADE-OFF · '));
    tradeoff.appendChild(document.createTextNode('Adds ₹35–60k per kWh of battery upfront. Replaces every 8–12 yrs.'));
  } else {
    tradeoff.appendChild(el('b', {}, 'TRADE-OFF · '));
    tradeoff.appendChild(document.createTextNode('System costs 2–3× more. Right for remote sites only.'));
  }
  wrap.appendChild(tradeoff);

  return wrap;
}

/* ──────────────────────────────────────────────────────────
   Price-breakdown panel — sits beside the size cards in the
   standalone Sizing & Price section. Driven by the user's
   currently selected system_type AND system_kw.
   ────────────────────────────────────────────────────────── */
function priceRow(label, value, modifier = '') {
  const row = el('div', { class: 'price-row' + (modifier ? ' price-row--' + modifier : '') });
  row.appendChild(el('span', { class: 'price-row__label' }, label));
  row.appendChild(el('span', { class: 'price-row__val' }, value));
  return row;
}

const SYS_TITLE = { OnGrid: 'On-grid', Hybrid: 'Hybrid', OffGrid: 'Off-grid' };

export function renderSizingPrice(state) {
  const host = document.getElementById('sizingPrice');
  if (!host) return;
  while (host.firstChild) host.removeChild(host.firstChild);

  const r = computeFull(state);
  const c = r.costs;
  const monthlySaved = r.savings_yr1.annual / 12;

  host.appendChild(el('span', { class: 'sizing-price__title' }, `Price for ${state.system_kw} kW · ${SYS_TITLE[state.system_type]}`));

  const breakdown = el('div', { class: 'sizing-price__breakdown' });
  breakdown.appendChild(priceRow('Gross system cost', fmtINR(c.gross)));
  if (c.battery_cost > 0) {
    breakdown.appendChild(priceRow('  of which battery (' + c.battery_kwh + ' kWh)', fmtINR(c.battery_cost), 'sub'));
  }
  if (c.central_subsidy > 0) {
    breakdown.appendChild(priceRow('Central subsidy (PM Surya Ghar)', '−' + fmtINR(c.central_subsidy), 'minus'));
  }
  if (c.state_subsidy > 0) {
    breakdown.appendChild(priceRow('State subsidy (' + r.discom.state + ')', '−' + fmtINR(c.state_subsidy), 'minus'));
  }
  breakdown.appendChild(priceRow('You pay (one-time)', fmtINR(c.net), 'total'));
  host.appendChild(breakdown);

  // Year-1 savings + bill-coverage — gives the card more density when stretched
  const savings = el('div', { class: 'sizing-price__savings' });
  savings.appendChild(el('span', { class: 'sizing-price__savings-label' }, 'Year-1 savings'));
  savings.appendChild(el('span', { class: 'sizing-price__savings-val' },
    fmtINR(r.savings_yr1.annual), el('span', { class: 'sizing-price__savings-unit' }, '/yr')));
  savings.appendChild(el('span', { class: 'sizing-price__savings-pct' },
    `covers ${(r.savings_yr1.pct_of_bill * 100).toFixed(0)}% of your annual bill`));
  host.appendChild(savings);

  const payback = r.metrics.payback_simple;
  if (payback != null && isFinite(payback)) {
    const pb = el('p', { class: 'sizing-price__payback' });
    pb.appendChild(document.createTextNode('Paid back in '));
    pb.appendChild(el('strong', {}, payback.toFixed(1) + ' years'));
    pb.appendChild(document.createTextNode(' from ' + fmtINR(monthlySaved) + '/mo savings.'));
    host.appendChild(pb);
  }

  // Footnote — explain what's NOT in the subsidy line for off-grid
  if (state.system_type === 'OffGrid') {
    host.appendChild(el('p', { class: 'sizing-price__footnote' },
      'Off-grid systems are excluded from PM Surya Ghar — no central subsidy applies.'));
  }
}

/* ──────────────────────────────────────────────────────────
   Public API
   ────────────────────────────────────────────────────────── */
function computePerSystem(state) {
  const out = {};
  PANES.forEach(({ id }) => {
    out[id] = computeFull({ ...state, system_type: id });
  });
  return out;
}

export function mountSystemDiagrams(container, state, initialSystem = 'OnGrid') {
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
  container.classList.add('sys-diagram');

  container.appendChild(el('span', { class: 'sys-diagram__rune' }, 'Fig. 0 · How each system handles your bill'));

  const results = computePerSystem(state);

  PANES.forEach((p) => {
    const pane = el('div', {
      class: 'sys-diagram__pane' + (p.id === initialSystem ? ' is-active' : ''),
      'data-pane': p.id,
      role: 'img',
      'aria-label': p.label,
    });

    const schematicWrap = el('div', { class: 'sys-diagram__schematic' });
    schematicWrap.appendChild(parseSvg(p.svg));
    schematicWrap.appendChild(el('p', { class: 'sys-diagram__gist' }, p.gist));
    pane.appendChild(schematicWrap);

    pane.appendChild(buildBillPane(p.id, state, results[p.id]));
    container.appendChild(pane);
  });
}

export function updateBillExamples(state) {
  const results = computePerSystem(state);
  document.querySelectorAll('.sys-diagram__pane').forEach((pane) => {
    const old = pane.querySelector('.sys-bill');
    if (!old) return;
    const fresh = buildBillPane(pane.dataset.pane, state, results[pane.dataset.pane]);
    pane.replaceChild(fresh, old);
  });
}

export function setActiveDiagram(systemType) {
  document.querySelectorAll('.sys-diagram__pane').forEach((p) => {
    p.classList.toggle('is-active', p.dataset.pane === systemType);
  });
}
