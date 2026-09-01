"""Shared test fixtures.

Everything here is deterministic and offline. Tests that reach a live API are
tests of that API's uptime, not of this code.
"""

from __future__ import annotations

import datetime as dt
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tixarb.models import (  # noqa: E402
    Artist, Event, OnsaleKind, Quote, SaleWindow, Venue,
)

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 3, 1, 12, 0, tzinfo=UTC)


def venue(capacity=575, name="Bowery Ballroom", city="New York", region="NY",
          vid="v:bowery") -> Venue:
    return Venue(vid, name, city, region, capacity=capacity)


def artist(followers=600_000, prior=400_000, listeners=8_000_000,
           popularity=68, aid="a:test", name="Test Act") -> Artist:
    return Artist(aid, name, popularity=popularity, followers=followers,
                  followers_90d_ago=prior, monthly_listeners=listeners)


def event(eid="e:test", days_out=70, onsale_days=5, face=(45, 65),
          tags=(), the_venue=None, the_artist=None, weekday=None) -> Event:
    starts = NOW + dt.timedelta(days=days_out)
    if weekday is not None:
        starts += dt.timedelta(days=(weekday - starts.weekday()) % 7)
    return Event(
        id=eid, name=f"{(the_artist or artist()).name} live",
        starts_at=starts, venue=the_venue or venue(),
        artists=(the_artist or artist(),),
        local_start=starts.replace(tzinfo=None),
        sale_windows=(SaleWindow(OnsaleKind.PUBLIC, NOW + dt.timedelta(days=onsale_days)),),
        face_min=face[0], face_max=face[1], tags=tags,
    )


def quote(eid="e:test", get_in=120, median=180, tickets=40, listings=20,
          at=None) -> Quote:
    return Quote(eid, at or NOW, "test", get_in=get_in, median=median,
                 listing_count=listings, ticket_count=tickets)
