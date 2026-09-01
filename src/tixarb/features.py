"""Feature extraction: turning raw event data into normalized signals.

Every feature returns a value in [0, 1] plus a plain-English rationale, and
may *abstain* when the underlying data is missing. Abstention is the point:
a scoring system that silently substitutes a default for absent data produces
confident nonsense, and the resulting number looks exactly like a real one.
Missing features drop out of the weighted average and pull ``confidence``
down instead.

The features are grouped by when they become knowable:

  pre-onsale   -- artist demand, momentum, venue scarcity, date density,
                  weekday, lead time, prestige tags, face headroom.
                  These are all you have when the buy decision is made.
  post-onsale  -- float thinness, realized premium. Far more predictive, but
                  they arrive after you have already committed capital, so
                  they drive the *sell* side: hold, reprice, or dump.

Treating those as one undifferentiated pile is the classic backtest error:
a model that scores beautifully using float data is useless at the only
moment the buy decision exists.
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass
from typing import Optional

from .models import Event, Quote, utcnow

# Feature availability phase.
PRE_ONSALE = "pre_onsale"
POST_ONSALE = "post_onsale"


@dataclass(frozen=True)
class Signal:
    name: str
    value: Optional[float]      # None = abstained
    weight: float
    phase: str
    rationale: str

    @property
    def available(self) -> bool:
        return self.value is not None


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def normalize(x: float, lo: float, hi: float) -> float:
    """Linear map of ``x`` from [lo, hi] onto [0, 1], clamped at the ends."""
    if hi == lo:
        return 0.5
    return clamp01((x - lo) / (hi - lo))


def _abstain(name: str, weight: float, phase: str, why: str) -> Signal:
    return Signal(name, None, weight, phase, f"no signal: {why}")


# --------------------------------------------------------------------------
# Pre-onsale features
# --------------------------------------------------------------------------

def artist_demand(event: Event, weight: float = 1.0) -> Signal:
    """Raw pull of the headliner, from streaming reach and popularity index."""
    artist = event.headliner
    if artist is None or (artist.monthly_listeners <= 0 and artist.popularity <= 0):
        return _abstain("artist_demand", weight, PRE_ONSALE, "no artist metrics")

    parts, why = [], []
    if artist.monthly_listeners > 0:
        # 50k listeners -> 0, 50M -> 1, log-scaled: demand spans four orders
        # of magnitude and a linear scale would collapse everything below
        # stadium acts into a single bucket.
        listeners = normalize(math.log10(artist.monthly_listeners), 4.7, 7.7)
        parts.append(listeners)
        why.append(f"{artist.monthly_listeners:,} monthly listeners")
    if artist.popularity > 0:
        parts.append(artist.popularity / 100.0)
        why.append(f"popularity {artist.popularity}/100")

    value = sum(parts) / len(parts)
    return Signal("artist_demand", value, weight, PRE_ONSALE, ", ".join(why))


def momentum(event: Event, weight: float = 1.0) -> Signal:
    """Trailing 90-day follower growth.

    A rising act sells out a room booked against last year's numbers -- the
    venue was sized for who they were when the tour was routed, typically
    six to twelve months before the show. That lag is where the markup
    lives. A flat or declining act in a room booked at its peak is the
    mirror image, and the most common way to get stuck holding.
    """
    artist = event.headliner
    if artist is None:
        return _abstain("momentum", weight, PRE_ONSALE, "no artist")
    growth = artist.follower_growth_90d
    if growth is None:
        return _abstain("momentum", weight, PRE_ONSALE,
                        "no 90-day follower history yet")
    # -10% -> 0, +50% -> 1. Flat growth lands at 0.17, deliberately low:
    # a static fanbase is a mildly bearish signal, not a neutral one.
    value = normalize(growth, -0.10, 0.50)
    return Signal("momentum", value, weight, PRE_ONSALE,
                  f"{growth:+.1%} follower growth over 90d")


def venue_scarcity(event: Event, weight: float = 1.0) -> Signal:
    """Artist draw measured against the size of the room they booked.

    The single most reliable pre-onsale signal. A large act in a small room
    is a supply shortage that resale prices resolve; the same act in a
    stadium has no shortage to resolve. Underplays -- a headliner doing a
    club show -- are where the biggest multiples come from.
    """
    artist = event.headliner
    capacity = event.venue.capacity if event.venue else 0
    if artist is None or artist.monthly_listeners <= 0:
        return _abstain("venue_scarcity", weight, PRE_ONSALE, "no listener data")
    if capacity <= 0:
        return _abstain("venue_scarcity", weight, PRE_ONSALE, "unknown venue capacity")

    # Sublinear draw proxy: national streaming reach converts to local ticket
    # demand at a steeply diminishing rate.
    draw = math.sqrt(artist.monthly_listeners)
    ratio = draw / capacity
    value = normalize(math.log10(ratio), -1.0, 1.0)
    return Signal("venue_scarcity", value, weight, PRE_ONSALE,
                  f"draw proxy {draw:,.0f} vs {capacity:,} capacity "
                  f"(ratio {ratio:.2f})")


def date_density(event: Event, competing_dates: int, weight: float = 1.0) -> Signal:
    """How many other dates compete for the same local audience.

    Demand is metro-local. One Chicago night is scarce; four Chicago nights
    on the same tour are four sellers of the same thing, and the last one
    prices the market.
    """
    if competing_dates < 1:
        return _abstain("date_density", weight, PRE_ONSALE, "metro not indexed")
    extra = competing_dates - 1
    value = clamp01(1.0 / (1.0 + 0.9 * extra))
    label = "single date in metro" if extra == 0 else f"{competing_dates} dates in metro"
    return Signal("date_density", value, weight, PRE_ONSALE, label)


_WEEKDAY_SCORE = {0: 0.25, 1: 0.25, 2: 0.35, 3: 0.55, 4: 0.90, 5: 1.00, 6: 0.55}
_WEEKDAY_NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                 "Saturday", "Sunday"]


def weekday_premium(event: Event, weight: float = 1.0) -> Signal:
    """Friday and Saturday shows clear at a premium; Monday and Tuesday do not."""
    wd = event.local_weekday
    return Signal("weekday_premium", _WEEKDAY_SCORE.get(wd, 0.4), weight, PRE_ONSALE,
                  f"{_WEEKDAY_NAME[wd]} show")


def lead_time(event: Event, at: Optional[dt.datetime] = None,
              weight: float = 1.0) -> Signal:
    """Runway between onsale and showtime.

    Too short and there is no time for a market to form around your listing;
    too long and you carry inventory through months in which the act can
    cool off, a bigger local competitor can be announced, or the tour can add
    dates. The workable band is roughly six weeks to five months out.
    """
    window = event.first_sale_window
    if window is None:
        return _abstain("lead_time", weight, PRE_ONSALE, "no onsale date known")
    days = (event.starts_at - window.starts_at).total_seconds() / 86400.0
    if days <= 0:
        return _abstain("lead_time", weight, PRE_ONSALE, "onsale after event start")
    if days < 45:
        value = normalize(days, 7, 45) * 0.7
        why = f"{days:.0f}d runway (tight)"
    elif days <= 150:
        value = 1.0
        why = f"{days:.0f}d runway (ideal band)"
    else:
        value = normalize(400 - days, 0, 250)
        why = f"{days:.0f}d runway (long carry)"
    return Signal("lead_time", clamp01(value), weight, PRE_ONSALE, why)


# Step-change demand markers. No API exposes these cleanly, so they are
# operator-set tags on the event -- and they are worth the manual entry:
# a farewell tour is a different asset from a routine touring cycle.
PRESTIGE_TAGS = {
    "final-tour": 1.0, "farewell": 1.0, "reunion": 0.95, "last-show": 1.0,
    "anniversary": 0.7, "residency-debut": 0.7, "one-night-only": 0.85,
    "festival-headline": 0.6, "album-release": 0.5, "hometown": 0.6,
    "surprise-show": 0.9, "underplay": 0.95,
}


def prestige(event: Event, weight: float = 1.0) -> Signal:
    """Scarcity that comes from the occasion rather than the room."""
    hits = [(t, PRESTIGE_TAGS[t]) for t in event.tags if t in PRESTIGE_TAGS]
    if not hits:
        # Absence of a tag is real information -- a routine tour date -- not
        # missing data, so this scores low rather than abstaining.
        return Signal("prestige", 0.25, weight, PRE_ONSALE, "routine tour date")
    best = max(hits, key=lambda h: h[1])
    return Signal("prestige", best[1], weight, PRE_ONSALE,
                  f"tagged {', '.join(t for t, _ in hits)}")


def face_headroom(event: Event, weight: float = 1.0) -> Signal:
    """Cheap face value in a desirable room leaves more room to mark up.

    Underpriced primary inventory is the raw material of the whole trade.
    When a promoter prices a hot show at $45 face, the gap between face and
    clearing price is the entire opportunity; when they price the same show
    at $250, the promoter has already captured it.
    """
    face = event.face_mid
    if face <= 0:
        return _abstain("face_headroom", weight, PRE_ONSALE, "no published face value")
    # $250 face -> 0, $25 face -> 1. Inverted: lower face, more headroom.
    value = 1.0 - normalize(float(face), 25.0, 250.0)
    return Signal("face_headroom", value, weight, PRE_ONSALE,
                  f"${face} face midpoint")


# --------------------------------------------------------------------------
# Post-onsale features (sell-side only)
# --------------------------------------------------------------------------

def float_thinness(event: Event, quote: Optional[Quote],
                   weight: float = 1.0) -> Signal:
    """Listed supply as a share of house capacity.

    The best-known predictor of which way late prices break. Under ~3% of
    the house listed and the remaining sellers hold pricing power; over ~10%
    and they are competing with each other into the floor on show day.
    """
    if quote is None:
        return _abstain("float_thinness", weight, POST_ONSALE, "no market quote yet")
    capacity = event.venue.capacity if event.venue else 0
    ratio = quote.float_ratio(capacity)
    if ratio is None:
        return _abstain("float_thinness", weight, POST_ONSALE, "unknown capacity")
    value = 1.0 - normalize(ratio, 0.02, 0.12)
    return Signal("float_thinness", value, weight, POST_ONSALE,
                  f"{quote.ticket_count:,} seats listed = {ratio:.1%} of house")


def realized_premium(event: Event, quote: Optional[Quote],
                     weight: float = 1.0) -> Signal:
    """What the secondary market is actually paying, relative to face.

    Once this exists it dominates every forecast built to predict it. The
    market has already voted; the model's job shifts from prediction to
    deciding whether the current price is a good exit.
    """
    if quote is None or quote.get_in <= 0:
        return _abstain("realized_premium", weight, POST_ONSALE, "no market quote yet")
    face = event.face_mid
    if face <= 0:
        return _abstain("realized_premium", weight, POST_ONSALE, "no face value")
    multiple = float(quote.get_in) / float(face)
    value = normalize(multiple, 0.6, 3.0)
    return Signal("realized_premium", value, weight, POST_ONSALE,
                  f"get-in ${quote.get_in} = {multiple:.2f}x face")


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------

# Weights are the model's priors, deliberately kept in one visible table
# rather than scattered through the code. scoring.calibrate() refits them
# against realized sales once enough history exists.
DEFAULT_WEIGHTS = {
    "artist_demand": 1.0,
    "momentum": 1.4,
    "venue_scarcity": 2.0,
    "date_density": 1.2,
    "weekday_premium": 0.6,
    "lead_time": 0.5,
    "prestige": 1.3,
    "face_headroom": 1.1,
    "float_thinness": 2.2,
    "realized_premium": 2.5,
}


def extract(event: Event, quote: Optional[Quote] = None,
            competing_dates: int = 1, weights: Optional[dict] = None,
            at: Optional[dt.datetime] = None,
            include_post_onsale: bool = True) -> list:
    """Build the full signal set for one event.

    Set ``include_post_onsale=False`` to score the way you would have had to
    at buy time. Do that when backtesting -- otherwise the model gets to see
    the market data that only exists after the decision it is being graded on.
    """
    w = dict(DEFAULT_WEIGHTS)
    if weights:
        w.update(weights)

    signals = [
        artist_demand(event, w["artist_demand"]),
        momentum(event, w["momentum"]),
        venue_scarcity(event, w["venue_scarcity"]),
        date_density(event, competing_dates, w["date_density"]),
        weekday_premium(event, w["weekday_premium"]),
        lead_time(event, at, w["lead_time"]),
        prestige(event, w["prestige"]),
        face_headroom(event, w["face_headroom"]),
    ]
    if include_post_onsale:
        signals.append(float_thinness(event, quote, w["float_thinness"]))
        signals.append(realized_premium(event, quote, w["realized_premium"]))
    return signals


def composite(signals: list) -> tuple:
    """Collapse signals to ``(score, confidence)``.

    ``score`` is the weight-average over *available* signals only.
    ``confidence`` is the share of total weight that was actually available,
    so an event scored from two of ten signals is visibly a guess.
    """
    live = [s for s in signals if s.available]
    if not live:
        return 0.0, 0.0
    total_weight = sum(s.weight for s in signals) or 1.0
    live_weight = sum(s.weight for s in live)
    score = sum(s.value * s.weight for s in live) / live_weight
    return clamp01(score), clamp01(live_weight / total_weight)


def as_dict(signals: list) -> dict:
    """Feature vector for storage and later calibration."""
    return {s.name: s.value for s in signals if s.available}
