// The Solar Ledger — UI controller
// Reads inputs → calls engine.computeFull → renders.
// All DOM construction uses textContent + createElement for safety.

import { computeFull, defaultInput, formatINR, formatLakh, recommendSystemType, systemTypeAdvisory, pickOptimalSize, centralSubsidy } from './engine.js?v=7';
import {
  DISCOMS, STATE_DEFAULTS, LIFESTYLE_STAMPS, scaleStampToTariff, OUTAGE_STOPS, MONTH_LABELS,
  getTariffSchedule,
} from './constants.js?v=7';
import { mountSystemDiagrams, updateBillExamples, setActiveDiagram } from './diagrams.js?v=7';

/* ──────────────────────────────────────────────────────────
   STATE
   ────────────────────────────────────────────────────────── */
const state = defaultInput();
let billMode = 'easy';
let activeStampId = null;   // tracks which lifestyle stamp is currently selected (null if user typed a custom bill)
// True once the user has manually picked a kW (slider, numeric input, or size-card).
// While false, the slider auto-tracks the engine's recommendation as bills/state/grid
// inputs change. Once true, the slider stays put — the user owns the value.
let kwOverridden = false;

/* ──────────────────────────────────────────────────────────
   DOM HELPERS — safe element construction
   ────────────────────────────────────────────────────────── */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v === false || v === null || v === undefined) {} // skip
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined && v !== false) node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function setText(id, v) {
  const node = document.getElementById(id);
  if (!node) return;
  if (node.textContent !== String(v)) {
    node.textContent = v;
    if (node.classList.contains('amber')) {
      node.style.animation = 'none';
      void node.offsetWidth;
      node.style.animation = '';
    }
  }
}

/* ──────────────────────────────────────────────────────────
   POPULATE STATIC OPTIONS
   ────────────────────────────────────────────────────────── */
// Render the lifestyle tiles with bill values scaled to the current state's tariff
function populateLifestyle() {
  const grid = document.getElementById('lifestyleGrid');
  clear(grid);
  const tariff = currentTariff();

  LIFESTYLE_STAMPS.forEach((s) => {
    const scaled = scaleStampToTariff(s, tariff);
    const tile = el('button', {
      class: 'lifestyle-tile',
      dataset: { stamp: s.id },
      type: 'button',
    },
      el('strong', {}, s.label),
      el('span', {}, `₹${scaled.peak.toLocaleString('en-IN')} peak · ₹${scaled.low.toLocaleString('en-IN')} low`),
    );
    if (s.id === activeStampId) tile.classList.add('is-active');

    tile.addEventListener('click', () => {
      grid.querySelectorAll('.lifestyle-tile').forEach((t) => t.classList.remove('is-active'));
      tile.classList.add('is-active');
      activeStampId = s.id;
      applyStampToState(s);
      rerender();
    });
    grid.appendChild(tile);
  });
}

function currentTariff() {
  const d = DISCOMS.find((x) => x.key === state.state_key);
  return d ? d.tariff : 7.0;
}

// Apply a stamp's scaled bills to state + sync the precise-mode sliders
function applyStampToState(stamp) {
  const scaled = scaleStampToTariff(stamp, currentTariff());
  state.bill_peak_summer = scaled.peak;
  state.bill_low_winter  = scaled.low;
  document.getElementById('billPeak').value = scaled.peak;
  document.getElementById('billLow').value  = scaled.low;
  document.getElementById('billPeakLabel').textContent = '₹' + scaled.peak.toLocaleString('en-IN');
  document.getElementById('billLowLabel').textContent  = '₹' + scaled.low.toLocaleString('en-IN');
}

function populateStateSelect() {
  const sel = document.getElementById('stateSelect');
  clear(sel);

  // One option per state, sorted alphabetically with "Other" pinned to the end
  const stateNames = Object.keys(STATE_DEFAULTS).filter((s) => s !== 'Other').sort();
  stateNames.forEach((stateName) => {
    sel.appendChild(el('option', { value: STATE_DEFAULTS[stateName] }, stateName));
  });
  sel.appendChild(el('option', { value: STATE_DEFAULTS['Other'] }, 'Other / not listed'));

  sel.value = state.state_key;
  updateDiscomMeta();
}

function updateDiscomMeta() {
  const d = DISCOMS.find((x) => x.key === state.state_key);
  if (!d) return;
  const zoneLabel = d.zone === 'VeryHigh' ? 'Very high' : d.zone.toLowerCase();
  // Surface tariff data quality so users know when to verify against their bill.
  // Most schedules are sourced from public DISCOM tariff orders; some are
  // estimated where the order PDF couldn't be parsed cleanly. Hiding that
  // distinction would over-promise precision on a financial planning tool.
  const sched = getTariffSchedule(d.key, 'residential_lt');
  const src = sched._source || 'fallback';
  const sourceLabel = src === 'verified'
    ? 'Tariff verified from DISCOM order.'
    : src === 'estimated'
      ? 'Tariff estimated — verify against your bill.'
      : 'Tariff is a generic fallback — switch to a specific state for accuracy.';
  document.getElementById('discomMeta').textContent =
    `Tariff ₹${d.tariff.toFixed(2)}/unit · ${zoneLabel} sun zone · ${d.settlement.toLowerCase()} settlement. ${sourceLabel}`;
}

function populateGridStops() {
  const stops = document.getElementById('gridStops');
  clear(stops);
  OUTAGE_STOPS.forEach((s) => {
    stops.appendChild(el('span', { title: s.scenario }, s.label));
  });
}

function updateGridLabel(idx) {
  const stop = OUTAGE_STOPS[idx];
  document.getElementById('gridLabel').textContent = stop.label;
  document.getElementById('gridScenario').textContent = stop.scenario;
  state.outage_hours_per_day = stop.hours;
}

// Default sub-label text for each system type when it is NOT the recommended one
const SYS_DEFAULT_SUB = {
  OnGrid:  'financial-best',
  Hybrid:  'backup',
  OffGrid: 'enablement',
};

// Recompute the recommended type from current outage hours and update the
// system-type buttons + advisory note. Called whenever grid slider or system
// type changes.
function updateSystemTypeRecommendation() {
  const recommended = recommendSystemType(state.outage_hours_per_day);

  document.querySelectorAll('.sys-btn').forEach((btn) => {
    const type = btn.dataset.sys;
    const sub = btn.querySelector('.sys-btn__sub');
    if (!sub) return;
    if (type === recommended) {
      sub.textContent = 'recommended';
      btn.classList.add('is-recommended');
    } else {
      sub.textContent = SYS_DEFAULT_SUB[type] || '';
      btn.classList.remove('is-recommended');
    }
  });

  const advisoryEl = document.getElementById('sysAdvisory');
  if (advisoryEl) {
    const note = systemTypeAdvisory(state.system_type, recommended, state.outage_hours_per_day);
    if (note) {
      advisoryEl.textContent = note;
      advisoryEl.hidden = false;
    } else {
      advisoryEl.textContent = '';
      advisoryEl.hidden = true;
    }
  }
}

/* ──────────────────────────────────────────────────────────
   INPUT BINDINGS
   ────────────────────────────────────────────────────────── */
function bindInputs() {
  document.querySelectorAll('.mode-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      billMode = billMode === 'easy' ? 'precise' : 'easy';
      toggle.setAttribute('aria-checked', billMode === 'precise' ? 'true' : 'false');
      toggle.querySelectorAll('.mode-toggle__opt').forEach((opt) => {
        opt.classList.toggle('is-active', opt.dataset.opt === billMode);
      });
      document.querySelectorAll('[data-mode-pane]').forEach((p) => {
        p.classList.toggle('is-hidden', p.dataset.modePane !== billMode);
      });
    });
  });

  ['billPeak', 'billLow'].forEach((id) => {
    const node = document.getElementById(id);
    node.addEventListener('input', () => {
      const v = +node.value;
      if (id === 'billPeak') {
        state.bill_peak_summer = v;
        document.getElementById('billPeakLabel').textContent = '₹' + v.toLocaleString('en-IN');
      } else {
        state.bill_low_winter = v;
        document.getElementById('billLowLabel').textContent = '₹' + v.toLocaleString('en-IN');
      }
      document.querySelectorAll('.lifestyle-tile').forEach((t) => t.classList.remove('is-active'));
      rerender();
    });
  });

  document.getElementById('stateSelect').addEventListener('change', (e) => {
    state.state_key = e.target.value;
    updateDiscomMeta();
    // Re-apply active lifestyle stamp at the new state's tariff (bill scales),
    // and refresh the tile labels so they show the right ₹ for this state.
    if (activeStampId) {
      const stamp = LIFESTYLE_STAMPS.find((s) => s.id === activeStampId);
      if (stamp) applyStampToState(stamp);
    }
    populateLifestyle();
    rerender();
  });

  document.querySelectorAll('.roof-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.roof-btn').forEach((b) => {
        b.classList.remove('is-active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-checked', 'true');
      state.roof_type = btn.dataset.roof;
      rerender();
    });
  });

  const gridSlider = document.getElementById('gridSlider');
  gridSlider.addEventListener('input', () => {
    updateGridLabel(+gridSlider.value);
    updateSystemTypeRecommendation();
    rerender();
  });
  updateGridLabel(0);
  updateSystemTypeRecommendation();

  document.querySelectorAll('.sys-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sys-btn').forEach((b) => {
        b.classList.remove('is-active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-checked', 'true');
      state.system_type = btn.dataset.sys;
      document.getElementById('hybridGroup').hidden = state.system_type !== 'Hybrid';
      setActiveDiagram(state.system_type);
      updateSystemTypeRecommendation();
      rerender();
    });
  });

  document.getElementById('panelTech').addEventListener('change', (e) => { state.panel_tech = e.target.value; rerender(); });
  document.getElementById('shading').addEventListener('change', (e) => { state.shading = e.target.value; rerender(); });
  document.getElementById('systemKw').addEventListener('input', (e) => {
    const v = +e.target.value;
    if (v >= 1 && v <= 10) { state.system_kw = v; kwOverridden = true; syncKwControls(); rerender(); }
  });

  const kwSlider = document.getElementById('kwSlider');
  if (kwSlider) {
    kwSlider.value = state.system_kw;
    kwSlider.addEventListener('input', () => {
      const v = +kwSlider.value;
      if (v >= 1 && v <= 10) {
        state.system_kw = v;
        kwOverridden = true;
        syncKwControls();
        rerender();
      }
    });
  }
  document.getElementById('costPerKw').addEventListener('input', (e) => {
    const v = +e.target.value;
    if (v > 0) { state.cost_per_kw_gross = v; rerender(); }
  });
  document.getElementById('escalation').addEventListener('input', (e) => {
    state.tariff_escalation = (+e.target.value) / 100;
    rerender();
  });
  document.getElementById('altReturn').addEventListener('input', (e) => {
    state.alt_return_rate = (+e.target.value) / 100;
    rerender();
  });
  document.getElementById('horizon').addEventListener('change', (e) => {
    state.analysis_horizon_years = +e.target.value;
    rerender();
  });
  document.getElementById('netMetering').addEventListener('change', (e) => {
    state.net_metering_enabled = e.target.checked;
    rerender();
  });
  document.getElementById('criticalLoad')?.addEventListener('input', (e) => { state.critical_load_kw = +e.target.value; rerender(); });
  document.getElementById('outageTiming')?.addEventListener('change', (e) => { state.outage_timing = e.target.value; rerender(); });
  document.getElementById('batteryFactor')?.addEventListener('input', (e) => { state.battery_size_factor = +e.target.value; rerender(); });

  document.getElementById('exportCashflow')?.addEventListener('click', exportCashflowCsv);
}

function exportCashflowCsv() {
  const r = computeFull(state);
  const paybackY = r.metrics.payback_simple !== null ? Math.ceil(r.metrics.payback_simple) : -1;
  const replYears = new Set((r.battery_replacements || []).map((b) => b.year));

  // CSV-quote a value: wrap in quotes and escape internal quotes if needed
  const q = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [];
  lines.push(['Year', 'Generation (kWh)', 'Savings (INR)', 'Cumulative cash (INR)', 'Status'].map(q).join(','));
  // Year 0 — upfront outlay
  lines.push(['Y0', '', -r.costs.net, -r.costs.net, 'upfront'].map(q).join(','));
  // Subsequent years from the engine
  r.year_array.forEach((y) => {
    const status = y.year === paybackY ? 'breakeven' : replYears.has(y.year) ? 'battery replaced' : '';
    const gen = Math.round(r.generation.annual * y.degradation);
    lines.push([
      `Y${y.year}`,
      gen,
      Math.round(y.savings),
      Math.round(y.cumCashflow),
      status,
    ].map(q).join(','));
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `solar-ledger_cashflow_${state.system_kw}kW_${state.system_type}_${stamp}.csv`;
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ──────────────────────────────────────────────────────────
   RENDER PIPELINE
   ────────────────────────────────────────────────────────── */
function rerender() {
  let r = computeFull(state);

  // §3 spine — while the user hasn't manually picked a size, keep the slider
  // pinned to the engine's recommendation. The recommendation depends on
  // bill/state/roof/grid (NOT on system_kw), so this is a single re-compute,
  // not a loop. After the first user override, kwOverridden is true and this
  // block becomes a no-op.
  if (!kwOverridden && r.recommendation && r.recommendation.kw !== state.system_kw) {
    state.system_kw = r.recommendation.kw;
    r = computeFull(state);
  }

  renderRecommendation(r);
  renderVerdict(r);
  renderCardA(r);
  renderComparisonHeadline(r);
  renderCardB(r);
  renderRationale(r);
  renderModesDeltas(r);
  renderCumulativeChart(r);
  renderYearTable(r);
  updateBillExamples(state);
  // renderSizingPrice removed — §6 now uses the simpler cost-strip rendered
  // by renderFinance(r) below.
  renderFinance(r);
  renderSubsidyNote(state.system_kw);
  renderBillChange(r);
  renderPayback(r);
  renderBillingPattern(r);
  syncKwControls();
}

// §2 — Billing pattern. A title sentence summarising peak/low months and
// summer concentration, plus a 12-bar Jan–Dec ₹ chart so the user can see
// the seasonal shape of their bill before sizing.
function renderBillingPattern(r) {
  const monthly = r.bills && r.bills.monthly;
  if (!monthly || monthly.length !== 12) return;

  const peakIdx = monthly.reduce((best, v, i) => (v > monthly[best] ? i : best), 0);
  const lowIdx = monthly.reduce((best, v, i) => (v < monthly[best] ? i : best), 0);
  const peakVal = monthly[peakIdx];
  const lowVal = monthly[lowIdx];

  // Find the run of consecutive peak months (within 2% of peak). With the
  // BILL_SHAPE curve May & June both sit at factor 1.00, so the typical run
  // is two months — but we handle the general case.
  const peakMonthIdxs = monthly
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v >= peakVal * 0.98)
    .map((x) => x.i);
  const peakLabel = peakMonthIdxs.length > 1
    ? `${MONTH_LABELS[peakMonthIdxs[0]]}–${MONTH_LABELS[peakMonthIdxs[peakMonthIdxs.length - 1]]}`
    : MONTH_LABELS[peakMonthIdxs[0]];

  // "Summer concentration" — what share of the annual bill comes from the
  // top 3 months. A high value (50%+) means solar's seasonal alignment is
  // doing most of the work for this household.
  const sorted = [...monthly].sort((a, b) => b - a);
  const top3 = sorted.slice(0, 3).reduce((a, b) => a + b, 0);
  const annual = r.bills.annual || monthly.reduce((a, b) => a + b, 0);
  const top3Pct = annual > 0 ? Math.round((top3 / annual) * 100) : 0;

  // Rough "low season" label from where the low index falls.
  const lowMonth = lowIdx;
  const lowSeason = (lowMonth >= 6 && lowMonth <= 8) ? 'monsoon'
    : (lowMonth === 11 || lowMonth <= 1) ? 'winter'
      : MONTH_LABELS[lowMonth];

  const titleEl = document.getElementById('billPatternTitle');
  if (titleEl) {
    clear(titleEl);
    titleEl.appendChild(document.createTextNode('Your bill peaks at '));
    titleEl.appendChild(el('strong', { class: 'amber' }, formatINR(peakVal)));
    titleEl.appendChild(document.createTextNode(` in ${peakLabel} and dips to `));
    titleEl.appendChild(el('strong', {}, formatINR(lowVal)));
    titleEl.appendChild(document.createTextNode(` in ${lowSeason}. The top 3 months drive `));
    titleEl.appendChild(el('strong', {}, `${top3Pct}%`));
    titleEl.appendChild(document.createTextNode(' of your year.'));
  }

  // The math panel — explicit numbers next to the chart so the user can see
  // where the bill estimate is coming from, not just the visualization.
  setText('billAnnualTotal', formatINR(annual) + ' / yr');
  setText('billAnnualUnits', Math.round(r.consumption?.annual_kwh || 0).toLocaleString('en-IN'));
  if (r.rates?.marginal) {
    setText('billTopSlab', `₹${r.rates.marginal.toFixed(2)} / kWh`);
  }
  setText('billPeakMo', `${formatINR(peakVal)} (${MONTH_LABELS[peakIdx]})`);
  setText('billLowMo', `${formatINR(lowVal)} (${MONTH_LABELS[lowIdx]})`);

  renderBillPatternChart(monthly);
}

// §2 chart — 12 amber bars Jan→Dec with mono axis labels. Mirrors the
// renderMonthlyChart aesthetic (single bar per month rather than a paired
// bill-vs-savings group). Tooltips via SVG <title> children.
function renderBillPatternChart(monthly) {
  const host = document.getElementById('billPatternChart');
  if (!host) return;
  const W = host.clientWidth || 720;
  const H = host.clientHeight || 280;
  const pad = CHART_PAD;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const maxV = Math.max(...monthly, 100) * 1.1;
  const barW = innerW / 12;
  const subBarW = barW * 0.62;
  const yScale = (v) => innerH - (v / maxV) * innerH;

  const step = niceStep(maxV / 4);
  const ticks = [];
  for (let v = 0; v <= maxV; v += step) ticks.push(v);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });

  // Grid + Y labels
  ticks.forEach((t) => {
    svg.appendChild(svgEl('line', {
      x1: pad.l, y1: pad.t + yScale(t), x2: W - pad.r, y2: pad.t + yScale(t),
      stroke: 'var(--rule-soft)', 'stroke-width': '0.5', 'stroke-dasharray': '2 3',
    }));
    svg.appendChild(svgEl('text', {
      x: pad.l - 8, y: pad.t + yScale(t) + 3, 'text-anchor': 'end',
      'font-family': 'IBM Plex Mono', 'font-size': '9', fill: 'var(--ink-mute)',
    }, `₹${(t / 1000).toFixed(t >= 10000 ? 0 : 1)}k`));
  });

  // Bars + month labels
  for (let m = 0; m < 12; m++) {
    const x = pad.l + m * barW;
    const barH = (monthly[m] / maxV) * innerH;
    const rect = svgEl('rect', {
      x: x + (barW - subBarW) / 2,
      y: pad.t + innerH - barH,
      width: subBarW,
      height: barH,
      fill: 'var(--amber)',
    });
    rect.appendChild(svgEl('title', {}, `${MONTH_LABELS[m]}: ${formatINR(monthly[m])}`));
    svg.appendChild(rect);

    svg.appendChild(svgEl('text', {
      x: x + barW / 2, y: H - pad.b + 14, 'text-anchor': 'middle',
      'font-family': 'IBM Plex Mono', 'font-size': '9', fill: 'var(--ink-mute)',
      'letter-spacing': '0.05em',
    }, MONTH_LABELS[m].toUpperCase()));
  }

  // Baseline
  svg.appendChild(svgEl('line', {
    x1: pad.l, y1: pad.t + innerH, x2: W - pad.r, y2: pad.t + innerH,
    stroke: 'var(--ink)', 'stroke-width': '1.5',
  }));

  clear(host);
  host.appendChild(svg);
}

// §8 — populate payback section IDs. Breakeven year + horizon-after-breakeven
// + IRR badge + the in-caption breakeven year. Gracefully handles the
// negative-IRR case where payback_simple is null (e.g. some off-grid configs).
function renderPayback(r) {
  const pb = r.metrics.payback_simple;
  const horizon = r.year_array.length;
  const escPct = (state.tariff_escalation * 100).toFixed(0);

  const yearsEl = document.getElementById('paybackYears');
  const afterEl = document.getElementById('paybackAfter');
  const irrEl = document.getElementById('paybackIRR');
  const breakevenEl = document.getElementById('paybackBreakeven');

  if (pb == null || !isFinite(pb)) {
    if (yearsEl) yearsEl.textContent = 'never (at this size)';
    if (afterEl) afterEl.textContent = '0 years';
    if (breakevenEl) breakevenEl.textContent = '—';
  } else {
    if (yearsEl) yearsEl.textContent = pb.toFixed(1) + ' years';
    if (afterEl) afterEl.textContent = Math.max(0, horizon - Math.ceil(pb)) + ' years';
    if (breakevenEl) breakevenEl.textContent = pb.toFixed(1);
  }

  if (irrEl) {
    clear(irrEl);
    irrEl.appendChild(document.createTextNode(`${horizon}-year IRR: `));
    const irrStr = (r.metrics.irr != null && isFinite(r.metrics.irr))
      ? (r.metrics.irr * 100).toFixed(0) + '%'
      : '—';
    irrEl.appendChild(el('strong', {}, irrStr));
    irrEl.appendChild(document.createTextNode(` · Tariffs escalate ${escPct}%/yr, so later savings grow.`));
  }
}

// §7 — Bill-change section. Three blocks:
//   7a · the two rates side by side (save vs earn) + the spread
//   7b · monthly stacked bars (self / export / import) + bank-balance line
//   7c · reconciled summary (bill avoided + surplus payout)
// All inputs flow from r.rates (the spread), r.monthly_decomposition (the
// per-month flows + year-end sweep), and r.discom.settlement (annual vs monthly).
function renderBillChange(r) {
  const rates = r.rates;
  const decomposition = r.monthly_decomposition;
  if (!rates || !decomposition) return;

  // --- 7a · the spread block + section title amber span ---
  setText('billChangeTariff', '₹' + rates.marginal.toFixed(2));
  setText('spreadSaveRate', '₹' + rates.marginal.toFixed(2) + ' / kWh');
  setText('spreadEarnRate', '₹' + rates.appc.toFixed(2) + ' / kWh   (APPC)');
  setText('spreadGap', '₹' + rates.spread.toFixed(2) + ' / kWh');

  // --- 7b · charts ---
  renderBillChangeMonthly(decomposition);
  renderBillChangeBank(decomposition, r.discom.settlement, rates.appc);

  // Bank chart title + caption + kicker — all flip by settlement type so
  // monthly-settlement DISCOMs (MH, GJ, WB) don't display the wrong story.
  const bankTitle = document.getElementById('bankTitle');
  const bankCaption = document.getElementById('bankCaption');
  const bankKicker = document.getElementById('bankKicker');
  if (r.discom.settlement === 'Monthly') {
    if (bankKicker) bankKicker.textContent = 'Fig. B · monthly settlement';
    if (bankTitle)   bankTitle.textContent  = 'Monthly export credit — settled at APPC each month';
    if (bankCaption) bankCaption.textContent = 'Your DISCOM zeroes the bank every month. Whatever you exported that month is paid out at the APPC rate.';
  } else {
    if (bankKicker) bankKicker.textContent = 'Fig. B · annual bank';
    if (bankTitle)   bankTitle.textContent  = 'kWh credit bank — how the seasonal surplus settles';
    if (bankCaption) bankCaption.textContent = "Winter excess banks against summer draws. Whatever's left at year-end settles at APPC.";
  }

  // --- 7c · reconciled summary ---
  const annualBillAvoided = decomposition.monthly.reduce((s, m) => s + m.bill_avoided_inr, 0);
  const surplusInr = decomposition.year_end.surplus_inr;
  setText('billAvoidedYr', formatINR(annualBillAvoided));
  setText('billAvoidedMo', formatINR(annualBillAvoided / 12));
  setText('surplusYr', formatINR(surplusInr));
  setText('surplusMo', formatINR(surplusInr / 12));
  setText('totalValueYr', formatINR(annualBillAvoided + surplusInr) + ' / yr');

  const surplusLabel = document.getElementById('surplusLabel');
  if (surplusLabel) {
    surplusLabel.textContent = r.discom.settlement === 'Monthly'
      ? '(monthly APPC export credit)'
      : '(year-end APPC sweep)';
  }
}

// §7b · Monthly stacked-bar chart in kWh.
// Three stacks per month, bottom→top:
//   1. self_consumed + bank_drawn  (high-value, retail rate)  — amber
//   2. exported_kwh                (low-value, APPC)          — soft amber
//   3. grid_import_kwh             (still paid for)           — muted ink
// Y-axis kWh, mono labels. Matches the visual aesthetic of renderMonthlyChart.
function renderBillChangeMonthly(decomposition) {
  const host = document.getElementById('billChangeMonthly');
  if (!host) return;
  const W = host.clientWidth || 560;
  const H = host.clientHeight || 350;
  const pad = CHART_PAD;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const monthly = decomposition.monthly;
  // Per-month totals across all three segments — that's the bar height
  const totals = monthly.map((m) => (m.self_consumed_kwh + m.bank_drawn_kwh) + m.exported_kwh + m.grid_import_kwh);
  const maxV = Math.max(...totals, 10) * 1.1;

  const barW = innerW / 12;
  const barPad = barW * 0.18;
  const subBarW = barW - barPad;
  const yScale = (v) => innerH - (v / maxV) * innerH;

  const step = niceStep(maxV / 4);
  const ticks = [];
  for (let v = 0; v <= maxV; v += step) ticks.push(v);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });

  // Grid + Y labels (kWh)
  ticks.forEach((t) => {
    svg.appendChild(svgEl('line', {
      x1: pad.l, y1: pad.t + yScale(t), x2: W - pad.r, y2: pad.t + yScale(t),
      stroke: 'var(--rule-soft)', 'stroke-width': '0.5', 'stroke-dasharray': '2 3',
    }));
    svg.appendChild(svgEl('text', {
      x: pad.l - 8, y: pad.t + yScale(t) + 3, 'text-anchor': 'end',
      'font-family': 'IBM Plex Mono', 'font-size': '9', fill: 'var(--ink-mute)',
    }, t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${Math.round(t)}`));
  });

  // Bars + month labels
  for (let m = 0; m < 12; m++) {
    const x = pad.l + m * barW + barPad / 2;
    const row = monthly[m];

    const selfH = ((row.self_consumed_kwh + row.bank_drawn_kwh) / maxV) * innerH;
    const exportH = (row.exported_kwh / maxV) * innerH;
    const importH = (row.grid_import_kwh / maxV) * innerH;

    let yCursor = pad.t + innerH;
    // Bottom: self-consumed (amber)
    if (selfH > 0) {
      yCursor -= selfH;
      svg.appendChild(svgEl('rect', {
        x, y: yCursor, width: subBarW, height: selfH, fill: 'var(--amber)',
      }));
    }
    // Middle: exported (amber-wash, lower-value)
    if (exportH > 0) {
      yCursor -= exportH;
      svg.appendChild(svgEl('rect', {
        x, y: yCursor, width: subBarW, height: exportH, fill: 'var(--amber-wash)',
      }));
    }
    // Top: imported (muted ink — the part you still paid for)
    if (importH > 0) {
      yCursor -= importH;
      svg.appendChild(svgEl('rect', {
        x, y: yCursor, width: subBarW, height: importH,
        fill: 'var(--rule-soft)',
      }));
    }

    svg.appendChild(svgEl('text', {
      x: x + subBarW / 2, y: H - pad.b + 14, 'text-anchor': 'middle',
      'font-family': 'IBM Plex Mono', 'font-size': '9', fill: 'var(--ink-mute)',
      'letter-spacing': '0.05em',
    }, MONTH_LABELS[m].toUpperCase()));
  }

  // Baseline
  svg.appendChild(svgEl('line', {
    x1: pad.l, y1: pad.t + innerH, x2: W - pad.r, y2: pad.t + innerH,
    stroke: 'var(--ink)', 'stroke-width': '1.5',
  }));

  // Y-axis label (kWh)
  svg.appendChild(svgEl('text', {
    x: pad.l - 8, y: pad.t - 6, 'text-anchor': 'end',
    'font-family': 'IBM Plex Mono', 'font-size': '8', fill: 'var(--ink-mute)',
    'letter-spacing': '0.06em',
  }, 'kWh'));

  clear(host);
  host.appendChild(svg);
}

// §7b · Bank/settlement chart.
// Annual settlement: filled area under bank_balance_eom curve, with a year-end
// sweep callout at Dec showing the kWh × APPC payout.
// Monthly settlement: per-month ₹ bars showing each month's APPC export credit
// (since the bank is always 0, the visual story is the cash drip-feed instead).
function renderBillChangeBank(decomposition, settlement, appcRate) {
  const host = document.getElementById('billChangeBank');
  if (!host) return;

  if (settlement === 'Monthly') {
    renderMonthlySurplusChart(host, decomposition, appcRate);
    return;
  }

  const W = host.clientWidth || 560;
  const H = host.clientHeight || 350;
  const pad = CHART_PAD;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const monthly = decomposition.monthly;
  const balances = monthly.map((m) => m.bank_balance_eom_kwh);
  const maxV = Math.max(...balances, 10) * 1.15;

  const xScale = (i) => pad.l + (i / 11) * innerW;
  const yScale = (v) => pad.t + innerH - (v / maxV) * innerH;

  const step = niceStep(maxV / 4);
  const ticks = [];
  for (let v = 0; v <= maxV; v += step) ticks.push(v);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });

  // Grid + Y labels (kWh)
  ticks.forEach((t) => {
    svg.appendChild(svgEl('line', {
      x1: pad.l, y1: yScale(t), x2: W - pad.r, y2: yScale(t),
      stroke: 'var(--rule-soft)', 'stroke-width': '0.5', 'stroke-dasharray': '2 3',
    }));
    svg.appendChild(svgEl('text', {
      x: pad.l - 8, y: yScale(t) + 3, 'text-anchor': 'end',
      'font-family': 'IBM Plex Mono', 'font-size': '9', fill: 'var(--ink-mute)',
    }, t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${Math.round(t)}`));
  });

  // Filled area path: line + close to baseline
  const linePath = balances.map((v, i) =>
    `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`,
  ).join(' ');
  const baselineY = yScale(0);
  const areaPath = linePath +
    ` L ${xScale(11).toFixed(1)} ${baselineY.toFixed(1)}` +
    ` L ${xScale(0).toFixed(1)} ${baselineY.toFixed(1)} Z`;

  svg.appendChild(svgEl('path', {
    d: areaPath, fill: 'var(--amber-wash)', opacity: '0.7',
  }));
  svg.appendChild(svgEl('path', {
    d: linePath, fill: 'none', stroke: 'var(--amber)', 'stroke-width': '2',
  }));

  // Baseline (zero)
  svg.appendChild(svgEl('line', {
    x1: pad.l, y1: baselineY, x2: W - pad.r, y2: baselineY,
    stroke: 'var(--ink)', 'stroke-width': '1.2',
  }));

  // Month labels
  for (let m = 0; m < 12; m++) {
    svg.appendChild(svgEl('text', {
      x: xScale(m), y: H - pad.b + 14, 'text-anchor': 'middle',
      'font-family': 'IBM Plex Mono', 'font-size': '9', fill: 'var(--ink-mute)',
      'letter-spacing': '0.05em',
    }, MONTH_LABELS[m].toUpperCase()));
  }

  // Y-axis label (kWh)
  svg.appendChild(svgEl('text', {
    x: pad.l - 8, y: pad.t - 6, 'text-anchor': 'end',
    'font-family': 'IBM Plex Mono', 'font-size': '8', fill: 'var(--ink-mute)',
    'letter-spacing': '0.06em',
  }, 'kWh'));

  // Year-end sweep callout at Dec
  const surplusKwh = decomposition.year_end.surplus_kwh;
  const surplusInr = decomposition.year_end.surplus_inr;
  if (surplusKwh > 0.5) {
    const decX = xScale(11);
    const decY = yScale(balances[11]);
    svg.appendChild(svgEl('circle', {
      cx: decX, cy: decY, r: '3.5', fill: 'var(--amber-deep)',
    }));
    const labelText = `${Math.round(surplusKwh)} kWh × ₹${appcRate.toFixed(2)} = ₹${Math.round(surplusInr).toLocaleString('en-IN')}`;
    // Anchor end so the callout doesn't overflow on the right
    svg.appendChild(svgEl('text', {
      x: decX - 6, y: decY - 8, 'text-anchor': 'end',
      'font-family': 'Fraunces', 'font-style': 'italic',
      'font-size': '11', fill: 'var(--amber-deep)',
    }, labelText));
  }

  clear(host);
  host.appendChild(svg);
}

// Monthly-settlement variant: 12 ₹ bars showing each month's APPC export credit.
// Uses monthly_surplus_inr from the engine (already computed in deriveMonthlyDecomposition)
// or falls back to exported_kwh × appcRate. The total at the bottom matches the
// §7c surplus row, anchoring the cash story.
function renderMonthlySurplusChart(host, decomposition, appcRate) {
  const W = host.clientWidth || 560;
  const H = host.clientHeight || 350;
  const pad = CHART_PAD;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const monthly = decomposition.monthly;
  const surplusInr = monthly.map((m) =>
    m.monthly_surplus_inr != null ? m.monthly_surplus_inr : (m.exported_kwh || 0) * appcRate,
  );
  const maxV = Math.max(...surplusInr, 1) * 1.15;

  const barW = innerW / 12;
  const barPad = barW * 0.22;
  const subBarW = barW - barPad;
  const yScale = (v) => pad.t + innerH - (v / maxV) * innerH;

  const step = niceStep(maxV / 4);
  const ticks = [];
  for (let v = 0; v <= maxV; v += step) ticks.push(v);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });

  // Grid + Y labels (₹)
  ticks.forEach((t) => {
    svg.appendChild(svgEl('line', {
      x1: pad.l, y1: yScale(t), x2: W - pad.r, y2: yScale(t),
      stroke: 'var(--rule-soft)', 'stroke-width': '0.5', 'stroke-dasharray': '2 3',
    }));
    svg.appendChild(svgEl('text', {
      x: pad.l - 8, y: yScale(t) + 3, 'text-anchor': 'end',
      'font-family': 'IBM Plex Mono', 'font-size': '9', fill: 'var(--ink-mute)',
    }, t >= 1000 ? `₹${(t / 1000).toFixed(1)}k` : `₹${Math.round(t)}`));
  });

  // Baseline
  svg.appendChild(svgEl('line', {
    x1: pad.l, y1: yScale(0), x2: W - pad.r, y2: yScale(0),
    stroke: 'var(--ink)', 'stroke-width': '1.2',
  }));

  // Bars (one per month)
  surplusInr.forEach((v, i) => {
    const x = pad.l + i * barW + barPad / 2;
    const y = yScale(v);
    svg.appendChild(svgEl('rect', {
      x: x.toFixed(1), y: y.toFixed(1),
      width: subBarW.toFixed(1), height: (yScale(0) - y).toFixed(1),
      fill: 'var(--amber-wash)', stroke: 'var(--amber)', 'stroke-width': '1',
    }));
  });

  // Month labels
  for (let m = 0; m < 12; m++) {
    svg.appendChild(svgEl('text', {
      x: pad.l + m * barW + barW / 2, y: H - pad.b + 14, 'text-anchor': 'middle',
      'font-family': 'IBM Plex Mono', 'font-size': '9', fill: 'var(--ink-mute)',
      'letter-spacing': '0.05em',
    }, MONTH_LABELS[m].toUpperCase()));
  }

  // Y-axis label
  svg.appendChild(svgEl('text', {
    x: pad.l - 8, y: pad.t - 6, 'text-anchor': 'end',
    'font-family': 'IBM Plex Mono', 'font-size': '8', fill: 'var(--ink-mute)',
    'letter-spacing': '0.06em',
  }, '₹ / mo'));

  // Total annotation in upper-right
  const total = surplusInr.reduce((s, v) => s + v, 0);
  if (total > 0) {
    svg.appendChild(svgEl('text', {
      x: W - pad.r, y: pad.t + 4, 'text-anchor': 'end',
      'font-family': 'Fraunces', 'font-style': 'italic',
      'font-size': '11', fill: 'var(--amber-deep)',
    }, `Year total: ₹${Math.round(total).toLocaleString('en-IN')}`));
  }

  clear(host);
  host.appendChild(svg);
}

// §6 — Finance title sentence. Mirrors the spread story but at the cash level:
// what you write the cheque for, what the subsidy covers, what you save year 1.
// Built via DOM nodes (not innerHTML) so amber spans are first-class elements
// the tick animation can reset.
function renderFinance(r) {
  // §6 cost-strip: just the 3 upfront-cost cells. Year-1 savings is told
  // by §3 (cuts X% of bill) and §7 (Year-1 value), so it doesn't repeat
  // here — §6 stays focused on the cheque you write.
  const strip = document.getElementById('costStrip');
  if (!strip) return;
  const c = r.costs;
  const cells = [
    { label: 'Gross system cost', value: formatINR(c.gross), tone: 'plain' },
    { label: 'Subsidy (PM Surya Ghar)', value: '−' + formatINR(c.total_subsidy), tone: 'minus' },
    { label: 'You pay (one-time)', value: formatINR(c.net), tone: 'total' },
  ];
  clear(strip);
  cells.forEach((cell) => {
    strip.appendChild(el('div', { class: `cost-cell cost-cell--${cell.tone}` },
      el('dt', {}, cell.label),
      el('dd', {}, cell.value),
    ));
  });

  // Footnote — only visible when subsidy slab cap kicks in (>3 kW)
  const note = document.getElementById('costStripNote');
  if (note) {
    note.textContent = state.system_kw > 3
      ? `PM Surya Ghar caps at 3 kW; the extra ${(state.system_kw - 3).toFixed(1)} kW is at full cost.`
      : '';
  }
}

// §6 — Subsidy slab is now expressed inline as one microcopy line beneath
// the price box (the SVG kink chart was retired to reclaim layout density).
// This function flips the caption based on whether the user is above the
// 3 kW central-subsidy cap.
function renderSubsidyNote(systemKw) {
  const caption = document.getElementById('subsidyKinkCaption');
  if (!caption) return;
  caption.textContent = systemKw > 3
    ? `Central subsidy capped at ₹${(centralSubsidy(3) / 1000).toFixed(0)}k for the first 3 kW under PM Surya Ghar — your extra ${(systemKw - 3).toFixed(1)} kW is at full cost.`
    : `Central subsidy of ₹${(centralSubsidy(systemKw) / 1000).toFixed(0)}k applied at this size under PM Surya Ghar (slab caps at 3 kW).`;
}

// §5 — render the per-mode delta-from-recommended badges and the picked-type
// word in the section head. The recommendation drives the headline; the
// non-recommended buttons get a "−₹X.YL vs reco" sub label sourced from
// engine.system_options[].delta_to_recommended (negative = worse over 25y).
function renderModesDeltas(r) {
  const reco = r.recommendation;
  if (reco) {
    setText('modesPickedType', SYS_TYPE_LABEL[reco.system_type] || String(reco.system_type).toLowerCase());
  }
  if (!Array.isArray(r.system_options)) return;
  for (const opt of r.system_options) {
    const btn = document.querySelector(`.sys-btn[data-sys="${opt.type}"]`);
    if (!btn) continue;
    const sub = btn.querySelector('.sys-btn__sub');
    if (!sub) continue;
    if (opt.recommended) {
      sub.textContent = 'recommended';
      btn.classList.add('is-recommended');
      continue;
    }
    btn.classList.remove('is-recommended');
    const delta = opt.delta_to_recommended;
    // Suppress the badge if the delta is small enough to be noise (< ₹50k over 25y)
    if (!isFinite(delta) || Math.abs(delta) < 50000) {
      sub.textContent = SYS_DEFAULT_SUB[opt.type] || '';
      continue;
    }
    const sign = delta >= 0 ? '+' : '−';
    sub.textContent = `${sign}${formatLakh(Math.abs(delta))} vs reco`;
  }
}

// §3 — populate the recommendation sentence above the slider. Mirrors the
// engine's recommendation.kw / system_type / reason_kw verbatim so all four
// signals (sentence, slider thumb, RECOMMENDED tick, size-card badge) agree.
const SYS_TYPE_LABEL = { OnGrid: 'on-grid', Hybrid: 'hybrid', OffGrid: 'off-grid' };
function renderRecommendation(r) {
  const reco = r.recommendation;
  if (!reco) return;

  setText('recoKw', reco.kw + ' kW');
  setText('recoType', SYS_TYPE_LABEL[reco.system_type] || String(reco.system_type).toLowerCase());

  // One-liner describes the *recommendation*, not the user's pick — so the
  // numbers come from reco.payback_at_reco / reco.pct_at_reco, computed in
  // deriveRecommendation against the recommended kW. Cap pct at 100; the
  // over-100% surplus story belongs in §7.
  const payback = reco.payback_at_reco;
  const paybackStr = payback != null && isFinite(payback) ? payback.toFixed(1) : '—';
  const pct = Math.max(0, Math.min(100, (reco.pct_at_reco ?? 0) * 100));
  setText('recoOneLiner', `pays back in ${paybackStr} years and cuts ${pct.toFixed(0)}% of your bill.`);

  // When the picked size diverges from the recommendation, prefix the reason
  // so it reads as an explanation of the recommendation, not a defense of the
  // current pick. Without the prefix it can look like the rationale is stale.
  const reasonText = state.system_kw !== reco.kw
    ? `Why we picked that: ${reco.reason_kw}`
    : reco.reason_kw;
  setText('recoReason', reasonText);
}

function syncKwControls() {
  const fmtKw = (n) => (Math.round(n * 10) / 10).toString().replace(/\.0$/, '');
  const kwStr = fmtKw(state.system_kw);

  const slider = document.getElementById('kwSlider');
  const readout = document.getElementById('kwSliderReadout');
  const recoEl = document.getElementById('kwRecommended');
  const numericInput = document.getElementById('systemKw');
  if (slider && +slider.value !== state.system_kw) slider.value = state.system_kw;
  if (readout) readout.textContent = kwStr + ' kW';
  if (numericInput && +numericInput.value !== state.system_kw) numericInput.value = state.system_kw;

  // Recommendation: kW + position the tick on the track
  const reco = pickOptimalSize(state);
  const recoStr = fmtKw(reco);
  if (recoEl) recoEl.textContent = recoStr + ' kW';
  const tick = document.getElementById('kwSliderReco');
  if (tick) {
    const min = +slider?.min || 1;
    const max = +slider?.max || 10;
    const pct = Math.max(0, Math.min(100, ((reco - min) / (max - min)) * 100));
    tick.style.left = pct + '%';
    tick.title = `Recommended: ${recoStr} kW`;
    // Keep the tick centered on the position (wrapper transform stays in CSS),
    // but nudge the label horizontally so it doesn't clip the track edges
    // when reco sits at min or max.
    const label = tick.querySelector('.kw-slider__reco-label');
    if (label) {
      let labelShift = '0';
      if (pct < 8) labelShift = `${(8 - pct) * 0.6}rem`;
      else if (pct > 92) labelShift = `${-(pct - 92) * 0.6}rem`;
      label.style.transform = `translateX(${labelShift})`;
    }
  }

  // Live readout line under the slider — uses the engine for THIS pick
  const r = computeFull(state);
  const livePick    = document.getElementById('kwLivePick');
  const livePayback = document.getElementById('kwLivePayback');
  // NOTE: #kwLiveSave is intentionally no longer populated. The ₹/mo savings
  // figure conflated bill-avoided with surplus credit; the spread is told
  // properly in §7. Element/ID kept in DOM-free state for future devs.
  if (livePick)    livePick.textContent = kwStr + ' kW';
  if (livePayback) livePayback.textContent =
    r.metrics.payback_simple != null && isFinite(r.metrics.payback_simple)
      ? r.metrics.payback_simple.toFixed(1) + ' years'
      : '—';
  const liveCut = document.getElementById('kwLiveCut');
  // pct_of_bill is now naturally capped at 100% (engine uses bill_offset).
  // For oversized configs, append the surplus credit so the user sees that
  // bigger ≠ free upside — capacity above 100% is monetized at the low APPC
  // rate, not the retail rate. Without this, 4 kW and 10 kW both read as
  // "cuts 100%" with no signal that 10 kW is leaking the spread.
  if (liveCut) {
    const pct = (r.savings_yr1.pct_of_bill * 100).toFixed(0);
    const surplus = r.savings_yr1.surplus_credit;
    liveCut.textContent = surplus > 100
      ? `${pct}% (+ ${formatINR(surplus)}/yr surplus at APPC)`
      : `${pct}%`;
  }
}

// The legacy headline sentence (#hKw / #hPayback / #hGain / #hHorizon /
// #hSubsidy) and Fig. 1 monthly chart were removed — §3's recommendation
// sentence is now the page's top-level answer, and §7 owns the bill-change
// monthly story. This function survives only to populate §9's verdict pill,
// which still uses the legacy `headline__verdict` class as its hook.
function renderVerdict(r) {
  const v = r.verdict;
  const wrap = document.getElementById('headlineVerdict');
  if (!wrap) return;
  wrap.className = 'headline__verdict tone-' + v.tone;
  clear(wrap);
  wrap.appendChild(el('span', { class: 'verdict__pill' }, v.headline));
  wrap.appendChild(el('p', { class: 'verdict__body' }, v.body));
}

function renderCardA(r) {
  const initialOutlay = r.costs.net;
  setText('cmpOutlay', formatINR(initialOutlay));

  // Step 1 — rupees over 25 years.
  // bills_total = cumulative escalated bills if you do nothing.
  // total_savings = cumulative escalated savings solar produces (revenue).
  const billsTotal = r.metrics.bills_total;
  const solarRevenue = r.metrics.total_savings;
  setText('cmpBillsTotal', formatLakh(billsTotal));
  setText('cmpSolarRevenue', formatLakh(solarRevenue));

  const noteEl = document.getElementById('cmpRupeesNote');
  if (noteEl) {
    if (solarRevenue >= billsTotal) {
      noteEl.textContent = `Solar produces ${formatLakh(solarRevenue - billsTotal)} more rupees of value than your 25-year bill — you come out ahead even after paying ${formatLakh(initialOutlay)} for the system.`;
    } else {
      noteEl.textContent = `Solar produces ${formatLakh(billsTotal - solarRevenue)} less than your 25-yr bill — sized too small for this consumption. Try a larger kW.`;
    }
  }

  // Step 2 — annualised IRR comparison vs FD and equity (post-tax effective).
  // Effective post-tax rate of a lump sum compounded for H years and taxed on
  // gains: solve r_eff such that (1+r_eff)^H = 1 + (1+r_pre)^H × (1−tax) − tax_floor.
  // Simpler approximation for display: post_eff = ((corpus_post / outlay)^(1/H) − 1).
  const H = state.analysis_horizon_years || 25;
  const fdEff = effectiveAnnualRate(0.07, 0.20, H);    // 7% FD post-30% slab... actually using slab_tax_rate=0.20
  const eqEff = effectiveAnnualRate(0.12, 0.125, H);   // 12% equity post-LTCG 12.5%

  const solarIrr = r.metrics.irr;
  setText('irrSolarRate', solarIrr != null ? (solarIrr * 100).toFixed(0) + '%' : '—');
  setText('irrEquityRate', (eqEff * 100).toFixed(1) + '%');
  setText('irrFdRate', (fdEff * 100).toFixed(1) + '%');

  // Bar widths — proportional to the highest IRR (always solar in healthy
  // recos). Capped at 100% width.
  const maxRate = Math.max(solarIrr || 0, eqEff, fdEff, 0.01);
  const bars = {
    irrRowSolar: solarIrr || 0,
    irrRowEquity: eqEff,
    irrRowFd: fdEff,
  };
  Object.entries(bars).forEach(([rowId, rate]) => {
    const row = document.getElementById(rowId);
    if (!row) return;
    const fill = row.querySelector('.irr-bar__fill');
    if (!fill) return;
    const pct = (Math.max(0, rate) / maxRate) * 100;
    fill.style.setProperty('--bar-pct', pct.toFixed(1) + '%');
  });
}

// Helper — effective post-tax annualised rate after compounding for H years
// and paying tax on gains at the end (one-shot tax model).
function effectiveAnnualRate(preTaxRate, taxOnGain, years) {
  const corpusPre = Math.pow(1 + preTaxRate, years);
  const gain = corpusPre - 1;
  const corpusPost = 1 + gain * (1 - taxOnGain);
  return Math.pow(corpusPost, 1 / years) - 1;
}

// §9 — Comparison section's headline sentence.
// Builds a one-line verdict comparing solar's gain to the better of the two
// alt-investment paths (FD or passive equity), inverting the verb when solar
// trails. The detail panel below (rupees + IRR comparison) is populated by
// renderCardA — this function only owns the head copy above the panel.
function renderComparisonHeadline(r) {
  const fd     = r.metrics.fd_gain;
  const equity = r.metrics.nifty_gain;
  const solar  = r.metrics.net_gain;

  // Pick the leading alternative — the one that gets compared against solar.
  const altLeader = equity > fd
    ? { value: equity, label: 'passive equity' }
    : { value: fd,     label: 'fixed deposits' };

  const solarWins = solar >= altLeader.value;
  const gap = Math.abs(solar - altLeader.value);

  const titleEl = document.querySelector('.comparison__title');
  if (titleEl) {
    clear(titleEl);
    if (solarWins) {
      // Solar's <X> beats <leader> by <Y> over 25 years. Even after taxes.
      titleEl.appendChild(document.createTextNode("Solar's "));
      titleEl.appendChild(el('strong', { class: 'amber', id: 'cmpSolarLakh' }, formatLakh(solar)));
      titleEl.appendChild(document.createTextNode(' beats '));
      titleEl.appendChild(el('span', { id: 'cmpRunnerUp' }, altLeader.label));
      titleEl.appendChild(document.createTextNode(' by '));
      titleEl.appendChild(el('strong', { id: 'cmpGap' }, formatLakh(gap)));
      titleEl.appendChild(document.createTextNode(' over 25 years. Even after taxes.'));
    } else {
      // Solar's <X> trails <leader> by <Y> over 25 years.
      titleEl.appendChild(document.createTextNode("Solar's "));
      titleEl.appendChild(el('strong', { class: 'amber', id: 'cmpSolarLakh' }, formatLakh(solar)));
      titleEl.appendChild(document.createTextNode(' trails '));
      titleEl.appendChild(el('span', { id: 'cmpRunnerUp' }, altLeader.label));
      titleEl.appendChild(document.createTextNode(' by '));
      titleEl.appendChild(el('strong', { id: 'cmpGap' }, formatLakh(gap)));
      titleEl.appendChild(document.createTextNode(' over 25 years.'));
    }
  }

  setText('cmpOutlay', formatINR(r.costs.net));
}

function renderCardB(r) {
  const host = document.getElementById('sizeCards');
  clear(host);

  // Dedupe by kw — when the IRR-optimum sits at the 1 kW floor or 5 kW
  // ceiling, sizing cards collapse onto each other. Keep one card per kW,
  // preferring the engine's recommended one when there's a tie.
  const byKw = new Map();
  r.sizing_cards.forEach((c) => {
    const existing = byKw.get(c.kw);
    if (!existing || c.recommended) byKw.set(c.kw, c);
  });
  const uniqueCards = Array.from(byKw.values()).sort((a, b) => a.kw - b.kw);

  // Always show 3 chips. If dedupe collapsed the set (e.g. Smaller == Best IRR
  // because the optimum is at the floor), synthesize additional sizes above
  // the current largest so the user can still compare three options.
  while (uniqueCards.length < 3) {
    const maxKw = Math.max(...uniqueCards.map((c) => c.kw));
    const nextKw = Math.min(5.0, maxKw + 1.0);
    if (nextKw <= maxKw) break;
    if (uniqueCards.some((c) => Math.abs(c.kw - nextKw) < 0.01)) break;
    const rExtra = computeFull({ ...state, system_kw: nextKw });
    uniqueCards.push({
      label: 'Bigger',
      kw: nextKw,
      recommended: false,
      payback: rExtra.metrics.payback_simple,
      savings_pct: rExtra.savings_yr1.pct_of_bill,
    });
  }

  uniqueCards.forEach((c) => {
    const isActive = Math.abs(state.system_kw - c.kw) < 0.01;
    const cls = 'size-card'
      + (c.recommended ? ' is-recommended' : '')
      + (isActive ? ' is-active' : '');

    // Compact buttons: kW + label only. Payback and bill-cut live in the
    // live readout below the slider and in the Year-1 Savings card.
    const paybackStr = c.payback ? c.payback.toFixed(1) + 'y' : '—';
    const pctStr = (c.savings_pct * 100).toFixed(0) + '% bill cut';
    const card = el('button', {
      class: cls,
      dataset: { kw: c.kw },
      type: 'button',
      title: `${c.kw} kW · payback ${paybackStr} · ${pctStr}`,
      'aria-label': `${c.kw} kW — ${c.label}, payback ${paybackStr}, ${pctStr}`,
      'aria-pressed': isActive ? 'true' : 'false',
    },
      el('span', { class: 'size-card__kw' }, `${c.kw} kW`),
      el('span', { class: 'size-card__label' }, c.label),
    );

    card.addEventListener('click', () => {
      state.system_kw = +card.dataset.kw;
      kwOverridden = true;
      const numericInput = document.getElementById('systemKw');
      if (numericInput) numericInput.value = state.system_kw;
      rerender();
    });

    host.appendChild(card);
  });

  const rec = r.sizing_cards.find((c) => c.recommended);
  const settlement = r.discom.settlement;
  const userKw = state.system_kw;
  const recKw = rec.kw;

  let note = '';
  if (Math.abs(userKw - recKw) < 0.25) {
    note = `${recKw} kW is the IRR-optimal pick for your DISCOM. `;
  } else if (userKw > recKw) {
    note = `You're at ${userKw} kW — that's ${(userKw - recKw).toFixed(1)} kW above the IRR-optimal ${recKw} kW. ` +
           `Extra capacity covers more of your bill but each marginal kWh earns less, so payback stretches. `;
  } else {
    note = `You're at ${userKw} kW — ${(recKw - userKw).toFixed(1)} kW below the IRR-optimal ${recKw} kW. ` +
           `You'll leave savings on the table; consider going up. `;
  }

  if (settlement === 'Monthly') {
    note += 'Your DISCOM settles surplus monthly at the low APPC rate (~₹3.25/unit), ' +
            'so over-sizing bleeds IRR fast. ';
  } else {
    note += 'Your DISCOM nets surplus annually at full retail, so sizing flexibility is wider. ';
  }
  if (userKw > 3.0) {
    note += 'Note: central subsidy caps at ₹78,000 above 3 kW.';
  }
  const sizeNoteEl = document.getElementById('sizeNote');
  if (sizeNoteEl) sizeNoteEl.textContent = note.trim();
}

function renderRationale(r) {
  // Numbers strip — anchors the chart with figures unique to this section.
  // Payback and "you pay" intentionally omitted (§3 already shows payback;
  // §6 shows the cost breakdown).
  //
  // The 4th cell tells the seasonal-alignment story differently for under
  // vs over-generation. Calling it "Coverage" was misleading next to §3's
  // "cuts X%" — same kW, but kWh-ratio (could exceed 100%) read as
  // contradicting the ₹-ratio (capped at 100%). Split honestly so the user
  // sees BOTH: solar covers your consumption, and any excess exports at APPC.
  const annualGen = r.generation.annual;
  const annualKwh = r.consumption?.annual_kwh || 0;
  const surplusKwh = Math.max(0, annualGen - annualKwh);
  const coverageKwh = Math.min(annualGen, annualKwh);
  const coveragePct = annualKwh > 0 ? (coverageKwh / annualKwh) * 100 : 0;
  const fourthLabel = surplusKwh > 0 ? 'Self-use · surplus to grid' : 'Generation covers';
  const fourthValue = surplusKwh > 0
    ? `${coveragePct.toFixed(0)}% · ${Math.round(surplusKwh).toLocaleString('en-IN')} kWh`
    : `${coveragePct.toFixed(0)}% of consumption`;
  const stripCells = [
    { label: 'Annual bill', value: formatINR(r.bills.annual) },
    { label: 'Annual consumption', value: Math.round(annualKwh).toLocaleString('en-IN') + ' kWh' },
    { label: `Solar gen at ${state.system_kw} kW`, value: Math.round(annualGen).toLocaleString('en-IN') + ' kWh' },
    { label: fourthLabel, value: fourthValue },
  ];
  const strip = document.getElementById('rationaleStrip');
  if (strip) {
    clear(strip);
    stripCells.forEach((c) => {
      const cell = el('div', { class: 'rationale__strip-cell' },
        el('dt', {}, c.label),
        el('dd', { class: 'mono' }, c.value),
      );
      strip.appendChild(cell);
    });
  }

  // The chart is the lead — paints monthly gen and cons side-by-side so the
  // user can SEE seasonal alignment instead of reading abstract cards.
  renderRationaleChart(r);

  // §4 — system-type reason line, populated from the engine's recommendation.
  const typeLine = document.getElementById('rationaleTypeLine');
  if (typeLine && r.recommendation && r.recommendation.reason_type) {
    typeLine.textContent = r.recommendation.reason_type;
  }
}

// §4 chart — paired bars per month: solar generation (amber) and household
// consumption (ink). Months where gen ≥ cons get a subtle background tint
// so "covered months" are obvious at a glance. The story: "this is why X kW
// is the right size — here's how it lines up with what you actually use."
function renderRationaleChart(r) {
  const host = document.getElementById('rationaleChart');
  if (!host) return;
  const W = host.clientWidth || 720;
  const H = host.clientHeight || 280;
  const pad = CHART_PAD;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const gen = r.generation?.monthly || [];
  const cons = r.consumption?.monthly || [];
  if (gen.length !== 12 || cons.length !== 12) return;

  const maxV = Math.max(...gen, ...cons, 10) * 1.12;
  const groupW = innerW / 12;
  const barGap = groupW * 0.12;
  const barW = (groupW - barGap * 2) / 2;
  const yScale = (v) => pad.t + innerH - (v / maxV) * innerH;
  const xGroup = (i) => pad.l + i * groupW + barGap;

  const step = niceStep(maxV / 4);
  const ticks = [];
  for (let v = 0; v <= maxV; v += step) ticks.push(v);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });

  // Background tint on months where gen ≥ cons (solar covers the home)
  for (let m = 0; m < 12; m++) {
    if (gen[m] >= cons[m]) {
      svg.appendChild(svgEl('rect', {
        x: (pad.l + m * groupW).toFixed(1),
        y: pad.t.toFixed(1),
        width: groupW.toFixed(1),
        height: innerH.toFixed(1),
        fill: 'var(--amber-wash)', opacity: '0.18',
      }));
    }
  }

  // Y-axis grid + labels (kWh)
  ticks.forEach((t) => {
    svg.appendChild(svgEl('line', {
      x1: pad.l, y1: yScale(t), x2: W - pad.r, y2: yScale(t),
      stroke: 'var(--rule-soft)', 'stroke-width': '0.5', 'stroke-dasharray': '2 3',
    }));
    svg.appendChild(svgEl('text', {
      x: pad.l - 8, y: yScale(t) + 3, 'text-anchor': 'end',
      'font-family': 'IBM Plex Mono', 'font-size': '9', fill: 'var(--ink-mute)',
    }, t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${Math.round(t)}`));
  });

  // Baseline
  svg.appendChild(svgEl('line', {
    x1: pad.l, y1: yScale(0), x2: W - pad.r, y2: yScale(0),
    stroke: 'var(--ink)', 'stroke-width': '1.2',
  }));

  // Average lines — sizing aims to match avg consumption over the year, not
  // the peak month. The text labels for these lines now live in the legend
  // (rationaleLegendAvgGen / rationaleLegendAvgCons) so they don't collide
  // with the per-month % labels above the bars.
  const avgGen = gen.reduce((a, b) => a + b, 0) / 12;
  const avgCons = cons.reduce((a, b) => a + b, 0) / 12;

  svg.appendChild(svgEl('line', {
    x1: pad.l, y1: yScale(avgCons), x2: W - pad.r, y2: yScale(avgCons),
    stroke: 'var(--ink)', 'stroke-width': '1', 'stroke-dasharray': '5 4', opacity: '0.55',
  }));
  svg.appendChild(svgEl('line', {
    x1: pad.l, y1: yScale(avgGen), x2: W - pad.r, y2: yScale(avgGen),
    stroke: 'var(--amber-deep)', 'stroke-width': '1.2', 'stroke-dasharray': '5 4',
  }));

  // Push avg numbers into the legend so the user reads them once, in one
  // place, rather than hunting for clipped in-chart labels.
  const legendGen = document.getElementById('rationaleLegendAvgGen');
  const legendCons = document.getElementById('rationaleLegendAvgCons');
  if (legendGen) legendGen.textContent = `${Math.round(avgGen)} kWh/mo`;
  if (legendCons) legendCons.textContent = `${Math.round(cons.reduce((a,b)=>a+b,0)/12)} kWh/mo`;

  // Paired bars
  for (let m = 0; m < 12; m++) {
    const gx = xGroup(m);
    const cx = gx + barW;
    const gy = yScale(gen[m]);
    const cy = yScale(cons[m]);
    const baseline = yScale(0);
    const covPct = cons[m] > 0 ? (gen[m] / cons[m]) * 100 : 0;
    const tooltip = `${MONTH_LABELS[m]} · Gen ${Math.round(gen[m])} kWh, Cons ${Math.round(cons[m])} kWh · covers ${covPct.toFixed(0)}%`;

    // Generation bar (amber filled — matches legend-mark--save)
    const genBar = svgEl('rect', {
      x: gx.toFixed(1), y: gy.toFixed(1),
      width: barW.toFixed(1), height: (baseline - gy).toFixed(1),
      fill: 'var(--amber)',
    });
    genBar.appendChild(svgEl('title', {}, tooltip));
    svg.appendChild(genBar);

    // Consumption bar — outlined ink, no fill, to match legend-mark--bill
    // (solid ink fill would have been a visual mismatch with the legend swatch)
    const consBar = svgEl('rect', {
      x: cx.toFixed(1), y: cy.toFixed(1),
      width: barW.toFixed(1), height: (baseline - cy).toFixed(1),
      fill: 'var(--paper)', stroke: 'var(--ink)', 'stroke-width': '1.2',
    });
    consBar.appendChild(svgEl('title', {}, tooltip));
    svg.appendChild(consBar);

    // Per-month coverage % above the taller bar. We tag each month with one
    // of three states so the labels signal the *story*, not just a number:
    //   • short  (<70%)        — undersized that month, you import a lot
    //   • match  (70-130%)     — well-aligned, retail savings dominate
    //   • surplus (>130%)      — over-export at low APPC rate
    // Huge winter percentages like "815%" felt alarming; we cap visual at
    // "200%+" so the eye reads the band, not the absurd number.
    const topY = Math.min(gy, cy) - 5;
    let pctText, tone;
    if (covPct >= 200) { pctText = '200%+'; tone = 'var(--amber-deep)'; }
    else if (covPct >= 130) { pctText = covPct.toFixed(0) + '%'; tone = 'var(--amber-deep)'; }
    else if (covPct >= 70)  { pctText = covPct.toFixed(0) + '%'; tone = 'var(--ink)'; }
    else                    { pctText = covPct.toFixed(0) + '%'; tone = 'var(--ink-mute)'; }
    svg.appendChild(svgEl('text', {
      x: (gx + barW).toFixed(1), y: topY.toFixed(1), 'text-anchor': 'middle',
      'font-family': 'IBM Plex Mono', 'font-size': '8', fill: tone,
    }, pctText));
  }

  // Month labels
  for (let m = 0; m < 12; m++) {
    svg.appendChild(svgEl('text', {
      x: pad.l + m * groupW + groupW / 2, y: H - pad.b + 14, 'text-anchor': 'middle',
      'font-family': 'IBM Plex Mono', 'font-size': '9', fill: 'var(--ink-mute)',
      'letter-spacing': '0.05em',
    }, MONTH_LABELS[m].toUpperCase()));
  }

  // Y-axis label
  svg.appendChild(svgEl('text', {
    x: pad.l - 8, y: pad.t - 6, 'text-anchor': 'end',
    'font-family': 'IBM Plex Mono', 'font-size': '8', fill: 'var(--ink-mute)',
    'letter-spacing': '0.06em',
  }, 'kWh'));

  clear(host);
  host.appendChild(svg);
}

/* ──────────────────────────────────────────────────────────
   CHARTS — custom SVG via createElementNS
   ────────────────────────────────────────────────────────── */

const CHART_PAD = { t: 24, r: 20, b: 36, l: 48 };

// renderMonthlyChart was removed along with the headline section.
// §2 (renderBillingPattern) and §7 (renderBillChange / billChangeMonthly + bank)
// now own the monthly-bill story more accurately.

function renderCumulativeChart(r) {
  const host = document.getElementById('cumulativeChart');
  const W = host.clientWidth || 560;
  const H = host.clientHeight || 350;
  const pad = CHART_PAD;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const years = r.year_array;
  // Solar gain over time = cumulative net cashflow (savings - outlay).
  // Negative until breakeven, climbs after.
  const solar = years.map((y) => y.cumCashflow);
  // Alt gain over time = pure investment growth post-LTCG, anchored at 0.
  // Apples-to-apples with §9: bills are paid from salary in either path, so
  // they don't subtract from the alt corpus.
  const ltcg = 0.125;
  const alt = years.map((y) => {
    const corpusPre = r.costs.net * Math.pow(1 + state.alt_return_rate, y.year);
    return (corpusPre - r.costs.net) * (1 - ltcg);
  });

  const allVals = [...solar, ...alt, 0];
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;

  document.getElementById('altLabel').textContent = (state.alt_return_rate * 100).toFixed(0) + '% post-LTCG';

  const xScale = (i) => pad.l + (i / Math.max(1, years.length - 1)) * innerW;
  const yScale = (v) => pad.t + innerH - ((v - minV) / range) * innerH;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });

  // Zone tints — soft red for "underwater", soft amber wash for "in the
  // black". Drawn first so grid lines and curves layer on top.
  if (minV < 0) {
    svg.appendChild(svgEl('rect', {
      x: pad.l, y: yScale(0),
      width: innerW, height: (pad.t + innerH - yScale(0)).toFixed(1),
      fill: 'var(--crimson)', opacity: '0.05',
    }));
  }
  if (maxV > 0) {
    svg.appendChild(svgEl('rect', {
      x: pad.l, y: pad.t,
      width: innerW, height: (yScale(0) - pad.t).toFixed(1),
      fill: 'var(--amber-wash)', opacity: '0.18',
    }));
  }

  const tickStep = niceStep(range / 4);
  for (let v = Math.ceil(minV / tickStep) * tickStep; v <= maxV; v += tickStep) {
    svg.appendChild(svgEl('line', {
      x1: pad.l, y1: yScale(v), x2: W - pad.r, y2: yScale(v),
      stroke: 'var(--rule-soft)', 'stroke-width': '0.5', 'stroke-dasharray': '2 3',
    }));
    svg.appendChild(svgEl('text', {
      x: pad.l - 8, y: yScale(v) + 3, 'text-anchor': 'end',
      'font-family': 'IBM Plex Mono', 'font-size': '9', fill: 'var(--ink-mute)',
    }, formatLakhShort(v)));
  }

  // Zero line — the visual fulcrum
  if (minV < 0 && maxV > 0) {
    svg.appendChild(svgEl('line', {
      x1: pad.l, y1: yScale(0), x2: W - pad.r, y2: yScale(0),
      stroke: 'var(--ink)', 'stroke-width': '1.2',
    }));
  }

  // Year labels (every 5)
  for (let y = 5; y <= years.length; y += 5) {
    const x = xScale(y - 1);
    svg.appendChild(svgEl('text', {
      x, y: H - pad.b + 14, 'text-anchor': 'middle',
      'font-family': 'IBM Plex Mono', 'font-size': '9', fill: 'var(--ink-mute)',
    }, `Y${y}`));
  }

  // Gap fill between solar and alt — shows lead/lag at a glance. Closed
  // path: along solar forward, then along alt backward.
  const solarPath = solar.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`).join(' ');
  const altPathFwd = alt.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`).join(' ');
  const altPathRev = alt.slice().reverse().map((v, i) => {
    const idx = alt.length - 1 - i;
    return `L ${xScale(idx).toFixed(1)} ${yScale(v).toFixed(1)}`;
  }).join(' ');
  const gapPath = solarPath + ' ' + altPathRev + ' Z';
  // Two-tone gap: amber wash where solar leads, ink wash where alt leads.
  // We approximate by clipping a single fill against the lead direction —
  // simplest version is one fill colored by the year-25 winner.
  const solarLeads = solar[solar.length - 1] >= alt[alt.length - 1];
  svg.appendChild(svgEl('path', {
    d: gapPath, fill: solarLeads ? 'var(--amber)' : 'var(--ink)',
    opacity: '0.08',
  }));

  // Alt line (dashed ink)
  svg.appendChild(svgEl('path', {
    d: altPathFwd, fill: 'none', stroke: 'var(--ink)', 'stroke-width': '1.4', 'stroke-dasharray': '4 3', opacity: '0.7',
  }));

  // Solar line — solid amber, drawn on top
  svg.appendChild(svgEl('path', { d: solarPath, fill: 'none', stroke: 'var(--amber)', 'stroke-width': '2.2' }));

  // Breakeven marker — vertical dashed guide + amber dot at zero crossing
  if (r.metrics.payback_simple !== null && r.metrics.payback_simple < years.length) {
    const pbIdx = Math.max(0, r.metrics.payback_simple - 1);
    const px = pad.l + (pbIdx / Math.max(1, years.length - 1)) * innerW;
    const py = yScale(0);
    svg.appendChild(svgEl('line', {
      x1: px, y1: pad.t, x2: px, y2: pad.t + innerH,
      stroke: 'var(--amber-deep)', 'stroke-width': '1', 'stroke-dasharray': '3 3', opacity: '0.6',
    }));
    svg.appendChild(svgEl('circle', { cx: px, cy: py, r: '4', fill: 'var(--amber-deep)' }));
    svg.appendChild(svgEl('text', {
      x: px + 6, y: pad.t + 11,
      'font-family': 'IBM Plex Mono', 'font-size': '9',
      'letter-spacing': '0.04em', fill: 'var(--amber-deep)', 'font-weight': '500',
    }, `BREAKEVEN ${r.metrics.payback_simple.toFixed(1)}y`));
  }

  // Endpoint labels — Year-25 anchors. Solar first (it's the headline number).
  const lastIdx = years.length - 1;
  const lastX = xScale(lastIdx);
  svg.appendChild(svgEl('text', {
    x: lastX - 6, y: yScale(solar[lastIdx]) - 6,
    'text-anchor': 'end', 'font-family': 'Fraunces', 'font-style': 'italic',
    'font-size': '11', fill: 'var(--amber-deep)', 'font-weight': '500',
  }, `Solar ${formatLakhShort(solar[lastIdx])}`));
  svg.appendChild(svgEl('text', {
    x: lastX - 6, y: yScale(alt[lastIdx]) + 14,
    'text-anchor': 'end', 'font-family': 'Fraunces', 'font-style': 'italic',
    'font-size': '11', fill: 'var(--ink-soft)',
  }, `Alt ${formatLakhShort(alt[lastIdx])}`));

  clear(host);
  host.appendChild(svg);

  // Populate the side numbers panel — payback intentionally omitted (it's
  // already in the §8 headline + the chart's BREAKEVEN marker).
  setText('pbStatSolar25', formatLakh(solar[lastIdx]));
  setText('pbStatAlt25', formatLakh(alt[lastIdx]));
  const lead = solar[lastIdx] - alt[lastIdx];
  const leadLabel = document.getElementById('pbStatLeadLabel');
  const leadVal = document.getElementById('pbStatLead');
  if (leadLabel && leadVal) {
    if (lead >= 0) {
      leadLabel.textContent = 'Solar leads alt by';
      leadVal.textContent = '+' + formatLakh(lead);
      leadVal.classList.add('num--accent');
    } else {
      leadLabel.textContent = 'Alt leads solar by';
      leadVal.textContent = formatLakh(Math.abs(lead));
      leadVal.classList.remove('num--accent');
    }
  }
}

function niceStep(rough) {
  if (rough <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / exp;
  let nice;
  if (norm < 1.5) nice = 1;
  else if (norm < 3.5) nice = 2;
  else if (norm < 7.5) nice = 5;
  else nice = 10;
  return nice * exp;
}

function formatLakhShort(rupees) {
  if (Math.abs(rupees) >= 100000) return `₹${(rupees / 100000).toFixed(1)}L`;
  if (Math.abs(rupees) >= 1000) return `₹${(rupees / 1000).toFixed(0)}k`;
  return `₹${Math.round(rupees)}`;
}

/* ──────────────────────────────────────────────────────────
   YEAR-BY-YEAR TABLE
   ────────────────────────────────────────────────────────── */
function renderYearTable(r) {
  const host = document.getElementById('yearTable');
  const paybackY = r.metrics.payback_simple !== null ? Math.ceil(r.metrics.payback_simple) : -1;
  const replYears = new Set((r.battery_replacements || []).map((b) => b.year));

  const table = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  ['Year', 'Generation', 'Savings', 'Cumulative cash', 'Status'].forEach((h) => headRow.appendChild(el('th', {}, h)));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');

  // Year 0
  const y0 = el('tr');
  ['Y0', '—', `−${formatINR(r.costs.net)}`, `−${formatINR(r.costs.net)}`, 'upfront'].forEach((c) => y0.appendChild(el('td', {}, c)));
  tbody.appendChild(y0);

  r.year_array.forEach((y) => {
    const isPb = y.year === paybackY;
    const isRpl = replYears.has(y.year);
    const tr = el('tr', { class: isPb ? 'is-payback' : isRpl ? 'is-replacement' : '' });
    const status = isPb ? 'breakeven' : isRpl ? 'battery replaced' : '';
    const gen = Math.round(r.generation.annual * y.degradation).toLocaleString('en-IN') + ' kWh';
    const cumStr = (y.cumCashflow >= 0 ? '+' : '−') + formatINR(Math.abs(y.cumCashflow));
    [`Y${y.year}`, gen, formatINR(y.savings), cumStr, status].forEach((c) => tr.appendChild(el('td', {}, c)));
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  clear(host);
  host.appendChild(table);
}

/* ──────────────────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────────────────── */
function init() {
  const now = new Date();
  document.getElementById('dateline').textContent =
    `EDITION №1 · ${now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase()}`;

  // Default lifestyle on first paint — median Indian middle-class home.
  // Sets activeStampId so the tile renders highlighted, and syncs sliders/state.
  const defaultStamp = LIFESTYLE_STAMPS.find((s) => s.id === '2ac-evening');
  if (defaultStamp) {
    activeStampId = defaultStamp.id;
    applyStampToState(defaultStamp);
  }

  populateLifestyle();
  populateStateSelect();
  populateGridStops();
  mountSystemDiagrams(document.getElementById('systemDiagram'), state, state.system_type);
  bindInputs();
  // Defer the first rerender by one frame so chart hosts have non-zero
  // clientWidth by the time render functions read it. Without this we hit a
  // first-paint TypeError when the script runs before layout settles.
  requestAnimationFrame(() => rerender());

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const r = computeFull(state);
      renderCumulativeChart(r);
      renderBillChange(r);
      renderBillingPattern(r);
      renderSubsidyNote(state.system_kw);
      renderRationaleChart(r);
    }, 150);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
