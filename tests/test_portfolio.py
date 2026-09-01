import datetime as dt
import unittest

from support import NOW, event, quote, venue

from tixarb import config as config_mod
from tixarb import portfolio
from tixarb.models import Position, PositionStatus
from tixarb.money import money
from tixarb.store import Store


class PortfolioCase(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.addCleanup(self.store.close)
        self.cfg = config_mod.Config(bankroll=money("10000.00"),
                                     max_position_pct=0.05)
        self.event = event()
        self.store.upsert_event(self.event)

    def add(self, pid="p1", qty=2, face="59.00", cost="79.28", eid=None,
            status=PositionStatus.HELD, sold_price=None):
        pos = Position(pid, eid or self.event.id, qty, face, cost, NOW,
                       status=status, sold_price=sold_price,
                       sold_at=NOW if sold_price else None)
        self.store.save_position(pos)
        return pos


class TestMarking(PortfolioCase):
    def test_marks_net_of_sell_fees_not_at_gross_market(self):
        self.add()
        self.store.record_quote(quote(self.event.id, get_in=200))
        marked = portfolio.mark(self.store, self.store.get_position("p1"),
                                self.cfg.sell_fees(), NOW)
        self.assertEqual(marked.market_price, money("200.00"))
        self.assertEqual(marked.market_net, money("174.00"))  # 200 * 0.87
        self.assertLess(marked.market_net, marked.market_price)

    def test_unquoted_inventory_is_held_at_cost(self):
        self.add()
        marked = portfolio.mark(self.store, self.store.get_position("p1"),
                                self.cfg.sell_fees(), NOW)
        self.assertIsNone(marked.market_price)
        self.assertEqual(marked.unrealized_each, 0)

    def test_underwater_positions_are_flagged(self):
        self.add()
        self.store.record_quote(quote(self.event.id, get_in=50))
        marked = portfolio.mark(self.store, self.store.get_position("p1"),
                                self.cfg.sell_fees(), NOW)
        self.assertTrue(marked.is_underwater)


class TestRealizedPnl(PortfolioCase):
    def test_sale_is_net_of_fees(self):
        pos = self.add(status=PositionStatus.SOLD, sold_price="200.00")
        # (200 * 0.87 - 79.28) * 2
        self.assertEqual(portfolio.realized_pnl(pos, self.cfg.sell_fees()),
                         money("189.44"))

    def test_unsold_expiry_loses_the_whole_basis(self):
        # Not "still worth what I paid" -- that fiction is what keeps dead
        # positions on the book.
        pos = self.add(status=PositionStatus.EXPIRED)
        self.assertEqual(portfolio.realized_pnl(pos, self.cfg.sell_fees()),
                         money("-158.56"))

    def test_open_positions_have_no_realized_pnl(self):
        self.assertEqual(portfolio.realized_pnl(self.add(),
                                                self.cfg.sell_fees()), 0)


class TestSummary(PortfolioCase):
    def test_separates_open_from_closed(self):
        self.add("p1")
        self.add("p2", status=PositionStatus.SOLD, sold_price="200.00")
        summary = portfolio.summarize(self.store, self.cfg, NOW)
        self.assertEqual(summary.open_count, 1)
        self.assertEqual(summary.sold_count, 1)
        self.assertEqual(summary.open_tickets, 2)

    def test_win_rate_counts_expiries_as_losses(self):
        self.add("p1", status=PositionStatus.SOLD, sold_price="200.00")
        self.add("p2", status=PositionStatus.EXPIRED)
        summary = portfolio.summarize(self.store, self.cfg, NOW)
        self.assertEqual((summary.wins, summary.losses), (1, 1))
        self.assertAlmostEqual(summary.win_rate, 0.5)

    def test_win_rate_is_undefined_with_no_closed_positions(self):
        self.add("p1")
        self.assertIsNone(portfolio.summarize(self.store, self.cfg, NOW).win_rate)

    def test_total_pnl_combines_both(self):
        self.add("p1", status=PositionStatus.SOLD, sold_price="200.00")
        self.add("p2")
        self.store.record_quote(quote(self.event.id, get_in=200))
        summary = portfolio.summarize(self.store, self.cfg, NOW)
        self.assertEqual(summary.total_pnl,
                         money(summary.realized + summary.unrealized))


class TestConcentration(PortfolioCase):
    def test_flags_exposure_over_the_per_event_cap(self):
        self.add("p1", qty=20, cost="79.28")     # 1585.60 vs a 500 cap
        warnings = portfolio.check_concentration(self.store, self.cfg, NOW)
        self.assertTrue(any("per-event cap" in w for w in warnings))

    def test_flags_a_tour_masquerading_as_diversification(self):
        # Same artist, two dates. They reprice together.
        second = event(eid="e:second", days_out=80)
        self.store.upsert_event(second)
        self.add("p1")
        self.add("p2", eid=second.id)
        warnings = portfolio.check_concentration(self.store, self.cfg, NOW)
        tour = [w for w in warnings if "reprice together" in w]
        self.assertTrue(tour)
        self.assertIn("across 2 dates", tour[0])

    def test_single_position_does_not_trip_the_tour_warning(self):
        # A lone position is trivially 100% of the book; saying so is noise
        # that trains the operator to ignore the warning that matters.
        self.cfg.bankroll = money("100000.00")
        self.add("p1")
        warnings = portfolio.check_concentration(self.store, self.cfg, NOW)
        self.assertFalse(any("reprice together" in w for w in warnings))

    def test_two_dates_by_different_artists_do_not_trip_it(self):
        from support import artist as make_artist
        other = event(eid="e:other", days_out=80,
                      the_artist=make_artist(aid="a:other", name="Other Act"))
        self.store.upsert_event(other)
        self.cfg.bankroll = money("100000.00")
        self.add("p1")
        self.add("p2", eid=other.id)
        warnings = portfolio.check_concentration(self.store, self.cfg, NOW)
        self.assertFalse(any("reprice together" in w for w in warnings))

    def test_flags_spending_beyond_the_bankroll(self):
        self.cfg.bankroll = money("100.00")
        self.add("p1")
        warnings = portfolio.check_concentration(self.store, self.cfg, NOW)
        self.assertTrue(any("bankroll" in w for w in warnings))

    def test_quiet_when_within_limits(self):
        self.cfg.bankroll = money("100000.00")
        self.add("p1")
        self.assertEqual(portfolio.check_concentration(self.store, self.cfg, NOW),
                         [])


class TestNeedsAttention(PortfolioCase):
    def test_lists_positions_inside_the_horizon_soonest_first(self):
        near = event(eid="e:near", days_out=5)
        far = event(eid="e:far", days_out=200)
        self.store.upsert_event(near)
        self.store.upsert_event(far)
        self.add("p-near", eid=near.id)
        self.add("p-far", eid=far.id)
        rows = portfolio.needs_attention(self.store, self.cfg, NOW,
                                         horizon_days=21)
        self.assertEqual([r.position.id for r in rows], ["p-near"])

    def test_sorted_by_urgency(self):
        for days in (18, 3, 11):
            e = event(eid=f"e:{days}", days_out=days)
            self.store.upsert_event(e)
            self.add(f"p{days}", eid=e.id)
        rows = portfolio.needs_attention(self.store, self.cfg, NOW,
                                         horizon_days=21)
        self.assertEqual([r.position.id for r in rows], ["p3", "p11", "p18"])


if __name__ == "__main__":
    unittest.main()
