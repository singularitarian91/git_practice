"""tixarb -- decision support for buying and reselling event tickets.

The system automates everything that can be automated legitimately:
discovering onsales, forecasting resale markup, sizing positions against
fees and bankroll, repricing listings on a decay curve, and tracking P&L.

It does not automate the purchase itself. Under the US BOTS Act it is
unlawful to circumvent a ticket seller's access controls, CAPTCHAs, queues
or posted purchase limits, so the buy step alerts a human who buys within
the limits. See docs/LEGAL.md for what that does and does not rule out.
"""

__version__ = "0.1.0"

__all__ = [
    "alerts", "config", "economics", "features", "models", "money",
    "portfolio", "pricing", "scoring", "sources", "store", "watcher",
]
