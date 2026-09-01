"""Domain models.

The shapes here deliberately mirror what the primary-market APIs actually
return (Ticketmaster Discovery in particular: UTC instant *and* venue-local
wall clock, price ranges rather than exact face values, presale windows as a
list). Adapters normalize into these; everything downstream reads only these.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field, replace
from decimal import Decimal
from enum import Enum
from typing import Optional

from .money import ZERO, money

UTC = dt.timezone.utc


def utcnow() -> dt.datetime:
    return dt.datetime.now(tz=UTC)


def _aware(value: Optional[dt.datetime]) -> Optional[dt.datetime]:
    """Force a datetime to be timezone-aware, assuming UTC if naive."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class OnsaleKind(str, Enum):
    """How a purchase window is gated.

    The distinction drives strategy, not just labelling: PUBLIC windows are
    where bot-driven competition is fiercest and where purchase-limit
    circumvention is illegal (BOTS Act); the gated windows are where a
    legitimate operator actually gets allocation, because eligibility is the
    scarce resource rather than milliseconds.
    """

    PUBLIC = "public"
    ARTIST_PRESALE = "artist_presale"
    FANCLUB = "fanclub"
    CARDHOLDER = "cardholder"
    VENUE = "venue"
    RADIO_LOCAL = "radio_local"
    VERIFIED_FAN = "verified_fan"
    OTHER = "other"


class PositionStatus(str, Enum):
    HELD = "held"
    LISTED = "listed"
    SOLD = "sold"
    EXPIRED = "expired"  # event passed with the ticket unsold
    REFUNDED = "refunded"


@dataclass(frozen=True)
class Venue:
    id: str
    name: str
    city: str = ""
    region: str = ""          # state / province
    country: str = "US"
    capacity: int = 0
    timezone: str = "America/New_York"
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    @property
    def metro(self) -> str:
        """Coarse market key. Two dates in the same metro compete with each other."""
        return f"{self.city}|{self.region}".lower()


@dataclass(frozen=True)
class Artist:
    id: str
    name: str
    spotify_id: Optional[str] = None
    # Spotify popularity index, 0-100. A relative, decayed play-count measure.
    popularity: int = 0
    followers: int = 0
    # Follower count snapshotted ~90 days ago, for momentum. None = unknown.
    followers_90d_ago: Optional[int] = None
    monthly_listeners: int = 0
    genres: tuple = ()

    @property
    def follower_growth_90d(self) -> Optional[float]:
        """Fractional follower growth over the trailing 90 days."""
        if not self.followers_90d_ago or self.followers_90d_ago <= 0:
            return None
        return (self.followers - self.followers_90d_ago) / self.followers_90d_ago

    @property
    def draw_proxy(self) -> int:
        """Best available estimate of national audience size.

        Prefers monthly listeners when known. Spotify's Web API does not
        expose that figure, so the fallback scales follower count -- see
        FOLLOWERS_TO_LISTENERS in the Spotify adapter for the ratio and its
        caveats. Returns 0 when neither is known, so features abstain rather
        than score a fabricated audience.
        """
        if self.monthly_listeners > 0:
            return self.monthly_listeners
        if self.followers > 0:
            return int(self.followers * 12)
        return 0


@dataclass(frozen=True)
class SaleWindow:
    """A window in which tickets can be bought on the primary market."""

    kind: OnsaleKind
    starts_at: dt.datetime
    ends_at: Optional[dt.datetime] = None
    name: str = ""
    # True when a code you must already possess is required. These are the
    # windows worth building eligibility for ahead of time.
    code_required: bool = False

    def __post_init__(self):
        object.__setattr__(self, "starts_at", _aware(self.starts_at))
        object.__setattr__(self, "ends_at", _aware(self.ends_at))

    def is_open(self, at: Optional[dt.datetime] = None) -> bool:
        at = _aware(at) or utcnow()
        if at < self.starts_at:
            return False
        return self.ends_at is None or at <= self.ends_at


@dataclass(frozen=True)
class Event:
    id: str
    name: str
    starts_at: dt.datetime            # UTC instant of doors/showtime
    venue: Venue
    artists: tuple = ()               # tuple[Artist, ...], headliner first
    local_start: Optional[dt.datetime] = None   # naive venue-local wall clock
    sale_windows: tuple = ()          # tuple[SaleWindow, ...]
    face_min: Decimal = ZERO          # primary-market price range, ex-fees
    face_max: Decimal = ZERO
    source: str = "unknown"
    url: str = ""
    # Free-form tags from the source or hand-annotated: "final-tour",
    # "reunion", "festival", "residency". These carry real signal and no
    # API exposes them cleanly, so they stay operator-editable.
    tags: tuple = ()

    def __post_init__(self):
        object.__setattr__(self, "starts_at", _aware(self.starts_at))
        object.__setattr__(self, "face_min", money(self.face_min))
        object.__setattr__(self, "face_max", money(self.face_max))

    @property
    def headliner(self) -> Optional[Artist]:
        return self.artists[0] if self.artists else None

    @property
    def face_mid(self) -> Decimal:
        """Midpoint of the published price range.

        Primary sellers publish a range spanning nosebleeds to floor. The
        midpoint is a crude stand-in used only where a single anchor is
        needed; real positions carry their actual paid face value.
        """
        if self.face_max <= ZERO:
            return self.face_min
        if self.face_min <= ZERO:
            return self.face_max
        return money((self.face_min + self.face_max) / 2)

    @property
    def public_onsale(self) -> Optional[SaleWindow]:
        pub = [w for w in self.sale_windows if w.kind == OnsaleKind.PUBLIC]
        return min(pub, key=lambda w: w.starts_at) if pub else None

    @property
    def first_sale_window(self) -> Optional[SaleWindow]:
        return min(self.sale_windows, key=lambda w: w.starts_at) if self.sale_windows else None

    def days_until(self, at: Optional[dt.datetime] = None) -> float:
        at = _aware(at) or utcnow()
        return (self.starts_at - at).total_seconds() / 86400.0

    @property
    def local_weekday(self) -> int:
        """0=Mon .. 6=Sun, in venue-local time where known."""
        ref = self.local_start or self.starts_at
        return ref.weekday()

    def with_tags(self, *tags: str) -> "Event":
        return replace(self, tags=tuple(dict.fromkeys(self.tags + tags)))


@dataclass(frozen=True)
class Quote:
    """One observation of the secondary market for an event.

    ``get_in`` is the cheapest available seat -- the number that actually
    governs whether your listing sells, because that is what a buyer sorting
    by price sees first.
    """

    event_id: str
    observed_at: dt.datetime
    source: str
    get_in: Decimal = ZERO            # cheapest listing, seller-side price
    median: Decimal = ZERO            # median listing price
    listing_count: int = 0            # distinct listings
    ticket_count: int = 0             # total seats listed across listings
    section: str = ""                 # "" = whole-event aggregate

    def __post_init__(self):
        object.__setattr__(self, "observed_at", _aware(self.observed_at))
        object.__setattr__(self, "get_in", money(self.get_in))
        object.__setattr__(self, "median", money(self.median))

    def float_ratio(self, capacity: int) -> Optional[float]:
        """Listed seats as a fraction of house capacity.

        The single best-known predictor of terminal price direction. Under
        ~3% and late-window prices tend to firm; over ~10% and the seller
        side is racing itself to the floor.
        """
        if not capacity or capacity <= 0:
            return None
        return self.ticket_count / capacity


@dataclass
class Position:
    """Tickets actually owned, with cost basis."""

    id: str
    event_id: str
    qty: int
    face_each: Decimal                # published face, ex-fees
    cost_each: Decimal                # all-in landed cost incl. fees + tax
    purchased_at: dt.datetime
    section: str = ""
    row: str = ""
    status: PositionStatus = PositionStatus.HELD
    listed_price: Optional[Decimal] = None   # current seller-side ask, per ticket
    sold_price: Optional[Decimal] = None     # realized seller-side price, per ticket
    sold_at: Optional[dt.datetime] = None
    marketplace: str = ""
    notes: str = ""

    def __post_init__(self):
        self.purchased_at = _aware(self.purchased_at)
        self.sold_at = _aware(self.sold_at)
        self.face_each = money(self.face_each)
        self.cost_each = money(self.cost_each)
        if self.listed_price is not None:
            self.listed_price = money(self.listed_price)
        if self.sold_price is not None:
            self.sold_price = money(self.sold_price)
        if isinstance(self.status, str):
            self.status = PositionStatus(self.status)

    @property
    def cost_total(self) -> Decimal:
        return money(self.cost_each * self.qty)

    @property
    def is_open(self) -> bool:
        return self.status in (PositionStatus.HELD, PositionStatus.LISTED)

    def holding_days(self, at: Optional[dt.datetime] = None) -> float:
        end = self.sold_at or _aware(at) or utcnow()
        return max(0.0, (end - self.purchased_at).total_seconds() / 86400.0)


@dataclass(frozen=True)
class WatchItem:
    """A standing interest in an artist/market, used by the onsale watcher."""

    id: str
    query: str                        # artist name or keyword
    max_face: Optional[Decimal] = None
    markets: tuple = ()               # metro keys; empty = anywhere
    min_score: float = 0.0            # suppress alerts below this markup score
    active: bool = True

    def __post_init__(self):
        if self.max_face is not None:
            object.__setattr__(self, "max_face", money(self.max_face))
