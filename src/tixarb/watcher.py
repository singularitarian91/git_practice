"""Onsale discovery and alerting.

This is the fully automatable half of the system, and the half that actually
compounds. It runs on a schedule and does three things:

1. **Scan.** Query the configured sources for each watchlist entry, normalize
   and persist what comes back, and enrich artists so momentum snapshots
   accumulate from day one.
2. **Schedule.** Queue alerts ahead of every future sale window, at each
   configured lead time, deduplicated so a watcher polling every fifteen
   minutes does not alert every fifteen minutes.
3. **Dispatch.** Deliver whatever has come due.

What it deliberately does not do is buy anything. The line is not
aesthetic: under the US BOTS Act (15 U.S.C. 45c) it is unlawful to
circumvent a ticket seller's access controls, CAPTCHAs, queues or posted
purchase limits, and to sell tickets you know were acquired that way. So
this alerts a human, who buys within the limits like anyone else. See
docs/LEGAL.md.

The advantage this gives up in milliseconds it takes back in preparation.
Most desirable inventory never reaches the public onsale at all -- it goes
in gated presales. Knowing three weeks ahead which presales exist and which
you are eligible for beats being fast on a public onsale that was picked
over before it opened.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Optional

from . import scoring
from .alerts import Alert, Dispatcher
from .models import Event, OnsaleKind, WatchItem, utcnow


@dataclass
class ScanReport:
    queries: int = 0
    events_found: int = 0
    events_new: int = 0
    alerts_queued: int = 0
    alerts_sent: int = 0
    errors: list = field(default_factory=list)

    def summary(self) -> str:
        line = (f"{self.queries} queries -> {self.events_found} events "
                f"({self.events_new} new), {self.alerts_queued} alerts queued, "
                f"{self.alerts_sent} sent")
        if self.errors:
            line += f", {len(self.errors)} source errors"
        return line


def matches(item: WatchItem, event: Event) -> bool:
    """Does an event satisfy a watchlist entry's filters?"""
    if item.max_face is not None and event.face_min > 0:
        # Filter on the cheapest tier: a house spanning $45-$495 is still
        # worth watching for someone capped at $100.
        if event.face_min > item.max_face:
            return False
    if item.markets:
        metro = event.venue.metro if event.venue else ""
        if metro not in {m.lower() for m in item.markets}:
            return False
    return True


class Watcher:
    def __init__(self, store, registry, cfg, dispatcher: Optional[Dispatcher] = None):
        self.store = store
        self.registry = registry
        self.cfg = cfg
        self.dispatcher = dispatcher or Dispatcher()

    # -- 1. scan ------------------------------------------------------------

    def scan(self, report: Optional[ScanReport] = None) -> ScanReport:
        report = report or ScanReport()
        for item in self.store.watchlist():
            report.queries += 1
            for event in self.registry.search_events(item.query):
                if not matches(item, event):
                    continue
                report.events_found += 1
                if self.store.get_event(event.id) is None:
                    report.events_new += 1
                self.store.upsert_event(self._enriched(event))
        report.errors.extend(self.registry.errors)
        return report

    def _enriched(self, event: Event) -> Event:
        """Fill in artist metrics, preserving anything already known.

        Enrichment runs on every scan even for artists already on file: the
        point is the time series. Momentum is a derivative, and a snapshot
        not taken today is gone.
        """
        from dataclasses import replace

        if not event.artists:
            return event
        enriched = []
        for artist in event.artists:
            known = self.store.get_artist(artist.id)
            merged = artist
            if known is not None:
                merged = replace(
                    artist,
                    spotify_id=artist.spotify_id or known.spotify_id,
                    popularity=artist.popularity or known.popularity,
                    followers=artist.followers or known.followers,
                    monthly_listeners=artist.monthly_listeners or known.monthly_listeners,
                    genres=artist.genres or known.genres,
                )
            enriched.append(self.registry.enrich(merged))
        return replace(event, artists=tuple(enriched))

    # -- 2. schedule --------------------------------------------------------

    def schedule_alerts(self, at: Optional[dt.datetime] = None,
                        report: Optional[ScanReport] = None) -> ScanReport:
        at = at or utcnow()
        report = report or ScanReport()
        watch_by_query = self.store.watchlist()

        for event in self.store.upcoming_events(at):
            min_score = self._min_score_for(event, watch_by_query)
            forecast = None
            for window in event.sale_windows:
                if window.starts_at <= at:
                    continue  # already open; nothing left to warn about
                if min_score > 0:
                    if forecast is None:
                        forecast = scoring.forecast(
                            event, quote=self.store.latest_quote(event.id),
                            competing_dates=self._competing(event), at=at,
                        )
                    if forecast.score < min_score:
                        continue
                for lead in self.cfg.alert_lead_minutes:
                    fires_at = window.starts_at - dt.timedelta(minutes=lead)
                    if fires_at <= at:
                        continue
                    alert_id = (f"{event.id}|{window.kind.value}"
                                f"|{window.starts_at.isoformat()}|{lead}")
                    queued = self.store.queue_alert(
                        alert_id, kind=window.kind.value, fires_at=fires_at,
                        event_id=event.id,
                        payload={
                            "lead_minutes": lead,
                            "window": window.name or window.kind.value,
                            "code_required": window.code_required,
                            "event_name": event.name,
                            "venue": event.venue.name if event.venue else "",
                            "url": event.url,
                            "face_min": str(event.face_min),
                            "face_max": str(event.face_max),
                            "opens_at": window.starts_at.isoformat(),
                        },
                    )
                    if queued:
                        report.alerts_queued += 1
        return report

    def _min_score_for(self, event: Event, items: list) -> float:
        """Strictest score floor among watchlist entries this event matches."""
        scores = [i.min_score for i in items if matches(i, event) and i.min_score > 0]
        return max(scores) if scores else 0.0

    def _competing(self, event: Event) -> int:
        if not event.venue:
            return 1
        return max(1, len(self.store.events_in_metro(event.venue.metro, event.starts_at)))

    # -- 3. dispatch --------------------------------------------------------

    def dispatch_due(self, at: Optional[dt.datetime] = None,
                     report: Optional[ScanReport] = None) -> ScanReport:
        at = at or utcnow()
        report = report or ScanReport()
        for row in self.store.due_alerts(at):
            import json

            payload = json.loads(row["payload"] or "{}")
            alert = self._render(row, payload)
            if self.dispatcher.send(alert):
                self.store.mark_alert_sent(row["id"])
                report.alerts_sent += 1
            else:
                # Leave it unsent so the next pass retries. An onsale alert
                # nobody received is worse than a duplicate.
                report.errors.append(f"no sink accepted alert {row['id']}")
        report.errors.extend(self.dispatcher.errors)
        return report

    def _render(self, row: dict, payload: dict) -> Alert:
        lead = payload.get("lead_minutes", 0)
        window = payload.get("window", row["kind"])
        gate = " (code required)" if payload.get("code_required") else ""
        when = f"{lead} min" if lead < 60 else f"{lead // 60} hr"
        face = ""
        if payload.get("face_min", "0") not in ("0", "0.00", ""):
            face = f" | face ${payload['face_min']}-${payload['face_max']}"
        body = (f"{payload.get('venue', '')}{face}\n"
                f"opens {payload.get('opens_at', '')}")
        return Alert(
            kind=row["kind"],
            title=f"{window}{gate} in {when}: {payload.get('event_name', row['event_id'])}",
            body=body,
            fires_at=dt.datetime.fromisoformat(row["fires_at"]),
            event_id=row["event_id"] or "",
            url=payload.get("url", ""),
            urgency="high" if lead <= 60 else "normal",
            data=payload,
        )

    # -- orchestration ------------------------------------------------------

    def run_once(self, at: Optional[dt.datetime] = None,
                 skip_scan: bool = False) -> ScanReport:
        report = ScanReport()
        if not skip_scan:
            self.scan(report)
        self.schedule_alerts(at, report)
        self.dispatch_due(at, report)
        return report
