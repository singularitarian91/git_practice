import datetime as dt
import unittest

from support import NOW, artist, event, quote, venue

from tixarb import economics, pricing, scoring
from tixarb.economics import BUY_PRESETS, SELL_PRESETS, landed_cost
from tixarb.models import Position, Quote
from tixarb.money import money

BUY = BUY_PRESETS["ticketmaster-us"]
SELL = SELL_PRESETS["stubhub"]


def position(face=59, qty=2, eid="e:test", listed=None):
    return Position(id="p:test", event_id=eid, qty=qty, face_each=face,
                    cost_each=landed_cost(face, qty, BUY).cost_each,
                    purchased_at=NOW, listed_price=listed)


class TestLadderMonotonicity(unittest.TestCase):
    """Regression: the reservation price must never rise as showtime nears.

    The ambitious anchor was denominated in the position's face value while
    the clearing anchor came from the market get-in, so a cheap seat in a hot
    market produced a curve that asked *less* two months out than on the day.
    """

    def _ladder(self, e, q, face=59):
        fc = scoring.forecast(e, quote=q)
        return [r["ask"] for r in
                pricing.ladder(position(face=face, eid=e.id), e, fc, q, SELL,
                               at=NOW, steps=12)]

    def assert_non_increasing(self, asks, label):
        for earlier, later in zip(asks, asks[1:]):
            self.assertGreaterEqual(earlier, later,
                                    f"{label}: ask rose from {earlier} to {later}")

    def test_thin_float_hot_market(self):
        e = event(the_venue=venue(capacity=2362), face=(59, 99))
        self.assert_non_increasing(
            self._ladder(e, quote(get_in=178, median=245, tickets=96)), "thin")

    def test_saturated_float(self):
        e = event(the_venue=venue(capacity=2362), face=(59, 99))
        self.assert_non_increasing(
            self._ladder(e, quote(get_in=45, median=70, tickets=900)), "thick")

    def test_no_quote_at_all(self):
        self.assert_non_increasing(self._ladder(event(), None), "no quote")

    def test_expensive_face_soft_market(self):
        e = event(the_venue=venue(capacity=20000), face=(120, 280))
        self.assert_non_increasing(
            self._ladder(e, quote(get_in=64, median=118, tickets=3100), face=195),
            "arena")

    def test_ladder_ends_at_showtime(self):
        e = event()
        fc = scoring.forecast(e)
        rows = pricing.ladder(position(eid=e.id), e, fc, None, SELL, at=NOW)
        self.assertEqual(rows[-1]["days_out"], 0.0)

    def test_ladder_is_empty_once_the_event_has_started(self):
        e = event(days_out=-1)
        rows = pricing.ladder(position(eid=e.id), e, scoring.forecast(e), None,
                              SELL, at=NOW)
        self.assertEqual(rows, [])


class TestExitDiscipline(unittest.TestCase):
    def setUp(self):
        self.event = event(the_venue=venue(capacity=2362), face=(59, 99))
        self.pos = position(eid=self.event.id)

    def advise_at(self, days, q):
        fc = scoring.forecast(self.event, quote=q)
        at = self.event.starts_at - dt.timedelta(days=days)
        return pricing.advise(self.pos, self.event, fc, q, BUY, SELL, at=at)

    def test_holds_while_far_out(self):
        self.assertEqual(self.advise_at(60, None).action, "hold")

    def test_liquidates_inside_the_final_window(self):
        advice = self.advise_at(2, quote(get_in=178, tickets=96))
        self.assertEqual(advice.action, "dump")
        self.assertEqual(advice.urgency, "high")

    def test_cuts_early_when_the_market_is_under_breakeven(self):
        # The discipline that matters: a market below breakeven with three
        # weeks left decays from there. Holding for "at least breakeven"
        # turns a recoverable loss into a total one.
        advice = self.advise_at(20, quote(get_in=60, median=75, tickets=900))
        self.assertEqual(advice.action, "dump")
        self.assertLess(advice.profit_each, 0)

    def test_waits_when_a_soft_market_still_has_time(self):
        advice = self.advise_at(60, quote(get_in=60, median=75, tickets=900))
        self.assertNotEqual(advice.action, "dump")
        self.assertIn("remain", advice.rationale)

    def test_will_price_below_breakeven_rather_than_hold_to_zero(self):
        advice = self.advise_at(1, quote(get_in=40, median=55, tickets=1200))
        self.assertFalse(advice.above_breakeven)
        self.assertGreater(advice.ask, 0)

    def test_expired_position_is_marked_worthless(self):
        advice = self.advise_at(-1, quote())
        self.assertEqual(advice.action, "expired")
        self.assertEqual(advice.ask, 0)
        self.assertEqual(advice.profit_each, money(-self.pos.cost_each))

    def test_does_not_chase_the_get_in_far_from_the_event(self):
        # Regression: undercutting unconditionally fired 60 days out and
        # flattened the curve onto the cheapest seat in the house.
        advice = self.advise_at(50, quote(get_in=178, median=245, tickets=96))
        self.assertNotEqual(advice.action, "undercut")

    def test_does_chase_the_get_in_near_the_event(self):
        advice = self.advise_at(10, quote(get_in=178, median=245, tickets=96))
        self.assertEqual(advice.action, "undercut")
        self.assertLess(advice.ask, money(178))


class TestAdviceArithmetic(unittest.TestCase):
    def test_net_and_display_bracket_the_ask(self):
        e = event()
        advice = pricing.advise(position(eid=e.id), e, scoring.forecast(e),
                                quote(), BUY, SELL, at=NOW)
        self.assertLess(advice.net_each, advice.ask)
        self.assertGreater(advice.display_ask, advice.ask)

    def test_profit_is_measured_against_landed_cost(self):
        e = event()
        advice = pricing.advise(position(eid=e.id), e, scoring.forecast(e),
                                None, BUY, SELL, at=NOW)
        self.assertEqual(advice.profit_each,
                         money(advice.net_each - advice.cost_each))

    def test_ask_never_goes_to_zero_before_showtime(self):
        e = event(days_out=1)
        advice = pricing.advise(position(eid=e.id), e, scoring.forecast(e),
                                quote(get_in=1, median=2, tickets=5000),
                                BUY, SELL, at=NOW)
        self.assertGreaterEqual(advice.ask, money("1.00"))


if __name__ == "__main__":
    unittest.main()
