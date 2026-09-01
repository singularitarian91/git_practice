# Data sources

All three are official, documented, free-tier APIs. Each is optional — the
registry skips unconfigured adapters, and the pipeline runs on whatever is
available. `tixarb sources` shows what is live.

## Ticketmaster Discovery API

**Gives you:** the event catalogue, the public onsale instant, and the full
presale schedule with presale *names*. That last one is the most valuable
field in the entire system — see the playbook.

**Get a key:** developer.ticketmaster.com, free, self-serve.
**Limits:** 5,000 calls/day, 5 requests/second at time of writing. The
adapter is capped at 3/sec with jittered backoff that honours `Retry-After`.

```bash
export TICKETMASTER_API_KEY=...
```

**Gaps:**
- **No venue capacity.** The strongest pre-onsale signal depends on it, so it
  comes from `venue_capacity` in your config, keyed by venue id or lowercased
  venue name. `SEED_CAPACITIES` ships with a few dozen well-known rooms.
- **`priceRanges` spans the whole house** and often omits fees. An anchor, not
  a face value. Real positions carry what you actually paid.
- **Presale gating is not machine-readable.** The adapter classifies presale
  names by keyword into verified-fan / cardholder / fan club / venue / radio.
  Whether *you* can pass a given gate is not in the API.

## SeatGeek Platform API

**Gives you:** venue capacity (which fills Ticketmaster's biggest gap) and an
official `stats` block per event — listing count, visible listings, lowest and
median price. Legitimate secondary-market comps with no scraping.

**Get a key:** seatgeek.com/build, free, self-serve.

```bash
export SEATGEEK_CLIENT_ID=...
export SEATGEEK_CLIENT_SECRET=...   # optional
```

**Calibrate this before trusting it.** Whether `lowest_price` is fee-inclusive
depends on the account and has changed over time; since the FTC all-in pricing
rule it is usually the buyer's total. Everything downstream treats quotes as
*seller-side* prices. Check one event against the site and set
`SeatGeekSource(prices_are_all_in=...)` accordingly — getting it backwards
biases every comp by 25-30%, which is larger than most margins here.

Ids do not cross providers, so `quote_for()` matches a Ticketmaster event by
performer name plus a one-day date window, preferring a city match.

## Spotify Web API

**Gives you:** follower count, a 0-100 popularity index, and genres, via
client-credentials (no user data).

**Get a key:** developer.spotify.com/dashboard, free.

```bash
export SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=...
```

**It does not expose monthly listeners.** That number lives on the artist's
web profile, not the API, and scraping it is a terms violation.
`Artist.draw_proxy` falls back to `followers × 12`, which is crude and
documented as such — the ratio varies widely by genre and catalogue age.

It matters less than it looks. The signal doing the work is the *derivative*:
90-day follower growth, measured against your own snapshots, which is immune
to the scaling error in the level. Which is why:

**Start scanning months before you intend to trade.** `momentum` abstains
until the database holds 90 days of history. `artist_metrics` is append-only
and cannot be backfilled — a snapshot not taken is gone.

## Manual quotes

For anything with no official feed:

```bash
tixarb quote tm:XXXX --get-in 165 --median 210 --listings 42 --tickets 84
```

`--tickets` (seats listed) drives the float ratio, which predicts terminal
price direction better than price level does. Hand-entered quotes go stale
after 5 days and stop being served, so a three-week-old comp cannot
masquerade as live data.

## What is deliberately absent

No scraper for StubHub, Vivid Seats, or Ticketmaster listing pages. See
[LEGAL.md](LEGAL.md#why-there-is-no-marketplace-scraper).

## Adding a source

Implement `available()` plus one of `search_events()`, `quote_for()`, or
`enrich()`, and register it in `sources.build_registry()`. The protocols are
structural, so there is no base class to inherit. A source that raises is
recorded in `registry.errors` and skipped — one dead API never aborts a scan.

The highest-value addition is a marketplace **seller** API (StubHub Pro,
SeatGeek Enterprise, Ticketmaster TradeDesk). Those are built for
programmatic repricing of your own listings, which is ordinary commerce and
fully automatable — it would let `pricing.ladder()` push prices instead of
printing them.
