"""Dynamic repricing and exit discipline.

The buy decision gets all the attention; the sell decision is where the
money is actually kept or lost, and it is the part that can be fully
automated without touching a purchase flow at all. Repricing your own
listings through a marketplace's seller API is ordinary commerce -- no
access controls circumvented, no purchase limits evaded.

Two facts drive everything here.

**An unsold ticket is worth exactly zero the moment doors close.** It is not
worth what you paid, and the market does not care about your cost basis.
Anchoring on cost and holding for "at least breakeven" is the single most
expensive habit in retail resale: it converts a recoverable 30% loss into a
total one. So the reservation price decays toward a clearing price as the
event approaches, and crosses below breakeven when it has to.

**Late price direction is set by float, not by hope.** With a thin float the
remaining sellers hold pricing power and prices firm into showtime; with a
saturated one they undercut each other into the floor. The same show, the
same act, opposite terminal behaviour -- so the decay curve is steepened or
flattened by the observed float rather than run on a fixed schedule.

Known limitation: quotes here are event-level aggregates, so a pair in row 3
is being compared against a get-in price that may be an upper-bowl single.
:class:`~tixarb.models.Quote` carries a ``section`` field and the store keys
on it; populating section-level comps is the upgrade path, and until you do,
treat the advice as directional for good seats.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from . import economics
from .models import Event, Position, Quote
from .money import ZERO, money, price_floor
from .scoring import MarkupForecast

# Days out at which the decay toward a clearing price begins. Beyond this,
# hold the ambitious ask -- there is no information yet and no urgency.
DECAY_WINDOW_DAYS = 45.0
# Curvature of the decay. Above 1 keeps the ask high for longer and then
# concedes quickly, which fits observed resale curves better than a straight
# line: most of the price discovery happens in the last fortnight.
DECAY_GAMMA = 1.8
# Inside this many days, the position is a liquidation problem.
LIQUIDATION_DAYS = 3.0
# Undercut the get-in by this much when the goal is to be first in the sort.
UNDERCUT_PCT = Decimal("0.02")
# Only start chasing the get-in inside this many days -- before that, the
# forecast governs and there is still time for the market to come to you.
UNDERCUT_DAYS = 14.0
# Float thinness below this counts as saturated: sort position is then the
# only thing that sells a listing, at any distance from the event.
SATURATED_FLOAT = 0.35
# Marketplaces enforce a minimum listing price, and a sub-dollar ask is a
# data error rather than a strategy. Applied last, after every clamp.
MIN_ASK = Decimal("1.00")


@dataclass(frozen=True)
class PriceAdvice:
    position_id: str
    days_to_event: float
    ask: Decimal                 # seller-side price to list at, per ticket
    display_ask: Decimal         # what the buyer will see, all-in
    net_each: Decimal            # what lands in your account if it clears
    breakeven: Decimal
    cost_each: Decimal
    action: str                  # hold | reprice | undercut | dump
    urgency: str                 # normal | high
    rationale: str
    profit_each: Decimal = ZERO

    @property
    def above_breakeven(self) -> bool:
        return self.ask >= self.breakeven

    def explain(self) -> str:
        margin = "above" if self.above_breakeven else "BELOW"
        return (f"{self.action.upper()} @ {self.ask} "
                f"(buyer sees {self.display_ask}, you net {self.net_each}, "
                f"{margin} breakeven {self.breakeven}) "
                f"-- {self.days_to_event:.0f}d out. {self.rationale}")


def _urgency_factor(days_to_event: float) -> float:
    """0 when far out, 1 at showtime. Drives the decay from ambition to clearing."""
    if days_to_event >= DECAY_WINDOW_DAYS:
        return 0.0
    if days_to_event <= 0:
        return 1.0
    return (1.0 - days_to_event / DECAY_WINDOW_DAYS) ** DECAY_GAMMA


def _float_thinness(quote: Optional[Quote], event: Event) -> Optional[float]:
    if quote is None or event.venue is None:
        return None
    ratio = quote.float_ratio(event.venue.capacity)
    if ratio is None:
        return None
    return max(0.0, min(1.0, 1.0 - (ratio - 0.02) / 0.10))


def reservation_price(position: Position, event: Event, forecast: MarkupForecast,
                      quote: Optional[Quote], sell: economics.SellFees,
                      breakeven: Decimal, at: Optional[dt.datetime] = None) -> Decimal:
    """The ask for right now: ambitious early, clearing-priced late."""
    days = max(0.0, event.days_until(at))
    urgency = _urgency_factor(days)
    face = position.face_each if position.face_each > ZERO else event.face_mid

    thinness = _float_thinness(quote, event)

    # Ambitious end: the 75th percentile of the forecast, never below a
    # margin over breakeven. No reason to concede while there is still time.
    p75 = money(face * Decimal(str(forecast.quantile(0.75))))
    anchor_high = max(p75, money(breakeven * Decimal("1.15")))

    # Clearing end: the price that actually moves on the last day. With a
    # market quote, undercut it; without one, concede below breakeven,
    # because holding to expiry realizes zero.
    if quote is not None and quote.get_in > ZERO:
        anchor_low = money(quote.get_in * (Decimal("1") - UNDERCUT_PCT))
        if thinness is not None:
            # A thin float earns the right to concede less; a saturated one
            # has to concede more than the schedule alone would suggest.
            anchor_low = money(anchor_low * (Decimal("0.85") +
                                             Decimal(str(thinness)) * Decimal("0.30")))
        # A live market that is already above the forecast is evidence the
        # forecast is stale, and the forecast is denominated in *your* face
        # value while the get-in reflects the house. Without this, a cheap
        # seat bought into a hot market produces an ambitious anchor below
        # the clearing anchor and the whole curve runs backwards -- asking
        # less two months out than on show day.
        market_anchor = money(
            quote.get_in * (Decimal("1") + Decimal(str(thinness or 0.0)) / 2))
        anchor_high = max(anchor_high, market_anchor)
    else:
        anchor_low = money(breakeven * Decimal("0.80"))

    # The curve must never rise as the event approaches. Time only ever
    # reduces what you can ask for a perishable good.
    anchor_low = min(anchor_low, anchor_high)

    ask = anchor_high + (anchor_low - anchor_high) * Decimal(str(urgency))

    # Never ask so far above the visible market that the listing is decoration.
    if quote is not None and quote.median > ZERO:
        ask = min(ask, money(quote.median * Decimal("1.50")))
    return max(money(ask), MIN_ASK)


def advise(position: Position, event: Event, forecast: MarkupForecast,
           quote: Optional[Quote], buy: economics.BuyFees,
           sell: economics.SellFees, at: Optional[dt.datetime] = None) -> PriceAdvice:
    """Recommend an action and an ask for one open position."""
    days = event.days_until(at)
    breakeven = economics.breakeven_list_price(position.cost_each, position.qty, sell)
    ask = reservation_price(position, event, forecast, quote, sell, breakeven, at)
    thinness = _float_thinness(quote, event)
    action, urgency, reasons = "reprice", "normal", []

    if days <= 0:
        # Past showtime the asset no longer exists. Say so plainly rather
        # than emitting a price for something unsellable.
        return PriceAdvice(
            position_id=position.id, days_to_event=days, ask=ZERO,
            display_ask=ZERO, net_each=ZERO, breakeven=breakeven,
            cost_each=position.cost_each, action="expired", urgency="high",
            rationale="event has started; unsold inventory is now worthless",
            profit_each=money(-position.cost_each),
        )

    if days <= LIQUIDATION_DAYS:
        action, urgency = "dump", "high"
        reasons.append(f"{days:.1f}d out: price to clear, not to profit")
        if quote is not None and quote.get_in > ZERO:
            # Undercut hard. Being second-cheapest on the last day is the
            # same as being unlisted.
            ask = min(ask, money(quote.get_in * Decimal("0.92")))
    elif quote is not None and quote.get_in > ZERO and quote.get_in < breakeven:
        if days <= 21:
            action, urgency = "dump", "high"
            reasons.append(
                f"market get-in {quote.get_in} is under breakeven {breakeven} "
                f"with {days:.0f}d left: cut now, it decays from here")
        else:
            action = "reprice"
            reasons.append(
                f"market {quote.get_in} is under breakeven {breakeven}, but "
                f"{days:.0f}d remain for it to recover")
    elif days > DECAY_WINDOW_DAYS:
        action = "hold"
        reasons.append(f"{days:.0f}d out, beyond the {DECAY_WINDOW_DAYS:.0f}d "
                       f"decay window: no reason to concede yet")
    elif (quote is not None and quote.get_in > ZERO and ask > quote.get_in
          and (days <= UNDERCUT_DAYS or (thinness is not None
                                         and thinness < SATURATED_FLOAT))):
        # Only chase the get-in near the event, or when the float is
        # saturated and the sort order is the whole game. Undercutting the
        # cheapest seat in the house months out just donates the upside:
        # the get-in is an upper-bowl single, and matching it prices good
        # seats like bad ones.
        action = "undercut"
        reasons.append(f"asking above the {quote.get_in} get-in; "
                       f"undercut to reach the top of the sort")
        ask = min(ask, money(quote.get_in * (Decimal("1") - UNDERCUT_PCT)))

    if thinness is not None:
        reasons.append(
            f"float {'thin' if thinness > 0.6 else 'saturated' if thinness < 0.3 else 'moderate'} "
            f"({thinness:.2f})")
    if position.listed_price is not None and position.listed_price != ask:
        reasons.append(f"currently listed at {position.listed_price}")

    # Re-apply the floor: the liquidation and undercut clamps above can each
    # push below it when the observed market is itself near zero.
    ask = max(money(ask), MIN_ASK)
    net = economics.net_proceeds(ask, position.qty, sell)
    return PriceAdvice(
        position_id=position.id, days_to_event=days, ask=ask,
        display_ask=economics.display_price(ask, sell), net_each=net,
        breakeven=breakeven, cost_each=position.cost_each, action=action,
        urgency=urgency, rationale="; ".join(reasons) or "on schedule",
        profit_each=money(net - position.cost_each),
    )


def ladder(position: Position, event: Event, forecast: MarkupForecast,
           quote: Optional[Quote], sell: economics.SellFees,
           at: Optional[dt.datetime] = None, steps: int = 10) -> list:
    """The full repricing schedule from now to showtime.

    Feed this to a scheduler and the sell side runs itself: each entry is
    the ask to be listed at on that day. Emitting the whole curve rather
    than one number also makes the strategy auditable in advance -- you can
    see the concession you have committed to before it happens, rather than
    discovering it on show day.
    """
    at = at or dt.datetime.now(dt.timezone.utc)
    breakeven = economics.breakeven_list_price(position.cost_each, position.qty, sell)
    total_days = max(0.0, event.days_until(at))
    if total_days <= 0:
        return []

    rows = []
    for i in range(steps + 1):
        days_out = total_days * (1.0 - i / steps)
        when = event.starts_at - dt.timedelta(days=days_out)
        ask = reservation_price(position, event, forecast, quote, sell,
                                breakeven, at=when)
        rows.append({
            "date": when.date().isoformat(),
            "days_out": round(days_out, 1),
            "ask": ask,
            "display": economics.display_price(ask, sell),
            "net": economics.net_proceeds(ask, position.qty, sell),
            "vs_breakeven": money(ask - breakeven),
        })
    return rows
