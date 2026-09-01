"""SeatGeek Platform API adapter.

Serves two roles this system needs and Ticketmaster cannot fill:

* **Venue capacity.** SeatGeek's venue records often carry ``capacity``,
  which Discovery omits and which the strongest pre-onsale signal depends on.
* **Resale comps.** The ``stats`` block on an event carries listing count,
  visible listing count, and lowest/median price -- an official, documented
  window onto the secondary market, with no scraping and no ToS problem.

One calibration step is required before trusting the prices. Whether
``lowest_price`` is fee-inclusive depends on the account and has changed over
time; since the FTC all-in pricing rule took effect the displayed number is
usually the total a buyer pays. This matters because everything downstream
treats quotes as *seller-side* prices. Check one event against the site,
then set ``prices_are_all_in`` accordingly -- getting it backwards biases
every comp by 25-30%, which is larger than most of the margins being chased.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from ..models import Artist, Event, Quote, Venue, utcnow
from ..money import money
from .http import HttpClient

API_BASE = "https://api.seatgeek.com/2"


def _parse_dt(value: Optional[str]) -> Optional[dt.datetime]:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)


class SeatGeekSource:
    name = "seatgeek"

    def __init__(self, cfg, client: Optional[HttpClient] = None,
                 prices_are_all_in: bool = True, buyer_fee_pct: float = 0.25):
        self.cfg = cfg
        self.http = client or HttpClient(rate=3.0, burst=6.0)
        self.prices_are_all_in = prices_are_all_in
        self.buyer_fee_pct = buyer_fee_pct

    def available(self) -> bool:
        return bool(self.cfg.seatgeek_client_id)

    def _params(self, **extra) -> dict:
        params = {"client_id": self.cfg.seatgeek_client_id}
        if self.cfg.seatgeek_client_secret:
            params["client_secret"] = self.cfg.seatgeek_client_secret
        params.update(extra)
        return params

    def _to_seller_side(self, value) -> Decimal:
        """Convert a displayed price to the seller-side basis used everywhere else."""
        price = money(value or 0)
        if price <= 0 or not self.prices_are_all_in:
            return price
        return money(price / (Decimal("1") + Decimal(str(self.buyer_fee_pct))))

    def search_events(self, query: str, *, size: int = 50,
                      country: str = "US") -> list:
        payload = self.http.get_json(
            f"{API_BASE}/events",
            params=self._params(q=query, per_page=min(size, 100),
                                **{"taxonomies.name": "concert"}),
        )
        events = []
        for item in payload.get("events") or []:
            event = self.to_event(item)
            if event is not None:
                events.append(event)
        return events

    def to_event(self, item: dict) -> Optional[Event]:
        starts_at = _parse_dt(item.get("datetime_utc"))
        if starts_at is None:
            return None
        raw_venue = item.get("venue") or {}
        venue_id = f"sg:{raw_venue.get('id')}" if raw_venue.get("id") else "sg:unknown"
        name = raw_venue.get("name", "")
        location = raw_venue.get("location") or {}
        capacity = int(raw_venue.get("capacity") or 0)
        if capacity <= 0:
            capacity = self.cfg.capacity_for(venue_id, name)

        venue = Venue(
            id=venue_id, name=name,
            city=raw_venue.get("city", ""), region=raw_venue.get("state", ""),
            country=raw_venue.get("country", "US"), capacity=capacity,
            timezone=raw_venue.get("timezone") or "America/New_York",
            latitude=location.get("lat"), longitude=location.get("lon"),
        )
        artists = tuple(
            Artist(id=f"sg:{p.get('id')}", name=p.get("name", ""))
            for p in (item.get("performers") or []) if p.get("id")
        )
        local = item.get("datetime_local")
        return Event(
            id=f"sg:{item.get('id')}", name=item.get("title", ""),
            starts_at=starts_at, venue=venue, artists=artists,
            local_start=dt.datetime.fromisoformat(local) if local else None,
            source=self.name, url=item.get("url", ""),
        )

    def quote_for(self, event: Event) -> Optional[Quote]:
        """Current resale snapshot for an event, matched by title and date."""
        raw = self._find_matching(event)
        if raw is None:
            return None
        stats = raw.get("stats") or {}
        listing_count = stats.get("listing_count") or 0
        # visible_listings_count counts listings, not seats. Seats is what
        # float ratio needs, so scale by a typical pair-heavy listing size
        # when a seat count is not published.
        ticket_count = stats.get("visible_listings_count") or listing_count
        return Quote(
            event_id=event.id, observed_at=utcnow(), source=self.name,
            get_in=self._to_seller_side(stats.get("lowest_price")),
            median=self._to_seller_side(
                stats.get("median_price") or stats.get("average_price")),
            listing_count=int(listing_count),
            ticket_count=int(ticket_count * 2),
        )

    def _find_matching(self, event: Event) -> Optional[dict]:
        """Locate the SeatGeek record for an event discovered elsewhere.

        Ids do not cross providers, so matching is on performer name plus
        date. The one-day window absorbs late-night shows whose local and UTC
        dates disagree.
        """
        if event.id.startswith("sg:"):
            payload = self.http.get_json(
                f"{API_BASE}/events/{event.id[3:]}", params=self._params())
            return payload or None

        headliner = event.headliner.name if event.headliner else event.name
        lo = (event.starts_at - dt.timedelta(days=1)).strftime("%Y-%m-%d")
        hi = (event.starts_at + dt.timedelta(days=1)).strftime("%Y-%m-%d")
        payload = self.http.get_json(
            f"{API_BASE}/events",
            params=self._params(q=headliner, per_page=25,
                                **{"datetime_utc.gte": lo, "datetime_utc.lte": hi}),
        )
        candidates = payload.get("events") or []
        if not candidates:
            return None
        target_city = (event.venue.city or "").strip().lower()
        for candidate in candidates:
            city = ((candidate.get("venue") or {}).get("city") or "").strip().lower()
            if target_city and city == target_city:
                return candidate
        return candidates[0]
