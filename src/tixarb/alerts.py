"""Alert delivery.

Sinks are deliberately dumb and independent: each takes a rendered
:class:`Alert` and gets it somewhere. A sink that raises is reported and
skipped, never fatal -- a Slack outage must not stop the onsale alert from
reaching the log file.

An onsale alert that arrives late is worthless, so :class:`WebhookSink` uses
a short timeout and few retries. Better to fail fast into a second sink than
to spend ninety seconds backing off against a dead endpoint while the presale
opens.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .models import utcnow
from .sources.http import HttpClient


@dataclass(frozen=True)
class Alert:
    kind: str                    # "onsale", "presale", "reprice", "dump"
    title: str
    body: str
    fires_at: dt.datetime
    event_id: str = ""
    url: str = ""
    urgency: str = "normal"      # "normal" | "high"
    data: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "kind": self.kind, "title": self.title, "body": self.body,
            "fires_at": self.fires_at.isoformat(), "event_id": self.event_id,
            "url": self.url, "urgency": self.urgency, "data": self.data,
        }

    def as_text(self) -> str:
        mark = "!! " if self.urgency == "high" else ""
        line = f"{mark}{self.title}\n{self.body}"
        return f"{line}\n{self.url}" if self.url else line


class ConsoleSink:
    name = "console"

    def __init__(self, stream=None):
        self.stream = stream or sys.stdout

    def send(self, alert: Alert) -> None:
        stamp = alert.fires_at.strftime("%Y-%m-%d %H:%M UTC")
        print(f"[{stamp}] {alert.as_text()}\n", file=self.stream)


class JsonlSink:
    """Append-only local log. The sink of last resort: no network, no auth."""

    name = "jsonl"

    def __init__(self, path: str = "~/.tixarb/alerts.jsonl"):
        self.path = Path(path).expanduser()

    def send(self, alert: Alert) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            record = alert.as_dict()
            record["sent_at"] = utcnow().isoformat()
            handle.write(json.dumps(record) + "\n")


class WebhookSink:
    """POSTs to a generic webhook. Payload suits Slack and Discord unchanged."""

    name = "webhook"

    def __init__(self, url: str, client: Optional[HttpClient] = None):
        self.url = url
        # Two retries, six-second timeout: an onsale alert is worthless late.
        self.http = client or HttpClient(timeout=6.0, max_retries=2, rate=2.0)

    def send(self, alert: Alert) -> None:
        if not self.url:
            return
        text = alert.as_text()
        self.http.post_json(self.url, data={
            "text": text,       # Slack
            "content": text,    # Discord
            "alert": alert.as_dict(),
        })


class Dispatcher:
    """Fans an alert out to every configured sink, tolerating sink failures."""

    def __init__(self, sinks: Optional[list] = None):
        self.sinks = sinks or []
        self.errors: list = []

    def add(self, sink) -> "Dispatcher":
        if sink is not None:
            self.sinks.append(sink)
        return self

    def send(self, alert: Alert) -> int:
        delivered = 0
        for sink in self.sinks:
            try:
                sink.send(alert)
                delivered += 1
            except Exception as exc:                       # noqa: BLE001
                self.errors.append(f"{sink.name}: {exc}")
        return delivered


def build_dispatcher(cfg, console: bool = True) -> Dispatcher:
    dispatcher = Dispatcher()
    if console:
        dispatcher.add(ConsoleSink())
    if cfg.alert_log_path:
        dispatcher.add(JsonlSink(cfg.alert_log_path))
    if cfg.webhook_url:
        dispatcher.add(WebhookSink(cfg.webhook_url))
    return dispatcher


# --------------------------------------------------------------------------
# Calendar export
# --------------------------------------------------------------------------

def _ics_escape(text: str) -> str:
    return (text.replace("\\", "\\\\").replace(";", r"\;")
                .replace(",", r"\,").replace("\n", r"\n"))


def _ics_stamp(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def onsale_calendar(events: list, alarm_minutes: tuple = (1440, 60, 10)) -> str:
    """Render upcoming sale windows as an iCalendar feed.

    Worth more than it looks. Subscribing a phone to this file turns the
    whole watch layer into something that works when the machine running the
    watcher is asleep, and the per-window alarms put a real notification on a
    real device at the only moment the buy decision can be acted on.
    """
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//tixarb//onsale//EN",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "X-WR-CALNAME:Ticket onsales",
    ]
    now = _ics_stamp(utcnow())
    for event in events:
        for window in event.sale_windows:
            uid = f"{event.id}-{window.kind.value}-{_ics_stamp(window.starts_at)}"
            label = window.name or window.kind.value.replace("_", " ")
            gate = " [code required]" if window.code_required else ""
            lines += [
                "BEGIN:VEVENT",
                f"UID:{_ics_escape(uid)}@tixarb",
                f"DTSTAMP:{now}",
                f"DTSTART:{_ics_stamp(window.starts_at)}",
                # 15 minutes is generous: the inventory that matters is
                # usually gone inside the first two.
                f"DTEND:{_ics_stamp(window.starts_at + dt.timedelta(minutes=15))}",
                f"SUMMARY:{_ics_escape(f'{label}{gate}: {event.name}')}",
                f"DESCRIPTION:{_ics_escape(_window_description(event, window))}",
                f"LOCATION:{_ics_escape(event.venue.name if event.venue else '')}",
            ]
            if event.url:
                lines.append(f"URL:{_ics_escape(event.url)}")
            for minutes in alarm_minutes:
                lines += [
                    "BEGIN:VALARM", "ACTION:DISPLAY",
                    f"TRIGGER:-PT{int(minutes)}M",
                    f"DESCRIPTION:{_ics_escape(f'{label} in {minutes}m: {event.name}')}",
                    "END:VALARM",
                ]
            lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    # RFC 5545 wants CRLF.
    return "\r\n".join(lines) + "\r\n"


def _window_description(event, window) -> str:
    parts = [f"Show: {event.starts_at.strftime('%a %d %b %Y')}"]
    if event.venue:
        parts.append(f"Venue: {event.venue.name} ({event.venue.city})")
    if event.face_min > 0:
        parts.append(f"Face: ${event.face_min}-${event.face_max}")
    if window.code_required:
        parts.append("Requires a presale code -- confirm eligibility beforehand.")
    return "\n".join(parts)
