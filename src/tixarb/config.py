"""Configuration: API credentials, fee schedules, and risk limits.

Resolution order, most specific first: explicit argument, environment
variable, config file, built-in default. Credentials are only ever read from
the environment or a file you control -- nothing here writes a key back to
disk, and ``Config.redacted()`` exists so config can be logged safely.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, replace
from decimal import Decimal
from pathlib import Path
from typing import Optional

from .economics import BUY_PRESETS, SELL_PRESETS, BuyFees, SellFees
from .money import money

DEFAULT_CONFIG_PATH = Path(os.environ.get("TIXARB_CONFIG", "~/.tixarb/config.json"))
DEFAULT_DB_PATH = os.environ.get("TIXARB_DB", "~/.tixarb/tixarb.db")

# Ticketmaster's Discovery API does not return venue capacity, and capacity
# drives the strongest pre-onsale signal there is (an act's draw measured
# against the size of the room). So capacity is operator-maintained. Seed
# rows below; extend via the config file's "venue_capacity" map, keyed by
# either venue id or a lowercased venue name.
SEED_CAPACITIES = {
    "bowery ballroom": 575,
    "webster hall": 1500,
    "brooklyn steel": 1800,
    "terminal 5": 3000,
    "9:30 club": 1200,
    "the fillmore": 1150,
    "first avenue": 1550,
    "the wiltern": 1850,
    "hollywood palladium": 4000,
    "radio city music hall": 5960,
    "red rocks amphitheatre": 9525,
    "msg": 20789,
    "madison square garden": 20789,
    "united center": 23500,
    "barclays center": 19000,
    "the anthem": 6000,
    "the greek theatre": 5900,
    "ryman auditorium": 2362,
}


@dataclass
class Config:
    db_path: str = DEFAULT_DB_PATH

    # Credentials. Empty means the corresponding source is skipped rather
    # than erroring, so a partial setup still runs.
    ticketmaster_key: str = ""
    seatgeek_client_id: str = ""
    seatgeek_client_secret: str = ""
    spotify_client_id: str = ""
    spotify_client_secret: str = ""

    # Notification sinks.
    webhook_url: str = ""
    alert_log_path: str = "~/.tixarb/alerts.jsonl"

    # Fee schedules in force. Override these with rates backed out of your
    # own receipts -- see economics.implied_buy_load.
    buy_fees_name: str = "ticketmaster-us"
    sell_fees_name: str = "stubhub"
    buy_fees_override: dict = field(default_factory=dict)
    sell_fees_override: dict = field(default_factory=dict)

    # Risk limits.
    bankroll: Decimal = money("0")
    max_position_pct: float = 0.05     # cap on any single event, as share of bankroll
    max_event_exposure: Decimal = money("0")   # 0 = derive from bankroll
    min_roi: float = 0.15              # hurdle rate below which a trade is a pass
    min_confidence: float = 0.35       # forecasts thinner than this never trade

    # Watcher behaviour.
    alert_lead_minutes: tuple = (1440, 60, 10)
    poll_interval_seconds: int = 900

    venue_capacity: dict = field(default_factory=lambda: dict(SEED_CAPACITIES))

    # -- derived ------------------------------------------------------------

    def buy_fees(self) -> BuyFees:
        base = BUY_PRESETS.get(self.buy_fees_name, BUY_PRESETS["ticketmaster-us"])
        return replace(base, **self.buy_fees_override) if self.buy_fees_override else base

    def sell_fees(self) -> SellFees:
        base = SELL_PRESETS.get(self.sell_fees_name, SELL_PRESETS["stubhub"])
        return replace(base, **self.sell_fees_override) if self.sell_fees_override else base

    def capacity_for(self, venue_id: str, venue_name: str) -> int:
        """Look up an operator-supplied capacity by id, then by name."""
        if venue_id and venue_id in self.venue_capacity:
            return int(self.venue_capacity[venue_id])
        key = (venue_name or "").strip().lower()
        if key in self.venue_capacity:
            return int(self.venue_capacity[key])
        return 0

    def event_exposure_cap(self) -> Decimal:
        if self.max_event_exposure > 0:
            return self.max_event_exposure
        return money(self.bankroll * Decimal(str(self.max_position_pct)))

    def resolved_db_path(self) -> str:
        return str(Path(self.db_path).expanduser())

    def redacted(self) -> dict:
        """Config as a dict with secrets masked, safe to print or log."""
        out = {}
        for key, value in self.__dict__.items():
            if any(s in key for s in ("key", "secret", "client_id", "webhook")):
                out[key] = f"<set:{len(str(value))}>" if value else "<unset>"
            elif isinstance(value, Decimal):
                out[key] = str(value)
            elif key == "venue_capacity":
                out[key] = f"<{len(value)} venues>"
            else:
                out[key] = value
        return out


_ENV_MAP = {
    "ticketmaster_key": "TICKETMASTER_API_KEY",
    "seatgeek_client_id": "SEATGEEK_CLIENT_ID",
    "seatgeek_client_secret": "SEATGEEK_CLIENT_SECRET",
    "spotify_client_id": "SPOTIFY_CLIENT_ID",
    "spotify_client_secret": "SPOTIFY_CLIENT_SECRET",
    "webhook_url": "TIXARB_WEBHOOK_URL",
}


def load(path: Optional[Path] = None) -> Config:
    """Build a Config from file plus environment overlay."""
    cfg = Config()
    path = Path(path).expanduser() if path else DEFAULT_CONFIG_PATH.expanduser()
    if path.exists():
        data = json.loads(path.read_text())
        capacities = dict(SEED_CAPACITIES)
        capacities.update({str(k).lower(): v
                           for k, v in (data.pop("venue_capacity", {}) or {}).items()})
        for key, value in data.items():
            if not hasattr(cfg, key):
                continue
            if key in ("bankroll", "max_event_exposure"):
                value = money(value)
            elif key == "alert_lead_minutes":
                value = tuple(value)
            setattr(cfg, key, value)
        cfg.venue_capacity = capacities

    for attr, env in _ENV_MAP.items():
        if os.environ.get(env):
            setattr(cfg, attr, os.environ[env])
    if os.environ.get("TIXARB_DB"):
        cfg.db_path = os.environ["TIXARB_DB"]
    return cfg


def write_template(path: Optional[Path] = None) -> Path:
    """Write a commented starter config. Never overwrites an existing file."""
    path = Path(path).expanduser() if path else DEFAULT_CONFIG_PATH.expanduser()
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    template = {
        "_comment": (
            "Credentials are better set as environment variables than stored "
            "here. Fee rates below are estimates -- replace them with rates "
            "backed out of your own receipts before sizing anything on them."
        ),
        "db_path": DEFAULT_DB_PATH,
        "ticketmaster_key": "",
        "seatgeek_client_id": "",
        "spotify_client_id": "",
        "spotify_client_secret": "",
        "webhook_url": "",
        "buy_fees_name": "ticketmaster-us",
        "sell_fees_name": "stubhub",
        "bankroll": "0.00",
        "max_position_pct": 0.05,
        "min_roi": 0.15,
        "min_confidence": 0.35,
        "alert_lead_minutes": [1440, 60, 10],
        "venue_capacity": {"example venue name": 1200},
    }
    path.write_text(json.dumps(template, indent=2) + "\n")
    path.chmod(0o600)
    return path
