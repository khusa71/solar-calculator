// The Solar Ledger — UI controller
// Reads inputs → calls engine.computeFull → renders.
// All DOM construction uses textContent + createElement for safety.

import { computeFull, defaultInput, formatINR, formatLakh, recommendSystemType, systemTypeAdvisory, pickOptimalSize } from './engine.js?v=5';
import {
  DISCOMS, STATE_DEFAULTS, LIFESTYLE_STAMPS, scaleStampToTariff, OUTAGE_STOPS, MONTH_LABELS,
} from './constants.js?v=4';
import { mountSystemDiagrams, updateBillExamples, setActiveDiagram, renderSizingPrice } from './diagrams.js?v=5';

/* ──────────────────────────────────────────────────────────
   STATE
   ────────────────────────────────────────────────────────── */
const state = defaultInput();
let billMode = 'easy';
let activeStampId = null;   // tracks which lifestyle stamp is currently selected (null if user typed a custom bill)

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
  document.getElementById('discomMeta').textContent =
    `Tariff ₹${d.tariff.toFixed(2)}/unit · ${zoneLabel} sun zone · ${d.settlement.toLowerCase()} net-metering settlement.`;
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
    if (v >= 1 && v <= 10) { state.system_kw = v; syncKwControls(); rerender(); }
  });

  const kwSlider = document.getElementById('kwSlider');
  if (kwSlider) {
    kwSlider.value = state.system_kw;
    kwSlider.addEventListener('input', () => {
      const v = +kwSlider.value;
      if (v >= 1 && v <= 10) {
        state.system_kw = v;
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
  const r = computeFull(state);
  renderHeadline(r);
  renderCardA(r);
  renderCardB(r);
  renderRationale(r);
  renderMonthlyChart(r);
  renderCumulativeChart(r);
  renderYearTable(r);
  updateBillExamples(state);
  renderSizingPrice(state);
  syncKwControls();
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
  }

  // Live readout line under the slider — uses the engine for THIS pick
  const r = computeFull(state);
  const livePick    = document.getElementById('kwLivePick');
  const livePayback = document.getElementById('kwLivePayback');
  const liveSave    = document.getElementById('kwLiveSave');
  if (livePick)    livePick.textContent = kwStr + ' kW';
  if (livePayback) livePayback.textContent =
    r.metrics.payback_simple != null && isFinite(r.metrics.payback_simple)
      ? r.metrics.payback_simple.toFixed(1) + ' years'
      : '—';
  if (liveSave) liveSave.textContent = '₹' + Math.round(r.savings_yr1.annual / 12).toLocaleString('en-IN');
  const liveCut = document.getElementById('kwLiveCut');
  if (liveCut) liveCut.textContent = (r.savings_yr1.pct_of_bill * 100).toFixed(0) + '%';
}

function renderHeadline(r) {
  setText('hKw', state.system_kw);
  setText('hPayback', r.metrics.payback_simple !== null ? r.metrics.payback_simple.toFixed(1) : '—');
  setText('hGain', r.metrics.net_gain > 0 ? formatLakh(r.metrics.net_gain) : '—');
  setText('hHorizon', state.analysis_horizon_years);
  setText('hSubsidy', formatINR(r.costs.total_subsidy));

  const v = r.verdict;
  const wrap = document.getElementById('headlineVerdict');
  if (!wrap) return;
  wrap.className = 'headline__verdict tone-' + v.tone;
  clear(wrap);
  wrap.appendChild(el('span', { class: 'verdict__pill' }, v.headline));
  wrap.appendChild(el('p', { class: 'verdict__body' }, v.body));
}

function renderCardA(r) {
  // Reference values — anchor the comparison so the lakh figures aren't floating
  const initialOutlay = r.costs.net;
  setText('refOutlay', formatINR(initialOutlay));
  setText('refBill', formatINR(r.bills.annual) + ' / yr');

  setText('cardAIrr', r.metrics.irr !== null ? (r.metrics.irr * 100).toFixed(0) + '%' : '—');

  // NET WEALTH (post-tax investment gain MINUS cumulative bills the alt-path
  // would still pay). This is the apples-to-apples comparison with solar's
  // net_gain. Showing pre-tax gross gain made alt rows look 2–3× larger than
  // they actually leave the household.
  const fd     = r.metrics.fd_net_wealth;
  const equity = r.metrics.nifty_net_wealth;
  const solar  = r.metrics.net_gain;

  // Format with sign — alts can go negative (FD frequently does)
  const fmtSigned = (v) => (v < 0 ? '−' : '') + formatLakh(Math.abs(v));
  setText('cardAFd', fmtSigned(fd));
  setText('cardANifty', fmtSigned(equity));
  setText('cardASolar', fmtSigned(solar));

  // Multiplier vs initial outlay — kept for context but only shown when positive
  const mult = (val) => initialOutlay > 0 ? (val / initialOutlay).toFixed(1) + '× outlay' : '—';
  setText('cardAFdMult', fd > 0 ? mult(fd) : '');
  setText('cardANiftyMult', equity > 0 ? mult(equity) : '');
  setText('cardASolarMult', solar > 0 ? mult(solar) : '');

  // Magnitude bar widths — use absolute values for max but track signed values
  // so negative wealth doesn't render with a positive bar
  const absMax = Math.max(Math.abs(fd), Math.abs(equity), Math.abs(solar), 1);
  const setBar = (id, val) => {
    const span = document.getElementById(id);
    const row = span?.parentElement?.parentElement;
    if (!row) return;
    const pct = (Math.max(0, val) / absMax) * 100;
    row.style.setProperty('--bar-pct', pct.toFixed(1) + '%');
  };
  setBar('cardAFd', fd);
  setBar('cardANifty', equity);
  setBar('cardASolar', solar);
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
  const cells = [
    {
      num: formatINR(r.bills.annual),
      title: 'Your annual bill',
      sub: 'Sum of 12 monthly bills using a typical Indian shape curve, anchored to your peak and low.',
    },
    {
      num: Math.round(r.generation.annual).toLocaleString('en-IN') + ' kWh',
      title: 'Roof solar potential',
      sub: `${r.discom.zone === 'VeryHigh' ? 'Very high' : r.discom.zone} sun zone · ${state.panel_tech} panels · ${state.shading.toLowerCase()} shading${state.roof_type === 'SlopedTiled' ? ' · −7% sloped-roof tilt derate' : ''}.`,
    },
    {
      num: formatINR(r.costs.total_subsidy),
      title: 'Government subsidy',
      sub: `Central PM Surya Ghar slab applied for ${state.system_kw} kW, plus state subsidy where applicable.`,
    },
    {
      num: formatINR(r.costs.net),
      title: 'You pay upfront',
      sub: `Recovered by year ${r.metrics.payback_simple ? r.metrics.payback_simple.toFixed(1) : '—'}, then it's free electricity.`,
    },
  ];

  const grid = document.getElementById('rationaleGrid');
  clear(grid);
  cells.forEach((c) => {
    grid.appendChild(el('div', { class: 'rationale__cell' },
      el('span', { class: 'rationale__num' }, c.num),
      el('p', { class: 'rationale__title' }, c.title),
      el('p', { class: 'rationale__sub' }, c.sub),
    ));
  });
}

/* ──────────────────────────────────────────────────────────
   CHARTS — custom SVG via createElementNS
   ────────────────────────────────────────────────────────── */

const CHART_PAD = { t: 24, r: 20, b: 36, l: 48 };

function renderMonthlyChart(r) {
  const host = document.getElementById('monthlyChart');
  const W = host.clientWidth || 560;
  const H = host.clientHeight || 350;
  const pad = CHART_PAD;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const bills = r.bills.monthly;
  const savings = r.savings_yr1.monthly;
  const maxV = Math.max(...bills, ...savings, 100) * 1.1;

  const barW = innerW / 12;
  const groupGap = barW * 0.18;
  const subBarW = (barW - groupGap) / 2;
  const yScale = (v) => innerH - (v / maxV) * innerH;

  // Choose nice tick step
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
    const billH = (bills[m] / maxV) * innerH;
    const saveH = (savings[m] / maxV) * innerH;

    svg.appendChild(svgEl('rect', {
      x: x + groupGap / 2, y: pad.t + innerH - billH, width: subBarW, height: billH,
      fill: 'none', stroke: 'var(--ink)', 'stroke-width': '1',
    }));
    svg.appendChild(svgEl('rect', {
      x: x + groupGap / 2 + subBarW, y: pad.t + innerH - saveH, width: subBarW, height: saveH,
      fill: 'var(--amber)',
    }));

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

function renderCumulativeChart(r) {
  const host = document.getElementById('cumulativeChart');
  const W = host.clientWidth || 560;
  const H = host.clientHeight || 350;
  const pad = CHART_PAD;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const years = r.year_array;
  const solar = years.map((y) => y.cumCashflow);
  // Alt line — net wealth gained at year t, mark-to-market post-tax less bills paid.
  //   wealth(t) = (corpus_pre(t) − outlay) × (1 − LTCG) − bills_paid(t)
  // Anchored at 0 at Y0 (mark-to-market: outlay is in market, no bills paid yet).
  // Solar starts at -outlay because the system is illiquid. The two lines start
  // at different y values intentionally — that's what shows the upfront cost.
  const ltcg = 0.125;
  const alt = years.map((y) => {
    const corpusPre = r.costs.net * Math.pow(1 + state.alt_return_rate, y.year);
    const gainPostTax = (corpusPre - r.costs.net) * (1 - ltcg);
    const billsPaid = r.metrics.bills_paid_by_year(y.year);
    return gainPostTax - billsPaid;
  });

  const allVals = [...solar, ...alt, 0];
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;

  document.getElementById('altLabel').textContent = (state.alt_return_rate * 100).toFixed(0) + '% post-tax, less bills you\'d still pay';

  const xScale = (i) => pad.l + (i / Math.max(1, years.length - 1)) * innerW;
  const yScale = (v) => pad.t + innerH - ((v - minV) / range) * innerH;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });

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

  if (minV < 0 && maxV > 0) {
    svg.appendChild(svgEl('line', {
      x1: pad.l, y1: yScale(0), x2: W - pad.r, y2: yScale(0),
      stroke: 'var(--ink)', 'stroke-width': '1.2',
    }));
  }

  for (let y = 5; y <= years.length; y += 5) {
    const x = xScale(y - 1);
    svg.appendChild(svgEl('text', {
      x, y: H - pad.b + 14, 'text-anchor': 'middle',
      'font-family': 'IBM Plex Mono', 'font-size': '9', fill: 'var(--ink-mute)',
    }, `Y${y}`));
  }

  // Alt line (dashed ink)
  const altPath = alt.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`).join(' ');
  svg.appendChild(svgEl('path', {
    d: altPath, fill: 'none', stroke: 'var(--ink)', 'stroke-width': '1.5', 'stroke-dasharray': '4 3',
  }));

  // Solar line + filled area
  const solarPath = solar.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`).join(' ');
  const zeroY = yScale(Math.max(0, minV));
  const areaPath = solarPath +
    ` L ${xScale(years.length - 1).toFixed(1)} ${zeroY.toFixed(1)}` +
    ` L ${xScale(0).toFixed(1)} ${zeroY.toFixed(1)} Z`;
  svg.appendChild(svgEl('path', { d: areaPath, fill: 'var(--amber-wash)', opacity: '0.6' }));
  svg.appendChild(svgEl('path', { d: solarPath, fill: 'none', stroke: 'var(--amber)', 'stroke-width': '2' }));

  // Payback marker
  if (r.metrics.payback_simple !== null && r.metrics.payback_simple < years.length) {
    const px = pad.l + (r.metrics.payback_simple / Math.max(1, years.length - 1)) * innerW;
    const py = yScale(0);
    svg.appendChild(svgEl('line', { x1: px, y1: py - 6, x2: px, y2: py + 6, stroke: 'var(--amber-deep)', 'stroke-width': '1.5' }));
    svg.appendChild(svgEl('circle', { cx: px, cy: py, r: '3', fill: 'var(--amber-deep)' }));
    svg.appendChild(svgEl('text', {
      x: px + 8, y: py - 8, 'font-family': 'Fraunces', 'font-style': 'italic',
      'font-size': '11', fill: 'var(--amber-deep)',
    }, `payback ${r.metrics.payback_simple.toFixed(1)}y`));
  }

  // Endpoint labels
  svg.appendChild(svgEl('text', {
    x: xScale(years.length - 1), y: yScale(solar[solar.length - 1]) - 8,
    'text-anchor': 'end', 'font-family': 'IBM Plex Mono', 'font-size': '10', fill: 'var(--amber-deep)',
  }, `Solar ${formatLakhShort(solar[solar.length - 1])}`));
  svg.appendChild(svgEl('text', {
    x: xScale(years.length - 1), y: yScale(alt[alt.length - 1]) - 8,
    'text-anchor': 'end', 'font-family': 'IBM Plex Mono', 'font-size': '10', fill: 'var(--ink-soft)',
  }, `Alt ${formatLakhShort(alt[alt.length - 1])}`));

  clear(host);
  host.appendChild(svg);
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
  rerender();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const r = computeFull(state);
      renderMonthlyChart(r);
      renderCumulativeChart(r);
    }, 150);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
