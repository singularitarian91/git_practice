# tixarb

Decision support for buying and reselling event tickets.

Scans official APIs for upcoming onsales, forecasts which shows will carry the
largest resale markup, sizes positions against the fee stack and your
bankroll, alerts you before each buying window opens, and then runs the exit —
a repricing schedule from listing to showtime, plus P&L and risk tracking.

Pure standard library. No dependencies, no build step.

```bash
python3 -m tixarb demo     # whole pipeline, offline, no API keys
```

## The number that decides everything

```
$ python3 -m tixarb fees

    face    landed  fee load  breakeven  x face  buyer sees
   35.00     50.48     44.2%      58.02   1.66x       72.53
   55.00     74.48     35.4%      85.61   1.56x      107.01
   85.00    110.48     30.0%     126.99   1.49x      158.74
  195.00    242.48     24.3%     278.71   1.43x      348.39
```

Every row is the resale price that returns your capital **and nothing more**.
A $35 ticket has to resell at $58 to break even — a 66% markup for zero
profit.

The round trip carries two fee stacks: roughly 20-35% over face going in, and
10-15% of the sale coming out. Comparing a resale price to *face* rather than
to landed cost plus the seller's cut is the single most common way people book
a loss as a win. Everything else in this repo is downstream of that table.

## What it automates, and what it will not

| | |
|---|---|
| Discovering events, onsales, and **presale windows** | automated |
| Artist demand and 90-day momentum tracking | automated |
| Venue capacity and resale comps | automated |
| Markup forecast, position sizing, EV | automated |
| Alerts at 24h / 1h / 10min, plus an iCal feed | automated |
| **Buying** | **you, within the posted limits** |
| Repricing your listings, P&L, risk | automated |

The purchase step is not automated because the US **BOTS Act** makes it
unlawful to circumvent a ticket seller's access controls, CAPTCHAs, queues, or
posted purchase limits — and to sell tickets you know were acquired that way.
This system alerts a human who buys like anyone else. See
[docs/LEGAL.md](docs/LEGAL.md).

That is a smaller handicap than it sounds. The edge in this business is
preparation and exit discipline, not milliseconds — most desirable inventory
never reaches the public onsale at all, and the gate on a presale is
eligibility you can arrange weeks ahead. See
[docs/PLAYBOOK.md](docs/PLAYBOOK.md).

For the same reason there is no scraper for resale marketplaces. Where no
official feed exists, comps are hand-entered.

## Quickstart

```bash
git clone <this repo> && cd git_practice
python3 -m tixarb demo                    # see it work, no setup

python3 -m tixarb init                    # config + database
export TICKETMASTER_API_KEY=...           # onsale + presale timing
export SEATGEEK_CLIENT_ID=...             # capacity + resale comps
export SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=...

python3 -m tixarb watch add "Artist Name" --max-face 120
python3 -m tixarb scan                    # discover, snapshot, queue alerts
python3 -m tixarb rank --explain 3        # what is worth buying, and why
python3 -m tixarb calendar --out onsales.ics
```

All three APIs are free and self-serve. Each is optional; the pipeline runs on
whatever is configured. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

**Start scanning months before you intend to trade.** The momentum signal
needs 90 days of follower history and cannot be backfilled.

## How a forecast reads

```
$ python3 -m tixarb rank --fixtures --explain 1

Ascendant at Bowery Ballroom
score 0.92 (confidence 66%) -> 3.06x face median, p10 1.68x / p90 5.58x
    realized_premium    --   w=2.5  no signal: no market quote yet
    float_thinness      --   w=2.2  no signal: no market quote yet
    venue_scarcity     0.88  w=2.0  draw proxy 3,376 vs 575 capacity (ratio 5.87)
    momentum           1.00  w=1.4  +69.2% follower growth over 90d
    prestige           0.95  w=1.3  tagged underplay
    date_density       1.00  w=1.2  single date in metro
    face_headroom      0.87  w=1.1  $55.00 face midpoint
    artist_demand      0.75  w=1.0  11,400,000 monthly listeners, popularity 71/100
    weekday_premium    1.00  w=0.6  Saturday show
    lead_time          1.00  w=0.5  71d runway (ideal band)
    -> BUY: ask 124.28 (2.76x face) vs breakeven 71.82 (1.60x).
       p(clear)=59%, EV 13.66/ticket, ROI +21.9%
```

Every signal shows its value, its weight, and why. Signals **abstain** when
data is missing — they drop out and pull `confidence` down, rather than
defaulting to a middle value that is indistinguishable from a measured one.

The forecast is a distribution, not a point estimate, because the decision is
not "what will this sell for" but "what is the chance it clears above my
breakeven" — which is what position sizing needs.

## Working an exit

```
$ python3 -m tixarb price --ladder

p1  Ascendant at Ryman Auditorium
  REPRICE @ 247.50 (buyer sees 309.38, you net 215.33, above breakeven 91.13)
  -- 40d out. float thin (0.79)

  date          days       ask  buyer sees       net    vs BE
  2026-09-01      40    247.50      309.38    215.33   156.37
  2026-09-13      28    238.43      298.04    207.43   147.30
  2026-09-25      16    221.95      277.44    193.10   130.82
  2026-10-07       4    198.88      248.60    173.03   107.75
```

(Fixture dates are relative to today, so the demo's exact figures shift.)

The curve decays from an ambitious ask toward a clearing price, shaped by
observed float: a thin float earns the right to concede slowly, a saturated
one does not. It is guaranteed monotone non-increasing — a perishable good
does not get more askable as it nears expiry.

When the market falls below breakeven with weeks left, `price` says `dump` and
shows you a loss. Taking it is the point. An unsold ticket is worth zero at
doors, and holding for "at least breakeven" is what turns a recoverable 30%
loss into a total one.

## Commands

| | |
|---|---|
| `demo` | whole pipeline offline on fixtures |
| `fees` | the breakeven table |
| `watch add/list/rm` | manage the watchlist |
| `scan` | fetch events, snapshot metrics, queue and send alerts |
| `rank [--explain N]` | rank by expected value |
| `calendar --out f.ics` | onsale calendar with alarms |
| `buy --paid` | record a position from a real receipt |
| `quote` | record a hand-read comp |
| `price [--ladder]` | repricing advice |
| `sold` / `pnl` | realized P&L, exposure, warnings |
| `calibrate` | refit weights on your own sales |

## Making it yours

Two things ship as **priors, not truth**:

- **Fee rates** are estimates. `buy --paid <order total>` back-solves your real
  fee load and prints it against the model's assumption. Two or three receipts
  and every breakeven number becomes correct instead of plausible.
- **Signal weights** are informed guesses. Record sales with `sold`, then
  `calibrate` refits them by ridge regression. It refuses under 25 realized
  sales and says so — a ten-feature fit on a dozen sales is memorization, and
  shipping it would replace defensible priors with noise that looks like
  science.

## Tests

```bash
PYTHONPATH=src:tests python3 -m unittest discover -s tests -t tests
```

169 tests, fully offline. A test that reaches a live API is a test of that
API's uptime.

## Docs

- [LEGAL.md](docs/LEGAL.md) — what is and is not lawful, and why the
  architecture looks like this
- [PLAYBOOK.md](docs/PLAYBOOK.md) — where the edge actually is
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — module map, modelling decisions,
  known limitations
- [DATA_SOURCES.md](docs/DATA_SOURCES.md) — API setup and gotchas

## Honest expectations

Most events you scan are negative expected value after fees, and the correct
action on the large majority is to pass. A system whose main output is "no" is
working. Capital is illiquid until the event; 90-day holds are normal. Every
input here — fee rates, capacities, follower ratios, salvage assumptions — is
an estimate, so this is a disciplined way to be roughly right, not a way to be
precisely right.

---

*This repository also contains `visualizer.html`, an unrelated earlier
experiment.*
