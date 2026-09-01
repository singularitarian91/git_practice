"""SQLite persistence.

Money is stored as INTEGER cents and datetimes as ISO-8601 UTC strings, so the
database is exact and greppable. Conversion happens only at this boundary --
callers hand in and receive the domain models from :mod:`tixarb.models`.

The whole system is designed around a single local file. Ticket trading is a
low-write, high-read workload with one operator; a local SQLite file is the
right size of tool and keeps the entire history of what you paid, what you
were told it was worth, and what it actually sold for in one place you can
back up by copying.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
from decimal import Decimal
from pathlib import Path
from typing import Iterable, Iterator, Optional

from .models import (
    Artist, Event, OnsaleKind, Position, PositionStatus, Quote, SaleWindow,
    Venue, WatchItem, utcnow,
)
from .money import from_cents, money, to_cents

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS venues (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT DEFAULT '',
    region TEXT DEFAULT '',
    country TEXT DEFAULT 'US',
    capacity INTEGER DEFAULT 0,
    timezone TEXT DEFAULT 'America/New_York',
    latitude REAL,
    longitude REAL
);

CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    spotify_id TEXT,
    popularity INTEGER DEFAULT 0,
    followers INTEGER DEFAULT 0,
    followers_90d_ago INTEGER,
    monthly_listeners INTEGER DEFAULT 0,
    genres TEXT DEFAULT '[]',
    updated_at TEXT
);

-- Append-only snapshots of artist metrics. Momentum is a derivative, so it
-- cannot be recovered after the fact from a table that only holds "now".
-- Start collecting on day one or the momentum signal is dead for months.
CREATE TABLE IF NOT EXISTS artist_metrics (
    artist_id TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    popularity INTEGER,
    followers INTEGER,
    monthly_listeners INTEGER,
    PRIMARY KEY (artist_id, observed_at)
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    local_start TEXT,
    venue_id TEXT NOT NULL REFERENCES venues(id),
    face_min_cents INTEGER DEFAULT 0,
    face_max_cents INTEGER DEFAULT 0,
    source TEXT DEFAULT '',
    url TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    first_seen_at TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_venue ON events(venue_id);

CREATE TABLE IF NOT EXISTS event_artists (
    event_id TEXT NOT NULL REFERENCES events(id),
    artist_id TEXT NOT NULL REFERENCES artists(id),
    billing INTEGER DEFAULT 0,      -- 0 = headliner
    PRIMARY KEY (event_id, artist_id)
);

CREATE TABLE IF NOT EXISTS sale_windows (
    event_id TEXT NOT NULL REFERENCES events(id),
    kind TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT,
    name TEXT DEFAULT '',
    code_required INTEGER DEFAULT 0,
    PRIMARY KEY (event_id, kind, starts_at)
);
CREATE INDEX IF NOT EXISTS idx_windows_start ON sale_windows(starts_at);

CREATE TABLE IF NOT EXISTS quotes (
    event_id TEXT NOT NULL REFERENCES events(id),
    observed_at TEXT NOT NULL,
    source TEXT NOT NULL,
    section TEXT DEFAULT '',
    get_in_cents INTEGER DEFAULT 0,
    median_cents INTEGER DEFAULT 0,
    listing_count INTEGER DEFAULT 0,
    ticket_count INTEGER DEFAULT 0,
    PRIMARY KEY (event_id, observed_at, source, section)
);
CREATE INDEX IF NOT EXISTS idx_quotes_event ON quotes(event_id, observed_at);

CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id),
    qty INTEGER NOT NULL,
    face_each_cents INTEGER NOT NULL,
    cost_each_cents INTEGER NOT NULL,
    purchased_at TEXT NOT NULL,
    section TEXT DEFAULT '',
    row TEXT DEFAULT '',
    status TEXT DEFAULT 'held',
    listed_price_cents INTEGER,
    sold_price_cents INTEGER,
    sold_at TEXT,
    marketplace TEXT DEFAULT '',
    notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_positions_event ON positions(event_id);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);

CREATE TABLE IF NOT EXISTS watchlist (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    max_face_cents INTEGER,
    markets TEXT DEFAULT '[]',
    min_score REAL DEFAULT 0.0,
    active INTEGER DEFAULT 1,
    created_at TEXT
);

-- Every forecast ever made, kept so the model can be scored against reality.
-- Without this the weights can never be calibrated and the system stays a
-- guess with a nice interface.
CREATE TABLE IF NOT EXISTS forecasts (
    event_id TEXT NOT NULL REFERENCES events(id),
    made_at TEXT NOT NULL,
    expected_multiple REAL,
    p10 REAL,
    p50 REAL,
    p90 REAL,
    confidence REAL,
    features TEXT DEFAULT '{}',
    model_version TEXT DEFAULT '',
    PRIMARY KEY (event_id, made_at)
);

CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    event_id TEXT,
    kind TEXT NOT NULL,
    fires_at TEXT NOT NULL,
    sent_at TEXT,
    payload TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_alerts_fires ON alerts(fires_at, sent_at);
"""


def _iso(value: Optional[dt.datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _parse(value: Optional[str]) -> Optional[dt.datetime]:
    if not value:
        return None
    parsed = dt.datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def _parse_naive(value: Optional[str]) -> Optional[dt.datetime]:
    """Parse a venue-local wall clock, which is deliberately timezone-free."""
    return dt.datetime.fromisoformat(value) if value else None


class Store:
    """Thin, explicit data access layer. No ORM, no lazy loading."""

    def __init__(self, path="tixarb.db"):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA journal_mode = WAL")
        self._migrate()

    def _migrate(self) -> None:
        self.conn.executescript(SCHEMA)
        cur = self.conn.execute("SELECT value FROM meta WHERE key = 'schema_version'")
        row = cur.fetchone()
        if row is None:
            self.conn.execute(
                "INSERT INTO meta(key, value) VALUES ('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )
        elif int(row["value"]) > SCHEMA_VERSION:
            raise RuntimeError(
                f"database at {self.path} is schema v{row['value']}, "
                f"this build understands v{SCHEMA_VERSION}"
            )
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- venues / artists ---------------------------------------------------

    def upsert_venue(self, venue: Venue) -> None:
        self.conn.execute(
            """INSERT INTO venues(id, name, city, region, country, capacity,
                                  timezone, latitude, longitude)
               VALUES(?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, city=excluded.city, region=excluded.region,
                 country=excluded.country,
                 -- never let a source that omits capacity clobber a known one
                 capacity=CASE WHEN excluded.capacity > 0
                               THEN excluded.capacity ELSE venues.capacity END,
                 timezone=excluded.timezone,
                 latitude=COALESCE(excluded.latitude, venues.latitude),
                 longitude=COALESCE(excluded.longitude, venues.longitude)""",
            (venue.id, venue.name, venue.city, venue.region, venue.country,
             venue.capacity, venue.timezone, venue.latitude, venue.longitude),
        )
        self.conn.commit()

    def get_venue(self, venue_id: str) -> Optional[Venue]:
        row = self.conn.execute("SELECT * FROM venues WHERE id = ?", (venue_id,)).fetchone()
        return self._row_to_venue(row) if row else None

    @staticmethod
    def _row_to_venue(row: sqlite3.Row) -> Venue:
        return Venue(
            id=row["id"], name=row["name"], city=row["city"], region=row["region"],
            country=row["country"], capacity=row["capacity"], timezone=row["timezone"],
            latitude=row["latitude"], longitude=row["longitude"],
        )

    def upsert_artist(self, artist: Artist, snapshot: bool = True) -> None:
        self.conn.execute(
            """INSERT INTO artists(id, name, spotify_id, popularity, followers,
                                   followers_90d_ago, monthly_listeners, genres, updated_at)
               VALUES(?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name,
                 spotify_id=COALESCE(excluded.spotify_id, artists.spotify_id),
                 popularity=excluded.popularity, followers=excluded.followers,
                 followers_90d_ago=COALESCE(excluded.followers_90d_ago,
                                            artists.followers_90d_ago),
                 monthly_listeners=excluded.monthly_listeners,
                 genres=excluded.genres, updated_at=excluded.updated_at""",
            (artist.id, artist.name, artist.spotify_id, artist.popularity,
             artist.followers, artist.followers_90d_ago, artist.monthly_listeners,
             json.dumps(list(artist.genres)), _iso(utcnow())),
        )
        if snapshot:
            self.conn.execute(
                """INSERT OR REPLACE INTO artist_metrics
                   (artist_id, observed_at, popularity, followers, monthly_listeners)
                   VALUES(?,?,?,?,?)""",
                (artist.id, _iso(utcnow()), artist.popularity, artist.followers,
                 artist.monthly_listeners),
            )
        self.conn.commit()

    def get_artist(self, artist_id: str) -> Optional[Artist]:
        row = self.conn.execute("SELECT * FROM artists WHERE id = ?", (artist_id,)).fetchone()
        return self._row_to_artist(row) if row else None

    def _row_to_artist(self, row: sqlite3.Row) -> Artist:
        followers_90d = row["followers_90d_ago"]
        if followers_90d is None:
            followers_90d = self.followers_as_of(row["id"], days_ago=90)
        return Artist(
            id=row["id"], name=row["name"], spotify_id=row["spotify_id"],
            popularity=row["popularity"], followers=row["followers"],
            followers_90d_ago=followers_90d,
            monthly_listeners=row["monthly_listeners"],
            genres=tuple(json.loads(row["genres"] or "[]")),
        )

    def followers_as_of(self, artist_id: str, days_ago: int = 90) -> Optional[int]:
        """Nearest follower snapshot at or before ``days_ago``.

        Returns None when history does not reach back that far, so the
        momentum signal can abstain rather than invent a growth rate from a
        two-week-old database.
        """
        cutoff = utcnow() - dt.timedelta(days=days_ago)
        row = self.conn.execute(
            """SELECT followers FROM artist_metrics
               WHERE artist_id = ? AND observed_at <= ? AND followers IS NOT NULL
               ORDER BY observed_at DESC LIMIT 1""",
            (artist_id, _iso(cutoff)),
        ).fetchone()
        return row["followers"] if row else None

    # -- events -------------------------------------------------------------

    def upsert_event(self, event: Event) -> None:
        self.upsert_venue(event.venue)
        now = _iso(utcnow())
        self.conn.execute(
            """INSERT INTO events(id, name, starts_at, local_start, venue_id,
                                  face_min_cents, face_max_cents, source, url, tags,
                                  first_seen_at, updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, starts_at=excluded.starts_at,
                 local_start=excluded.local_start, venue_id=excluded.venue_id,
                 face_min_cents=excluded.face_min_cents,
                 face_max_cents=excluded.face_max_cents,
                 source=excluded.source, url=excluded.url,
                 tags=excluded.tags, updated_at=excluded.updated_at""",
            (event.id, event.name, _iso(event.starts_at),
             event.local_start.isoformat() if event.local_start else None,
             event.venue.id, to_cents(event.face_min), to_cents(event.face_max),
             event.source, event.url, json.dumps(list(event.tags)), now, now),
        )
        for billing, artist in enumerate(event.artists):
            self.upsert_artist(artist)
            self.conn.execute(
                """INSERT OR REPLACE INTO event_artists(event_id, artist_id, billing)
                   VALUES(?,?,?)""",
                (event.id, artist.id, billing),
            )
        for window in event.sale_windows:
            self.conn.execute(
                """INSERT OR REPLACE INTO sale_windows
                   (event_id, kind, starts_at, ends_at, name, code_required)
                   VALUES(?,?,?,?,?,?)""",
                (event.id, window.kind.value, _iso(window.starts_at),
                 _iso(window.ends_at), window.name, int(window.code_required)),
            )
        self.conn.commit()

    def get_event(self, event_id: str) -> Optional[Event]:
        row = self.conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        return self._row_to_event(row) if row else None

    def _row_to_event(self, row: sqlite3.Row) -> Event:
        venue = self.get_venue(row["venue_id"])
        artist_rows = self.conn.execute(
            """SELECT a.* FROM artists a
               JOIN event_artists ea ON ea.artist_id = a.id
               WHERE ea.event_id = ? ORDER BY ea.billing""",
            (row["id"],),
        ).fetchall()
        window_rows = self.conn.execute(
            "SELECT * FROM sale_windows WHERE event_id = ? ORDER BY starts_at",
            (row["id"],),
        ).fetchall()
        return Event(
            id=row["id"], name=row["name"], starts_at=_parse(row["starts_at"]),
            venue=venue, artists=tuple(self._row_to_artist(a) for a in artist_rows),
            local_start=_parse_naive(row["local_start"]),
            sale_windows=tuple(
                SaleWindow(
                    kind=OnsaleKind(w["kind"]), starts_at=_parse(w["starts_at"]),
                    ends_at=_parse(w["ends_at"]), name=w["name"],
                    code_required=bool(w["code_required"]),
                )
                for w in window_rows
            ),
            face_min=from_cents(row["face_min_cents"]),
            face_max=from_cents(row["face_max_cents"]),
            source=row["source"], url=row["url"],
            tags=tuple(json.loads(row["tags"] or "[]")),
        )

    def iter_events(self, after: Optional[dt.datetime] = None,
                    before: Optional[dt.datetime] = None) -> Iterator[Event]:
        sql = "SELECT * FROM events WHERE 1=1"
        params = []
        if after:
            sql += " AND starts_at >= ?"
            params.append(_iso(after))
        if before:
            sql += " AND starts_at <= ?"
            params.append(_iso(before))
        sql += " ORDER BY starts_at"
        for row in self.conn.execute(sql, params):
            yield self._row_to_event(row)

    def upcoming_events(self, at: Optional[dt.datetime] = None) -> list:
        return list(self.iter_events(after=at or utcnow()))

    def events_in_metro(self, metro: str, near: dt.datetime, window_days: int = 60) -> list:
        """Other dates competing for the same local audience.

        Scarcity is local: three Chicago nights on one tour do not compete
        with a Denver date, they compete with each other.
        """
        lo = near - dt.timedelta(days=window_days)
        hi = near + dt.timedelta(days=window_days)
        rows = self.conn.execute(
            """SELECT e.* FROM events e JOIN venues v ON v.id = e.venue_id
               WHERE lower(v.city || '|' || v.region) = ?
                 AND e.starts_at BETWEEN ? AND ?""",
            (metro, _iso(lo), _iso(hi)),
        ).fetchall()
        return [self._row_to_event(r) for r in rows]

    # -- quotes -------------------------------------------------------------

    def record_quote(self, quote: Quote) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO quotes
               (event_id, observed_at, source, section, get_in_cents,
                median_cents, listing_count, ticket_count)
               VALUES(?,?,?,?,?,?,?,?)""",
            (quote.event_id, _iso(quote.observed_at), quote.source, quote.section,
             to_cents(quote.get_in), to_cents(quote.median),
             quote.listing_count, quote.ticket_count),
        )
        self.conn.commit()

    def latest_quote(self, event_id: str, section: str = "") -> Optional[Quote]:
        row = self.conn.execute(
            """SELECT * FROM quotes WHERE event_id = ? AND section = ?
               ORDER BY observed_at DESC LIMIT 1""",
            (event_id, section),
        ).fetchone()
        return self._row_to_quote(row) if row else None

    def quote_history(self, event_id: str, section: str = "") -> list:
        rows = self.conn.execute(
            """SELECT * FROM quotes WHERE event_id = ? AND section = ?
               ORDER BY observed_at""",
            (event_id, section),
        ).fetchall()
        return [self._row_to_quote(r) for r in rows]

    @staticmethod
    def _row_to_quote(row: sqlite3.Row) -> Quote:
        return Quote(
            event_id=row["event_id"], observed_at=_parse(row["observed_at"]),
            source=row["source"], section=row["section"],
            get_in=from_cents(row["get_in_cents"]),
            median=from_cents(row["median_cents"]),
            listing_count=row["listing_count"], ticket_count=row["ticket_count"],
        )

    # -- positions ----------------------------------------------------------

    def save_position(self, pos: Position) -> None:
        self.conn.execute(
            """INSERT INTO positions(id, event_id, qty, face_each_cents, cost_each_cents,
                                     purchased_at, section, row, status,
                                     listed_price_cents, sold_price_cents, sold_at,
                                     marketplace, notes)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 qty=excluded.qty, face_each_cents=excluded.face_each_cents,
                 cost_each_cents=excluded.cost_each_cents, section=excluded.section,
                 row=excluded.row, status=excluded.status,
                 listed_price_cents=excluded.listed_price_cents,
                 sold_price_cents=excluded.sold_price_cents, sold_at=excluded.sold_at,
                 marketplace=excluded.marketplace, notes=excluded.notes""",
            (pos.id, pos.event_id, pos.qty, to_cents(pos.face_each),
             to_cents(pos.cost_each), _iso(pos.purchased_at), pos.section, pos.row,
             pos.status.value,
             to_cents(pos.listed_price) if pos.listed_price is not None else None,
             to_cents(pos.sold_price) if pos.sold_price is not None else None,
             _iso(pos.sold_at), pos.marketplace, pos.notes),
        )
        self.conn.commit()

    def get_position(self, position_id: str) -> Optional[Position]:
        row = self.conn.execute(
            "SELECT * FROM positions WHERE id = ?", (position_id,)).fetchone()
        return self._row_to_position(row) if row else None

    def positions(self, status: Optional[PositionStatus] = None,
                  event_id: Optional[str] = None) -> list:
        sql = "SELECT * FROM positions WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status.value)
        if event_id:
            sql += " AND event_id = ?"
            params.append(event_id)
        sql += " ORDER BY purchased_at"
        return [self._row_to_position(r) for r in self.conn.execute(sql, params)]

    def open_positions(self) -> list:
        return [p for p in self.positions() if p.is_open]

    @staticmethod
    def _row_to_position(row: sqlite3.Row) -> Position:
        return Position(
            id=row["id"], event_id=row["event_id"], qty=row["qty"],
            face_each=from_cents(row["face_each_cents"]),
            cost_each=from_cents(row["cost_each_cents"]),
            purchased_at=_parse(row["purchased_at"]),
            section=row["section"], row=row["row"],
            status=PositionStatus(row["status"]),
            listed_price=from_cents(row["listed_price_cents"])
                if row["listed_price_cents"] is not None else None,
            sold_price=from_cents(row["sold_price_cents"])
                if row["sold_price_cents"] is not None else None,
            sold_at=_parse(row["sold_at"]),
            marketplace=row["marketplace"], notes=row["notes"],
        )

    # -- watchlist ----------------------------------------------------------

    def add_watch(self, item: WatchItem) -> None:
        self.conn.execute(
            """INSERT INTO watchlist(id, query, max_face_cents, markets, min_score,
                                     active, created_at)
               VALUES(?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 query=excluded.query, max_face_cents=excluded.max_face_cents,
                 markets=excluded.markets, min_score=excluded.min_score,
                 active=excluded.active""",
            (item.id, item.query,
             to_cents(item.max_face) if item.max_face is not None else None,
             json.dumps(list(item.markets)), item.min_score,
             int(item.active), _iso(utcnow())),
        )
        self.conn.commit()

    def watchlist(self, active_only: bool = True) -> list:
        sql = "SELECT * FROM watchlist"
        if active_only:
            sql += " WHERE active = 1"
        return [
            WatchItem(
                id=r["id"], query=r["query"],
                max_face=from_cents(r["max_face_cents"])
                    if r["max_face_cents"] is not None else None,
                markets=tuple(json.loads(r["markets"] or "[]")),
                min_score=r["min_score"], active=bool(r["active"]),
            )
            for r in self.conn.execute(sql)
        ]

    def remove_watch(self, watch_id: str) -> bool:
        cur = self.conn.execute("DELETE FROM watchlist WHERE id = ?", (watch_id,))
        self.conn.commit()
        return cur.rowcount > 0

    # -- forecasts and alerts ----------------------------------------------

    def record_forecast(self, event_id: str, expected: float, p10: float, p50: float,
                        p90: float, confidence: float, features: dict,
                        model_version: str = "") -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO forecasts
               (event_id, made_at, expected_multiple, p10, p50, p90, confidence,
                features, model_version)
               VALUES(?,?,?,?,?,?,?,?,?)""",
            (event_id, _iso(utcnow()), expected, p10, p50, p90, confidence,
             json.dumps(features), model_version),
        )
        self.conn.commit()

    def training_rows(self) -> list:
        """Forecast features joined to realized outcomes, for calibration.

        A row exists only where a position actually sold, because a realized
        multiple is the only honest label. Unsold inventory is censored data
        and silently treating it as a low multiple would bias the model
        toward optimism about liquidity.
        """
        rows = self.conn.execute(
            """SELECT f.event_id, f.features, f.made_at,
                      p.sold_price_cents, p.face_each_cents
               FROM forecasts f
               JOIN positions p ON p.event_id = f.event_id
               WHERE p.status = 'sold' AND p.sold_price_cents IS NOT NULL
                 AND p.face_each_cents > 0"""
        ).fetchall()
        out = []
        for r in rows:
            realized = r["sold_price_cents"] / r["face_each_cents"]
            out.append((json.loads(r["features"] or "{}"), realized, r["event_id"]))
        return out

    def queue_alert(self, alert_id: str, kind: str, fires_at: dt.datetime,
                    event_id: Optional[str] = None, payload: Optional[dict] = None) -> bool:
        """Queue an alert. Returns False when this id was already queued.

        The id is the dedup key -- build it from (event, kind, lead time) so a
        watcher that runs every five minutes does not alert every five minutes.
        """
        try:
            self.conn.execute(
                """INSERT INTO alerts(id, event_id, kind, fires_at, payload)
                   VALUES(?,?,?,?,?)""",
                (alert_id, event_id, kind, _iso(fires_at), json.dumps(payload or {})),
            )
            self.conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False

    def due_alerts(self, at: Optional[dt.datetime] = None) -> list:
        at = at or utcnow()
        return [
            dict(r) for r in self.conn.execute(
                "SELECT * FROM alerts WHERE sent_at IS NULL AND fires_at <= ? "
                "ORDER BY fires_at", (_iso(at),))
        ]

    def mark_alert_sent(self, alert_id: str) -> None:
        self.conn.execute(
            "UPDATE alerts SET sent_at = ? WHERE id = ?", (_iso(utcnow()), alert_id))
        self.conn.commit()
