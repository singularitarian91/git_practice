"""Data source adapters.

Every adapter implements :class:`EventSource` and normalizes into the domain
models. Adapters are skipped, not fatal, when unconfigured, so a partial
credential setup still produces a working pipeline.

Scope note, because it decides the shape of this package: the adapters here
talk to *official, documented, key-issued APIs* -- Ticketmaster Discovery,
SeatGeek Platform, Spotify Web API -- within their published rate limits.
There is deliberately no scraper for a resale marketplace's web pages. That
is not squeamishness about difficulty: scraping those sites breaches their
terms of service, the anti-bot measures are exactly the "security measures"
the US BOTS Act makes it unlawful to circumvent for ticket purchasing, and a
data pipeline whose foundation can be pulled by a single ToS enforcement is
not a business. Where an official feed does not exist, this package takes
manually entered comps (:class:`ManualQuotes`) rather than pretending
otherwise.
"""

from __future__ import annotations

import datetime as dt
from typing import Iterable, Optional, Protocol, runtime_checkable

from ..models import Artist, Event, Quote


@runtime_checkable
class EventSource(Protocol):
    """A source of primary-market events and onsale timing."""

    name: str

    def available(self) -> bool:
        """True when this source has what it needs to run (usually a key)."""

    def search_events(self, query: str, *, size: int = 50,
                      country: str = "US") -> list:
        """Return events matching ``query`` as :class:`~tixarb.models.Event`."""


@runtime_checkable
class QuoteSource(Protocol):
    """A source of secondary-market pricing for a known event."""

    name: str

    def available(self) -> bool: ...

    def quote_for(self, event: Event) -> Optional[Quote]:
        """Current resale snapshot, or None when the event is not covered."""


@runtime_checkable
class ArtistEnricher(Protocol):
    """A source of artist-level demand metrics."""

    name: str

    def available(self) -> bool: ...

    def enrich(self, artist: Artist) -> Artist:
        """Return ``artist`` with metrics filled in where they were missing."""


class Registry:
    """Holds configured adapters and fans a query out across them.

    One misbehaving source must not take the run down: a source that raises
    is recorded in :attr:`errors` and the others still return. A scan that
    half-works and says so beats one that aborts because Spotify was down.
    """

    def __init__(self):
        self.event_sources: list = []
        self.quote_sources: list = []
        self.enrichers: list = []
        self.errors: list = []

    def register(self, adapter) -> "Registry":
        if isinstance(adapter, EventSource) and hasattr(adapter, "search_events"):
            self.event_sources.append(adapter)
        if isinstance(adapter, QuoteSource) and hasattr(adapter, "quote_for"):
            self.quote_sources.append(adapter)
        if isinstance(adapter, ArtistEnricher) and hasattr(adapter, "enrich"):
            self.enrichers.append(adapter)
        return self

    def active(self, adapters: list) -> list:
        return [a for a in adapters if a.available()]

    def search_events(self, query: str, **kwargs) -> list:
        found, seen = [], set()
        for source in self.active(self.event_sources):
            try:
                for event in source.search_events(query, **kwargs):
                    if event.id not in seen:
                        seen.add(event.id)
                        found.append(event)
            except Exception as exc:                      # noqa: BLE001
                self.errors.append(f"{source.name}: {exc}")
        return found

    def quote_for(self, event: Event) -> Optional[Quote]:
        for source in self.active(self.quote_sources):
            try:
                quote = source.quote_for(event)
                if quote is not None:
                    return quote
            except Exception as exc:                      # noqa: BLE001
                self.errors.append(f"{source.name}: {exc}")
        return None

    def enrich(self, artist: Artist) -> Artist:
        for source in self.active(self.enrichers):
            try:
                artist = source.enrich(artist)
            except Exception as exc:                      # noqa: BLE001
                self.errors.append(f"{source.name}: {exc}")
        return artist

    def describe(self) -> str:
        def names(adapters):
            return ", ".join(
                f"{a.name}{'' if a.available() else ' (unconfigured)'}"
                for a in adapters) or "none"
        return (f"events:   {names(self.event_sources)}\n"
                f"quotes:   {names(self.quote_sources)}\n"
                f"artists:  {names(self.enrichers)}")


def build_registry(cfg, store=None, include_fixtures: bool = False) -> Registry:
    """Assemble the registry from config. Unconfigured adapters register but stay inactive."""
    from .fixtures import FixtureSource, ManualQuotes
    from .seatgeek import SeatGeekSource
    from .spotify import SpotifySource
    from .ticketmaster import TicketmasterSource

    registry = Registry()
    registry.register(TicketmasterSource(cfg))
    registry.register(SeatGeekSource(cfg))
    registry.register(SpotifySource(cfg))
    if store is not None:
        registry.register(ManualQuotes(store))
    if include_fixtures:
        registry.register(FixtureSource())
    return registry
