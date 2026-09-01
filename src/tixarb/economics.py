"""Fee, breakeven, and expected-value modelling.

This is the module that decides whether a trade exists at all.

The dominant reason retail ticket resale loses money is not bad event
picking -- it is that the round trip carries two fee stacks. You pay ~20-35%
over face on the way in, and surrender ~10-15% of the sale on the way out.
Those compound: a ticket bought at $100 face routinely needs to clear around
$150 just to return the capital. Anyone eyeballing "face $100, resale $130,
nice" is booking a loss.

Everything here is expressed as an explicit, overridable schedule rather than
a hardcoded constant, because the real rates vary by event, marketplace,
seller tier and state, and they change. Use
:func:`implied_buy_load` / :func:`implied_sell_load` to back the true rates
out of receipts and payout statements you already have, and run the model on
those. The shipped presets are starting estimates, not ground truth.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from .money import ZERO, money, price_floor, rate

ONE = Decimal("1")


# --------------------------------------------------------------------------
# Fee schedules
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class BuyFees:
    """Primary-market fee stack.

    Modelled on the Ticketmaster/AXS shape: a percentage service fee on face,
    a flat per-ticket facility fee set by the venue, and per-order charges.
    """

    name: str = "generic-primary"
    service_pct: Decimal = rate("0.185")     # of face, per ticket
    facility_fee: Decimal = money("5.00")    # per ticket, flat, venue-set
    order_fee: Decimal = money("5.95")       # per order
    delivery_fee: Decimal = money("0.00")    # per order; mobile is usually free
    # Some states tax the full ticket price including fees. Set per market.
    tax_pct: Decimal = rate("0.00")
    as_of: str = ""
    note: str = ""

    def __post_init__(self):
        object.__setattr__(self, "service_pct", rate(self.service_pct))
        object.__setattr__(self, "facility_fee", money(self.facility_fee))
        object.__setattr__(self, "order_fee", money(self.order_fee))
        object.__setattr__(self, "delivery_fee", money(self.delivery_fee))
        object.__setattr__(self, "tax_pct", rate(self.tax_pct))


@dataclass(frozen=True)
class SellFees:
    """Secondary-market fee stack.

    ``seller_pct`` comes out of your money. ``buyer_pct`` does not -- but it
    is not free to you either: since the FTC's all-in pricing rule for live
    events (in force May 2025), marketplaces must show buyers the total up
    front, so buyers sort and compare on the fee-inclusive number. A high
    buyer fee therefore compresses the seller-side price you can ask while
    still winning the click. :meth:`display_price` is what the buyer sees.
    """

    name: str = "generic-secondary"
    seller_pct: Decimal = rate("0.10")       # commission withheld from sale
    payment_pct: Decimal = rate("0.03")      # payment processing
    buyer_pct: Decimal = rate("0.25")        # added on top, shown to buyer
    fulfillment_fee: Decimal = money("0.00") # per order, seller side
    as_of: str = ""
    note: str = ""

    def __post_init__(self):
        for f in ("seller_pct", "payment_pct", "buyer_pct"):
            object.__setattr__(self, f, rate(getattr(self, f)))
        object.__setattr__(self, "fulfillment_fee", money(self.fulfillment_fee))

    @property
    def retention(self) -> Decimal:
        """Fraction of the seller-side price you actually keep, ex flat fees."""
        keep = ONE - self.seller_pct - self.payment_pct
        if keep <= ZERO:
            raise ValueError(f"{self.name}: seller+payment fees consume the whole sale")
        return keep


# Starting estimates only. Rates vary by event, seller tier, market and state,
# and they change without notice. Calibrate against your own receipts before
# sizing anything on them -- see implied_buy_load()/implied_sell_load().
BUY_PRESETS = {
    "ticketmaster-us": BuyFees(
        name="ticketmaster-us", service_pct=rate("0.20"), facility_fee=money("5.50"),
        order_fee=money("5.95"), as_of="estimate",
        note="TM all-in load commonly lands 20-35% over face; varies per event.",
    ),
    "axs-us": BuyFees(
        name="axs-us", service_pct=rate("0.18"), facility_fee=money("4.50"),
        order_fee=money("4.95"), as_of="estimate",
    ),
    "box-office": BuyFees(
        name="box-office", service_pct=rate("0.00"), facility_fee=money("0.00"),
        order_fee=money("0.00"), as_of="exact",
        note="In-person box office purchases often carry no service fee at all. "
             "This is a real and underused edge: it lowers the breakeven "
             "multiple by roughly the entire primary fee load.",
    ),
}

SELL_PRESETS = {
    "stubhub": SellFees(
        name="stubhub", seller_pct=rate("0.10"), payment_pct=rate("0.03"),
        buyer_pct=rate("0.25"), as_of="estimate",
    ),
    "seatgeek": SellFees(
        name="seatgeek", seller_pct=rate("0.10"), payment_pct=rate("0.03"),
        buyer_pct=rate("0.25"), as_of="estimate",
    ),
    "vividseats": SellFees(
        name="vividseats", seller_pct=rate("0.10"), payment_pct=rate("0.03"),
        buyer_pct=rate("0.28"), as_of="estimate",
    ),
    "ticketmaster-resale": SellFees(
        name="ticketmaster-resale", seller_pct=rate("0.15"), payment_pct=rate("0.00"),
        buyer_pct=rate("0.20"), as_of="estimate",
        note="Higher seller cut, but transfer is native and non-delivery risk "
             "is near zero for a mobile-transfer event.",
    ),
}


# --------------------------------------------------------------------------
# Buy side
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class CostBreakdown:
    qty: int
    face_each: Decimal
    service_each: Decimal
    facility_each: Decimal
    order_each: Decimal      # per-order charges amortized across qty
    tax_each: Decimal
    cost_each: Decimal
    cost_total: Decimal

    @property
    def fee_load(self) -> Decimal:
        """Fees as a fraction of face. The number to sanity-check against a receipt."""
        if self.face_each <= ZERO:
            return ZERO
        return (self.cost_each - self.face_each) / self.face_each

    def explain(self) -> str:
        return (
            f"{self.qty} x face {self.face_each} "
            f"+ service {self.service_each} + facility {self.facility_each} "
            f"+ order {self.order_each} + tax {self.tax_each} "
            f"= {self.cost_each} each ({self.cost_total} total, "
            f"{self.fee_load * 100:.1f}% over face)"
        )


def landed_cost(face_each, qty: int, fees: BuyFees) -> CostBreakdown:
    """All-in acquisition cost, per ticket and total.

    Per-order charges are amortized across ``qty``, which is why buying pairs
    beats buying singles on identical inventory.
    """
    if qty <= 0:
        raise ValueError("qty must be positive")
    face = money(face_each)
    service = money(face * fees.service_pct)
    facility = fees.facility_fee
    order_each = money((fees.order_fee + fees.delivery_fee) / qty)
    pre_tax_each = money(face + service + facility + order_each)
    tax_each = money(pre_tax_each * fees.tax_pct)
    cost_each = money(pre_tax_each + tax_each)
    return CostBreakdown(
        qty=qty, face_each=face, service_each=service, facility_each=facility,
        order_each=order_each, tax_each=tax_each,
        cost_each=cost_each, cost_total=money(cost_each * qty),
    )


def implied_buy_load(face_each, qty: int, order_total) -> Decimal:
    """Back the true fee load out of a real receipt.

    Feed it the face value and the number your card was actually charged.
    The result is the fraction over face you really paid -- use it to correct
    a :class:`BuyFees` preset that is guessing.
    """
    face = money(face_each)
    if face <= ZERO or qty <= 0:
        raise ValueError("face and qty must be positive")
    per_ticket = money(Decimal(str(order_total)) / qty)
    return (per_ticket - face) / face


# --------------------------------------------------------------------------
# Sell side
# --------------------------------------------------------------------------

def net_proceeds(list_price, qty: int, fees: SellFees) -> Decimal:
    """What actually lands in your account, per ticket, at ``list_price``."""
    if qty <= 0:
        raise ValueError("qty must be positive")
    price = money(list_price)
    gross = price * fees.retention
    return money(gross - (fees.fulfillment_fee / qty))


def display_price(list_price, fees: SellFees) -> Decimal:
    """The all-in price the buyer is shown, and compares against rivals."""
    return money(money(list_price) * (ONE + fees.buyer_pct))


def list_price_for_display(display, fees: SellFees) -> Decimal:
    """Invert :func:`display_price`: what to ask to hit a target buyer-facing price.

    Used when competing on the sorted-by-price screen, where the only number
    that matters is the one the buyer sees.
    """
    return price_floor(money(display) / (ONE + fees.buyer_pct))


def breakeven_list_price(cost_each, qty: int, fees: SellFees) -> Decimal:
    """Seller-side ask at which net proceeds exactly return the cost basis.

    Rounded *up* to the cent: rounding down would leave you a cent short of
    breakeven, which is the wrong direction to be wrong in.
    """
    cost = money(cost_each)
    target = (cost + (fees.fulfillment_fee / qty)) / fees.retention
    exact = price_floor(target)
    return exact if net_proceeds(exact, qty, fees) >= cost else money(exact + Decimal("0.01"))


def breakeven_multiple(face_each, qty: int, buy: BuyFees, sell: SellFees) -> Decimal:
    """Multiple of face the resale must clear just to return capital.

    The headline number of this whole system. For typical US primary + resale
    fees it sits near 1.5x -- meaning a "50% markup" is a break-even trade,
    not a win.
    """
    face = money(face_each)
    if face <= ZERO:
        raise ValueError("face must be positive")
    cost = landed_cost(face, qty, buy).cost_each
    return breakeven_list_price(cost, qty, sell) / face


# --------------------------------------------------------------------------
# Expected value and sizing
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class TradeEval:
    qty: int
    cost_each: Decimal
    cost_total: Decimal
    target_price: Decimal
    target_net_each: Decimal
    breakeven_price: Decimal
    breakeven_mult: Decimal
    p_sell: float
    salvage_price: Decimal
    salvage_net_each: Decimal
    win_each: Decimal
    loss_each: Decimal          # positive magnitude of the downside
    carry_each: Decimal         # opportunity cost of tied-up capital
    ev_each: Decimal
    ev_total: Decimal
    roi: float                  # EV / cost, per ticket
    kelly: float                # full-Kelly bankroll fraction, clamped to [0, 1]
    verdict: str

    @property
    def is_positive(self) -> bool:
        return self.ev_each > ZERO

    def explain(self) -> str:
        return (
            f"cost {self.cost_each}/ea -> breakeven ask {self.breakeven_price} "
            f"({self.breakeven_mult:.2f}x face). Target {self.target_price} "
            f"nets {self.target_net_each} (+{self.win_each}); miss salvages at "
            f"{self.salvage_price} ({-self.loss_each}). p(sell)={self.p_sell:.0%} "
            f"=> EV {self.ev_each}/ea, ROI {self.roi:+.1%}. {self.verdict}"
        )


def kelly_fraction(p_sell: float, win_each: Decimal, loss_each: Decimal,
                   stake_each: Decimal) -> float:
    """Full-Kelly bankroll fraction for a two-outcome trade.

    Upside and downside must be expressed as fractions of the stake, so the
    dollar amounts are normalized by ``stake_each`` first::

        w = win/stake,  l = loss/stake,  f* = (p*w - q*l) / (w*l)

    Clamped to [0, 1]: a strong edge can push raw Kelly above 1, which only
    means "lever up", and levered ticket inventory is not a thing to build.

    Report it, then bet a fraction of it. Kelly assumes ``p`` is known; here
    ``p`` is a model output with real error bars, and overbetting a
    mis-estimated edge is how bankrolls die. Quarter-Kelly is the usual
    working compromise -- see :func:`recommended_stake`.
    """
    stake = float(stake_each)
    if stake <= 0:
        return 0.0
    w = float(win_each) / stake
    l = float(loss_each) / stake
    if w <= 0:
        return 0.0
    if l <= 0:
        return 1.0  # no downside modelled; sizing is not the binding constraint
    q = 1.0 - p_sell
    return max(0.0, min(1.0, (p_sell * w - q * l) / (w * l)))


def recommended_stake(bankroll, kelly: float, fraction: float = 0.25,
                      max_pct: float = 0.05) -> Decimal:
    """Capital to commit: fractional Kelly, hard-capped as a share of bankroll.

    The cap matters more than the Kelly term. Ticket positions are correlated
    (one tour going soft hits every date you hold) and illiquid until the
    event, so single-event concentration is the practical risk, not ruin from
    one bad bet.
    """
    if kelly <= 0:
        return ZERO
    bank = money(bankroll)
    sized = Decimal(str(min(kelly * fraction, max_pct)))
    return money(bank * sized)


def evaluate(
    face_each,
    qty: int,
    target_price,
    p_sell: float,
    buy: BuyFees,
    sell: SellFees,
    salvage_price=None,
    hold_days: float = 90.0,
    annual_capital_cost: float = 0.08,
    cost_each: Optional[Decimal] = None,
) -> TradeEval:
    """Score one candidate trade end to end.

    ``salvage_price`` is the absolute per-ticket price you expect to get when
    the position does *not* clear at target -- the show-day dump. It must be
    anchored to the market, never to ``target_price``: deriving salvage as a
    fraction of your own ask means raising the ask also raises the assumed
    floor, which makes the downside branch look better the greedier you get
    and sends any EV optimizer straight into the tail. Defaults to 85% of
    face, which is roughly where a soft show lands once the seller side is
    racing the clock.

    This is the most consequential and least examined input in retail
    resale. Assuming you can always exit near cost is what turns a string of
    small wins into one large loss.

    ``cost_each`` overrides the modelled acquisition cost -- pass the real
    number from a receipt when you have one.
    """
    if not 0.0 <= p_sell <= 1.0:
        raise ValueError("p_sell must be in [0, 1]")
    breakdown = landed_cost(face_each, qty, buy)
    cost = money(cost_each) if cost_each is not None else breakdown.cost_each

    target = money(target_price)
    target_net = net_proceeds(target, qty, sell)
    salvage = money(salvage_price) if salvage_price is not None \
        else money(money(face_each) * Decimal("0.85"))
    salvage_net = net_proceeds(salvage, qty, sell)

    win = money(target_net - cost)
    loss = money(cost - salvage_net)
    carry = money(cost * Decimal(str(annual_capital_cost)) * Decimal(str(hold_days)) / Decimal("365"))

    p = Decimal(str(p_sell))
    ev = money(p * win - (ONE - p) * loss - carry)

    be_price = breakeven_list_price(cost, qty, sell)
    be_mult = be_price / money(face_each) if money(face_each) > ZERO else ZERO
    k = kelly_fraction(p_sell, win, loss, cost)
    roi = float(ev / cost) if cost > ZERO else 0.0

    if ev <= ZERO:
        verdict = "PASS - negative expected value"
    elif target < be_price:
        verdict = "PASS - target ask is below breakeven"
    elif k <= 0:
        verdict = "PASS - edge too thin to size"
    elif roi < 0.10:
        verdict = "MARGINAL - positive but under a 10% hurdle"
    else:
        verdict = "TAKE"

    return TradeEval(
        qty=qty, cost_each=cost, cost_total=money(cost * qty),
        target_price=target, target_net_each=target_net,
        breakeven_price=be_price, breakeven_mult=be_mult,
        p_sell=p_sell, salvage_price=salvage, salvage_net_each=salvage_net,
        win_each=win, loss_each=loss, carry_each=carry,
        ev_each=ev, ev_total=money(ev * qty), roi=roi, kelly=k, verdict=verdict,
    )
