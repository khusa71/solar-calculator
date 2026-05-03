# Solar Rooftop Calculator — Computation Logic Specification

> Source-of-truth for every calculation, lookup table, and decision branch in the calculator.
> Resolves ambiguities in the PRD before any code is written.
> Notation: `kw` = kilowatts (peak DC), `kWh` = kilowatt-hours (units), `₹` = INR.

---

## 0. Document conventions

- **Inputs** are user-supplied or auto-filled.
- **Constants** are hard-coded lookups (subsidy slabs, tariff rates, irradiance zones).
- **Derived** values are computed from inputs + constants.
- **Outputs** are what the UI displays.
- All money is in INR with 0 decimal places except per-unit tariffs (2 decimals).
- All percentages stored as decimals internally (e.g. 5% = 0.05).
- Year indexing: Year 1 = first full year after commissioning. Year 0 = installation moment (cashflow only).
- Month indexing: 1 = January … 12 = December. Seasonal classification is fixed; no per-user customization in v1.

---

## 1. Issues found in the PRD and resolutions

The PRD has six places where the math is ambiguous, double-counted, or under-specified. Each is resolved below; downstream sections use the resolved version.

### 1.1 The `0.92` blanket derating in PRD §4.3 partially overlaps with PRD §4.2

PRD §4.3 says `monthly_saving = MIN(bill, generation × tariff) × 0.92`, and the `0.92` "accounts for night consumption, cloudy days, inverter losses, and Year-1 system loss." But §4.2 already applies temperature and shading derating to generation. There are two problems:

1. **Cloudy days** are typically already baked into the `peak_sun_hours` value for a zone (that figure is an annual daily-average from NREL/MNRE-style irradiance data, not a clear-sky maximum). Multiplying again double-counts.
2. **Night consumption** is a *consumption-side* effect, not a generation-side one — it belongs in the savings model via self-consumption ratio, not in a generation derating.

**Resolution.** Break the lumped factor into explicit, attributable factors:

| Factor | Where applied | Default | Rationale |
|---|---|---|---|
| Inverter conversion efficiency | Generation | 0.97 | DC→AC, well-measured |
| Soiling + miscellaneous AC losses | Generation | 0.97 | Dust, wiring, mismatch |
| Annual degradation Year 1 | Generation | 0.99 in Y1, then -0.005/yr | Industry standard linear curve |
| Self-consumption ratio (no net metering) | Savings | 0.65 | Only daytime use displaces grid; nights need batteries |
| Self-consumption ratio (with net metering, default ON) | Savings | 1.00 | Banked credits cover night use |

The `peak_sun_hours` constant by zone (§3) is an annual daily-average that already includes cloudy-day losses, so we do **not** add a separate cloudy-day derating.

### 1.2 IRR: `net_cost` was never defined

PRD §4.5 references `net_cost` in the cashflow without defining it. Standard:

```
net_cost = gross_cost - central_subsidy - state_subsidy
```

For IRR, Year 0 is the only outflow. The PRD also notes elsewhere that the subsidy actually arrives 2–4 months *after* commissioning, which creates a working-capital gap. This matters for the user's experience but only marginally for IRR over 25 years (≤0.3% IRR delta). We document the cashflow gap as a UI note but use `net_cost` upfront in the IRR calculation.

### 1.3 System degradation was hidden inside the `0.92` factor

The PRD only models Year 1 degradation. Real panels degrade ~0.5%/year linearly after Year 1. This depresses long-term savings and IRR. We model it explicitly:

```
generation_yrN = generation_yr1 × (1 - 0.005 × (N - 1))     for N ≥ 1
```

Floor at 0.85× by Year 25 (most warranties guarantee ≥80–85% output at year 25).

### 1.4 Subsidy is stepwise but the PRD didn't specify intra-band behavior

PRD §4.1 only gives integer slabs. Actual PM Surya Ghar formula (post-Feb 2024 revision):

```
subsidy = ₹30,000 per kW for the first 2 kW
        + ₹18,000 per kW for the 3rd kW
        + ₹0 beyond 3 kW
        capped at ₹78,000 total
```

Closed form for any system size `s` (kW), including fractional:

```
band1 = MIN(s, 2) × 30,000
band2 = MAX(0, MIN(s, 3) - 2) × 18,000
subsidy = MIN(78,000, band1 + band2)
```

Worked check: 1.5 kW → 30000×1.5 = ₹45,000. 2.5 kW → 30000×2 + 18000×0.5 = ₹69,000. 3 kW → ₹78,000. 5 kW → ₹78,000.

### 1.5 Net metering rate of `tariff × 0.70` is optimistic for some states

Many DISCOMs settle surplus exported energy at Average Power Purchase Cost (APPC) which is ₹3.0–3.5/unit, far below the retail tariff of ₹7–10. Few states (notably Delhi for ≤10 kW residential) credit at full retail tariff under genuine net metering rules.

**Resolution.** Per-state `net_metering_rate_factor` lookup, default 0.50 for unspecified states. UI exposes it as an editable advanced field.

### 1.6 TOPCon vs Mono PERC temperature derating must be monthly, not annual

PRD §4.2 implies a single temp-loss number "at 65°C". But panels run hot in summer and cool in winter — the technology delta is real in May, near zero in January. We compute monthly average panel temperature from ambient + irradiance heuristic and apply per-month.

```
panel_temp_C(month, zone) ≈ ambient_temp_C(month, zone) + 25
loss_fraction = (panel_temp_C - 25) × coefficient
coefficient_TOPCon  = 0.0029 per °C
coefficient_MonoPERC = 0.0035 per °C
generation_factor = 1 - loss_fraction
```

Ambient temperature lookup is in §3.4.

---

## 2. Input model

All inputs, with defaults, ranges, and validation. The calculator runs end-to-end with defaults — every field has a sensible fallback.

### 2.1 Bill inputs (mandatory)

| Field | Type | Range | Default | Required |
|---|---|---|---|---|
| `bill_summer` | int | 500–15,000 | 3,500 | Yes |
| `bill_winter` | int | 200–2,000 | 400 | Yes |
| `bill_transition` | int (or "auto") | 200–10,000 | auto | No |
| `state` | enum | (see §3.1) | "Rajasthan-KEDL" | Yes |
| `tariff_per_unit` | decimal | 3.00–12.00 | by state | No (auto-fill) |

Auto-formula for transition bill (PRD §3.1):

```
bill_transition = 0.45 × bill_summer + 0.05 × bill_winter
```

User can override. Stored field is always the resolved number; "auto" is a UI mode that recomputes whenever summer/winter change.

### 2.2 System inputs

| Field | Type | Range | Default |
|---|---|---|---|
| `system_kw` | decimal | 1.0–10.0 step 0.5 | recommended (§6) |
| `panel_tech` | enum | TOPCon \| MonoPERC | TOPCon |
| `system_type` | enum | OnGrid \| Hybrid \| OffGrid | OnGrid |
| `roof_type` | enum | FlatRCC \| SlopedTiled \| Terrace | FlatRCC |
| `roof_area_sqft` | int (optional) | 50–10,000 | empty |
| `shading` | enum | None \| Partial \| Heavy | None |
| `phase` | enum | Single \| Three | Single |

V1 scope: only `OnGrid` is fully modeled. `Hybrid` adds a fixed battery cost (~₹35,000/kWh) but we do not model dispatch logic. `OffGrid` is documented as out-of-scope and the calculator shows a placeholder.

### 2.3 Financial inputs

| Field | Type | Range | Default |
|---|---|---|---|
| `cost_per_kw_gross` | int | 40,000–90,000 | 65,000 |
| `state_subsidy` | int | 0–50,000 | by state (§3.1, mostly 0) |
| `tariff_escalation` | decimal | 0.03–0.10 | 0.05 |
| `alt_return_rate` | decimal | 0.06–0.20 | 0.12 |
| `analysis_horizon_years` | enum | 10 \| 15 \| 25 | 25 |
| `net_metering_enabled` | bool | — | true |

Central subsidy (`central_subsidy`) is **always derived** (§4.1), never user-entered. The user can layer on `state_subsidy` separately.

### 2.4 Validation rules (warnings, never blocking)

| Condition | Message |
|---|---|
| `bill_summer < bill_winter` | "Unusual — summer bill is typically higher in India." |
| `system_kw × 80 > roof_area_sqft` (when area provided) | "System may not fit your roof — typical requirement 80 sq ft per kW." |
| `cost_per_kw_gross < 45,000` | "Below market floor — verify panel quality and warranty terms." |
| `cost_per_kw_gross > 85,000` | "Above market ceiling — get a second quote before signing." |
| `tariff_escalation > 0.08` | "Aggressive escalation assumption — results may overstate solar IRR." |
| `alt_return_rate > 0.18` | "High alternative return — solar appears less attractive vs reality." |
| `tariff_per_unit < 4` | "Low tariff makes solar payback longer — verify your bill." |

Warnings render inline next to the field, not as modals.

---

## 3. Constants & lookup tables

### 3.1 State / DISCOM table

Stored as an array of records. UI dropdown groups by state.

| key | state | discom | tariff_per_unit | extra_state_subsidy | net_metering_rate_factor |
|---|---|---|---|---|---|
| `RJ-KEDL` | Rajasthan | KEDL (Kota) | 8.50 | 0 | 0.50 |
| `RJ-JVVNL` | Rajasthan | JVVNL (Jaipur) | 8.00 | 0 | 0.50 |
| `RJ-AVVNL` | Rajasthan | AVVNL (Ajmer) | 8.00 | 0 | 0.50 |
| `MH-MSEDCL` | Maharashtra | MSEDCL | 10.00 | 0 | 0.45 |
| `KA-BESCOM` | Karnataka | BESCOM | 7.75 | 0 | 0.50 |
| `GJ-UGVCL` | Gujarat | UGVCL | 6.25 | 10,000 | 0.50 |
| `GJ-PGVCL` | Gujarat | PGVCL | 6.25 | 10,000 | 0.50 |
| `DL-BSES-R` | Delhi | BSES Rajdhani | 7.00 | 2,000/kW capped 10,000 | 1.00 |
| `DL-BSES-Y` | Delhi | BSES Yamuna | 7.00 | 2,000/kW capped 10,000 | 1.00 |
| `DL-NDPL` | Delhi | Tata Power Delhi | 6.50 | 2,000/kW capped 10,000 | 1.00 |
| `TN-TNEB` | Tamil Nadu | TNEB | 6.50 | 0 | 0.45 |
| `UP-UPPCL` | Uttar Pradesh | UPPCL | 7.00 | 0 | 0.45 |
| `TS-TSSPDCL` | Telangana | TSSPDCL | 7.00 | 0 | 0.45 |
| `KL-KSEB` | Kerala | KSEB | 6.50 | 0 | 0.50 |
| `WB-CESC` | West Bengal | CESC | 8.50 | 0 | 0.40 |
| `HR-DHBVN` | Haryana | DHBVN | 6.50 | 0 | 0.50 |
| `PB-PSPCL` | Punjab | PSPCL | 6.00 | 0 | 0.50 |
| `MP-MPPKVVCL` | Madhya Pradesh | MPPKVVCL | 7.00 | 0 | 0.50 |
| `BR-BSPHCL` | Bihar | BSPHCL | 6.50 | 0 | 0.45 |
| `OTHER` | Other | — | 7.00 | 0 | 0.45 |

Tariff is the residential slab rate at ~250 kWh/month consumption. Above 500 kWh many states have a higher slab — out of scope for v1; advanced users can override.

### 3.2 Irradiance zones (peak sun hours per day, annual average)

| Zone | Member states | peak_sun_hours |
|---|---|---|
| Very high | Rajasthan, Gujarat, Madhya Pradesh | 5.5 |
| High | UP, Bihar, Haryana, Punjab, Telangana | 5.0 |
| Moderate | Maharashtra, Karnataka, Andhra, Tamil Nadu, Odisha | 4.8 |
| Lower | Kerala, West Bengal, NE states, J&K, Himachal | 4.2 |

State→zone mapping is hard-coded with the DISCOM table (additional `zone` column not shown above for table compactness).

### 3.3 Seasonal generation factors (multiplier on `peak_sun_hours × days_in_month`)

| Months | Factor | Label |
|---|---|---|
| Mar, Apr, May, Sep, Oct | 0.95 | Shoulder/clear |
| Jun, Jul, Aug | 0.75 | Monsoon (cloud, rain) |
| Nov, Dec, Jan, Feb | 0.85 | Winter (low sun angle, short day) |

Note this is **inverted from the bill seasons.** Bills peak in summer due to AC use; *generation* peaks in spring/autumn because monsoon cuts mid-summer output and winter has shorter days. Bills and generation seasons must be tracked separately.

### 3.4 Average ambient temperature by month and zone (°C)

Used for monthly panel temperature in §1.6.

| Zone | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Very high (RJ/GJ/MP) | 16 | 20 | 26 | 33 | 38 | 39 | 33 | 31 | 31 | 28 | 22 | 17 |
| High | 16 | 19 | 25 | 31 | 35 | 33 | 30 | 29 | 29 | 26 | 21 | 17 |
| Moderate | 22 | 24 | 27 | 30 | 31 | 28 | 26 | 26 | 26 | 26 | 24 | 22 |
| Lower | 25 | 26 | 28 | 29 | 29 | 27 | 26 | 26 | 27 | 27 | 26 | 26 |

Panel temp ≈ ambient + 25°C (NOCT-style heuristic for roof-mounted modules in summer; lower offset in winter). Acceptable approximation for the savings calculator.

### 3.5 Bill-side seasonal classification (used to allocate user's seasonal bills to specific months)

| Months | Bill bucket |
|---|---|
| May, Jun, Jul, Aug | Summer |
| Mar, Apr, Sep, Oct | Transition |
| Nov, Dec, Jan, Feb | Winter |

So `monthly_bill[m]` = `bill_summer` for m ∈ {5,6,7,8}, etc.

### 3.6 Subsidy slab lookup (PM Surya Ghar)

Defined in §1.4. Reproduced as a function:

```
function central_subsidy(s_kw):
  band1 = min(s_kw, 2) × 30000
  band2 = max(0, min(s_kw, 3) - 2) × 18000
  return min(78000, band1 + band2)
```

### 3.7 Shading derating

| Setting | Factor |
|---|---|
| None | 1.00 |
| Partial | 0.88 |
| Heavy | 0.75 |

### 3.8 Roof type cost adder (₹/kW added to gross)

| Roof | Adder |
|---|---|
| FlatRCC | 0 |
| SlopedTiled | +3,000 |
| Terrace | 0 |

### 3.9 System type adder

| Type | Cost adder | Notes |
|---|---|---|
| OnGrid | 0 | Default |
| Hybrid | +35,000 per kW (battery) | Roughly 1 kWh battery per 1 kW solar |
| OffGrid | n/a | Out of scope v1 |

### 3.10 Provider scoring weights and rubric

Weights (from PRD §6.1, sum = 1.00):

```
{ panel_tech: 0.20, net_price: 0.20, panel_warranty: 0.15,
  inverter_warranty: 0.10, dcr: 0.15, turnkey: 0.10, local: 0.10 }
```

Per-criterion scoring (each yields 0–10):

| Criterion | Mapping |
|---|---|
| panel_tech | TOPCon=10, MonoPERC=7, Poly=4 |
| net_price | Linear normalization within shortlist: best=10, worst=0 |
| panel_warranty | ≥30y=10, 25y=8, 20y=6, <20y=4 |
| inverter_warranty | ≥10y=10, 7y=8, 5y=6, <5y=3 |
| dcr | Yes=10, Unknown=5, No=0 |
| turnkey | Full (install + subsidy)=10, Install only=6, Neither=0 |
| local | Stars 1–5 → score = stars × 2 |

Final composite = weighted sum, displayed 0–10 with one decimal.

---

## 4. Computation pipeline

This is the canonical order in which the calculator must compute things. UI updates re-run the entire pipeline (cheap; ~2 ms for 25 years of monthly data).

```
INPUTS  →  1. derive_bill_array()
        →  2. derive_subsidy()
        →  3. derive_net_cost()
        →  4. derive_monthly_generation_year1()
        →  5. derive_monthly_savings_year1()
        →  6. derive_year_array_25()
        →  7. derive_metrics()  [IRR, payback, totals]
        →  8. derive_alt_corpus_25()
        →  9. derive_sizing_recommendations()  [3 cards]
        → 10. score_providers()
        →  OUTPUTS
```

Each step is specified below.

### 4.1 `derive_bill_array()`

Returns 12-element array of monthly bills (₹).

```
for m in 1..12:
  if m in {5,6,7,8}:        bill[m] = bill_summer
  else if m in {3,4,9,10}:  bill[m] = bill_transition  // resolved value (auto or user)
  else:                     bill[m] = bill_winter
return bill
```

Annual bill = sum(bill[1..12]).

### 4.2 `derive_subsidy()`

```
central = central_subsidy(system_kw)        // §3.6
state   = state_subsidy_value(state_key, system_kw)   // §3.1, may be per-kW for Delhi
total_subsidy = central + state
```

Delhi's per-kW component caps at ₹10,000 total (e.g., 5 kW × 2,000 = 10,000, not 12,000).

### 4.3 `derive_net_cost()`

```
hardware_cost  = system_kw × cost_per_kw_gross
roof_adder     = system_kw × roof_type_adder       // §3.8
type_adder     = system_kw × system_type_adder     // §3.9
gross_cost     = hardware_cost + roof_adder + type_adder
net_cost       = gross_cost - total_subsidy
```

`net_cost` cannot go negative; floor at 0 with a warning if it does (would only happen for absurd subsidy overrides).

### 4.4 `derive_monthly_generation_year1()`

Returns 12-element array of generation in kWh.

```
zone_psh = peak_sun_hours_for(state_key)         // §3.2
shading_factor = shading_factor_for(shading)     // §3.7

for m in 1..12:
  days = days_in_month(m, year=non_leap)
  base = system_kw × zone_psh × days × seasonal_factor[m]   // §3.3

  panel_temp = ambient_temp[zone, m] + 25                   // §3.4
  temp_loss = max(0, (panel_temp - 25)) × tech_coefficient  // §1.6
  temp_factor = 1 - temp_loss

  inverter_factor = 0.97
  soiling_factor  = 0.97

  generation[m] = base × temp_factor × shading_factor × inverter_factor × soiling_factor

return generation
```

`tech_coefficient`: TOPCon = 0.0029, MonoPERC = 0.0035 (per °C above 25°C).

Sanity floor: panel_temp - 25 should never be negative (winter zones with ambient < 0°C); we guard by `max(0, ...)`.

### 4.5 `derive_monthly_savings_year1()`

```
self_cons = net_metering_enabled ? 1.00 : 0.65   // §1.1

for m in 1..12:
  consumption_units = bill[m] / tariff_per_unit
  generation_units  = generation[m]

  if net_metering_enabled:
    // Banked credits cover full generation up to consumption
    offset_units = min(generation_units, consumption_units)
    export_units = max(0, generation_units - consumption_units)
    savings[m]   = offset_units × tariff_per_unit
                 + export_units × tariff_per_unit × net_metering_rate_factor
  else:
    // Only daytime consumption gets offset
    daytime_consumption = consumption_units × self_cons
    savings[m]          = min(generation_units, daytime_consumption) × tariff_per_unit

  // Cap savings at the full bill (cannot save more than you spend)
  savings[m] = min(savings[m], bill[m])
return savings
```

Note we no longer apply the `0.92` blanket factor — the equivalent losses are now in §4.4 (inverter, soiling) and §4.6 (degradation).

### 4.6 `derive_year_array_25()`

For year N from 1 to `analysis_horizon_years`:

```
degradation_factor = 1 - 0.005 × (N - 1)
degradation_factor = max(degradation_factor, 0.85)   // floor at 85%

escalation_factor = (1 + tariff_escalation)^(N - 1)

savings_yrN = sum(savings_yr1[1..12]) × degradation_factor × escalation_factor
```

Cashflow array for IRR:

```
cashflows = [-net_cost, savings_yr1, savings_yr2, ..., savings_yrH]
```

### 4.7 `derive_metrics()`

**IRR.** Solve for `r` such that NPV(cashflows, r) = 0.

```
function NPV(cashflows, r):
  return sum( cashflows[t] / (1 + r)^t  for t = 0..H )

function IRR(cashflows):
  // Binary search on r ∈ [-0.99, 5.0]
  lo, hi = -0.99, 5.0
  for i in 1..100:
    mid = (lo + hi) / 2
    npv = NPV(cashflows, mid)
    if abs(npv) < 1: return mid
    if npv > 0: lo = mid else: hi = mid
  return mid
```

If all cashflows are non-positive, IRR is undefined — return null and UI shows "—".

**Simple payback.**

```
cumulative = -net_cost
for N in 1..H:
  cumulative += savings_yrN
  if cumulative >= 0:
    // Linear interpolation within year N
    overshoot = cumulative
    fraction_into_year = (savings_yrN - overshoot) / savings_yrN
    return (N - 1) + fraction_into_year
return null  // never breaks even within horizon
```

**Discounted payback** (advanced view, discount rate = 0.06): same algorithm but discount each savings before adding.

**Lifetime totals.**

```
total_savings = sum(savings_yr1..H)
net_gain      = total_savings - net_cost
```

**Year-1 metrics.**

```
year1_savings_pct = savings_yr1 / annual_bill
residual_annual_bill = annual_bill - savings_yr1
```

### 4.8 `derive_alt_corpus_25()`

```
for N in 1..H:
  alt_corpus[N] = net_cost × (1 + alt_return_rate)^N
```

Pre-tax. Note in the UI: LTCG of 12.5% applies to equity gains; solar savings are tax-free.

For overlay chart, also compute cumulative solar savings:

```
cum_savings[N] = sum(savings_yr1..N) - net_cost   // crosses 0 at payback
```

The chart plots `alt_corpus[N]` against `cum_savings[N] + net_cost` (cumulative gross savings) so both lines start from the same axis intercept.

### 4.9 `derive_sizing_recommendations()`

Three cards always shown.

```
annual_units = sum(bill[m] / tariff_per_unit  for m in 1..12)

// Annual generation per kW (for this user's zone, panel tech, shading)
ref_gen_per_kw = sum(generation_yr1 for system_kw=1) / 1   // run §4.4 with kw=1

// Recommended size = covers annual consumption, rounded up to 0.5 kW
recommended = ceil(annual_units / ref_gen_per_kw / 0.5) × 0.5
recommended = clamp(recommended, 1.0, 10.0)

// Three cards
card_below       = max(1.0, recommended - 0.5)
card_recommended = recommended
card_above       = min(10.0, recommended + 0.5)

// Special case: if recommended exceeds 3 kW, show subsidy-cap warning
if recommended > 3.0:
  flag = "Subsidy caps at ₹78,000 above 3 kW — per-kW economics weaken."
```

For each card, run the full pipeline at that size and surface:
- gross_cost, total_subsidy, net_cost
- year1_savings_pct (% of annual bill)
- payback_years
- roof_area_required = system_kw × 80 sq ft
- IRR (so user sees the diminishing-returns warning numerically when "above" has lower IRR)

### 4.10 `score_providers()`

Pre-loaded providers (PRD §6.2) plus user-added. Each provider record:

```
{
  name, panel_tech, gross_price_3kw, includes_install, handles_subsidy,
  dcr, panel_warranty_yrs, inverter_warranty_yrs, local_stars
}
```

Scale price to user's system size:

```
provider_gross = (gross_price_3kw / 3) × system_kw
provider_net   = provider_gross - total_subsidy
```

Score each criterion per §3.10. Compute composite. Sort by composite descending. Top row gets a green border.

For "compare 2–3" feature: compute delta to the top by:
- Net cost difference
- 25-year savings difference (re-running pipeline isn't necessary; only `net_cost` changes, savings_yr1..H stay the same as they depend on system spec, not provider price — but IRR and payback do change)

So the comparison view re-runs §4.7 with the alternative net_cost.

---

## 5. Worked example: Kota, Rajasthan, 3 kW

Sanity check the pipeline end-to-end with concrete numbers that match the PRD's reference case.

**Inputs:**
- `bill_summer` = 3,500
- `bill_winter` = 400
- `bill_transition` = auto = 0.45 × 3500 + 0.05 × 400 = 1,575 + 20 = **1,595**
- `state_key` = `RJ-KEDL` → tariff 8.50, zone "Very high" psh 5.5, NM factor 0.50
- `system_kw` = 3.0
- `panel_tech` = TOPCon
- `shading` = None
- `roof_type` = FlatRCC
- `cost_per_kw_gross` = 65,000
- `state_subsidy` = 0
- `tariff_escalation` = 0.05
- `alt_return_rate` = 0.12
- `analysis_horizon_years` = 25
- `net_metering_enabled` = true

**Step 1 — Bill array (₹/month):**

```
m:  1     2     3     4     5     6     7     8     9     10    11    12
₹:  400   400   1595  1595  3500  3500  3500  3500  1595  1595  400   400
```

Annual bill = 4×400 + 4×1595 + 4×3500 = 1,600 + 6,380 + 14,000 = **₹21,980**

**Step 2 — Subsidy:**

```
band1 = min(3, 2) × 30000 = 60,000
band2 = (3 - 2) × 18000 = 18,000
central = min(78000, 78000) = 78,000
state = 0
total_subsidy = 78,000
```

**Step 3 — Net cost:**

```
hardware = 3 × 65000 = 1,95,000
roof_adder = 0, type_adder = 0
gross = 1,95,000
net_cost = 1,95,000 - 78,000 = ₹1,17,000
```

**Step 4 — Monthly generation Year 1 (kWh):**

For each month, base = 3 × 5.5 × days × seasonal_factor. Then apply temp/shading/inverter/soiling.

Picking three months for illustration:

| Month | days | seasonal | base kWh | ambient °C | panel °C | temp_loss | factors product | generation kWh |
|---|---|---|---|---|---|---|---|---|
| Jan | 31 | 0.85 | 434.6 | 16 | 41 | 4.6% | 0.954 × 1 × 0.97 × 0.97 = 0.898 | **390** |
| May | 31 | 0.95 | 485.7 | 38 | 63 | 11.0% | 0.890 × 1 × 0.97 × 0.97 = 0.838 | **407** |
| Jul | 31 | 0.75 | 383.6 | 33 | 58 | 9.6% | 0.904 × 1 × 0.97 × 0.97 = 0.851 | **326** |

Annual generation Year 1 ≈ **4,650 kWh** (full month-by-month sum). Equates to ~1,550 kWh per kW per year, in line with industry expectation for Rajasthan.

**Step 5 — Monthly savings Year 1 (₹):**

For January: consumption_units = 400 / 8.50 = 47 units. Generation 390 units >> consumption → offset = 47 units, export = 343 units.

```
savings_jan = 47 × 8.50 + 343 × 8.50 × 0.50 = 400 + 1,458 = ₹1,858
cap at bill: min(1858, 400)? — NO, with net metering the export earns separately
```

Wait — re-read §4.5. The cap is `savings[m] = min(savings[m], bill[m])`. That's wrong if export credit can carry forward. **Refining the logic:** the cap applies only to *self-consumption offset*, not to export credit. Updated:

```
self_offset_value = min(offset_units × tariff, bill[m])
export_value      = export_units × tariff × net_metering_rate_factor
savings[m]        = self_offset_value + export_value
```

With this fix: savings_jan = min(47×8.50, 400) + 343×8.50×0.50 = 400 + 1,458 = **₹1,858**.

For May: consumption 412 units, generation 407 units → offset 407, export 0. Savings = min(407×8.50, 3500) + 0 = min(3460, 3500) = **₹3,460**.

For Jul: consumption 412, generation 326 → offset 326, export 0. Savings = min(326×8.50, 3500) + 0 = **₹2,771**.

Annual savings Year 1, summed across all 12 months ≈ **₹26,500–28,500** depending on exact values. This *exceeds* the annual bill of ₹21,980 because the user is exporting surplus (winter months) at a credit. UI must explain this clearly: "your bill goes to zero; the surplus credit on winter exports is what pushes savings above the original bill."

**The §4.5 fix above must be applied in code.** The PRD's `min(bill, gen × tariff)` was implicitly assuming no export, which doesn't hold when generation exceeds consumption seasonally — exactly the Rajasthan case.

**Step 6 — Year array (25 years, with 0.5%/yr degradation, 5% tariff escalation):**

Year 1 ≈ 27,000 (illustrative). Year 10 = 27,000 × (1 - 0.045) × 1.05^9 = 25,785 × 1.551 = ₹40,000. Year 25 = 27,000 × 0.85 × 1.05^24 = 22,950 × 3.225 = ₹74,000.

**Step 7 — Metrics:**

- Cumulative cashflows: -1,17,000, +27,000, +28,200, +29,440, … crossing zero around Year 4.5
- Simple payback ≈ **4.4 years**
- IRR (binary search): roughly **23–25%** for this specific input set. Far above FD (7%) and Nifty (12%).
- 25-year total savings ≈ ₹11–12 lakh
- 25-year net gain ≈ ₹10 lakh
- Alt corpus at 12% over 25 yrs from ₹1.17 lakh = 1.17 × 17 = **₹19.9 lakh** pre-tax → ~₹17.4 lakh post-LTCG
- Solar net gain ₹10 lakh tax-free vs alt ₹16.2 lakh post-tax: **alt wins on absolute corpus, but solar provides energy security and the gap narrows if tariff escalation > 5%.** This honest comparison is exactly what PRD §16.5 demands.

**Validation of the Kota case is the v1 acceptance test.** Any code change that moves these numbers by >5% must be reviewed against this section.

---

## 6. UI ↔ logic contract

What the UI hands to the engine, and what comes back. This is the API surface for the calculator module.

### 6.1 Engine input shape

```
{
  bills:    { summer: int, winter: int, transition: int|null },
  state:    { key: string, tariff_per_unit: decimal|null },
  system:   { kw: decimal, panel_tech: enum, system_type: enum,
              roof_type: enum, roof_area_sqft: int|null,
              shading: enum, phase: enum },
  finance:  { cost_per_kw_gross: int, state_subsidy_override: int|null,
              tariff_escalation: decimal, alt_return_rate: decimal,
              analysis_horizon_years: int, net_metering_enabled: bool }
}
```

`null` fields trigger auto-fill from defaults/lookups.

### 6.2 Engine output shape

```
{
  bills_resolved:     { summer, winter, transition, monthly_array[12], annual },
  costs:              { gross, central_subsidy, state_subsidy, total_subsidy, net },
  generation_yr1:     { monthly_kwh[12], annual_kwh },
  savings_yr1:        { monthly_inr[12], annual_inr, pct_of_bill, residual_bill },
  year_array:         [ { year, gen_kwh, savings_inr, cumulative_cashflow }, ... ],
  metrics:            { irr, payback_simple, payback_discounted, total_savings,
                        net_gain, fd_corpus, nifty_corpus, alt_corpus },
  sizing_cards:       [ {label, kw, net_cost, payback, irr, savings_pct, area_sqft}, x3 ],
  provider_scores:    [ {name, composite, criteria_breakdown, net_price, ...}, ... ],
  warnings:           [ { field, severity, message }, ... ]
}
```

### 6.3 Update semantics

- Any input change re-runs the entire pipeline. No partial updates in v1.
- Engine is a pure function — no I/O, no DOM, no state. Same input always produces same output.
- Engine should run in <5 ms on a mid-range mobile (no async, no workers needed).

---

## 7. Edge cases checklist

Every one of these must produce a sensible output, not an error.

| Case | Expected behavior |
|---|---|
| All bills = 0 | annual_bill = 0; savings = 0; payback = ∞ shown as "—"; IRR = null shown as "—" |
| `system_kw` < 1 | Subsidy still computes (band1 partial); no recommended sizing card "below" |
| `system_kw` > 3 | Subsidy capped at ₹78,000; sizing flag fires |
| `tariff_per_unit` = 0 | Reject input (validation error, not warning) |
| `bill_winter` > `bill_summer` | Warning fires, calc still runs |
| Generation > Consumption all months | Net metering ON: surplus credits push savings above bill, UI explains |
| Generation > Consumption all months, NM OFF | savings cap at bill, large unused generation flagged |
| State = "OTHER" | Uses default tariff 7.00, zone "Moderate", NM 0.45, no state subsidy |
| `analysis_horizon_years` = 10 | All arrays truncated; cards show 10-yr totals; IRR re-computed |
| `net_cost` = 0 (over-subsidy override) | IRR = ∞ → return null, UI shows "Free system" easter-egg note |
| Provider list empty after filter | Hide provider section, show inline message |
| Roof area entered, system doesn't fit | Show warning on size sliders, calc runs |
| Hybrid system selected | Apply ₹35,000/kW battery adder, dispatch logic ignored |
| Off-grid selected | Show "out of scope v1" notice, disable engine outputs |

---

## 8. What v1 does NOT compute

Documented to keep scope honest; can be added later.

- **Time-of-day tariffs (ToD).** Some DISCOMs have ToD slabs — peak-hour tariffs higher than off-peak. Solar generation aligns with peak tariff hours, so flat-tariff modeling actually understates savings in ToD states. Acceptable conservatism for v1.
- **Slab-based tariffs.** Big consumers (>500 kWh/month) hit higher slabs. v1 uses a single flat tariff per state.
- **Battery dispatch optimization** for hybrid systems.
- **Demand charges** (commercial/industrial only).
- **Monsoon disruption** beyond the 0.75 seasonal factor (some years are worse).
- **Insurance / theft** — not modeled.
- **Inverter replacement cost** at year 10–12. **This is significant** — a 3 kW inverter replacement costs ₹15,000–25,000. We should add a Year 12 negative cashflow of ₹20,000 in the IRR; defer to v1.1.
- **AMC costs** post-warranty (₹3,000–5,000/year from year 6). Minor, defer.

---

## 9. Open decisions before build

These need user input or a default — flagged for the build phase.

1. **Inverter replacement cashflow.** Include in v1 or defer? Inclusion reduces IRR by ~1.5–2 percentage points. The PRD ignores it; if we include we are stricter than the PRD. **Default: include with a toggle, default ON.**
2. **Default `net_metering_enabled`.** The PRD doesn't say. Most residential installs in 2026 are net-metered. **Default ON.**
3. **Should "alternative investment" comparison apply tax adjustment by default?** Showing pre-tax inflates the alt; showing post-tax favors solar. **Default: show both, let user pick which to plot.**
4. **Should sizing cards re-rank by IRR or by net savings?** PRD doesn't say. **Default: keep size order (below/recommended/above) but visually highlight the best IRR.**
5. **Persistence.** localStorage on or off by default? **Default ON, with "clear" button.**

---

## 10. Test cases for the engine

These should be implemented as unit tests once the engine is built. Each is a tuple (input, expected output, tolerance).

| # | Description | Input deltas from §5 case | Expected | Tolerance |
|---|---|---|---|---|
| 1 | Kota baseline (§5) | none | IRR ∈ [22%, 26%], payback ∈ [4.0, 5.0] yr, annual savings ∈ [25k, 30k] | ±5% |
| 2 | Subsidy cap at 3 kW | system_kw = 4 | total_subsidy = 78,000 (not 96,000) | exact |
| 3 | Subsidy interpolation 1.5 kW | system_kw = 1.5 | total_subsidy = 45,000 | exact |
| 4 | Subsidy 2.5 kW | system_kw = 2.5 | total_subsidy = 69,000 | exact |
| 5 | Net metering off, surplus winter | NM_enabled = false | annual savings drops 10–25% vs case 1 | ±10% |
| 6 | Mono PERC | panel_tech = MonoPERC | annual gen 3–5% lower than TOPCon (same kw) | sign + range |
| 7 | Heavy shading | shading = Heavy | annual gen drops ~25% from baseline | exact factor |
| 8 | Low-tariff state | state_key = GJ-UGVCL (₹6.25) | payback longer, IRR lower than case 1 | qualitative |
| 9 | High-tariff state | state_key = MH-MSEDCL (₹10.00) | payback shorter, IRR higher than case 1 | qualitative |
| 10 | Zero bills | all bills = 0 | annual savings = 0, IRR = null, payback = null | exact |
| 11 | Bill flip warning | summer = 400, winter = 3500 | warnings array contains "summer < winter" | presence |
| 12 | Above-market price warning | cost_per_kw_gross = 88,000 | warnings array contains "above market" | presence |
| 13 | Sizing recommender | annual consumption ≈ 4,000 kWh in Rajasthan | recommended ≈ 2.5–3.0 kW | range |
| 14 | Provider scoring | Waaree TOPCon vs generic Mono | Waaree composite higher | sign |
| 15 | Tariff escalation effect | escalation = 0.10 vs 0.05 | 25-yr total savings ~50–60% higher | range |

---

## 11. Glossary

- **DISCOM** — Distribution Company. The state utility that bills the residential customer (KEDL, BESCOM, MSEDCL, etc.).
- **DCR** — Domestic Content Requirement. PM Surya Ghar requires DCR-compliant panels (cells + modules made in India). Not all panels qualify.
- **PM Surya Ghar Muft Bijli Yojana** — Central government rooftop solar scheme launched Feb 2024. Subsidy slabs in §3.6.
- **Net metering** — Bidirectional metering where surplus exported energy earns a credit. Settlement formulas vary by state.
- **APPC** — Average Power Purchase Cost. Some states pay surplus exports at this lower rate instead of retail tariff.
- **TOPCon** — Tunnel Oxide Passivated Contact. Newer cell tech, ~22% efficient, lower temperature coefficient than Mono PERC.
- **Mono PERC** — Monocrystalline Passivated Emitter Rear Contact. Mainstream 2020–2024 tech, ~20% efficient.
- **NOCT** — Nominal Operating Cell Temperature. Standardized panel-temp-vs-ambient relationship.
- **IRR** — Internal Rate of Return. Discount rate at which NPV of all cashflows equals zero.
- **Peak sun hours (PSH)** — Daily-equivalent hours of 1000 W/m² irradiance. Annual average for a location, already includes typical cloud cover.

---

*Logic spec v1.0 · Resolves PRD ambiguities §1.1–§1.6 · Acceptance criterion: §5 worked example reproduces within ±5% in code.*

---

## 12. Decision-first information architecture

The PRD enumerates ~25 inputs and ~15 outputs. A homeowner doesn't want to fill 25 fields — they want to make three decisions:

1. **Should I install solar at all?** (yes/no with payback + lifetime gain)
2. **What size system?** (kW number with one-line justification)
3. **Which provider should I call?** (top 1–2 names from a ranked shortlist)

This section defines what the calculator **shows by default** vs **hides behind disclosure** — without removing any of the analytical depth in §1–§11.

### 12.1 The three required inputs (above the fold)

These three drive 80% of the answer. Everything else has a smart default.

| # | Input | Why it's required | Cannot be defaulted because |
|---|---|---|---|
| 1 | **Highest monthly bill last year** (slider, ₹500–15,000) | Drives system sizing and savings | Varies 5× across users; no national default works |
| 2 | **City** (autocomplete, falls back to state) | Drives tariff, sun hours, subsidy slab, DISCOM | Varies by state; rural/urban default would mislead |
| 3 | **Roof type** (3 buttons: Flat / Sloped / Terrace) | Affects cost adder and area calc | Visual choice, takes 2 seconds |

That's the entire required surface. The user hits no other field before seeing an answer.

### 12.2 Auto-fills (computed silently, viewable on demand)

All of these are derived from the three required inputs or use national-median defaults. Each must be **viewable and editable in the advanced panel**, but never shown initially.

| Auto-filled | Source | Default if no city |
|---|---|---|
| `bill_winter` | `bill_summer × 0.15` (AC-dominated assumption for tier-2 cities) | Same formula |
| `bill_transition` | Per §3.5 formula | Same |
| `tariff_per_unit` | DISCOM lookup (§3.1) | ₹7.00 |
| `peak_sun_hours` | Zone lookup (§3.2) | 5.0 |
| `state_subsidy` | DISCOM lookup | 0 |
| `system_kw` | Sizing recommender (§4.9) | — |
| `cost_per_kw_gross` | Market median ₹65,000 | Same |
| `panel_tech` | TOPCon | Same |
| `system_type` | OnGrid | Same |
| `shading` | None | Same |
| `tariff_escalation` | 0.05 | Same |
| `alt_return_rate` | 0.12 | Same |
| `analysis_horizon_years` | 25 | Same |
| `net_metering_enabled` | true | Same |

**Rule:** if the user changes a default in the advanced panel, surface a small "modified" badge so they remember they're off the standard model.

### 12.3 The headline output (the "decision" line)

A single sentence at the top, in larger type than anything else on the page. Template:

```
A {recommended_kw} kW system pays back in {payback_yrs} years and saves you
₹{net_gain_lakhs} lakh over {horizon} years — after the ₹{subsidy} government subsidy.
```

Example, Kota 3 kW: *"A 3 kW system pays back in 4.4 years and saves you ₹10 lakh over 25 years — after the ₹78,000 government subsidy."*

This sentence is what the user remembers. Everything else supports it.

### 12.4 The decision row (immediately below the headline)

Three cards, each resolving one of the three decisions in §12.

**Card A — Should I do this?**
- Headline number: **Payback in X years**
- Comparator: vs *"₹X lakh in FD over 25 years"* and *"₹X lakh in equity (post-tax LTCG)"*
- Verdict line: one of three statements, computed from IRR vs alt_return:
  - IRR > alt + 5% → *"Solar wins clearly. Better return than safe alternatives."*
  - IRR within ±5% of alt → *"Comparable to equity. Choose solar for inflation hedge + energy security."*
  - IRR < alt - 5% → *"Marginal. Solar makes sense if you'll live here >10 years; otherwise invest."*

**Card B — What size?**
- Three sub-options (small / recommended / large) per §4.9
- Recommended is highlighted; the other two show as smaller chips with their delta in payback and lifetime savings
- One-line justification: *"3 kW covers your current bill. 3.5 kW exports more in winter; 2.5 kW recovers your money 8 months sooner."*

**Card C — Which provider?**
- Top 2 from §4.10, ranked composite score
- For each: net price, panel tech, what to ask them (link to checklist)
- "Show all 6 providers" expand link

### 12.5 What goes below the decision row (analytical depth, on the same page)

Visible without expansion, but below the decision row — for the user who scrolls:

- **Monthly bill vs savings chart** (§7.1 of PRD). One image conveys the seasonal honesty.
- **25-year cumulative savings vs investment chart** (§7.2). Shows the breakeven crossover.
- **"Why we believe this"** strip — 4 short bullets:
  - Your annual bill: ₹X (sum of seasonal split, click to see)
  - Your roof's solar potential: X kWh/year (zone + tech + shading)
  - Government subsidy: ₹X (slab applied)
  - Net you pay: ₹X upfront, recovered by year X.X

### 12.6 The advanced panel (collapsed by default)

A single "Advanced settings" toggle reveals every other PRD input grouped into:

- **Bill detail** — override winter bill, transition bill, override tariff
- **System spec** — panel tech, roof area, shading, system type, phase
- **Financial assumptions** — cost/kW, escalation, alt return, horizon, net metering
- **Year-by-year table** — full 25-year breakdown, CSV download
- **Assumptions panel** — every constant used (§3 lookups), sourced

Edits here re-run the pipeline live. Modified values get a "modified" badge.

### 12.7 The vendor toolkit (separate tab or accordion)

Once the user is ready to act, surface the action-oriented modules from PRD §8 and §9:

- **Quote checklist** — interactive, ticks persist in localStorage
- **Email template generator** — pre-filled with their inputs
- **Red flags list** — the "walk away if" items from PRD §8

These don't belong on the calculation page; they belong on a "Now what?" page reached by a clear CTA.

### 12.8 What we deliberately do NOT show by default

| PRD asked for | Why hidden / removed from default view |
|---|---|
| Discounted payback | Most users don't know what discount rate means; show in advanced |
| Three-line FD/Nifty/custom comparison chart | Replaced with the verdict line in Card A |
| Year-by-year bar chart of all 25 years | Replaced with cumulative line + table in advanced |
| Per-criterion provider score breakdown | Show only composite + top criterion; full breakdown on hover |
| Roof area validation | Shown only if user enters roof area |
| WhatsApp share, PDF export | Action toolkit, not main page |

### 12.9 Mobile-first layout (since most users are on mobile)

Single column. Order top-to-bottom:

1. Three required inputs (sticky header that collapses on scroll)
2. Headline sentence
3. Card A (Should I) — full width
4. Card B (Size) — full width
5. Card C (Vendor) — full width
6. Monthly chart
7. Cumulative chart
8. "Why we believe this"
9. Advanced toggle
10. "Now what?" CTA → vendor toolkit

Desktop: two-column where the three required inputs stay visible on the left while results scroll on the right.

### 12.10 Interaction principle

- **First paint must show a valid result** even with the default bill, default city, default roof type. Never an empty state.
- **Every input change re-runs the entire pipeline in <50ms** and re-renders. No "Calculate" button.
- **Every number on screen must be traceable** to an assumption — clicking the number opens the assumption inline. This is non-negotiable for trust.

---

*v1.1 addendum: §12 added per design feedback. Logic in §1–§11 unchanged; this section governs presentation only.*

---

## 13. System type decision: on-grid vs hybrid vs off-grid

The PRD treated `system_type` as a single dropdown with on-grid as the only fully-modeled option. But choosing a type **is** a decision the user has to make — and it changes capex by 2–8× and IRR by 10–20 percentage points. This section gives the three types first-class treatment.

### 13.1 What each type is, in one line

| Type | Plain-English | Grid required? | Battery? | Subsidy eligible? |
|---|---|---|---|---|
| **On-grid** | Solar feeds the grid; you draw from grid at night and during outages (lights go off when grid does). | Yes | No | Yes — full PM Surya Ghar |
| **Hybrid** | Solar + battery + grid. Battery covers night use and outages; surplus still net-metered. | Yes | Yes | Yes — solar portion only, battery NOT subsidized |
| **Off-grid** | Solar + battery only. No grid connection (or actively disconnected). Generator backup typical for monsoon. | No | Yes (large) | **No — PM Surya Ghar excludes off-grid systems** |

The subsidy point is the most under-communicated fact in the Indian solar market. Off-grid gives up ₹78,000 of free money; the calculator must surface this.

### 13.2 New required input: grid reliability

To recommend a system type, we need one more required input.

| Field | Type | Default | Drives |
|---|---|---|---|
| `grid_reliability` | enum: Reliable \| Patchy \| NoGrid | Reliable | System-type recommendation; outage-value calc |

Definitions shown in the UI (so the user picks correctly):

- **Reliable** — urban metro, fewer than 5 outages/month, most under 1 hour. Backup is a nice-to-have, not a need.
- **Patchy** — semi-urban or rural. Outages weekly or daily, sometimes multi-hour. You already own a UPS or have considered an inverter battery.
- **No grid** — no electricity connection at the property, or you actively want to disconnect (farm, remote home, off-grid lifestyle).

This is the 4th and last required input (alongside bill, city, roof type from §12.1).

### 13.3 Decision rule — which type to recommend

```
function recommend_type(grid_reliability, bill_summer):
  if grid_reliability == "NoGrid":          return "OffGrid"
  if grid_reliability == "Patchy":          return "Hybrid"
  if grid_reliability == "Reliable":        return "OnGrid"
```

Override always available. The recommendation is a default selection in a 3-button toggle, never a forced choice.

When the user overrides:
- Picking **Hybrid** when grid is Reliable → show note: *"You're paying ₹X extra for backup you may not need. The financial-only choice is on-grid."*
- Picking **OnGrid** when grid is Patchy → show note: *"You'll lose power during outages. Consider hybrid if you have critical loads."*
- Picking **OffGrid** when grid is available → show note: *"You give up the ₹78,000 subsidy and pay ~3× more upfront. Pick this only for genuine off-grid use."*

### 13.4 Cost model per type

Replaces the simplified §4.3.

**Common base** (applies to all three):

```
solar_hardware = system_kw × cost_per_kw_gross   // default ₹65,000/kW
roof_adder     = system_kw × roof_type_adder     // §3.8
```

**On-grid:**

```
inverter_premium = 0                              // string inverter included in base
battery_cost     = 0
total_hardware   = solar_hardware + roof_adder
subsidy_eligible = solar_hardware                 // full
```

**Hybrid:**

```
battery_kwh      = system_kw × battery_size_factor   // default factor = 1.0 kWh per kW solar
battery_cost     = battery_kwh × battery_cost_per_kwh   // default ₹35,000/kWh (Li-ion LFP, 2026)
inverter_premium = system_kw × ₹5,000             // hybrid inverter costs more than string
total_hardware   = solar_hardware + roof_adder + battery_cost + inverter_premium
subsidy_eligible = solar_hardware                 // battery NOT eligible
```

**Off-grid:**

```
// Battery sizing is consumption-driven, not solar-driven, since you need autonomy
annual_consumption_kwh = annual_bill / tariff_per_unit
daily_consumption_kwh  = annual_consumption_kwh / 365
usable_battery_kwh     = daily_consumption_kwh × autonomy_days   // default autonomy_days = 2
nominal_battery_kwh    = usable_battery_kwh / 0.70                // 70% depth-of-discharge for LFP

battery_cost     = nominal_battery_kwh × ₹35,000
inverter_premium = system_kw × ₹15,000           // off-grid inverter + charge controller stack
total_hardware   = solar_hardware + roof_adder + battery_cost + inverter_premium
subsidy_eligible = 0                              // PM Surya Ghar excludes off-grid
```

**Net cost** (all types):

```
gross_cost      = total_hardware
central_subsidy = central_subsidy(system_kw) if subsidy_eligible > 0 else 0
state_subsidy   = state_subsidy_value(...)        if subsidy_eligible > 0 else 0
net_cost        = gross_cost - central_subsidy - state_subsidy
```

### 13.5 Battery sizing rules

**Hybrid (default 1 kWh per kW solar)** — sized for evening peak load coverage, not full night autonomy. Rationale: in a hybrid system, the grid is still there at night for any uncovered load. The battery's job is to (a) cover the post-sunset evening peak (cooking, TV, lights) and (b) provide outage backup. 1 kWh per kW of solar is the industry rule of thumb.

User can override `battery_size_factor` in advanced (range 0.5–3.0).

**Off-grid (consumption-driven)** — sized for `autonomy_days` of full consumption with no sun. Default 2 days covers typical monsoon clouds; 3 days is recommended for sites without generator backup.

User can override `autonomy_days` (range 1–5).

Both types use **LFP (lithium iron phosphate)** as the chemistry default — current 2026 standard for residential storage. Lead-acid (cheaper, ~₹15,000/kWh, but 5-year life) is documented as an alternative in the assumptions panel; not modeled in v1.

### 13.6 Battery degradation and replacement cashflow

LFP batteries lose ~2.5% capacity per year. By Year 10, capacity is ~80% — the standard replacement trigger.

**Year 10 replacement cashflow** (hybrid + off-grid only):

```
replacement_year   = 10
future_cost_per_kwh = battery_cost_per_kwh × (1 - 0.04)^10    // assume 4%/yr cost decline
                                                                // ₹35,000 → ~₹23,300 by Year 10
replacement_cost    = nominal_battery_kwh × future_cost_per_kwh
```

This becomes a **negative cashflow at Year 10** in the IRR array:

```
cashflows[10] += savings_yr10 - replacement_cost
```

For the §5 Kota case extended to hybrid (3 kWh battery): replacement_cost ≈ 3 × ₹23,300 = **₹70,000 at year 10**. Knocks IRR by 2–3 percentage points vs ignoring it.

Solar panel replacement: **not modeled.** Panel warranties run 25 years and most last 30+; the analysis horizon ends before failure. Inverter replacement at Year 12 (~₹20,000 for a 3 kW string inverter) is in scope per §8 of LOGIC.md but applies to all three types.

### 13.7 Savings model differences

The §4.5 savings logic was on-grid-specific. Here's the full picture:

**On-grid savings:**

```
// Per §4.5 with net_metering_enabled = true
// Day surplus exported to grid, night drawn from grid at retail tariff
monthly_savings = bill_offset + export_credit
outage_value    = 0                              // no backup
```

**Hybrid savings:**

```
// Same bill_offset and export_credit as on-grid (battery doesn't change net-meter math
// because the meter measures net flow at the boundary, regardless of battery use behind it)
monthly_savings = bill_offset + export_credit + outage_value

outage_value (annual):
  = outage_hours_per_year × critical_load_kw × tariff_per_unit × outage_premium_factor
  
defaults:
  outage_hours_per_year:
    Reliable:  10
    Patchy:    150
    NoGrid:    n/a (no grid to outage)
  critical_load_kw     = 0.5  (lights, fan, fridge, router — what backup actually powers)
  outage_premium_factor = 2.0  (people value uninterrupted power at ~2× the tariff cost)
```

The outage_value is small (₹1,500–3,000/yr in Patchy; ₹100–200/yr in Reliable) but real. It's documented as a separate line so the user sees what they're paying battery premium for.

**Off-grid savings:**

The framing changes — there's no bill to save against. Three reframes:

```
// Reframe 1: bill avoided (if you would have had a grid connection)
hypothetical_bill_avoided = annual_bill          // entire bill
                                                  // assumes the user would otherwise have grid

// Reframe 2: vs diesel generator (common rural alternative)
diesel_kwh_cost = ₹25                            // ₹/kWh delivered (fuel + maintenance)
diesel_baseline_savings = annual_consumption_kwh × diesel_kwh_cost

// Reframe 3: vs no power (intangible — flagged but not monetized)
```

The off-grid card uses the higher of (1) and (2) as the comparison baseline, and shows both. If the user picked off-grid because there's genuinely no grid available and no diesel generator, IRR is undefined and we surface "Off-grid here is not a financial choice — it's an enablement choice."

**Curtailment for hybrid/off-grid.** When generation exceeds (consumption + battery space), the excess is wasted in off-grid (curtailed) and exported in hybrid (still earns net-meter credit). This makes off-grid systems generate less *useful* energy than their nameplate suggests:

```
// Off-grid only
useful_generation[m] = min(generation[m], consumption[m] + max_battery_charge_per_month)
                     ≈ generation[m] × utilization_factor
utilization_factor   = 0.75 to 0.90 depending on consumption-to-generation ratio
```

For v1 we use a flat 0.85 utilization factor for off-grid generation in the savings calc, with a note that this is a simplification.

### 13.8 Subsidy applicability — the costly difference

Repeated for emphasis because it's the single biggest economic factor:

| Type | Central subsidy (PM Surya Ghar) | State subsidy |
|---|---|---|
| On-grid | Full per §3.6, up to ₹78,000 | Per §3.1 |
| Hybrid | Full on solar portion (battery excluded) | Per §3.1 (also solar only) |
| Off-grid | **Zero** | Zero (most state schemes mirror central eligibility) |

For the Kota 3 kW case: on-grid and hybrid both get ₹78,000. Off-grid gets ₹0. That's a 40% capex difference on the solar portion alone.

### 13.9 IRR comparison across types — Kota 3 kW worked example

Extending the §5 case to all three types:

| Metric | On-grid | Hybrid (3 kWh battery) | Off-grid (8 kWh battery) |
|---|---|---|---|
| Solar hardware | ₹1,95,000 | ₹1,95,000 | ₹1,95,000 |
| Battery cost | 0 | ₹1,05,000 | ₹2,80,000 |
| Inverter premium | 0 | ₹15,000 | ₹45,000 |
| Gross cost | ₹1,95,000 | ₹3,15,000 | ₹5,20,000 |
| Subsidy | ₹78,000 | ₹78,000 | ₹0 |
| **Net cost** | **₹1,17,000** | **₹2,37,000** | **₹5,20,000** |
| Year 1 savings | ~₹27,000 | ~₹27,500 (incl. ₹500 outage value, Reliable grid) | ~₹21,980 (bill avoided) |
| Battery replacement Y10 | 0 | -₹70,000 | -₹1,87,000 |
| **Simple payback** | **4.4 yr** | **8.6 yr** | **24+ yr (effectively never)** |
| **IRR (25 yr)** | **~24%** | **~10%** | **~2%** |
| 25-yr net gain | ₹10,00,000 | ₹4,80,000 | -₹50,000 (loss) |
| Beats FD (7%)? | Yes, by miles | Yes, marginally | No |
| Beats Nifty (12% post-tax ~10.5%)? | Yes | Marginal | No |

For Patchy grid (150 outage hours/yr instead of 10), the hybrid Year-1 savings rises to ~₹29,500 → IRR moves to ~12%. Still well below on-grid.

**The financial verdict is unambiguous: on-grid > hybrid > off-grid.** Off-grid is never a financial choice. Hybrid is a backup-value choice — the user is paying ~₹1.2 lakh extra to get backup for outages.

### 13.10 How the calculator presents the type decision

Replaces and extends §12.4's Card A.

When the user lands on the page (default: Reliable grid → On-grid recommended), the page shows a single headline + decision row as in §12. But the **type toggle** is prominent — three large buttons above the headline:

```
[ ☀ On-grid ]   [ ☀+🔋 Hybrid ]   [ 🔋 Off-grid ]
   recommended      backup          enablement
```

Clicking any of the three re-runs the entire pipeline at that type. The headline sentence updates. The cards update.

A **"Compare all 3"** link opens a 3-column comparison table — this is the one place where the full §13.9 table is shown with a one-line interpretation per row:

> "Hybrid costs ₹1.2 lakh more than on-grid for backup worth ~₹500/year in your area. Choose hybrid for peace of mind, on-grid for return."
>
> "Off-grid loses the ₹78,000 subsidy and adds a ₹2.8 lakh battery. Pick off-grid only if you genuinely have no grid."

These interpretive lines are computed, not static. For Patchy grid, the hybrid line changes to: *"Hybrid costs ₹1.2 lakh more for backup worth ₹3,000/year — payback on the battery alone is 35 years. Still worth it for outage tolerance."*

### 13.11 Decision summary by user persona

| If you are… | Recommended | Why |
|---|---|---|
| Urban homeowner, reliable grid, financial-first | On-grid | Best IRR, lowest capex, no battery to replace |
| Urban homeowner, frequent outages, has medical/work-from-home critical load | Hybrid | Outage tolerance + still-good IRR |
| Apartment owner, no roof control | None of the above (out of scope for residential rooftop calc) | Consider community/group solar |
| Rural homeowner with grid | On-grid (or Hybrid if outages frequent) | Subsidy makes it worth it |
| Rural site with no grid available | Off-grid | The only option. Frame as enablement, not investment |
| Farmer with diesel pump | Off-grid for pump + hybrid for home | Out of scope v1 (ag pumps have separate subsidy scheme — Kusum) |
| Wants energy independence ideologically | Off-grid (or hybrid with batteries) | Honest pricing — solar is not free |

### 13.12 What changes in §1–§12 because of §13

- **§2.2** — `system_type` is no longer "OnGrid only fully modeled." All three are first-class.
- **§4.3** — `derive_net_cost()` updates to the type-conditional cost model in §13.4.
- **§4.5** — `derive_monthly_savings_year1()` adds the outage_value term for Hybrid; for Off-grid, switches to bill-avoided framing with utilization_factor.
- **§4.7** — `derive_metrics()` adds the Year 10 battery replacement cashflow for Hybrid and Off-grid.
- **§4.9** — `derive_sizing_recommendations()` runs at the currently-selected type, not just on-grid.
- **§7** — edge cases gain: "Hybrid recommended but user has Reliable grid" → show advisory note. "Off-grid selected with bill > 0" → confirm user understands no subsidy.
- **§9** — open decision #1 (inverter replacement Y12) now interacts with battery replacement Y10 — keep both as separate cashflow items, on by default for their respective types.
- **§10** — add 3 new test cases: hybrid Kota (IRR in [9%, 13%]), off-grid Kota (IRR in [-2%, 5%]), hybrid Patchy grid (outage_value > 0).
- **§12.1** — add `grid_reliability` as required input #4. The required surface is now: bill, city, roof type, grid reliability.

### 13.13 What we still don't model in v1

- **Backup-only mode for hybrid** (battery charges from grid, not just solar) — relevant for ToD-tariff arbitrage, niche.
- **Generator integration** for off-grid — assumed user adds generator separately if needed.
- **Battery dispatch optimization** — we assume battery charges during day, discharges in evening peak. No load-shifting, no grid-arbitrage logic.
- **Multi-string MPPT** for partial shading — assumed accounted for in `shading` derating.
- **Three-phase solar** — phase setting affects inverter sizing but not energy math at residential scale.

---

*v1.2 addendum: §13 added per design feedback ("decision is also important for system type"). Resolves the on-grid/hybrid/off-grid scope gap. Acceptance criterion expands: §13.9 table reproduces within ±10% in code.*

---

## 14. Outage modeling — proper physics

§13.7 used a flat `outage_hours_per_year` of 10/150 with a constant 0.5 kW critical load and a 2× premium. That's a placeholder, not a model. For Indian tier-2/tier-3 cities where 2–3 hour daily outages are normal (≈1,000 hours/year, not 150), the placeholder undervalues backup by ~7×. And the placeholder also missed the **capacity utilization** cap: during an outage, you can't run AC, geyser, or washing machine on a residential battery — only critical loads. Real-delivered backup energy is ~40–60% of what you'd consume normally.

This section replaces §13.7's outage math with a six-factor model that the user can reason about.

### 14.1 The six factors that govern outage economics

| Factor | What it is | Default | Why it matters |
|---|---|---|---|
| **Outage frequency** | Hours per day of grid outage, annualized | 0 (Reliable) | Drives both backup value and battery cycling |
| **Outage timing** | When during the day outages occur | 6–9 PM | Determines whether solar or battery covers it |
| **Capacity utilization** | Ratio of backed-up consumption to normal consumption during the outage | 0.50 | Battery can only run critical loads, not whole house |
| **Backup duration limit** | How many hours the battery can sustain before depleting | derived | A 3 kWh battery at 0.5 kW lasts 5–6 hrs; longer outages truncate value |
| **Round-trip efficiency** | Battery charge→discharge loss | 0.92 (LFP) | 1 kWh stored becomes ~0.92 kWh delivered |
| **Outage premium** | How much more users value "having power" vs the underlying kWh cost | 2.0× | Empirical — people pay 2× tariff for guaranteed power (UPS, inverter market evidence) |

All six are exposed in advanced; only the first two have meaningful defaults that need user override in the typical case.

### 14.2 Replacing `grid_reliability` with `outage_hours_per_day`

The 3-bucket enum from §13.2 is too coarse. A slider with labeled stops is more honest:

| Slider stop | Hours/day | Annual hours | Persona |
|---|---|---|---|
| Reliable | 0.0 | 0 | Urban metro, premium DISCOM zones |
| Occasional | 0.25 | ~90 | Most South Indian metros, planned maintenance only |
| Frequent | 1.0 | 365 | Most tier-2 cities, evening load-shedding |
| Patchy | 2.5 | 913 | Tier-3 cities, semi-urban, monsoon months |
| Severe | 5.0 | 1,825 | Rural, festival-season grid stress, infrastructure-poor districts |
| No grid | — | — | Off-grid (separate flow per §13) |

UI: slider with these 5 named stops + free-form numeric override.

Default selection follows from city/DISCOM lookup where data is available; falls back to "Frequent" (1 hr/day) for unknown locations because that's roughly the national tier-2 median and erring high serves the user better (overestimating grid quality leads to underspecced backup).

### 14.3 Outage timing

When during the day outages occur changes everything:

| Pattern | Probability of solar covering | Backup demand | Common in |
|---|---|---|---|
| **Evening peak (6–9 PM)** | 0% (sun is down) | Highest — full battery discharge | Load-shedding zones, most of India |
| **Daytime (10 AM–4 PM)** | 70%+ — solar runs even without grid (hybrid only) | Battery may not even be touched | Industrial-belt residential areas, infrastructure repair |
| **Night (10 PM–6 AM)** | 0% | Lower (only fridge + fans) | Storms, transformer failures |
| **Random / mixed** | ~30% | Variable | Most realistic; sum of the above weighted |

Default `outage_timing = Evening peak` because it's the dominant Indian pattern and the worst case for backup value (you can't credit solar coverage). Power user can change to any of the four patterns.

### 14.4 Capacity utilization — the 50% rule

**This is the single biggest correction to §13.7.**

When the grid fails, the user's normal load profile is impossible to maintain. A 3 kWh battery cannot run a 1.5 kW AC + 2 kW geyser + 1 kW washing machine simultaneously, nor for very long. What actually runs is the **critical load circuit**: lights, fans, fridge, router, TV, phone chargers — typically 0.4–0.7 kW continuous.

```
normal_consumption_during_outage_kwh  = avg_household_load_kw × outage_hours
backed_up_consumption_kwh             = critical_load_kw × outage_hours

utilization_factor = backed_up_consumption_kwh / normal_consumption_during_outage_kwh
                   ≈ 0.40 to 0.60 for typical Indian household
                   default: 0.50
```

The remaining 40–60% is **deferred consumption** (you run the washing machine after the grid returns) or **lost service** (you sweated through 3 hours without AC). Neither shows up as a kWh savings.

**Implication for outage value:** we credit only the backed-up portion, not the full hypothetical bill displaced.

### 14.5 Backup duration limit

If the outage lasts longer than the battery can sustain, the value caps:

```
battery_hours_available = (battery_kwh × usable_dod × roundtrip_eff) / critical_load_kw

  for hybrid 3 kWh, LFP, 0.5 kW critical load:
    = (3 × 0.80 × 0.92) / 0.5
    = 4.4 hours

if outage_duration ≤ battery_hours_available:
    delivered_kwh = critical_load_kw × outage_duration
else:
    delivered_kwh = critical_load_kw × battery_hours_available
    unmet_hours   = outage_duration - battery_hours_available    // truncation cost
```

For 2.5 hr/day outages with a 3 kWh battery and 0.5 kW critical load: 4.4 hrs > 2.5 hrs → no truncation, full coverage.

For 5 hr/day outages: truncation kicks in → 0.6 hrs/day are uncovered. Significant for the "Severe" persona.

If outages are long (5+ hrs daily), battery sizing must increase — see §14.7.

### 14.6 Round-trip efficiency (and why we care)

LFP batteries deliver about 92% of charged energy. The remaining 8% is lost as heat in charging + discharging.

For sizing: to deliver 1.5 kWh during an outage, battery must have stored 1.5 / 0.92 = **1.63 kWh**. So a "3 kWh battery" effectively delivers ~2.4 kWh per cycle (3 × 0.80 DoD × 0.92 RTE).

For yearly losses: a battery that cycles fully every day loses 1.5 kWh × 365 × 0.08 / 0.92 ≈ **48 kWh/year** to round-trip. At ₹8.50/unit that's **₹408/year** in efficiency drag. Small but cumulative — included for honesty.

### 14.7 Battery sizing must consider outage support, not just evening peak

§13.5 sized hybrid batteries at 1 kWh per kW solar (evening-peak rule). For high-outage zones, this is undersized.

**Outage-driven sizing:**

```
outage_kwh_required = critical_load_kw × max_expected_outage_hours / 0.92
nominal_kwh_required = outage_kwh_required / 0.80   // 80% DoD limit

for daily 3-hr evening outage in Kota:
  outage_kwh = 0.5 × 3 / 0.92 = 1.63 kWh
  nominal_kwh = 1.63 / 0.80 = 2.04 kWh
  → 2 kWh battery is enough

for daily 5-hr outage:
  outage_kwh = 0.5 × 5 / 0.92 = 2.72 kWh
  nominal_kwh = 2.72 / 0.80 = 3.40 kWh
  → 3.5 kWh battery needed
```

**Combined sizing rule (the rule that actually goes into the calculator):**

```
battery_kwh = max(
  system_kw × 1.0,                                    // evening peak rule from §13.5
  critical_load_kw × outage_hours_per_day × 1.5 / 0.92 // outage rule with 1.5x reserve
)
rounded up to nearest 0.5 kWh
```

For Kota Reliable: max(3.0, 0.5 × 0 × 1.5 / 0.92) = 3.0 kWh
For Kota Patchy 2.5 hr: max(3.0, 0.5 × 2.5 × 1.5 / 0.92) = max(3.0, 2.04) = 3.0 kWh
For Kota Severe 5 hr: max(3.0, 0.5 × 5 × 1.5 / 0.92) = max(3.0, 4.08) = 4.5 kWh ← outage rule wins

So in moderate-outage zones, the evening-peak rule still dominates. In severe-outage zones, sizing scales up.

### 14.8 Outage value — the corrected formula

Replaces §13.7's outage_value:

```
function annual_outage_value():
  // 1. How much energy actually gets backed up?
  daily_outage_hrs    = outage_hours_per_day
  truncated_hrs       = min(daily_outage_hrs, battery_hours_available)
  daily_delivered_kwh = critical_load_kw × truncated_hrs

  // 2. Apportion by timing — solar may cover daytime outages on hybrid
  if outage_timing == "Daytime":
    solar_coverage_during_outage = 0.70  // hybrid keeps running on solar even if grid is out
    battery_drain_per_outage     = daily_delivered_kwh × (1 - solar_coverage_during_outage)
  else:
    solar_coverage_during_outage = 0
    battery_drain_per_outage     = daily_delivered_kwh

  // 3. Annualize
  annual_delivered_kwh = daily_delivered_kwh × 365

  // 4. Value at premium tariff
  outage_value = annual_delivered_kwh × tariff_per_unit × outage_premium_factor

  // 5. Subtract round-trip losses on the battery-covered portion
  annual_battery_drain  = battery_drain_per_outage × 365
  annual_rte_loss_kwh   = annual_battery_drain × (1 / roundtrip_eff - 1)   // ~8.7% adder
  annual_rte_loss_inr   = annual_rte_loss_kwh × tariff_per_unit
  outage_value         -= annual_rte_loss_inr

  return outage_value
```

### 14.9 Multi-day outages (cyclones, festival grid stress)

Daily 2–3 hr outages are routine. But monsoon storms, cyclones, and festival peak loads can cause **multi-day outages** (12–48 hours). Battery alone cannot cover this for off-grid; for hybrid in evening-peak mode, this is a different scenario.

We don't model multi-day events in the recurring outage_value calc, but we add a separate disclosure:

```
multi_day_resilience_hours = battery_hours_available  // no further multiplier
```

The UI for hybrid surfaces: *"Your 3 kWh battery sustains critical loads for ~5 hours after a long grid failure. For 12+ hour outages, plan for partial coverage or add a generator."*

For off-grid, the autonomy_days input from §13.4 already covers this.

### 14.10 Inverter standby drain (the cost nobody mentions)

Hybrid and off-grid inverters have continuous idle draw — **~30W for a 3–5 kW inverter**, 24/7.

```
annual_standby_kwh = 30 × 24 × 365 / 1000 = 263 kWh/year
annual_standby_inr = 263 × tariff_per_unit = ₹2,235 at ₹8.50/unit
```

This is a real OPEX hit on hybrid and off-grid — not on on-grid string inverters which can sleep at night. We deduct it from annual savings as a separate line.

For on-grid: zero (string inverters sleep at zero net load).

### 14.11 Cycling acceleration → battery replacement timing

§13.6 assumed Year-10 battery replacement based on calendar life. But **deep daily cycling** (which is what high-outage hybrid operation looks like) accelerates degradation:

```
LFP cycle life ≈ 6,000 cycles to 80% capacity (manufacturer rating, lab conditions)
real-world ≈ 4,000–5,000 cycles to 80% capacity

cycles_per_year = 365 if outage_hours_per_day > 0  // one full discharge per outage day
                = 200 otherwise                      // partial cycling for evening peak only

years_to_80%_capacity = 4500 / cycles_per_year

  for outage_hours_per_day = 0:           years = 22.5  → calendar life dominates (10 yr)
  for outage_hours_per_day = 1:           years = 12.3  → calendar life dominates (10 yr)
  for outage_hours_per_day = 2.5:         years = 12.3  → calendar life dominates (10 yr)
  for outage_hours_per_day = 5+ (deep DoD): years = 8.2 → cycling dominates (8 yr)

replacement_year = min(10, years_to_80%_capacity)
```

For most users, calendar life still wins (battery replaced at Year 10). For severe-outage users, replacement at Year 8 is the right model.

### 14.12 Worked example: Kota 3 kW hybrid, 2.5 hr/day evening outage

Re-running §13.9's hybrid column with proper outage modeling:

**Inputs (deltas from §13.9 hybrid):**
- `outage_hours_per_day` = 2.5 (Patchy)
- `outage_timing` = Evening peak (default)
- `critical_load_kw` = 0.5
- `battery_kwh` = 3.0 (sizing rule still says 3.0 — outage rule yields 2.04, evening rule yields 3.0)
- `outage_premium_factor` = 2.0
- `roundtrip_eff` = 0.92

**Annual outage value (§14.8):**

```
truncated_hrs           = min(2.5, 5.5) = 2.5     // battery can sustain 5.5 hrs at 0.5 kW from 3 kWh
daily_delivered_kwh     = 0.5 × 2.5 = 1.25 kWh
annual_delivered_kwh    = 1.25 × 365 = 456 kWh
gross_outage_value      = 456 × 8.50 × 2.0 = ₹7,752

annual_battery_drain    = 456 kWh
annual_rte_loss_kwh     = 456 × (1/0.92 - 1) = 39.7 kWh
annual_rte_loss_inr     = 39.7 × 8.50 = ₹337

annual_outage_value     = 7,752 - 337 = ₹7,415
```

**Inverter standby drain (§14.10):**

```
annual_standby_inr      = 263 × 8.50 = ₹2,235
```

**Updated hybrid cashflow line items:**

| Line | Reliable (§13.9) | Patchy 2.5hr (revised) |
|---|---|---|
| Bill-offset savings | ₹27,000 | ₹27,000 |
| Outage value | ~₹500 | **₹7,415** |
| Inverter standby drain | (not modeled) | **-₹2,235** |
| Net annual savings | ~₹27,500 | **₹32,180** |

**Battery replacement** (§14.11): 2.5 hr/day → cycling life 12 yr → calendar still wins → replace Year 10. No change.

**Updated payback and IRR:**

- Net cost: ₹2,37,000 (unchanged)
- Year 1 net savings: ₹32,180 (vs ₹27,500 in §13.9 placeholder)
- Year 10 battery replacement: -₹70,000 (unchanged)
- Payback: ~7.4 yr (improved from 8.6)
- IRR: ~14% (improved from 10%)

So in genuinely patchy areas, hybrid does materially better than §13.9 suggested. For severe-outage areas (5 hr/day), the hybrid IRR can reach **17–18%**, approaching on-grid territory — at which point the outage value alone justifies the battery.

### 14.13 Updated decision logic given proper outage realism

The §13.10 verdict lines need to recompute against the corrected outage_value. New phrasing:

| Outage hours/day | Hybrid IRR (Kota) | Verdict shown |
|---|---|---|
| 0 | ~10% | "On-grid wins on returns. Hybrid only if you want backup peace of mind." |
| 1 | ~12% | "Hybrid is reasonable. On-grid is still better financially." |
| 2.5 | ~14% | "Hybrid pays off in your area. Backup value covers most of the battery cost." |
| 5+ | ~17–18% | "Hybrid is the right call. Outages here make the battery pay for itself." |

The slider in §14.2 directly drives this verdict — user moves the outage stop and sees the recommendation flip. That's the calculator earning its keep.

### 14.14 Critical-load circuit cost (the line item nobody quotes)

For hybrid to actually deliver outage backup, the user needs a **critical-load distribution box** — a separate sub-panel wired only to the appliances meant to run on backup. Cost: ₹15,000–25,000 for materials + electrician.

Most installer quotes don't include this. It's a real cost. We add a one-time line item:

```
critical_load_panel_cost = ₹20,000   // one-time, hybrid + off-grid only
```

Add to gross_cost for hybrid and off-grid system types.

### 14.15 What we still don't model in outage analysis

- **Load-shifting algorithms** — smart hybrid systems pre-charge batteries before scheduled outages. Improves coverage by ~10% but requires smart inverter + outage forecast.
- **Generator integration** — for severe-outage or off-grid users, a small diesel generator (₹40–80k) for monsoon weeks is rational. Out of scope.
- **Surge load handling** — fridges and ACs have 3–4× startup current. Inverter must be sized for peak, not average. Implicitly assumed by sizing the inverter at solar kW (typically sufficient).
- **Battery storage temperature derating** — LFP loses 20% capacity at 50°C ambient. Outdoor battery installs in Indian summers do degrade faster. Documented as a caveat in the assumptions panel.
- **Power factor correction** — irrelevant at residential scale.

### 14.16 What changes in §1–§13 because of §14

- **§13.2** — `grid_reliability` enum is replaced by `outage_hours_per_day` slider (§14.2). The enum stays as a shorthand mapping behind the slider's labeled stops.
- **§13.5** — battery sizing rule updated to `max(evening_peak_rule, outage_rule)` per §14.7.
- **§13.6** — battery replacement year is now `min(10, cycling_life_years)` per §14.11.
- **§13.7** — `outage_value` formula replaced wholesale by §14.8.
- **§13.9** — Kota hybrid IRR figure updates: at zero outage ~10%, at 2.5 hr/day ~14%, at 5 hr/day ~17%. The single-number "10%" in the table is a Reliable-grid figure; the calculator must show the user *their* IRR at *their* outage rate.
- **§13.10** — three-button toggle stays; the recommended type now also depends on outage_hours, not just on grid_reliability bucket.
- **§4.3** — `derive_net_cost()` adds `critical_load_panel_cost` for hybrid and off-grid.
- **§4.5** — savings model gains `outage_value` term for hybrid (with all six factors of §14.1).
- **§4.7** — metrics gain `inverter_standby_drain` deduction line; battery replacement year is dynamic per §14.11.
- **§10** — add 3 outage-specific test cases: 0 hr/day baseline, 2.5 hr/day Patchy, 5 hr/day Severe; assert hybrid IRR monotonically rises with outage hours.

---

*v1.3 addendum: §14 added per design feedback ("did you consider power outage capacity utilization 50%, etc"). Replaces §13.7 placeholder with six-factor outage model. Acceptance criterion expands: §14.12 worked example reproduces within ±10% in code.*

---

## 15. Friendly inputs — Easy mode + Precise mode

A homeowner doesn't know their roof in square feet, doesn't know their critical-load wattage, and doesn't know what 5.5 peak sun hours means. But they know "two cars fit on my terrace" and "I want my fridge, fan, lights, and Wi-Fi to keep running."

This section defines the **Easy/Precise toggle pattern** applied per input. The pattern, the conversion math, and the specific easy-mode controls for the four inputs that need them most.

### 15.1 The pattern

For every input where the natural unit (sq ft, kW, ₹/unit) requires technical knowledge, offer two modes:

- **Easy** (default) — a tangible, visual, or scenario-based picker. No numbers required.
- **Precise** — direct numeric entry, for users who know exactly.

UI: a small `Easy ⇆ Precise` pill toggle next to the input label. Switching modes preserves the resolved value (so changing back doesn't reset). The engine only ever sees the resolved numeric value — modes are pure UI.

Inputs that get this treatment:

| Input | Why hard in raw form | Easy-mode picker |
|---|---|---|
| **Roof area** | Nobody measures roofs in sq ft | "How many cars fit?" |
| **Critical load** | "0.5 kW" is opaque | Appliance checklist with wattage hidden |
| **Outage frequency** | Already friendly per §14.2 | (no change — slider with named stops) |
| **Bill amount** | Friendly if you have last bill | Lifestyle stamp as fallback |
| **System size** | "kW" is jargon | "% of bill covered" framing |

Inputs that don't need it (auto-filled from city or set with sensible defaults): tariff, peak sun hours, cost/kW, escalation, alt return, battery sizing.

### 15.2 Roof area — "fits N cars"

The Maruti Swift parking footprint (~80 sq ft) is the most universally legible reference object in tier-2/3 India. Coincidentally, residential rooftop solar needs ~80 sq ft per kW after accounting for spacing, walkways, and shadow gaps. So **1 Swift ≈ 1 kW solar capacity**, intuitively.

But Indian rooftops have water tanks, dish antennas, AC outdoor units, parapets, and stairhead boxes that eat 20–30% of usable area. So we apply a 0.75 utilization derate.

**Easy mode picker:**

```
🚗               Small         "Fits 1 car"          ~80 sq ft   → up to ~1 kW
🚗🚗             Medium        "Fits 2 cars"         ~160 sq ft  → up to ~1.5 kW
🚗🚗🚗           Large         "Fits 3 cars"         ~240 sq ft  → up to ~2.5 kW
🚗🚗🚗🚗         Extra large   "Fits 4 cars"         ~320 sq ft  → up to ~3.5 kW
🚗 ×5+           Huge          "Fits 5+ cars"        ~400+ sq ft → up to ~5 kW+
   (or: "Enter exact area")
```

Each card shows the equivalent sq ft (small text) and the kW it can support (small text) — so the user sees the conversion happening. On click, the resolved `roof_area_sqft` is set and the system size recommender (§4.9) re-runs.

For sloped or tiled roofs, the same picker works — "imagine your roof flattened, how many cars would fit on the floor area?" — with a UI hint to that effect.

**Precise mode:** numeric input in sq ft, OR length × width in feet (auto-multiplies). Both forms accepted.

**Conversion math:**

```
gross_area_sqft = N_cars × 80
usable_area_sqft = gross_area_sqft × 0.75       // accounts for tanks, walkways, shadow
max_system_kw   = usable_area_sqft / 80          // 80 sq ft per kW for solar
```

So `2 cars` → 160 gross → 120 usable → 1.5 kW max. Validated against the recommended kW from §4.9: if the recommendation exceeds max_system_kw, the recommender clamps and shows: *"Your roof fits up to 1.5 kW. A bigger system would need more space."*

### 15.3 Critical load — appliance checklist

Replaces the abstract `critical_load_kw` numeric input from §14.1 with a checklist. User ticks what they want to run during outages; sum gives the kW.

**Easy mode picker:**

| ☐ | Appliance | Power draw | Default ticked? |
|---|---|---|---|
| ☑ | LED lights (whole house, 8–10 bulbs) | 80 W | Yes |
| ☑ | Ceiling fans (3 fans) | 200 W | Yes |
| ☑ | Refrigerator (single door) | 150 W | Yes |
| ☑ | Wi-Fi router + ONT | 25 W | Yes |
| ☐ | TV (LED, 43") + set-top box | 120 W | No |
| ☐ | Mobile + laptop chargers | 60 W | No |
| ☐ | Mixer / grinder (occasional, 5 min/day) | 500 W (only when running) | No |
| ☐ | Air cooler (desert cooler) | 200 W | No |
| ☐ | Inverter AC (1.5 ton, eco mode) | 1,200 W ⚠ | No |
| ☐ | Geyser (instant) | 3,000 W ⚠ | No (impractical for backup) |

The wattage is shown discreetly on the right; users can see it but don't have to think in those terms.

**Sum logic:**

```
critical_load_kw = sum(checked_appliances_watts) / 1000
                 + diversity_factor                   // not all run simultaneously

diversity_factor = 0.7 if more than 5 items checked   // realistic non-coincident peak
                 = 1.0 otherwise
```

Default checklist (Lights + Fans + Fridge + Router) sums to ~455 W → 0.5 kW. Matches the §14.4 default exactly.

**Warnings:**

- If user ticks AC: *"Backing up an AC needs at least a 5 kWh battery. Your sized battery may not run it for long."*
- If user ticks Geyser: *"Instant geysers draw too much for residential backup. Consider tank-type with timer instead."*
- If user ticks 7+ items: *"Heavy critical load. We recommend a larger battery to sustain backup duration."*

The warnings link to the affected sections (§14.7 battery sizing) so the user can see what changes.

**Precise mode:** numeric input in watts or kW.

### 15.4 Outage frequency — already done in §14.2

Already has the slider with labeled stops (Reliable / Occasional / Frequent / Patchy / Severe / No grid). Each stop has a one-line scenario that's tangible:

> "Patchy — power goes out 2–3 hours daily, usually evenings. Common in tier-2 cities."

No further work needed. Listed here for completeness.

### 15.5 Bill amount — lifestyle stamp fallback

Most users have their last bill (or app/SMS reminder of the amount). The slider with ₹ values is already friendly. But for users who don't have the bill handy:

**Easy mode picker (bill estimator):**

| Lifestyle stamp | Approx peak summer bill |
|---|---|
| 1 BHK, no AC, fans only | ₹1,200 |
| 2 BHK, 1 AC used at night | ₹2,500 |
| 2 BHK, 2 ACs evening + night | ₹4,500 |
| 3 BHK, 3 ACs full day | ₹7,500 |
| 4 BHK / villa, 4+ ACs full day | ₹12,000+ |
| Custom | (slider) |

User picks their lifestyle stamp; the resolved `bill_summer` populates. They can switch to Precise to enter their actual bill if they recall it.

**Precise mode:** the existing slider/numeric input.

This is a soft-fallback only; we always nudge the user to enter the real bill if they have it ("Got your last bill handy? It'll be more accurate.").

### 15.6 System size — "covers X% of bill" framing

In §4.9 we already produce three sizing cards. Each card currently shows kW as the primary number. For Easy mode users, swap the framing:

| Mode | Primary label on card | Secondary |
|---|---|---|
| Precise | "3 kW" | "Covers 100% of your bill" |
| Easy | "Covers your full bill" | "3 kW system" |

Same data, different emphasis. Easy mode buries the technical unit; Precise mode leads with it.

The "below" card becomes "Covers most of your bill (85%)" and the "above" card becomes "Covers your bill + exports surplus."

### 15.7 Conversion lookup table (UI ↔ engine)

For implementation reference. Engine only ever sees the resolved numeric values.

| UI Easy-mode pick | Resolved engine value |
|---|---|
| "Fits 2 cars" | `roof_area_sqft = 160` |
| "Lights + Fans + Fridge + Wi-Fi" checked | `critical_load_kw = 0.5` |
| "Patchy" outage stop | `outage_hours_per_day = 2.5` |
| "2 BHK, 2 ACs" lifestyle stamp | `bill_summer = 4500` |
| "Covers your full bill" sizing card | `system_kw = recommended_value` |

### 15.8 Easy/Precise toggle behavior

Three rules:

1. **Easy is the default for first-time users.** The page loads in Easy everywhere.
2. **Switching modes preserves the resolved value.** If user picks "2 cars" (= 160 sq ft) and switches to Precise, the input shows `160`. Switching back to Easy re-selects "2 cars" (or the closest stop).
3. **Power-user override is sticky.** If the user ever switches an input to Precise, that input stays in Precise for the session (and across sessions if localStorage is on). They've signaled they want control.

A global `Easy / Precise` master toggle in the header sets all inputs at once. Useful for a returning user who wants the analyst view from the start.

### 15.9 What we deliberately don't make "easy"

Some inputs would be misleading if hidden behind a friendly picker because they materially change the answer and the user should consciously decide:

- **System type** (on-grid / hybrid / off-grid) — already a 3-button toggle with clear labels (§13.10). Not "easy" or "precise" — it's a decision.
- **Tariff escalation %** — affects 25-year results massively. Either accept the 5% default or knowingly override. No "Easy" pick that hides the assumption.
- **Alternative investment return %** — same reasoning.
- **Net metering on/off** — binary state choice; no friendly mid-ground.

These remain explicit toggles or numeric inputs. Easy mode just hides them inside the advanced panel until the user opens it.

### 15.10 Mobile considerations

On mobile, Easy mode is even more important — typing "320" into a sq ft field with a thumb is annoying. The car picker is a horizontal scroll of large tappable cards. The appliance checklist is a vertical list of large checkbox rows. Both are designed thumb-first.

Precise mode on mobile uses numeric keyboard (`inputmode="numeric"`).

### 15.11 What changes in §1–§14 because of §15

- **§2.2** — `roof_area_sqft` becomes optional in Precise; in Easy, the car picker is required (replaces it). Default still empty if Precise mode and user skips.
- **§4.9** — sizing cards gain alternate Easy-mode labels per §15.6.
- **§12.1** — required input #3 ("roof type") and the new roof picker are presented together. Roof type (flat/sloped/terrace) is the visual button choice; roof size (cars) is the picker right next to it.
- **§14.1** — `critical_load_kw` row's default value is now derived from the §15.3 default-checked appliances (455 W), not a hard-coded 0.5 kW.
- **§14.4** — utilization-factor explanation can reference the appliance checklist as the "what this 50% really means" example.

---

*v1.4 addendum: §15 added per design feedback ("make calculation easy — easy pick options like 2 Swift cars for roof, but precise option also available"). Establishes Easy/Precise pattern for roof area, critical load, bill, system size. No changes to underlying math.*

---

## 16. Bill input — two anchors and a shape curve

§2.1 asked for `bill_summer`, `bill_winter`, and `bill_transition`. That's three numbers, and "summer bill" is ambiguous — does the user mean their highest, their average, or their typical? Most Indians remember **two specific bills**: the one that hurt the most last May/June, and the trivial one in December. Those are the extremes. Asking for those two is more accurate than asking for season averages, and the rest of the year can be reconstructed from a fixed shape curve.

This section replaces §3.5 and §4.1's bill model.

### 16.1 The two anchors

Replaces `bill_summer`, `bill_winter`, `bill_transition` with:

| Field | Wording in UI | Anchored to |
|---|---|---|
| `bill_peak_summer` | *"Highest electricity bill you remember paying — usually May or June"* | The hottest month, full AC |
| `bill_low_winter` | *"Lowest electricity bill you remember paying — usually December or January"* | The mildest month, no AC, minimal heating |

UI hint under each: *"Pick a typical extreme, not a one-off (avoid months where you were travelling or had a billing issue)."*

That's the only bill input the user sees. Transition months are derived.

### 16.2 The 12-month shape curve

Each month's bill is interpolated between the two anchors using a fixed shape factor:

```
monthly_bill[m] = bill_low_winter + (bill_peak_summer - bill_low_winter) × shape[m]
```

Where `shape[m]` is the fraction of the peak-to-low range, in [0, 1]:

| Month | Shape | Reasoning |
|---|---|---|
| Jan | 0.00 | Anchor low — coldest, no AC |
| Feb | 0.05 | Mild winter, slight rise |
| Mar | 0.20 | Early summer, fans + occasional AC |
| Apr | 0.50 | Pre-peak, AC starts in earnest in north India |
| May | 1.00 | Anchor peak — hottest, full AC |
| Jun | 1.00 | Anchor peak — equally hot pre-monsoon |
| Jul | 0.75 | Monsoon dampens daytime AC; bills drop ~25% from peak |
| Aug | 0.70 | Continued monsoon, lower than Jul |
| Sep | 0.50 | Post-monsoon, residual heat |
| Oct | 0.25 | Mild, fans only most days |
| Nov | 0.10 | Winter starts, lights + fan + fridge baseline |
| Dec | 0.00 | Anchor low — same as Jan, no AC |

Validation: this curve is calibrated for **north and central India** (Delhi, Punjab, Rajasthan, Gujarat, MP, UP, Bihar) where the summer/winter swing is dramatic. For South India and coastal zones the swing is smaller.

### 16.3 Zonal shape variants (Phase 2 enhancement, single shape in v1)

For v1 we use the single shape curve in §16.2. For v1.1 we add zone-specific shapes:

| Zone | Member states | Shape characteristic |
|---|---|---|
| North/Central (default) | RJ, GJ, MP, DL, UP, Punjab, Haryana, Bihar | Steep summer peak, deep winter low (curve as in §16.2) |
| South | KA, TN, KL, AP, TS | Flatter — narrower swing, AC year-round |
| East | WB, OR, NE | Humid summer, mild winter, monsoon dip more pronounced |
| West coast | MH, Goa | Mild swing — sea moderates temperature |

For the South variant, the shape would be compressed:

```
shape_south[m] = 0.35 + shape[m] × 0.65
```

So Jan in Bangalore is `0.35` instead of `0.00` — a Bangalorean's "lowest winter" bill is 35% of the way from itself to their "peak" (small swing, mild winter).

V1 ships with single shape + a note in advanced: *"Bill curve is calibrated for north and central India. If you're in Bangalore/Chennai, your actual bills may swing less than shown — switch to Precise mode to enter monthly bills."*

### 16.4 Annual bill recalculated for Kota with the new model

Re-running the §5 worked example with the two-anchor approach:

- `bill_peak_summer` = 3,500
- `bill_low_winter` = 400
- range = 3,100

| Month | Shape | Bill |
|---|---|---|
| Jan | 0.00 | 400 |
| Feb | 0.05 | 555 |
| Mar | 0.20 | 1,020 |
| Apr | 0.50 | 1,950 |
| May | 1.00 | 3,500 |
| Jun | 1.00 | 3,500 |
| Jul | 0.75 | 2,725 |
| Aug | 0.70 | 2,570 |
| Sep | 0.50 | 1,950 |
| Oct | 0.25 | 1,175 |
| Nov | 0.10 | 710 |
| Dec | 0.00 | 400 |
| **Annual** | | **₹20,455** |

Compare to the old §5 model (4 summer + 4 transition + 4 winter at fixed seasonal bills): annual = **₹21,980**. The new model is ~7% lower because it correctly models the monsoon dip in Jul/Aug rather than treating them as full-peak summer months.

This 7% delta propagates to savings (~7% lower year-1 savings) and thus to IRR (~1 pp lower). The §5 worked example must be re-baselined; the §13.9 cross-type table likewise.

### 16.5 Why this is more accurate, not less

Skeptical reading: "We replaced 3 user inputs with 2 + a fixed curve — isn't that less accurate?" No, because:

- The dropped third input (`bill_transition`) was already auto-computed in §3.1 from the same two anchors. We just made the derivation more sophisticated (12-point curve instead of 3-point flat seasons).
- The 4-month flat-summer assumption in the old model was inaccurate — Jul/Aug aren't equal to May/Jun in any household, they're ~70-80% of peak.
- Asking for an extreme ("highest you paid") gets a more accurate number than asking for an average ("typical summer bill"), because users encode extremes in episodic memory and averages require mental math.

The shape curve is a model — but so was the old 3-bucket allocation. The new model is closer to actual Indian bill data.

### 16.6 Edge cases and validation

| Case | Behavior |
|---|---|
| `bill_low_winter > bill_peak_summer` | Warn: *"Did you reverse these? Winter bills are typically lower."* — show swap button. Calc still runs. |
| `bill_low_winter == bill_peak_summer` | Flat-bill case (no AC, no heater). All 12 months equal. Calc runs, savings are uniform. |
| `bill_low_winter == 0` | Allowed — some homes have a 0-unit winter bill. Treat as fixed minimum charge if tariff has one. |
| User in South India / Kerala | Default shape will overstate summer. Show advisory near the chart: *"Your monthly chart looks more variable than your real bills? You may be in a flatter-climate zone — switch to Precise to enter exact bills."* |
| User has 12 monthly bills in hand | Switch to Precise mode → enter all 12 individually. Bypasses the shape curve entirely. |

### 16.7 Precise mode for bills

For users who keep their last 12 bills (or use the DISCOM app to look them up):

**Easy mode (default):** two slider/numeric inputs — peak summer + low winter — as in §16.1.

**Precise mode:** 12 monthly inputs presented as a horizontal scrollable strip with month labels. Sum updates live as annual_bill. Switching from Easy to Precise pre-fills the 12 fields with the shape-curve interpolated values, so the user only edits where their bills differ from the model.

The 12-input form is heavyweight on mobile — clear UX hint: *"Most users skip this. The shape curve is accurate for ~95% of homes."*

### 16.8 Display: monthly bill vs savings chart needs both anchors marked

The chart from PRD §7.1 already plots 12 bars of monthly bill. With the two-anchor input, we annotate two specific bars:

- The May/Jun bars (peak) labelled *"Your peak — what you told us"*
- The Dec/Jan bars (low) labelled *"Your low — what you told us"*

The other 10 months show the shape-curve estimates with a small "estimated" subscript. Click any non-anchor bar → opens a tooltip *"Estimated from your two bills using a typical Indian bill curve. Switch to Precise to override."*

This makes the model visible without nagging the user to enter 12 bills.

### 16.9 What changes in §1–§15 because of §16

- **§2.1** — `bill_summer` / `bill_winter` / `bill_transition` are replaced by `bill_peak_summer` / `bill_low_winter`. Defaults change accordingly (3,500 / 400 stay the same numerically; just renamed).
- **§3.5** — bill-side seasonal classification (summer/transition/winter month buckets) is **deleted**. Replaced by §16.2 12-month shape curve.
- **§4.1** — `derive_bill_array()` formula changes per §16.2.
- **§5** — worked example annual_bill drops from ₹21,980 to ₹20,455. Year 1 savings, payback, IRR all shift slightly (~5–7% lower savings, ~1pp lower IRR). Re-baseline numbers throughout §5 in next consistency pass.
- **§12.1** — required input #1 wording updates: was "Highest monthly bill last year (single slider)", now "Highest summer + lowest winter bills (two sliders, both required)". Still effectively one input *concept* but two values.
- **§12.2** — `bill_winter` auto-fill rule (`bill_summer × 0.15`) is **removed** — no longer auto-filled, it's a required input now. The user gets two sliders side by side.
- **§13.9** — Kota cross-type table figures shift slightly (~5% lower savings); recompute in next pass.
- **§15.5** — lifestyle stamp picker now sets BOTH `bill_peak_summer` and `bill_low_winter` together (each stamp implies a peak/low pair, not just a single peak).

### 16.10 The lifestyle-stamp table (revised for two anchors)

Replaces §15.5:

| Lifestyle stamp | bill_peak_summer | bill_low_winter |
|---|---|---|
| 1 BHK, no AC, fans only | ₹1,200 | ₹400 |
| 2 BHK, 1 AC used at night | ₹2,500 | ₹500 |
| 2 BHK, 2 ACs evening + night | ₹4,500 | ₹600 |
| 3 BHK, 3 ACs full day | ₹7,500 | ₹900 |
| 4 BHK / villa, 4+ ACs full day | ₹12,000 | ₹1,500 |

Each stamp populates both anchors. The user can switch to Easy mode and tweak either slider individually after picking a stamp.

---

*v1.5 addendum: §16 added per design feedback ("ask highest summer + lowest winter — that's what people remember"). Replaces 3-bucket bill model with 2-anchor + 12-point shape curve. Annual bill estimate is ~7% lower than v1.4 due to more accurate monsoon-month modeling.*

---

## 17. Gap analysis — what we're still missing

Honest audit. Things a homeowner needs to make this decision well that aren't in the spec yet, ranked by impact.

### 17.1 Tier 1 — material impact on the IRR or the decision (must add for v1)

#### 17.1.1 Loan / EMI option

**Why it matters.** PM Surya Ghar makes collateral-free loans up to ₹2 lakh available at 7% (PSU banks) or 8.5% (private). **Most residential buyers do not pay ₹1.17 lakh upfront** — they take a loan. Without loan modeling, the calculator answers a question almost no user actually faces.

**What to add:**

```
inputs:
  payment_mode: "Cash" | "Loan"
  loan_pct: 0–80%        // typical 60–80%
  loan_rate: 0.07 (default PSU rate)
  loan_tenor: 5 years (typical 3–7)

derive:
  loan_amount     = net_cost × loan_pct
  cash_upfront    = net_cost - loan_amount
  emi_monthly     = loan_amount × r × (1+r)^n / ((1+r)^n - 1)   // standard EMI
                    where r = monthly rate, n = months
  interest_paid_total = emi × n - loan_amount
```

**Cashflow impact.** Year 0 outflow drops from ₹1.17 lakh to ~₹35,000 (cash portion). Years 1–5 each add EMI as additional outflow (~₹19,000/yr). IRR drops by ~3–4 percentage points (from ~24% to ~20% in Kota case) — still very attractive, but honestly modeled.

**Decision impact.** With loan, the user's *first-year cash position* may be **net positive** (savings ≥ EMI) — a powerful selling point that cash-only modeling hides.

#### 17.1.2 AMC and maintenance OPEX (Year 6 onwards)

**Why it matters.** Manufacturer warranty covers most issues for first 5 years. After that, AMC contracts run ₹3,000–5,000/year (single-visit cleaning + electrical check). Most installers don't include this. We mentioned in §8 backlog but never modeled.

**What to add:**

```
amc_annual_cost = 4000 (default ₹4,000/yr from Year 6)
panel_cleaning_cost = 0 (assume DIY)
              OR 1500 (if user picks "professional cleaning 4×/yr")
```

Subtract from annual savings starting Year 6. Reduces IRR by ~0.7–1.0 percentage points.

#### 17.1.3 Inverter replacement at Year 12

**Why it matters.** String inverter warranty is 5 years standard, 10 years extended. Real life: 10–13 years. A 3 kW string inverter replacement is ₹15,000–25,000 in 2026 prices, projected ~₹12,000–18,000 in 2038. **Already flagged in §8 backlog — needs to become a real cashflow item.**

**What to add:**

```
inverter_replacement_year = 12
inverter_replacement_cost = system_kw × 5,500 × (1 - 0.03)^12
                            // ₹5,500/kW today, declining 3%/yr
                            // for 3 kW: ₹16,500 today → ~₹11,400 at Y12

cashflows[12] += savings_yr12 - inverter_replacement_cost
```

Knocks IRR by ~1.5 percentage points. Combined with battery replacement (Y10 for hybrid), the **mid-life cashflow valley is real** — both should appear on the cashflow chart.

#### 17.1.4 Telescopic tariff (slab progression)

**Why it matters.** Most state DISCOMs charge in ascending slabs:
- 0–100 units: ₹3.50
- 101–200: ₹5.50
- 201–400: ₹7.50
- 401+: ₹9.00

If user consumes 350 units/month, marginal rate is ₹7.50, but average rate is ~₹5.40. Solar offsets units from the **top of the slab downward**, so each unit saved is worth the marginal rate (₹7.50), not the average (₹5.40). **Savings are 30–40% higher than flat-tariff modeling suggests** for slab-tariff customers.

**What to add:**

```
state_tariff_slabs: [
  { up_to_units: 100, rate: 3.50 },
  { up_to_units: 200, rate: 5.50 },
  { up_to_units: 400, rate: 7.50 },
  { up_to_units: Infinity, rate: 9.00 }
]

function effective_marginal_rate(monthly_consumption_units):
  // Returns the rate of the topmost slab the consumption reaches
  // If user is in 400-unit slab, marginal = 9.00; even after solar offsets to 100, marginal stays at top of remaining slab

function savings_from_solar(consumption_units, generation_units):
  // Strip generation_units off the top of the slab stack
  // Calculate ₹ saved at each slab's rate as we descend
```

This is the single biggest accuracy improvement after seasonal modeling. **Most calculators get this wrong (use flat rate)** and underestimate savings by 20–30%.

#### 17.1.5 Subsidy cashflow gap

**Why it matters.** User pays gross upfront (₹1.95 lakh), gets ₹78,000 back from government **2–4 months later**. That's a real working-capital cost (~₹2,500 in interest if borrowing at 12%) and a psychological one. Most users learn this only after committing.

**What to add:**

```
subsidy_arrival_months: 3 (default, range 2–6)

// IRR cashflow becomes:
year_0:   -gross_cost
year_0.25: +central_subsidy + state_subsidy   // arrives 3 months later
year_0.5+: savings as before
```

OR show as a Year-1 cashflow: `-gross_cost + savings_yr1 + subsidy`. Either is more honest than the current `-net_cost` upfront.

Impact on IRR: ~0.3 percentage points (small) but it changes the **headline year-1 cashflow** message significantly.

#### 17.1.6 Net metering settlement period

**Why it matters.** §1.5 noted that net metering rates vary, but didn't capture the **annual vs monthly settlement** distinction. This matters enormously:

- **Annual settlement** (Karnataka, Tamil Nadu, Rajasthan, Delhi for residential ≤10 kW): summer surplus banks against winter deficit. User effectively gets full retail offset.
- **Monthly settlement** (Maharashtra, Gujarat for some categories): each month's surplus settles at low APPC (₹3.0–3.5/unit). Massively undervalues seasonal mismatch.

**What to add:**

```
state_net_metering_settlement: "Annual" | "Monthly"

// For Annual:
  annual_export_units = sum(monthly_export[1..12])
  annual_credit       = annual_export_units × tariff_per_unit  (full retail)
  annual_savings      = monthly_offset_savings + annual_credit

// For Monthly:
  monthly_credit[m]   = export[m] × APPC_rate (e.g., ₹3.25)
  annual_savings      = sum(monthly_offset + monthly_credit_at_APPC)
```

For Kota with annual settlement: full credit on winter exports. With monthly settlement: only ~38% credit. **Same physical system, different economics.** Add `settlement_period` to §3.1 DISCOM table.

### 17.2 Tier 2 — meaningful but not blocking (add in v1.1)

#### 17.2.1 Roof orientation and tilt

South-facing at latitude-optimal tilt (~15–28° in India) = 100% reference. East/west facing = 85%. Flat installation = 92–95% (suboptimal but common). North-facing = ~70% (avoid).

Most installers don't optimize tilt. Asking the user "which way does your roof face?" with a 4-button picker (N/S/E/W or Flat-roof) and applying a generation factor is straightforward.

#### 17.2.2 Panel-level scorecard (not just brand)

PRD §6 ranks brands. But a Waaree TOPCon and a JA Solar TOPCon have different cell technology, warranty terms, country of origin, DCR status. For users serious about decision, add panel model dropdown (10–15 popular models in 2026) with per-panel data. Defaults to brand-level summary if user doesn't engage.

#### 17.2.3 Time-of-Day (ToD) tariff

Becoming standard 2025–2026 (BESCOM, MSEDCL, TPDDL piloting). Solar generation is in the cheap off-peak window (8 AM–4 PM at ₹4–5) and consumption peaks in expensive window (6 PM–10 PM at ₹9–11). With net metering, this is **neutral** (export earns at off-peak rate, import costs at peak rate — net loss). With proper hybrid + battery: **positive** (charge battery at off-peak, discharge at peak = arbitrage savings on top of solar).

Adds ~5–8% to hybrid economics in ToD states. Not material for non-ToD states (most of India in 2026).

#### 17.2.4 Energy independence % metric

Not financial, but emotionally meaningful — and a key driver for many buyers.

```
energy_independence_pct = annual_generation / annual_consumption
```

For Kota 3 kW: ~210% (generates more than consumes). The "100% energy independent" line resonates strongly. Free output to compute, big perceived value.

#### 17.2.5 Carbon offset (kg CO₂/year)

```
annual_co2_offset_kg = annual_generation_kwh × 0.82
                     // India grid emission factor 0.82 kg CO₂/kWh
```

For Kota 3 kW: ~3,800 kg/year. Equivalent to "1.7 cars off the road." Feel-good output, costs nothing to compute.

### 17.3 Tier 3 — niche or future (defer to v2)

| Gap | Why deferred |
|---|---|
| Property resale value uplift | Hard to quantify; depends on resale timing; minor relative to other factors |
| Group buying / community solar discounts | Requires aggregator partner; out of scope for individual calculator |
| Stochastic P50/P90 generation | Adds complexity; users want point estimates |
| Battery chemistry comparison (LFP vs lead-acid) | LFP is the right default; users rarely choose otherwise in 2026 |
| Smart inverter / app monitoring | Vendor scoring criterion at most |
| Three-phase nuances | Affects inverter spec, not energy math |
| Insurance modeling | Optional; ~0.5%/yr of capex; marginal impact |
| Hailstorm/cyclone risk | Regional; better as a vendor-question item |
| Carbon credit monetization | Impractical at residential scale |
| Future expansion / upgrade economics | Solvable by re-running calculator at new size |
| Renter / short-horizon ownership | Add `years_at_property` input + truncate horizon |

### 17.4 What we're missing on the *decision-support* side (not just math)

The calculator computes well; it doesn't yet **handhold the decision**. Beyond the math, the user needs:

#### 17.4.1 The "wait or now" sensitivity

Panels drop ~5–8%/year in ₹/kW. Subsidy slab is currently generous but politically vulnerable. Tariffs rise ~5–7%/year. **Net effect: waiting 1 year saves ~₹15,000 on hardware but costs ~₹27,000 in foregone savings + risks subsidy cuts.** A simple "Cost of waiting 1 year" line is high value.

```
wait_cost = savings_yr1 - (cost_per_kw_decline × system_kw)
```

Most calculators don't show this; it's the question every prospect asks.

#### 17.4.2 Cash position timeline (not just IRR)

A chart with two lines:
- Cumulative cash out (capex + EMI + AMC + replacements)
- Cumulative cash in (savings + subsidy)

Net = your bank balance vs. doing-nothing. The crossover is the real-world payback. Far more visceral than IRR.

#### 17.4.3 Counter-scenario: "what if I do nothing?"

Cumulative bills paid over 25 years at 5% escalation, no solar. For Kota: **₹10–11 lakh paid to DISCOM over 25 years.** Side-by-side with "₹10 lakh net gain from solar" makes the choice tangible.

#### 17.4.4 The "you'll move in N years" sensitivity

```
horizon_years_at_property: 5 | 10 | 15 | 25 | "forever"

// If user moves at year N, they recover (depreciated) system value via property uplift
recovered_value = (1 - 0.03 × N) × original_capex × 0.30
                  // Pessimistic: recover 30% of capex at sale, depreciating 3%/yr
```

Renters or near-term sellers should see solar is **bad for them financially**. Tells the truth.

#### 17.4.5 Vendor red flags as live warnings (not just checklist)

PRD §8 has the red-flag list as a static checklist. Better: when user enters a vendor's quote in §6, the calculator **flags red flags inline** ("This quote is 22% below market — verify panel model and DCR status").

#### 17.4.6 Subsidy program risk disclaimer

A one-line acknowledgment: *"PM Surya Ghar subsidy is a current government program. Slabs and eligibility have changed twice since 2022 and could change again. Numbers shown assume current rules."*

#### 17.4.7 DISCOM technical compatibility

Some old DISCOM transformers can't handle bidirectional flow. Site survey reveals this only after commitment. Add to vendor questions: *"Has DISCOM confirmed transformer compatibility for net metering at my address?"*

### 17.5 What's missing on the *user journey* side

The calculator handles the analysis. It doesn't yet handle the **next steps** after the decision:

| Stage | Currently | Should add |
|---|---|---|
| Decided to install | Quote checklist (PRD §8) | Live vendor finder using `pmsuryaghar.gov.in` empanelled list, location-filtered |
| Got quotes | Provider table (PRD §6) | Quote import — paste 2 vendor quotes, calculator parses + ranks |
| Signed contract | Vendor email template | Application tracker — install date, inspection date, subsidy disbursal status |
| Post-install | Nothing | Monitor input — enter actual generation monthly, compare to model. Flags underperforming systems for warranty claims |

The post-install phase is where most installers abandon customers. A simple "actual vs predicted" tracker for Year 1 would be a strong differentiator.

### 17.6 Summary — the prioritized addition list

To bring v1 to "complete-enough," add Tier 1 (six items in §17.1). Estimated effort: ~200 lines of additional logic and 2 new input groups. Ship v1.1 with Tier 2 (orientation, panel-level data, ToD, independence %, CO₂). Defer Tier 3.

| Priority | Item | Why now |
|---|---|---|
| 1 | Loan / EMI modeling | Most users buy on loan |
| 2 | Telescopic tariff slabs | 20–30% savings accuracy gain |
| 3 | Net-metering settlement period | State-by-state correctness |
| 4 | AMC + maintenance OPEX | Real OPEX hit on long-run IRR |
| 5 | Inverter replacement Y12 | Mid-life cashflow honesty |
| 6 | Subsidy cashflow gap | First-year cash reality |
| 7 | "Wait or now" sensitivity | Top user question |
| 8 | Cash position timeline chart | More visceral than IRR |
| 9 | Counter-scenario "do nothing" | Makes choice tangible |
| 10 | Roof orientation factor | Up to 30% generation delta |

### 17.7 Open question for build phase

With these 10 additions, the calculator becomes substantial — possibly too much for the Easy/Precise pattern alone to manage. May need a **"Quick estimate" vs "Full analysis" mode toggle** at the top:

- **Quick estimate** (5 inputs, ~10 sec): bill anchors, city, roof, grid reliability, system type → headline answer
- **Full analysis** (15+ inputs, ~2 min): adds loan, AMC, replacements, settlement period, orientation, etc.

Quick covers 80% of users. Full serves the careful researcher.

---

*v1.6 addendum: §17 added per design feedback ("anything we missing"). Audits 6 Tier-1 gaps that materially affect decision quality (loan, slab tariffs, settlement period, AMC, inverter replacement, subsidy gap), 5 Tier-2 enhancements, and 5 user-journey additions. Recommends Quick/Full mode toggle for v1.1.*
