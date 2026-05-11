# The Solar Ledger — Story & Information Flow

> Companion to `LOGIC.md`.
> `LOGIC.md` answers *what does the math compute*. This document answers *what does the user read, in what order, and why*.
> Source-of-truth for every section, every headline, every transition between sections — before any code is written.

---

## 0. Why this rewrite

The current page violates its own design philosophy in three concrete ways:

1. **The answer appears before the question is asked.** The "Worked Example · Your Bill" panel sits at scroll y≈543 and reports `YOU KEEP ₹2,703/mo` from a 3 kW assumption. The sizing slider is at y≈1114. The user reads the conclusion before they've sized a system.
2. **The same monthly figure is reported four times.** Worked example, sizing live-line, price box, headline. Repetition without bridging.
3. **The pricing spread is hidden.** Self-consumed kWh are worth ₹8.50 (slab tariff). Exported surplus is worth ₹3.25 (APPC). The page collapses these into a single fictional "effective rate ₹7.18/kWh" — and the entire economics of net-metering hinges on the spread it just hid.

`STORY.md` fixes those by establishing one ordered narrative and sticking to it.

---

## 0.5. Scope of this rewrite — UI stays, story changes

**What we keep (the UI is liked and stays):**
- The editorial newspaper aesthetic — Fraunces serif, IBM Plex sans/mono, cream paper background, paper-grain overlay.
- The masthead lockup — brand mark, dateline, `VOL. I · NO. 1`, double rule.
- The numeric editorial kickers (`01 · YOUR BILLS`, `02 · STATE`, …). They get **renumbered** to match the new section order, but the visual treatment stays.
- The input components — Easy/Precise toggle, lifestyle tile grid, roof button trio, grid-reliability slider, system-type segmented control with SVG icons, kW slider with `RECOMMENDED` tick.
- The chart aesthetic — amber/teak palette, mono axis labels, the chart-cap pattern with `FIG. N` kicker.
- The headline serif treatment with amber emphasis spans.
- The colophon with method line and methodology link.
- The `details > summary` advanced disclosure.

**What changes (story / information architecture only):**
- The order in which sections appear.
- Which section owns which output (so the same number isn't reported four times).
- The math shown in the worked example (split rates, real reconciliation).
- New: §2 (billing pattern), the seasonal kWh-bank chart in §7, the subsidy-slab kink in §6.
- Default values that contradict the recommendation engine (slider default, system-type default).

**Test for any proposed change:** if it alters the *order* in which the user encounters information, or the *correctness* of what's shown, it's in scope. If it alters the *look* — typography, palette, component shape, chart styling — it is not in scope and needs a separate conversation.

---

## 1. The story we want to tell

A homeowner with an electricity bill should be able to reach the page, scroll once, and walk through nine sub-decisions in this exact order. Each section answers one question and feeds the next.

| § | Question this section answers | Sub-decision the user is making |
|---|---|---|
| 1 | What's my situation? | "Have I told the page enough to compute an answer?" |
| 2 | What does my bill *look like* across a year? | "Is solar even relevant to my consumption pattern?" |
| 3 | What size system should I get? | "Do I trust the recommendation, or override it?" |
| 4 | Why that size? | "Is the reasoning sound?" |
| 5 | What kind of system? On-grid, hybrid, off-grid? | "Am I picking the right mode for my grid?" |
| 6 | What does it cost me, after subsidy? | "Can I afford the upfront?" |
| 7 | How does my bill actually change, month to month? | "Is the saving real cash or accounting credit?" |
| 8 | When does it pay back? | "How long am I committing capital for?" |
| 9 | What's the opportunity cost? | "Is this better than just investing the same money?" |
| 10 | Show me the math. | "Can I audit this?" |

That ordering is the **spine**. Every section header, every visualization, every paragraph of microcopy exists to advance the user along it. No section is allowed to repeat an earlier section's punch-line.

---

## 2. Cross-cutting principles

Before we walk through the sections, four rules that apply everywhere.

### 2.1 The recommendation is the spine

§3 produces a single recommendation (`X kW`, `on-grid|hybrid|off-grid`). §§4–9 then *stress-test that recommendation* — explaining it (§4), justifying the system type (§5), pricing it (§6), tracing the bill change (§7), modelling payback (§8), and benchmarking it (§9). If the user overrides kW or system type anywhere, the spine recomputes and every downstream section updates.

Practically:
- The slider in §3 defaults to the engine's recommended kW. Not a hardcoded `value="3"`.
- The system-type tabs in §5 default to the engine's recommendation. Not on-grid by default.
- The "RECOMMENDED" label, the size-card pill, and the slider thumb position must agree at all times.

### 2.2 One ₹/mo number, in one place

The monthly savings figure (`₹2,703/mo` for the default scenario) appears in §7 only. Earlier sections refer to annual figures or qualitative language. Later sections refer to cumulative figures (`₹13.2 lakh over 25 years`). The single monthly number's home is §7 because that's the section about *how the bill changes month-to-month* — which is exactly what the figure means.

### 2.3 Show the spread, every time

Every place the calculator presents savings, the import-vs-export rate spread is visible. No fictional "effective rate". Two real rates: ₹8.50 retail and ₹3.25 APPC. The user must see that the last marginal kWh of generation is worth less than the first.

### 2.4 Distinguish "money saved" from "money received"

Self-consumption avoids a bill — that's cash you don't spend. Surplus export earns a kWh credit that's reconciled at year-end at APPC — that's not monthly cashflow. The page must never sum them and present the total as a monthly cash figure (which it currently does).

---

## 3. The sections

Each section below specifies: **purpose**, **what the user sees**, **what they should walk away knowing**, **data dependencies**, **interaction**, and **what it replaces in the current build**.

---

### §1 — Your inputs

**Purpose.** Collect the minimum needed to compute everything else.

**What the user sees.**
- Editorial kicker: `Your situation`
- Headline: *Tell us about your bill, your roof, and your grid. We'll do the rest.*
- Four input groups in a row (desktop) or stacked (mobile):
  - **Bills** (Easy: lifestyle archetypes / Precise: peak + low sliders)
  - **State** (dropdown — also surfaces the DISCOM, e.g. "Rajasthan · Kota · KEDL")
  - **Roof** (Flat RCC / Sloped / Terrace)
  - **Grid reliability** (5-stop slider with scenario microcopy)

**Walk-away.** "I've given the page enough. Now it should know what to do."

**Data dependencies.** None — these *are* the inputs.

**Interaction.** Every change recomputes the engine and ripples through §2–§9 live.

**Replaces.** The current §1–§4 of the inputs band — minus the system-type segment, minus the system diagram, minus the worked example. Those move out.

**Microcopy notes.**
- Keep the `01 ·`, `02 ·`, `03 ·`, `04 ·` numeric kickers — the user likes the editorial pattern. The renumbering follows the new section order: this is `01–04` (the four parallel inputs in the band), and §3 becomes `05`, §4 becomes `06`, etc. The numbers indicate sequence in the page narrative, not a strict fill-the-form order.
- Surface the DISCOM in the state dropdown so users in larger states (Rajasthan, UP, Maharashtra) know which utility rules apply.
- Keep Easy/Precise toggle but fix the load-state bug where `data-mode="precise"` while the Easy pane is visible.

---

### §2 — Your billing pattern

**Purpose.** Translate the two numbers the user just gave us (peak + low, or lifestyle stamp) into a year-long bill shape they recognize. Establish that solar's value depends on *when* the bill is high.

**What the user sees.**
- Editorial kicker: `Your bill, decoded`
- Headline: *Your bill peaks at ~₹X in May–June and dips to ~₹Y in monsoon. AC months drive 60% of your year.*
- A 12-bar Jan–Dec mini-chart showing inferred monthly bill (₹).
- Beneath: 1–2 line takeaway, e.g. *"The peak summer months are exactly when solar generates the most — that's the alignment that makes rooftop solar pay."*

**Walk-away.** "My bill isn't flat. It peaks in summer. That's also when sun is strongest. So I'm a candidate for solar."

**Data dependencies.** `engine.deriveBillArray(billPeak, billLow)` — already exists.

**Interaction.** Updates whenever bills change. No user input here — this is an *interpretation* of inputs.

**Replaces.** Currently the user has to scroll past the entire decision to see Fig. 1 (Monthly bill vs solar savings). Promote the *bill* part of that chart up here, alone, before any solar overlay.

**New work.** A small chart component (~120px tall on desktop, full-width-stacked on mobile). Reuses the bar-rendering code from Fig. 1.

---

### §3 — The recommended system

**Purpose.** Deliver the engine's pick — kW *and* system type — in one sentence. Let the user override.

**What the user sees.**
- Editorial kicker: `Our recommendation`
- Headline: *We recommend a **2 kW on-grid system** for your bill. It pays back in 2.6 years and cuts 89% of what you currently spend.*
- Below the sentence:
  - A row of three size-cards (`Smaller` / `Best IRR` ✦ / `Larger`) — picking one snaps the slider to that kW.
  - A continuous slider (1–10 kW) with the `RECOMMENDED` tick at the engine's pick. **The thumb defaults to the recommended kW**, not a hardcoded value.
  - A live one-liner: *"At 2 kW, you'd pay ₹X upfront and your bill would drop to ₹Y/mo."*

**Walk-away.** "The page picked 2 kW. I can change it if I want, and watch the trade-offs update live."

**Data dependencies.** `engine.pickOptimalSize(input)`, `engine.deriveSizingCards(input, discom)`, `engine.recommendSystemType(outageHoursPerDay)`.

**Interaction.**
- Drag slider → updates kW, ripples through §4, §6, §7, §8, §9.
- Click size-card → snaps slider, same effect.
- Cannot change system type here. That happens in §5.

**Replaces.** Current §6 ("How big & what it costs"). Strip the price box out — it goes to §6.

**Bug fix.** Right now: size-card pill says "2 kW Best IRR", slider tick is at 2 kW, but slider thumb defaults to 3 kW. After this rewrite, all three agree at the engine-recommended size.

---

### §4 — Why that size

**Purpose.** Justify §3's pick. Four numbers, each anchored to an assumption.

**What the user sees.**
- Editorial kicker: `Why 2 kW`
- Headline: *We sized to your bill, not your roof. Here's the math behind it.*
- A 2×2 or 4×1 rationale grid:
  - **₹28,759** — annual bill, derived from your peak/low inputs (with shape curve)
  - **Very high sun zone** — ~5.5 peak sun hours/day in your region
  - **TOPCon panels, no shading** — assumed default; override in Advanced
  - **₹60,000 subsidy at 2 kW** — central PM Surya Ghar slab
- Below: one short line on system type, e.g. *"Your grid is reliable, so on-grid wins. Hybrid only pays back if outages cost you money — see §5."*

**Walk-away.** "The recommendation isn't arbitrary. It's pegged to my bill, my sun zone, my subsidy slab. If any of those are wrong, I know where to override."

**Important note.** Rename the current "Roof solar potential 4,515 kWh" rationale. It's *causally inverted* — that figure is a downstream output of the kW choice, not an input to it. Replace with either the actual roof-area-derived cap (sqm × kWp/sqm) or with a clearer "Annual generation at 2 kW" framing.

**Data dependencies.** Already in `engine.compute()` output. Just needs relocation.

**Interaction.** Read-only.

**Replaces.** Currently the rationale grid is buried inside the headline (§7 in current numbering). Promote it to be its own section, immediately after the recommendation.

---

### §5 — The three system modes

**Purpose.** Pedagogy. Explain on-grid vs hybrid vs off-grid, and what each one trades. Let the user override the system-type recommendation here, after they've understood it.

**What the user sees.**
- Editorial kicker: `How it works`
- Headline: *Three ways to wire solar into your home. We picked **on-grid** — here's why, and what changes if you pick differently.*
- Three tabs (or three side-by-side cards on wide screens):
  - **On-grid** — recommended badge, schematic, 1-line how-it-works, trade-off line
  - **Hybrid** — same structure, with a note: *"Adds backup. Adds ₹X to system cost. Pays back only if your outages cost you ₹Y/yr."*
  - **Off-grid** — same structure, with a stronger advisory: *"Cuts the grid. Requires 2× battery. Only if grid extension is impractical."*
- Click a tab → recomputes the model, updates the headline in §3, ripples through §6–§9.

**Walk-away.** "I understand what each mode does. The page recommended on-grid for me. If I want backup, I see the cost — exactly ₹X more, payback Y years longer."

**Data dependencies.** `engine.recommendSystemType`, `engine.systemTypeAdvisory`, plus a per-system-type cost+payback delta.

**Interaction.** System-type override lives here.

**Replaces.** Current "05 · System Type" segment (currently inside the inputs band, before the user has any context for the choice). Move into §5 with full pedagogy.

**New work.** When the user hovers/focuses a non-default mode, surface the *delta* from the default, not just the absolute value (e.g. *"Hybrid: pays back in 11.4y instead of 3.4y — that's ₹6.7L lower 25-year gain"*).

---

### §6 — The finance

**Purpose.** Cash terms. What you write the cheque for, what the government pays, what's left.

**What the user sees.**
- Editorial kicker: `What it costs`
- Headline: *₹1,17,000 upfront after a ₹78,000 subsidy. ₹32,436 saved in year one.*
- A 4-row finance table:

```
Gross system cost (2 kW × ₹65,000)        ₹1,30,000
Central subsidy (PM Surya Ghar)           − ₹60,000
State subsidy (where applicable)              ₹0
─────────────────────────────────────────────────────
You pay (one-time)                         ₹70,000
Year-1 savings                             ₹22,755 / yr
```

- A small subsidy-slab visualization showing the kink at 3 kW (subsidy caps). Helps users who are about to size up to 5 kW understand they're at full cost above 3 kW.

**Walk-away.** "I write a cheque for ₹70k. The government pays ₹60k. I get ₹22,755 back in the first year. Subsidy doesn't grow above 3 kW."

**Data dependencies.** `engine.deriveCosts(input, discom)`. Already exists.

**Interaction.** Read-only.

**Replaces.** Current price box (currently glued to the sizing slider).

**New work.** The subsidy-slab visualization. Small horizontal bar with kinks at 1/2/3 kW slabs.

---

### §7 — How your bill changes

**Purpose.** The honest economics. This is the section that tells the spread story and the seasonal banking story. It's the heart of the rewrite.

**What the user sees.**

**Block 7a — The two rates.** A simple split:

```
What you SAVE (every kWh you self-consume):     ₹8.50 / kWh
What you EARN (every kWh you export to grid):   ₹3.25 / kWh   (APPC)
                                                ─────────────
Spread:                                         ₹5.25 / kWh
```

One line: *"The first kWh of solar replaces a kWh you'd buy at retail. The last kWh — when you've already covered your home's draw — gets exported and settled at the lower wholesale rate. That's why over-sizing costs you the spread."*

**Block 7b — Year 1 monthly chart.** Stacked bars per month (Jan–Dec):
- Bar segment 1: kWh self-consumed (high-value — valued at ₹8.50)
- Bar segment 2: kWh exported (low-value — valued at ₹3.25)
- Overlaid line: kWh imported (months when you fall short)

A second small line chart below: **monthly kWh bank balance** — the credit you've accumulated from past exports, drawn down in import-heavy months, swept at year-end.

Caption: *"In winter you generate more than you use. Those kWh go into a bank credit that you draw against in monsoon. Whatever's left at year-end settles at APPC — ₹X for you this year."*

**Block 7c — Reconciled summary.**

```
Bill avoided  (kWh self-consumed × retail)        ₹26,484 / yr   →  ₹2,207 / mo
Surplus paid out (year-end APPC sweep)            ₹  5,952 / yr   →  ₹  496 / mo equivalent
                                                  ──────────────
Total Year-1 value                                ₹32,436 / yr
```

This is the **only place** ₹/mo is presented, and it explicitly breaks down what's monthly cash (bill avoided) vs what's annual settlement (surplus payout, presented as "₹X/mo equivalent" not as cashflow).

**Walk-away.** "I save ₹26k/yr by not buying electricity I'd otherwise buy at retail. I earn an additional ₹6k/yr from exports — settled once a year at the lower rate. The total is ₹32k. The exports aren't 'monthly income' — they're a year-end cheque."

**Data dependencies.**
- Existing: `engine.deriveMonthlyGenerationYr1`, `engine.deriveMonthlySavingsYr1` (already handles annual + monthly settlement modes).
- **New:** Decomposed monthly output split into `selfConsumed_kWh`, `exported_kWh`, `imported_kWh`, `bankBalance_kWh` per month.
- **New:** Engine returns `bill_avoided_yr1` and `surplus_payout_yr1` separately.

**Interaction.** Read-only chart, but tooltips on hover should show the per-month split.

**Replaces.** The current worked-example panel + Fig. 1 + the various ₹/mo readouts scattered through the page. All of that lives here, in one place, told once.

**New engine work.** This is the biggest computational lift in the rewrite. Spec:

```
For each month m:
  gen_m         = monthlyGeneration[m]
  cons_m        = monthlyBill[m] / tariff       (kWh implied by bill)
  selfCons_m    = min(gen_m, cons_m)
  export_m      = max(0, gen_m - cons_m)
  importNeed_m  = max(0, cons_m - gen_m)

  // Bank dynamics (annual settlement):
  bankIn_m   = export_m
  bankOut_m  = min(bank_balance, importNeed_m)   // draw from bank first
  gridImport_m = importNeed_m - bankOut_m         // remainder bought at retail
  bank_balance += bankIn_m - bankOut_m

At year-end (December):
  surplusUnits  = bank_balance                   // anything left
  surplusValue  = surplusUnits × APPC            // settled at low rate
  bank_balance  = 0                              // resets

bill_avoided_yr1 = sum(selfConsumed_m × tariff_m + bankOut_m × tariff_m)
surplus_payout   = surplusValue
```

This is consistent with `LOGIC.md §17.1.6` and the existing `deriveMonthlySavingsYr1` annual-settlement branch — but exposes the monthly intermediates that the chart needs.

---

### §8 — Payback

**Purpose.** When does the cheque turn into free electricity?

**What the user sees.**
- Editorial kicker: `Payback`
- Headline: *Recovered in 2.6 years. After that: 22 years of free electricity, plus a ₹X annual surplus cheque.*
- A single chart: cumulative cashflow over 25 years. X-axis = year. Y-axis = ₹. Starts at −₹70,000 (the cheque), climbs each year, crosses zero at year 2.6, ends at +₹10.6 lakh.
- Visual emphasis on the breakeven crossing — a vertical marker, the year called out, the annual escalation +5%/yr noted.
- Below: IRR badge (`32% IRR over 25 years`) with a tooltip explaining how to read IRR.

**Walk-away.** "I'm under water for 2.6 years. After that, I'm in the black, and the ₹/yr keeps growing because tariffs escalate ~5%/yr. Total 25-year IRR is 32%."

**Data dependencies.** `engine.computePayback`, `engine.computeIRR`, `engine.deriveYearArray`. Already exists.

**Interaction.** Hover to see year-by-year cumulative.

**Replaces.** Currently scattered across the headline ("pays back in 3.4 years") and Fig. 2 (cumulative chart). Consolidate into one section that *only* tells the time-to-breakeven story.

---

### §9 — Opportunity cost

**Purpose.** The honest comparison: solar vs FD vs equity, on the same money, over the same horizon.

**What the user sees.**
- Editorial kicker: `Versus the alternatives`
- Headline: *Solar's ₹13.2 lakh net wealth beats passive equity by ₹10.5L and FD by ₹22.8L. Even after taxes.*
- A 4-row comparison table (the existing table, kept):

```
                                          25-yr net wealth
Solar (this system)                       ₹13.2 lakh    ← chosen
Equity (12% post-LTCG, less bills paid)    ₹2.7 lakh
FD (7% post-slab, less bills paid)        −₹9.6 lakh
```

- A short note: *"Apples-to-apples. Each alternative starts with the same ₹70k upfront, plus you keep paying ₹28,759/yr in bills under the alternatives. Net wealth = investment growth post-tax minus 25 years of bills."*
- Verdict line: `SOLAR WINS CLEARLY` (or context-dependent variant).

**Walk-away.** "If I put the ₹70k in equity, I'd end with ₹2.7L after paying 25 years of bills. Solar gets me ₹13.2L. The decision is solar."

**Data dependencies.** Already computed. Just relocate.

**Replaces.** The current `headline__compare` aside. Promote to its own section.

---

### §10 — Advanced

**Purpose.** Audit. The user (or their installer / spouse / accountant) wants to see assumptions and year-by-year cashflow.

**What the user sees.**
- Hidden behind a `<details>` toggle, kicker `Advanced`.
- When expanded:
  - System spec (panel tech, shading, kW override)
  - Financial assumptions (cost/kW, escalation %, alt return, horizon, net metering on/off)
  - Hybrid backup parameters (when applicable)
  - Year-by-year cashflow table with CSV export

**Walk-away.** Power users who want to interrogate the model can. Casual users never see it.

**Data dependencies.** Existing.

**Interaction.** All inputs here override defaults and recompute everything upstream.

**Replaces.** Current `<details class="advanced">`. Keep as-is structurally; just make sure it's the *only* place advanced inputs live.

---

## 4. The move-list

What relocates from the current build to the new structure.

| Currently at | Moves to | Notes |
|---|---|---|
| System-type segment (in inputs band) | §5 | And the engine picks the default; user no longer has to pick this upfront |
| System diagram (`#systemDiagram` in inputs band) | §5 | One copy lives in §5, replicated per tab |
| Worked example (`.sys-bill` in inputs band) | §7 | Heavily rewritten — see §7 spec |
| Sizing live-line `#kwLiveLine` | §3 | Stays with the slider |
| Price box `#sizingPrice` | §6 | Becomes its own section |
| Rationale grid `#rationaleGrid` | §4 | Promoted out of the headline |
| Headline sentence `#headlineSentence` | §3 | Becomes the recommendation sentence |
| Comparison panel `.headline__compare` | §9 | Promoted to its own section |
| Fig. 1 (`#monthlyChart`) | §2 (bill-only) + §7 (with solar overlay) | Split into two: bill-shape view and bill-change view |
| Fig. 2 (`#cumulativeChart`) | §8 | Becomes the payback chart |
| Advanced details | §10 | No move — just rename the kicker |

## 5. The cut list

Only information-flow cuts. Visual elements stay.

| Removed | Why |
|---|---|
| The "Worked Example" inside the inputs band | Belongs in §7, after sizing — not before it |
| Repeated ₹/mo readouts in §3 / §6 / live-line | Single home in §7 |
| The "% of bill cut" phrasing above 100% | Replaced by the spread split — self-consumed % + exported % |
| Fictional "effective rate ₹7.18/kWh" | Replaced by the two real rates side by side |
| The "Roof solar potential 4,515 kWh" rationale label | Causally inverted (output presented as cause); reframe as "Annual generation at 2 kW" |

## 6. New computations to add

These don't exist in the engine yet. Spec'd here for `LOGIC.md §17.x` follow-up.

### 6.1 Decomposed monthly output for §7

Currently `compute()` returns `savings.monthly[]` as a single ₹ array. We need:

```js
output.monthly = {
  generation_kWh: number[12],
  consumption_kWh: number[12],     // bill / tariff
  selfConsumed_kWh: number[12],
  exported_kWh: number[12],
  imported_kWh: number[12],         // gross need beyond gen
  bankDrawn_kWh: number[12],        // from credit bank, not new import
  gridImport_kWh: number[12],       // imported - bankDrawn
  bankBalance_kWh_eom: number[12],  // end-of-month bank balance
  bill_avoided_INR: number[12],     // selfConsumed × tariff + bankDrawn × tariff
  surplus_credit_kWh_yearend: number, // bankBalance at Dec
  surplus_payout_INR: number,         // × APPC
}
```

### 6.2 Recommended-system unified output

`compute()` should also return:

```js
output.recommendation = {
  kw: number,         // engine-picked
  system_type: 'OnGrid' | 'Hybrid' | 'OffGrid',
  reason_kw: string,  // one-line: "Sized to your annual bill, not your roof"
  reason_type: string // one-line: "Reliable grid → on-grid"
}
```

### 6.3 Per-system-type delta for §5

When rendering the three tabs, we need each tab to show the delta from the recommended type:

```js
output.system_options = [
  { type: 'OnGrid',  payback_yrs: 2.6, gain_25y_lakh: 13.2, delta_to_default: 0 },
  { type: 'Hybrid',  payback_yrs: 11.4, gain_25y_lakh:  6.5, delta_to_default: -6.7 },
  { type: 'OffGrid', payback_yrs:  -1, gain_25y_lakh: -2.0, delta_to_default: -15.2 },
]
```

## 7. Open questions for sign-off

1. **§2 chart simplicity.** Should the billing-pattern chart show ₹ (matches what the user typed) or kWh (matches generation)? Recommendation: ₹ here, kWh in §7. Two languages, one each.
2. **§5 mobile layout.** Three tabs side-by-side don't fit. Stacked accordion or horizontal scroll? Recommendation: stacked, with the recommended one expanded by default.
3. **§7 chart density.** Two charts (stacked-bar + bank line) is information-dense. Should the bank line be opt-in ("Show settlement detail")? Recommendation: keep both visible — the bank story is the point of the section.
4. **Headline sentence in §3 vs hero.** Currently the page has no hero. Should §3's recommendation sentence get hero treatment (large serif), or stay editorial like everything else? Recommendation: hero-sized in §3, editorial in §4–§9.
5. **State default.** Currently RJ-KEDL (Kota). Default to a populous DISCOM (DL/MH/KA), or require the user to pick before showing the recommendation? Recommendation: require pick — show §1 inputs, then a placeholder in §3 ("Pick your state to see your recommendation") until a state is chosen.

## 8. Sequencing the rewrite

Suggested implementation order (each step shippable on its own):

1. **Lock the engine outputs** — extend `compute()` per §6.1, §6.2, §6.3. Add tests in `_test.mjs`.
2. **Skeleton section reordering** — restructure `index.html` into the 10 sections with placeholder content. Verify nothing breaks; current visualizations land in the right new sections.
3. **§3 (recommendation)** — wire engine recommendation to slider default and headline sentence. Fix the 2-vs-3 kW contradiction.
4. **§4 (why)** — relocate rationale grid, fix the inverted "roof potential" wording.
5. **§5 (modes)** — relocate system-type to §5 with pedagogy and deltas.
6. **§6 (finance)** — relocate price box, add subsidy-slab kink visualization.
7. **§7 (bill change)** — biggest section. Build the spread split, monthly stacked-bar chart, and bank-balance line.
8. **§8 (payback)** — clean up Fig. 2 into a dedicated payback story.
9. **§9 (opportunity cost)** — relocate comparison.
10. **§2 (billing pattern)** — last, because it depends on §7's chart components being clean.
11. **Polish, mobile, copy editing.**

## 9. What this document is not

- Not a math spec. That's `LOGIC.md`.
- **Not a visual redesign.** The current UI — typography, palette, component shapes, chart styling, masthead lockup — is in scope to *preserve*, not to change. See §0.5.
- Not a code spec. Each section above is a brief; the engineering plan lives in PRs/commits.

This is the *narrative contract*. Once we agree on the order and what each section says, every other artifact (markup wiring, engine extensions) follows from it — without touching the visual language.
