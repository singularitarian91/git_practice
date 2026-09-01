"""Markup forecasting and the buy/pass decision.

The chain is deliberately explicit end to end:

    signals -> composite score -> distribution over resale multiples
            -> P(clearing at a given ask) -> expected value -> verdict

The middle step matters. A point estimate ("this will go for 2.1x") is
useless for sizing, because the decision is not "what will it sell for" but
"what is the chance it clears above my breakeven". Resale outcomes are
right-skewed -- most shows drift near face, a few go parabolic -- so the
model carries a lognormal, and every downstream number is read off that
distribution rather than off a single guess.

The forecast is not a black box: :attr:`MarkupForecast.signals` carries every
input, its weight and why it scored the way it did, so a bad call can be
traced to the signal that caused it.
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from . import economics, features
from .models import Event, Quote
from .money import ZERO, money

MODEL_VERSION = "score-1"

# score -> median multiple, as mult = FLOOR * exp(SPAN * score).
# Anchored so a zero-signal event lands at 0.60x face (a show that
# underperforms and gets dumped) and a maximal one at 3.50x. These are the
# two numbers to revisit first when calibrating against your own results.
MULT_FLOOR = 0.60
MULT_TOP = 3.50
MULT_SPAN = math.log(MULT_TOP / MULT_FLOOR)

# Lognormal dispersion at full confidence. Widened as confidence falls, so a
# thinly-evidenced forecast produces a visibly wide interval rather than a
# crisp-looking wrong answer.
BASE_SIGMA = 0.35

Z90 = 1.2815515655446004  # standard normal 90th percentile


def _phi(x: float) -> float:
    """Standard normal CDF."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


@dataclass(frozen=True)
class MarkupForecast:
    """A distribution over the resale multiple of face value."""

    event_id: str
    score: float                 # composite signal strength, 0-1
    confidence: float            # share of signal weight actually available
    median: float                # p50 multiple
    mean: float                  # expected multiple (> median; right-skewed)
    p10: float
    p90: float
    sigma: float
    signals: tuple = ()
    model_version: str = MODEL_VERSION

    def p_clear_at(self, multiple: float) -> float:
        """P(resale multiple >= ``multiple``).

        This is the ``p_sell`` that :func:`tixarb.economics.evaluate` needs.
        Note what it does *not* model: it is the chance the market reaches
        that price, not the chance your specific listing is the one that
        sells there. In a thick float those diverge sharply -- see
        :mod:`tixarb.pricing`, which handles queue position.
        """
        if multiple <= 0:
            return 1.0
        if self.sigma <= 0:
            return 1.0 if self.median >= multiple else 0.0
        z = (math.log(self.median) - math.log(multiple)) / self.sigma
        return _phi(z)

    def quantile(self, q: float) -> float:
        """Inverse CDF of the multiple, for ``q`` in (0, 1)."""
        if not 0.0 < q < 1.0:
            raise ValueError("q must be in (0, 1)")
        # Acklam-style approximation is overkill here; bisect on the CDF.
        lo, hi = 1e-6, self.median * 50
        for _ in range(200):
            mid = (lo + hi) / 2
            if 1.0 - self.p_clear_at(mid) < q:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    def explain(self) -> str:
        lines = [
            f"score {self.score:.2f} (confidence {self.confidence:.0%}) "
            f"-> {self.median:.2f}x face median, "
            f"p10 {self.p10:.2f}x / p90 {self.p90:.2f}x"
        ]
        for s in sorted(self.signals, key=lambda s: -s.weight):
            val = "  --  " if s.value is None else f" {s.value:.2f} "
            lines.append(f"    {s.name:<18}{val} w={s.weight:<4} {s.rationale}")
        return "\n".join(lines)


def forecast(event: Event, quote: Optional[Quote] = None,
             competing_dates: int = 1, weights: Optional[dict] = None,
             at: Optional[dt.datetime] = None,
             include_post_onsale: bool = True) -> MarkupForecast:
    """Forecast the resale multiple for one event."""
    signals = features.extract(
        event, quote=quote, competing_dates=competing_dates, weights=weights,
        at=at, include_post_onsale=include_post_onsale,
    )
    score, confidence = features.composite(signals)

    median = MULT_FLOOR * math.exp(MULT_SPAN * score)
    sigma = BASE_SIGMA * (2.0 - confidence)
    # Mean of a lognormal sits above its median by exp(sigma^2/2): the upside
    # tail is where the money is, and reporting only the median understates
    # a portfolio of these.
    mean = median * math.exp(sigma * sigma / 2.0)

    return MarkupForecast(
        event_id=event.id, score=score, confidence=confidence,
        median=median, mean=mean,
        p10=median * math.exp(-Z90 * sigma),
        p90=median * math.exp(Z90 * sigma),
        sigma=sigma, signals=tuple(signals),
    )


# --------------------------------------------------------------------------
# Closing the loop: forecast + fees -> an actual decision
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Recommendation:
    event_id: str
    forecast: MarkupForecast
    trade: economics.TradeEval
    target_multiple: float
    stake: Decimal = ZERO
    action: str = "PASS"

    def explain(self) -> str:
        return (
            f"{self.action}: ask {self.trade.target_price} "
            f"({self.target_multiple:.2f}x face) vs breakeven "
            f"{self.trade.breakeven_price} ({self.trade.breakeven_mult:.2f}x). "
            f"p(clear)={self.trade.p_sell:.0%}, EV {self.trade.ev_each}/ticket, "
            f"ROI {self.trade.roi:+.1%}"
        )


def salvage_multiple(fc: MarkupForecast, dump_haircut: float = 0.85) -> float:
    """Multiple of face to assume in the scenario where the thesis failed.

    Deliberately *not* the forecast's own p10. The salvage branch is by
    construction the world in which this forecast was wrong, so reading the
    downside off the same distribution is circular -- and a bullish forecast
    produces a bullish p10, which is precisely backwards. Capping at 1.0x
    face before the haircut says: if the thesis breaks, assume the ticket is
    worth face at best, and you are a forced seller on show day.
    """
    return min(fc.p10, 1.0) * dump_haircut


def optimal_target(fc: MarkupForecast, face_each, qty: int,
                   buy: economics.BuyFees, sell: economics.SellFees,
                   salvage_price=None, hold_days: float = 90.0,
                   cost_each: Optional[Decimal] = None,
                   steps: int = 60) -> tuple:
    """Find the ask that maximizes expected value.

    There is a real optimum to find. Ask too little and you cap the upside on
    a show that was going to run; ask too much and ``p_clear`` collapses and
    you eat the salvage. Sweeping the ask from breakeven up through the p90
    and taking the argmax of EV is cheap and beats picking a round multiple
    by feel.

    Returns ``(best_multiple, best_eval)``.
    """
    face = money(face_each)
    if face <= ZERO:
        raise ValueError("face must be positive")
    cost = cost_each if cost_each is not None else \
        economics.landed_cost(face, qty, buy).cost_each
    be_mult = float(economics.breakeven_list_price(cost, qty, sell) / face)

    lo = be_mult
    hi = max(be_mult * 1.05, fc.p90 * 1.25)
    best = None
    for i in range(steps + 1):
        mult = lo + (hi - lo) * i / steps
        target = money(face * Decimal(str(mult)))
        p = fc.p_clear_at(mult)
        ev = economics.evaluate(
            face, qty, target, p, buy, sell, salvage_price=salvage_price,
            hold_days=hold_days, cost_each=cost,
        )
        if best is None or ev.ev_each > best[1].ev_each:
            best = (mult, ev)
    return best


def recommend(event: Event, face_each, qty: int,
              buy: economics.BuyFees, sell: economics.SellFees,
              quote: Optional[Quote] = None, competing_dates: int = 1,
              bankroll=None, salvage_price=None,
              min_roi: float = 0.15, min_confidence: float = 0.35,
              weights: Optional[dict] = None,
              cost_each: Optional[Decimal] = None,
              at: Optional[dt.datetime] = None) -> Recommendation:
    """Full buy-side decision for one event at one price point."""
    fc = forecast(event, quote=quote, competing_dates=competing_dates,
                  weights=weights, at=at)
    hold_days = max(1.0, event.days_until(at))
    mult, trade = optimal_target(
        fc, face_each, qty, buy, sell, salvage_price=salvage_price,
        hold_days=hold_days, cost_each=cost_each,
    )

    if fc.confidence < min_confidence:
        action = "PASS - too little data to judge"
    elif not trade.is_positive:
        action = "PASS - negative expected value"
    elif trade.roi < min_roi:
        action = f"PASS - {trade.roi:.1%} ROI under the {min_roi:.0%} hurdle"
    else:
        action = "BUY"

    stake = ZERO
    if action == "BUY" and bankroll is not None:
        stake = economics.recommended_stake(bankroll, trade.kelly)

    return Recommendation(event_id=event.id, forecast=fc, trade=trade,
                          target_multiple=mult, stake=stake, action=action)


# --------------------------------------------------------------------------
# Calibration
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Calibration:
    n: int
    r_squared: float
    weights: dict
    intercept: float
    usable: bool
    message: str


def _solve_ridge(xtx: list, xty: list, lam: float) -> Optional[list]:
    """Solve (X'X + lam*I) b = X'y by Gaussian elimination with partial pivoting."""
    k = len(xty)
    aug = [row[:] + [xty[i]] for i, row in enumerate(xtx)]
    for i in range(k):
        aug[i][i] += lam
    for col in range(k):
        pivot = max(range(col, k), key=lambda r: abs(aug[r][col]))
        if abs(aug[pivot][col]) < 1e-12:
            return None  # singular: features are collinear or constant
        aug[col], aug[pivot] = aug[pivot], aug[col]
        pv = aug[col][col]
        aug[col] = [v / pv for v in aug[col]]
        for r in range(k):
            if r == col:
                continue
            factor = aug[r][col]
            if factor:
                aug[r] = [v - factor * aug[col][j] for j, v in enumerate(aug[r])]
    return [aug[i][k] for i in range(k)]


MIN_CALIBRATION_ROWS = 25


def calibrate(rows: list, lam: float = 1.0,
              min_rows: int = MIN_CALIBRATION_ROWS) -> Calibration:
    """Refit feature weights against realized sale multiples.

    ``rows`` is ``[(features_dict, realized_multiple, event_id), ...]`` as
    produced by :meth:`tixarb.store.Store.training_rows`.

    Fits ``log(multiple) ~ intercept + sum(b_i * f_i)`` by ridge regression,
    then takes the positive coefficients as relative weights. Ridge rather
    than plain least squares because the features are strongly correlated
    (a big act underplaying a small room lights up demand, scarcity *and*
    prestige at once) and unregularized fits on correlated features produce
    wild, sign-flipped coefficients from a handful of samples.

    Refuses to emit weights below ``min_rows`` observations. With ten
    features and a dozen sales, a fit is memorization, and shipping it would
    replace defensible priors with noise. The honest answer early on is
    "keep trading the priors and keep recording outcomes".
    """
    if len(rows) < min_rows:
        return Calibration(
            n=len(rows), r_squared=0.0, weights={}, intercept=0.0, usable=False,
            message=(f"{len(rows)} realized sales; need {min_rows} before a fit "
                     f"beats the default weights. Keep recording outcomes."),
        )

    names = sorted({k for feats, _, _ in rows for k in feats})
    if not names:
        return Calibration(len(rows), 0.0, {}, 0.0, False, "no features recorded")

    X, y = [], []
    for feats, realized, _ in rows:
        if realized <= 0:
            continue
        X.append([1.0] + [float(feats.get(n, 0.5)) for n in names])
        y.append(math.log(realized))
    if len(X) < min_rows:
        return Calibration(len(X), 0.0, {}, 0.0, False,
                           "not enough rows with a positive realized multiple")

    k = len(names) + 1
    xtx = [[sum(row[i] * row[j] for row in X) for j in range(k)] for i in range(k)]
    xty = [sum(X[r][i] * y[r] for r in range(len(X))) for i in range(k)]
    # Do not penalize the intercept -- shrinking it just biases every
    # prediction toward a multiple of 1.0x.
    xtx[0][0] -= lam
    beta = _solve_ridge(xtx, xty, lam)
    if beta is None:
        return Calibration(len(X), 0.0, {}, 0.0, False,
                           "features are collinear; cannot fit")

    mean_y = sum(y) / len(y)
    ss_tot = sum((v - mean_y) ** 2 for v in y)
    ss_res = sum(
        (y[r] - sum(beta[i] * X[r][i] for i in range(k))) ** 2
        for r in range(len(X))
    )
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

    # Negative coefficients are almost always overfit on this data size, and
    # a negative weight on a signal we believe in on priors does more damage
    # than dropping it. Floor at zero and rescale to the prior's total mass
    # so the composite stays on the same scale.
    raw = {n: max(0.0, beta[i + 1]) for i, n in enumerate(names)}
    total = sum(raw.values())
    if total <= 0:
        return Calibration(len(X), r2, {}, beta[0], False,
                           "fit produced no positive coefficients")
    prior_mass = sum(features.DEFAULT_WEIGHTS.get(n, 1.0) for n in names)
    scaled = {n: v / total * prior_mass for n, v in raw.items()}

    return Calibration(
        n=len(X), r_squared=r2, weights=scaled, intercept=beta[0], usable=True,
        message=f"fit on {len(X)} sales, R^2 {r2:.2f}",
    )
