"""Position tracking, mark-to-market, and concentration risk.

Two things here that a spreadsheet usually gets wrong.

**Marking positions net of sell fees.** A position "worth" $200 at the
current get-in is worth about $174 to you. Carrying inventory at gross
market value overstates the book by the whole seller commission, and the
error grows exactly as the position grows.

**Treating correlation as the real risk.** Single-event exposure is the
obvious limit, but the dangerous concentration is a tour: eight dates on one
run all reprice together when the act underperforms, so eight "diversified"
positions are close to one bet. The checks below look at artist and date
clustering, not just per-event size.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from . import economics
from .models import Position, PositionStatus, utcnow
from .money import ZERO, money


@dataclass(frozen=True)
class MarkedPosition:
    position: Position
    event_name: str
    starts_at: Optional[dt.datetime]
    market_price: Optional[Decimal]     # seller-side get-in, if quoted
    market_net: Decimal                 # net of sell fees, per ticket
    breakeven: Decimal
    unrealized_each: Decimal
    days_to_event: Optional[float]

    @property
    def unrealized_total(self) -> Decimal:
        return money(self.unrealized_each * self.position.qty)

    @property
    def is_underwater(self) -> bool:
        return self.unrealized_each < ZERO


@dataclass
class PortfolioSummary:
    open_count: int = 0
    open_tickets: int = 0
    cost_basis: Decimal = ZERO
    market_value: Decimal = ZERO        # net of sell fees
    unrealized: Decimal = ZERO
    realized: Decimal = ZERO
    sold_count: int = 0
    expired_count: int = 0
    wins: int = 0
    losses: int = 0
    marked: list = field(default_factory=list)
    warnings: list = field(default_factory=list)

    @property
    def win_rate(self) -> Optional[float]:
        closed = self.wins + self.losses
        return self.wins / closed if closed else None

    @property
    def total_pnl(self) -> Decimal:
        return money(self.realized + self.unrealized)

    def explain(self) -> str:
        lines = [
            f"open:      {self.open_count} positions / {self.open_tickets} tickets",
            f"cost:      {self.cost_basis}",
            f"market:    {self.market_value} (net of sell fees)",
            f"unrealized:{self.unrealized:>12}",
            f"realized:  {self.realized:>12} over {self.sold_count} sales",
        ]
        if self.expired_count:
            lines.append(f"expired:   {self.expired_count} positions went unsold")
        if self.win_rate is not None:
            lines.append(f"win rate:  {self.win_rate:.0%} "
                         f"({self.wins}W / {self.losses}L)")
        lines.append(f"total P&L: {self.total_pnl}")
        for warning in self.warnings:
            lines.append(f"  ! {warning}")
        return "\n".join(lines)


def mark(store, position: Position, sell: economics.SellFees,
         at: Optional[dt.datetime] = None) -> MarkedPosition:
    """Value one position against the latest quote, net of sell fees."""
    event = store.get_event(position.event_id)
    quote = store.latest_quote(position.event_id)
    breakeven = economics.breakeven_list_price(position.cost_each, position.qty, sell)

    market_price = quote.get_in if quote and quote.get_in > ZERO else None
    if market_price is not None:
        market_net = economics.net_proceeds(market_price, position.qty, sell)
    else:
        # No quote: hold at cost rather than inventing a gain. Marking
        # unquoted inventory to anything else is how a book drifts away
        # from reality.
        market_net = position.cost_each

    return MarkedPosition(
        position=position,
        event_name=event.name if event else position.event_id,
        starts_at=event.starts_at if event else None,
        market_price=market_price,
        market_net=market_net,
        breakeven=breakeven,
        unrealized_each=money(market_net - position.cost_each),
        days_to_event=event.days_until(at) if event else None,
    )


def realized_pnl(position: Position, sell: economics.SellFees) -> Decimal:
    """Realized profit on a closed position, net of sell fees."""
    if position.status == PositionStatus.SOLD and position.sold_price is not None:
        net = economics.net_proceeds(position.sold_price, position.qty, sell)
        return money((net - position.cost_each) * position.qty)
    if position.status == PositionStatus.EXPIRED:
        # Went unsold. The whole basis is gone -- not "still worth what I
        # paid", which is the fiction that keeps bad positions on the book.
        return money(-position.cost_total)
    return ZERO


def summarize(store, cfg, at: Optional[dt.datetime] = None) -> PortfolioSummary:
    sell = cfg.sell_fees()
    at = at or utcnow()
    summary = PortfolioSummary()

    for position in store.positions():
        if position.is_open:
            marked = mark(store, position, sell, at)
            summary.marked.append(marked)
            summary.open_count += 1
            summary.open_tickets += position.qty
            summary.cost_basis = money(summary.cost_basis + position.cost_total)
            summary.market_value = money(
                summary.market_value + marked.market_net * position.qty)
            summary.unrealized = money(summary.unrealized + marked.unrealized_total)
        else:
            pnl = realized_pnl(position, sell)
            summary.realized = money(summary.realized + pnl)
            if position.status == PositionStatus.SOLD:
                summary.sold_count += 1
                if pnl > ZERO:
                    summary.wins += 1
                else:
                    summary.losses += 1
            elif position.status == PositionStatus.EXPIRED:
                summary.expired_count += 1
                summary.losses += 1

    summary.warnings = check_concentration(store, cfg, at)
    return summary


def check_concentration(store, cfg, at: Optional[dt.datetime] = None) -> list:
    """Flag exposure that has quietly become one bet."""
    warnings = []
    cap = cfg.event_exposure_cap()
    by_event = defaultdict(Decimal)
    by_artist = defaultdict(Decimal)
    artist_events = defaultdict(set)
    total = ZERO

    for position in store.open_positions():
        cost = position.cost_total
        total = money(total + cost)
        by_event[position.event_id] = money(by_event[position.event_id] + cost)
        event = store.get_event(position.event_id)
        if event:
            for artist in event.artists:
                by_artist[artist.name] = money(by_artist[artist.name] + cost)
                artist_events[artist.name].add(event.id)

    if cap > ZERO:
        for event_id, cost in by_event.items():
            if cost > cap:
                event = store.get_event(event_id)
                name = event.name if event else event_id
                warnings.append(f"{name}: {cost} exceeds the per-event cap of {cap}")

    if total > ZERO:
        for artist, cost in by_artist.items():
            share = cost / total
            if share > Decimal("0.40"):
                dates = len(artist_events[artist])
                spread = (f"across {dates} dates, which reprice together, "
                          f"so this is closer to one position than to {dates}"
                          if dates > 1 else "on a single date")
                warnings.append(
                    f"{artist} is {share:.0%} of open capital {spread}")

    if cfg.bankroll > ZERO and total > cfg.bankroll:
        warnings.append(f"open cost {total} exceeds the stated bankroll {cfg.bankroll}")

    return warnings


def needs_attention(store, cfg, at: Optional[dt.datetime] = None,
                    horizon_days: float = 21.0) -> list:
    """Open positions whose event is close enough that inaction is a decision.

    Sorted by how little time is left. A position at T-4 days that is still
    unlisted, or listed above the market, is the most expensive thing in the
    book and the easiest to overlook.
    """
    at = at or utcnow()
    sell = cfg.sell_fees()
    rows = []
    for position in store.open_positions():
        marked = mark(store, position, sell, at)
        if marked.days_to_event is None:
            continue
        if marked.days_to_event <= horizon_days:
            rows.append(marked)
    return sorted(rows, key=lambda m: m.days_to_event)
