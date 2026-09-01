"""Money primitives.

All money in this package is a ``Decimal`` quantized to cents. Never float:
margins here are routinely 5-15% of cost, and float drift compounds across the
buy-fee / sell-fee / tax chain fast enough to flip a marginal position from
profitable to not.

Persistence stores integer cents (see :mod:`tixarb.store`); the conversion
helpers live here so rounding happens in exactly one place.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP, ROUND_FLOOR

CENT = Decimal("0.01")
ZERO = Decimal("0")


def money(value) -> Decimal:
    """Coerce ``value`` to a cent-quantized Decimal.

    Floats are routed through ``repr`` so ``money(0.1)`` is ``0.10`` rather
    than the 0.1000000000000000055... binary expansion.
    """
    if isinstance(value, Decimal):
        dec = value
    elif isinstance(value, float):
        dec = Decimal(repr(value))
    else:
        dec = Decimal(str(value))
    return dec.quantize(CENT, rounding=ROUND_HALF_UP)


def rate(value) -> Decimal:
    """Coerce ``value`` to an unquantized Decimal, for percentages/ratios.

    Rates keep full precision -- quantizing a 14.75% commission to cents would
    turn it into 15%.
    """
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        return Decimal(repr(value))
    return Decimal(str(value))


def to_cents(value) -> int:
    """Serialize money to integer cents for storage."""
    return int(money(value) * 100)


def from_cents(cents) -> Decimal:
    """Deserialize integer cents back to money."""
    if cents is None:
        return ZERO
    return money(Decimal(int(cents)) / 100)


def price_floor(value) -> Decimal:
    """Round a computed price *down* to the cent.

    Used when deriving a list price from a target payout: rounding up would
    quietly push the payout below the target it was solved for.
    """
    if isinstance(value, float):
        value = Decimal(repr(value))
    elif not isinstance(value, Decimal):
        value = Decimal(str(value))
    return value.quantize(CENT, rounding=ROUND_FLOOR)


def pct_str(value) -> str:
    """Format a rate as a human percentage, e.g. ``Decimal('0.145')`` -> ``14.5%``."""
    return f"{rate(value) * 100:.4g}%"
