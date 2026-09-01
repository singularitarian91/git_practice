import unittest
from decimal import Decimal

from support import NOW  # noqa: F401  (path setup)

from tixarb import economics
from tixarb.economics import BUY_PRESETS, SELL_PRESETS, BuyFees, SellFees
from tixarb.money import money


class TestLandedCost(unittest.TestCase):
    def setUp(self):
        self.buy = BuyFees(service_pct="0.20", facility_fee="5.00",
                           order_fee="6.00", delivery_fee="0.00")

    def test_components_add_up(self):
        c = economics.landed_cost(100, 2, self.buy)
        self.assertEqual(c.service_each, money("20.00"))
        self.assertEqual(c.facility_each, money("5.00"))
        self.assertEqual(c.order_each, money("3.00"))     # 6.00 over 2 tickets
        self.assertEqual(c.cost_each, money("128.00"))
        self.assertEqual(c.cost_total, money("256.00"))

    def test_per_order_fees_amortize_over_quantity(self):
        single = economics.landed_cost(100, 1, self.buy).cost_each
        pair = economics.landed_cost(100, 2, self.buy).cost_each
        self.assertGreater(single, pair)

    def test_fee_load_is_fraction_over_face(self):
        c = economics.landed_cost(100, 2, self.buy)
        self.assertAlmostEqual(float(c.fee_load), 0.28, places=4)

    def test_tax_applies_to_fees_too(self):
        taxed = economics.landed_cost(
            100, 2, BuyFees(service_pct="0.20", facility_fee="5.00",
                            order_fee="6.00", tax_pct="0.10"))
        self.assertEqual(taxed.cost_each, money("140.80"))  # 128.00 * 1.10

    def test_rejects_nonpositive_quantity(self):
        with self.assertRaises(ValueError):
            economics.landed_cost(100, 0, self.buy)

    def test_box_office_preset_has_no_service_fee(self):
        c = economics.landed_cost(100, 2, BUY_PRESETS["box-office"])
        self.assertEqual(c.cost_each, money("100.00"))


class TestSellSide(unittest.TestCase):
    def setUp(self):
        self.sell = SellFees(seller_pct="0.10", payment_pct="0.03",
                             buyer_pct="0.25")

    def test_net_proceeds_withhold_seller_and_payment_fees(self):
        self.assertEqual(economics.net_proceeds(200, 2, self.sell),
                         money("174.00"))

    def test_display_price_adds_buyer_fee(self):
        self.assertEqual(economics.display_price(200, self.sell),
                         money("250.00"))

    def test_display_price_inverts(self):
        listed = economics.list_price_for_display(250, self.sell)
        self.assertLessEqual(economics.display_price(listed, self.sell),
                             money("250.00"))

    def test_breakeven_price_returns_at_least_the_cost_basis(self):
        for cost in ("50.00", "103.28", "127.51", "999.99"):
            be = economics.breakeven_list_price(cost, 2, self.sell)
            self.assertGreaterEqual(
                economics.net_proceeds(be, 2, self.sell), money(cost),
                f"breakeven {be} nets less than cost {cost}")

    def test_breakeven_is_not_wastefully_high(self):
        # One cent lower must fail to cover cost, or we are leaving money on
        # the table on every listing.
        cost = money("103.28")
        be = economics.breakeven_list_price(cost, 2, self.sell)
        self.assertLess(
            economics.net_proceeds(be - Decimal("0.01"), 2, self.sell), cost)

    def test_impossible_fee_schedule_is_rejected(self):
        with self.assertRaises(ValueError):
            SellFees(seller_pct="0.80", payment_pct="0.30").retention


class TestBreakevenMultiple(unittest.TestCase):
    def test_typical_us_round_trip_needs_about_1_5x(self):
        mult = economics.breakeven_multiple(
            100, 2, BUY_PRESETS["ticketmaster-us"], SELL_PRESETS["stubhub"])
        self.assertGreater(mult, Decimal("1.40"))
        self.assertLess(mult, Decimal("1.60"))

    def test_cheaper_face_carries_a_worse_multiple(self):
        buy, sell = BUY_PRESETS["ticketmaster-us"], SELL_PRESETS["stubhub"]
        # Flat per-ticket fees are a larger share of a small face value.
        self.assertGreater(economics.breakeven_multiple(35, 2, buy, sell),
                           economics.breakeven_multiple(295, 2, buy, sell))

    def test_box_office_purchase_lowers_the_bar(self):
        sell = SELL_PRESETS["stubhub"]
        self.assertLess(
            economics.breakeven_multiple(100, 2, BUY_PRESETS["box-office"], sell),
            economics.breakeven_multiple(100, 2, BUY_PRESETS["ticketmaster-us"], sell))


class TestImpliedLoad(unittest.TestCase):
    def test_backs_the_real_rate_out_of_a_receipt(self):
        # $100 face, 2 tickets, card charged $256.96 -> 28.48% over face.
        load = economics.implied_buy_load(100, 2, "256.96")
        self.assertAlmostEqual(float(load), 0.2848, places=4)


class TestEvaluate(unittest.TestCase):
    def setUp(self):
        self.buy = BUY_PRESETS["ticketmaster-us"]
        self.sell = SELL_PRESETS["stubhub"]

    def test_thin_margin_with_a_fat_tail_is_rejected_despite_high_hit_rate(self):
        # 90% chance of a tiny win against a 10% chance of a large loss is a
        # losing trade. This is the shape that fools people.
        result = economics.evaluate(100, 2, 150, 0.90, self.buy, self.sell)
        self.assertLess(result.ev_each, 0)
        self.assertIn("PASS", result.verdict)

    def test_wide_margin_at_moderate_odds_is_taken(self):
        result = economics.evaluate(100, 2, 220, 0.70, self.buy, self.sell)
        self.assertGreater(result.ev_each, 0)
        self.assertEqual(result.verdict, "TAKE")

    def test_salvage_price_is_absolute_not_a_share_of_the_ask(self):
        # Regression: salvage used to be a ratio of target_price, so raising
        # the ask raised the assumed floor and the downside branch improved
        # as the ask grew. The loss must not shrink when the ask rises.
        low = economics.evaluate(100, 2, 160, 0.5, self.buy, self.sell)
        high = economics.evaluate(100, 2, 400, 0.5, self.buy, self.sell)
        self.assertEqual(low.salvage_price, high.salvage_price)
        self.assertEqual(low.loss_each, high.loss_each)

    def test_carry_cost_grows_with_holding_period(self):
        short = economics.evaluate(100, 2, 220, 0.7, self.buy, self.sell,
                                   hold_days=10)
        long = economics.evaluate(100, 2, 220, 0.7, self.buy, self.sell,
                                  hold_days=300)
        self.assertGreater(long.carry_each, short.carry_each)
        self.assertLess(long.ev_each, short.ev_each)

    def test_explicit_cost_overrides_the_model(self):
        result = economics.evaluate(100, 2, 220, 0.7, self.buy, self.sell,
                                    cost_each=money("111.11"))
        self.assertEqual(result.cost_each, money("111.11"))

    def test_rejects_out_of_range_probability(self):
        for bad in (-0.1, 1.1):
            with self.assertRaises(ValueError):
                economics.evaluate(100, 2, 220, bad, self.buy, self.sell)


class TestKelly(unittest.TestCase):
    def test_normalizes_by_stake(self):
        # Regression: passing dollar amounts unnormalized produced a
        # dimensionally meaningless fraction that shrank as stakes grew.
        small = economics.kelly_fraction(0.7, money("50"), money("20"),
                                         money("100"))
        large = economics.kelly_fraction(0.7, money("500"), money("200"),
                                         money("1000"))
        self.assertAlmostEqual(small, large, places=9)

    def test_negative_edge_sizes_to_zero(self):
        self.assertEqual(
            economics.kelly_fraction(0.2, money("10"), money("90"), money("100")),
            0.0)

    def test_clamped_to_a_full_bankroll(self):
        k = economics.kelly_fraction(0.99, money("500"), money("5"), money("100"))
        self.assertLessEqual(k, 1.0)

    def test_stake_respects_the_concentration_cap(self):
        # Even at full Kelly the per-event cap must bind.
        stake = economics.recommended_stake(10_000, kelly=1.0, fraction=0.25,
                                            max_pct=0.05)
        self.assertEqual(stake, money("500.00"))

    def test_no_stake_without_an_edge(self):
        self.assertEqual(economics.recommended_stake(10_000, kelly=0.0), 0)


if __name__ == "__main__":
    unittest.main()
