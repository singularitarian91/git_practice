"""Ticketmaster Discovery API adapter.

The Discovery API is the best public source of *onsale timing* there is: it
publishes the public onsale instant and the full presale schedule, including
presale names, which is what the watcher runs on. Free key, documented
quota (5,000 calls/day, 5 req/sec at time of writing), and a plain read-only
REST surface.

Two gaps worth knowing before trusting it:

* **No venue capacity.** Capacity drives the strongest pre-onsale signal in
  this system, so it comes from the operator-maintained map in
  :mod:`tixarb.config` instead. Events whose capacity is unknown score with
  ``venue_scarcity`` abstaining rather than guessed.
* **``priceRanges`` is the whole house.** It spans nosebleeds to floor and
  frequently omits fees. Treat it as an anchor, never as your face value --
  a real position carries the price actually paid.
"""

from __future__ import annotations

import datetime as dt
from typing import Optional

from ..models import Artist, Event, OnsaleKind, SaleWindow, Venue
from .http import HttpClient

BASE_URL = "https://app.ticketmaster.com/discovery/v2"

# Presale naming is free text set per event, so classification is a keyword
# match. Order matters: the more specific patterns must be tested first, or
# "Spotify Fan First Presale" lands in the generic artist bucket.
_PRESALE_PATTERNS = (
    (("verified fan", "verifiedfan"), OnsaleKind.VERIFIED_FAN),
    (("amex", "american express", "citi", "chase", "capital one", "mastercard"),
     OnsaleKind.CARDHOLDER),
    (("fan club", "fanclub", "artist presale", "spotify", "vip"),
     OnsaleKind.FANCLUB),
    (("venue", "box office", "local"), OnsaleKind.VENUE),
    (("radio", "iheart"), OnsaleKind.RADIO_LOCAL),
)


def classify_presale(name: str) -> OnsaleKind:
    lowered = (name or "").lower()
    for needles, kind in _PRESALE_PATTERNS:
        if any(n in lowered for n in needles):
            return kind
    return OnsaleKind.ARTIST_PRESALE


def _parse_dt(value: Optional[str]) -> Optional[dt.datetime]:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)


def _parse_local(date_str: Optional[str], time_str: Optional[str]) -> Optional[dt.datetime]:
    """Venue-local wall clock, kept naive on purpose -- it is not an instant."""
    if not date_str:
        return None
    try:
        return dt.datetime.fromisoformat(f"{date_str}T{time_str or '20:00:00'}")
    except ValueError:
        return None


class TicketmasterSource:
    name = "ticketmaster"

    def __init__(self, cfg, client: Optional[HttpClient] = None):
        self.cfg = cfg
        # Well under the documented 5 req/sec ceiling. Headroom here is
        # cheap; a revoked key is not.
        self.http = client or HttpClient(rate=3.0, burst=5.0)

    def available(self) -> bool:
        return bool(self.cfg.ticketmaster_key)

    def search_events(self, query: str, *, size: int = 50, country: str = "US",
                      classification: str = "music") -> list:
        payload = self.http.get_json(
            f"{BASE_URL}/events.json",
            params={
                "apikey": self.cfg.ticketmaster_key,
                "keyword": query,
                "countryCode": country,
                "classificationName": classification,
                "size": min(size, 200),
                "sort": "date,asc",
            },
        )
        raw = (payload.get("_embedded") or {}).get("events") or []
        events = []
        for item in raw:
            event = self.to_event(item)
            if event is not None:
                events.append(event)
        return events

    def to_event(self, item: dict) -> Optional[Event]:
        """Normalize one Discovery event. Returns None if it lacks a start time."""
        dates = item.get("dates") or {}
        start = dates.get("start") or {}
        starts_at = _parse_dt(start.get("dateTime"))
        if starts_at is None:
            # Undated announcements ("TBA") carry no tradeable timing.
            return None

        embedded = item.get("_embedded") or {}
        venue = self._to_venue((embedded.get("venues") or [{}])[0])
        artists = tuple(
            Artist(id=f"tm:{a.get('id')}", name=a.get("name", ""))
            for a in (embedded.get("attractions") or []) if a.get("id")
        )

        windows = []
        sales = item.get("sales") or {}
        public = sales.get("public") or {}
        pub_start = _parse_dt(public.get("startDateTime"))
        if pub_start:
            windows.append(SaleWindow(
                kind=OnsaleKind.PUBLIC, starts_at=pub_start,
                ends_at=_parse_dt(public.get("endDateTime")), name="public onsale",
            ))
        for presale in sales.get("presales") or []:
            ps_start = _parse_dt(presale.get("startDateTime"))
            if not ps_start:
                continue
            label = presale.get("name", "")
            windows.append(SaleWindow(
                kind=classify_presale(label), starts_at=ps_start,
                ends_at=_parse_dt(presale.get("endDateTime")), name=label,
                # Every presale gates on something. Whether you can satisfy
                # the gate is the actual question, and it is not in the API.
                code_required=True,
            ))

        ranges = [r for r in (item.get("priceRanges") or [])
                  if r.get("currency") in (None, "USD")]
        face_min = min((r.get("min", 0) for r in ranges), default=0)
        face_max = max((r.get("max", 0) for r in ranges), default=0)

        return Event(
            id=f"tm:{item.get('id')}",
            name=item.get("name", ""),
            starts_at=starts_at,
            venue=venue,
            artists=artists,
            local_start=_parse_local(start.get("localDate"), start.get("localTime")),
            sale_windows=tuple(windows),
            face_min=face_min, face_max=face_max,
            source=self.name, url=item.get("url", ""),
        )

    def _to_venue(self, raw: dict) -> Venue:
        venue_id = f"tm:{raw.get('id')}" if raw.get("id") else "tm:unknown"
        name = raw.get("name", "")
        location = raw.get("location") or {}
        return Venue(
            id=venue_id, name=name,
            city=(raw.get("city") or {}).get("name", ""),
            region=(raw.get("state") or {}).get("stateCode", ""),
            country=(raw.get("country") or {}).get("countryCode", "US"),
            # Not in the Discovery payload; supplied by the operator's map.
            capacity=self.cfg.capacity_for(venue_id, name),
            timezone=raw.get("timezone") or "America/New_York",
            latitude=_maybe_float(location.get("latitude")),
            longitude=_maybe_float(location.get("longitude")),
        )


def _maybe_float(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
