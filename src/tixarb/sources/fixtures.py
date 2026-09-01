"""Offline fixtures and manually entered comps.

Two things live here.

:class:`FixtureSource` is a synthetic event set covering the cases the model
has to get right: a rising act underplaying a club, a legacy act in an
oversized arena, an ordinary mid-tier date, and a post-onsale event whose
market has already spoken. It exists so the whole pipeline runs end to end
with no API keys -- for the demo, and more importantly for tests, which must
never depend on a live third party.

:class:`ManualQuotes` reads comps an operator entered by hand. That is not a
placeholder for a scraper that was too hard to write; it is the honest
interface for markets with no official feed. Ten seconds spent reading the
get-in price off a listing page and typing it in is legitimate, accurate,
and cannot get an account banned.
"""

from __future__ import annotations

import datetime as dt
from typing import Optional

from ..models import (
    Artist, Event, OnsaleKind, Quote, SaleWindow, Venue, utcnow,
)


def _demo_events(now: Optional[dt.datetime] = None) -> list:
    now = now or utcnow()
    day = dt.timedelta(days=1)

    bowery = Venue("fx:bowery", "Bowery Ballroom", "New York", "NY", capacity=575)
    united = Venue("fx:united", "United Center", "Chicago", "IL", capacity=23500)
    wiltern = Venue("fx:wiltern", "The Wiltern", "Los Angeles", "CA", capacity=1850)
    ryman = Venue("fx:ryman", "Ryman Auditorium", "Nashville", "TN", capacity=2362)

    # Steep momentum, tiny room: the textbook underplay.
    rising = Artist("fx:rising", "Ascendant", popularity=71,
                    followers=880_000, followers_90d_ago=520_000,
                    monthly_listeners=11_400_000, genres=("indie pop",))
    # Flat-to-declining, oversized room: the textbook trap.
    legacy = Artist("fx:legacy", "Heritage Sound", popularity=54,
                    followers=1_240_000, followers_90d_ago=1_268_000,
                    monthly_listeners=2_900_000, genres=("classic rock",))
    midtier = Artist("fx:midtier", "Middle Distance", popularity=61,
                     followers=410_000, followers_90d_ago=372_000,
                     monthly_listeners=3_600_000, genres=("americana",))

    return [
        Event(
            id="fx:1", name="Ascendant at Bowery Ballroom",
            starts_at=now + 74 * day, venue=bowery, artists=(rising,),
            local_start=(now + 74 * day).replace(tzinfo=None, hour=21, minute=0),
            sale_windows=(
                SaleWindow(OnsaleKind.FANCLUB, now + 3 * day, name="Artist presale",
                           code_required=True),
                SaleWindow(OnsaleKind.PUBLIC, now + 5 * day, name="public onsale"),
            ),
            face_min=45, face_max=65, source="fixture", tags=("underplay",),
        ),
        Event(
            id="fx:2", name="Heritage Sound at United Center",
            starts_at=now + 120 * day, venue=united, artists=(legacy,),
            local_start=(now + 120 * day).replace(tzinfo=None, hour=20, minute=0),
            sale_windows=(SaleWindow(OnsaleKind.PUBLIC, now + 6 * day),),
            face_min=95, face_max=295, source="fixture",
        ),
        Event(
            id="fx:3", name="Middle Distance at The Wiltern",
            starts_at=now + 61 * day, venue=wiltern, artists=(midtier,),
            local_start=(now + 61 * day).replace(tzinfo=None, hour=20, minute=30),
            sale_windows=(SaleWindow(OnsaleKind.PUBLIC, now + 4 * day),),
            face_min=55, face_max=85, source="fixture",
        ),
        # Already on sale: the market has spoken, so this one exercises the
        # post-onsale signals and the sell-side path.
        Event(
            id="fx:4", name="Ascendant at Ryman Auditorium",
            starts_at=now + 40 * day, venue=ryman, artists=(rising,),
            local_start=(now + 40 * day).replace(tzinfo=None, hour=20, minute=0),
            sale_windows=(SaleWindow(OnsaleKind.PUBLIC, now - 30 * day),),
            face_min=59, face_max=99, source="fixture", tags=("album-release",),
        ),
    ]


def _demo_quotes(now: Optional[dt.datetime] = None) -> dict:
    now = now or utcnow()
    return {
        # Thin float, trading well over face: holding pricing power.
        "fx:4": Quote("fx:4", now, "fixture", get_in=178, median=245,
                      listing_count=54, ticket_count=96),
        # Saturated float on the arena show: sellers racing each other down.
        "fx:2": Quote("fx:2", now, "fixture", get_in=64, median=118,
                      listing_count=1420, ticket_count=3100),
    }


class FixtureSource:
    """Synthetic events and quotes. Always available; never touches the network."""

    name = "fixture"

    def __init__(self, now: Optional[dt.datetime] = None):
        self.now = now
        self._events = _demo_events(now)
        self._quotes = _demo_quotes(now)

    def available(self) -> bool:
        return True

    def search_events(self, query: str, *, size: int = 50,
                      country: str = "US") -> list:
        needle = (query or "").strip().lower()
        if not needle:
            return list(self._events[:size])
        return [
            e for e in self._events
            if needle in e.name.lower()
            or any(needle in a.name.lower() for a in e.artists)
        ][:size]

    def quote_for(self, event: Event) -> Optional[Quote]:
        return self._quotes.get(event.id)


class ManualQuotes:
    """Comps typed in by the operator, read back from the store.

    Returns the most recent hand-entered quote for an event, and refuses to
    serve one older than ``max_age_days``. A three-week-old comp on a market
    that reprices hourly is worse than no comp: it is a stale number that
    looks current, and the model would weight it as heavily as live data.
    """

    name = "manual"

    def __init__(self, store, max_age_days: float = 5.0):
        self.store = store
        self.max_age_days = max_age_days

    def available(self) -> bool:
        return self.store is not None

    def quote_for(self, event: Event) -> Optional[Quote]:
        quote = self.store.latest_quote(event.id)
        if quote is None:
            return None
        age_days = (utcnow() - quote.observed_at).total_seconds() / 86400.0
        return quote if age_days <= self.max_age_days else None
