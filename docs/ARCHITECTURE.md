# Architecture

## Shape

```
                    ┌─────────────────────────────────────┐
   official APIs ──▶│ sources/  adapters + registry       │
   (TM, SeatGeek,   │  ticketmaster  onsale/presale timing│
    Spotify)        │  seatgeek      capacity + comps     │
                    │  spotify       demand + momentum    │
                    │  fixtures      offline demo + manual│
                    └──────────────┬──────────────────────┘
                                   │ normalized models
                    ┌──────────────▼──────────────────────┐
                    │ store/  SQLite, integer cents       │
                    │  events, artists, venues, windows   │
                    │  artist_metrics  (append-only)      │
                    │  quotes, positions, forecasts       │
                    └──────┬────────────────────┬─────────┘
                           │                    │
              ┌────────────▼─────────┐  ┌───────▼────────────┐
              │ features/            │  │ watcher/           │
              │  10 signals, may     │  │  scan → schedule → │
              │  abstain             │  │  dispatch          │
              └────────────┬─────────┘  └───────┬────────────┘
                           │                    │
              ┌────────────▼─────────┐  ┌───────▼────────────┐
              │ scoring/             │  │ alerts/            │
              │  composite → log-    │  │  console, jsonl,   │
              │  normal → P(clear)   │  │  webhook, iCal     │
              └────────────┬─────────┘  └────────────────────┘
                           │
              ┌────────────▼──────────────────────┐
              │ economics/  fees, breakeven, EV   │
              │  the gate every decision passes   │
              └────┬─────────────────────────┬────┘
                   │                         │
        ┌──────────▼────────┐   ┌────────────▼──────────┐
        │ pricing/  exit    │   │ portfolio/  P&L, risk │
        └───────────────────┘   └───────────────────────┘
```

Dependencies point one way. `economics` knows nothing about events;
`features` knows nothing about money; `store` knows nothing about scoring.
Every module is usable on its own.

## Module notes

**`money`** — every amount is a cent-quantized `Decimal`, never a float.
Margins here run 5-15% of cost, and drift across the buy-fee/sell-fee/tax
chain is enough to flip a marginal position's sign. SQLite stores integer
cents; conversion happens only at the store boundary.

**`models`** — shapes mirror what the primary APIs actually return: a UTC
instant *and* a venue-local wall clock (weekday premium needs local; ordering
needs UTC), a price *range* rather than a face value, sale windows as a list
keyed by how they are gated.

**`economics`** — the fee stack, breakeven, expected value, Kelly sizing. Fee
schedules are data, not constants, with `implied_buy_load()` to back real
rates out of receipts. `evaluate()` takes an absolute `salvage_price`, never
a fraction of the ask — see "Modelling decisions".

**`features`** — ten signals in [0, 1], each with a rationale string, split by
when they become knowable. Pre-onsale signals are all that exist at the buy
decision; post-onsale signals (float, realized premium) are far stronger but
arrive after capital is committed, so they drive the sell side. Signals
**abstain** when data is missing rather than defaulting.

**`scoring`** — composite score → lognormal over resale multiples →
`p_clear_at(multiple)` → expected value. A point estimate cannot size a
position; the decision is "what is the chance this clears above breakeven".
`calibrate()` refits weights by ridge regression on realized sales, and
refuses under 25 observations.

**`pricing`** — reservation price decaying from forecast p75 toward a clearing
price, with the curve shaped by observed float. Guaranteed monotone
non-increasing.

**`watcher`** — scan → schedule → dispatch on a poll, with alerts deduped on
(event, window, lead time). Failed sends stay queued.

**`portfolio`** — marks net of sell fees, and treats correlation as the real
risk: several dates on one tour are one bet.

## Modelling decisions worth knowing

**Abstention over imputation.** A signal without data returns `None`, drops
out of the weighted average, and lowers `confidence`. Substituting a default
produces a number indistinguishable from a measured one, and confident
nonsense is worse than a visible gap.

**Distribution, not point estimate.** Resale outcomes are right-skewed: most
drift near face, a few go parabolic. The lognormal median, mean, p10 and p90
are all reported, and `p_clear_at()` feeds `p_sell` straight into `evaluate()`.

**Salvage is anchored to the market, never to the ask.** Deriving the
downside as a fraction of your own target means raising the target also
raises the assumed floor — the downside branch improves as you get greedier,
and the EV optimizer walks into the tail. (It did: 6.7x ask, 4% clear
probability, +144% reported ROI.) Salvage is capped at 1.0x face pre-onsale,
because the salvage scenario is by construction the one where the forecast
was wrong, so reading it off that same forecast is circular. With a market
quote in hand it becomes today's get-in decayed toward show day.

**Pre- and post-onsale features are separated.** Scoring buy decisions with
float data is the backtest that looks brilliant and cannot be executed.
`extract(..., include_post_onsale=False)` is the honest buy-time view.

**The ladder cannot rise.** Enforced structurally. A perishable good does not
get more askable as it approaches expiry, and a curve that rises means the
anchors are denominated inconsistently — which they were.

## Known limitations

- **Quotes are event-level.** A pair in row 3 is compared against a get-in
  that may be an upper-bowl single. `Quote.section` exists and the store keys
  on it; populating section-level comps is the main upgrade path.
- **Venue capacity is operator-maintained.** Discovery does not return it.
  Unknown venues abstain on the strongest pre-onsale signal.
- **Monthly listeners are not in Spotify's API.** `draw_proxy` scales
  followers by a crude constant. The derivative (90-day growth) carries the
  weight and is immune to the scaling error.
- **Fee presets are estimates.** Calibrate from receipts.
- **No transfer-restriction data.** Nothing here can see that a tour is
  non-transferable. Check the event page before buying.
- **Weights are priors, not fitted.** Until you have 25 realized sales.

## Extending

Add a source by implementing `available()` plus one of `search_events()`,
`quote_for()`, or `enrich()`, then registering it in
`sources.build_registry()`. The protocols are structural — no base class.

The most valuable additions, in order: section-level comps; a real venue
capacity table; a marketplace seller API so `pricing.ladder()` can push
prices instead of printing them.
