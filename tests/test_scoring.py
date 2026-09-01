import unittest

from support import NOW, artist, event, quote, venue

from tixarb import scoring
from tixarb.economics import BUY_PRESETS, SELL_PRESETS
from tixarb.money import money


class TestForecast(unittest.TestCase):
    def test_stronger_signals_forecast_a_higher_multiple(self):
        hot = scoring.forecast(event(the_venue=venue(capacity=500),
                                     tags=("underplay",), face=(40, 50)))
        cold = scoring.forecast(event(
            the_venue=venue(capacity=20000),
            the_artist=artist(followers=400_000, prior=420_000,
                              listeners=1_500_000, popularity=45),
            face=(180, 300)))
        self.assertGreater(hot.median, cold.median)

    def test_distribution_is_ordered(self):
        fc = scoring.forecast(event())
        self.assertLess(fc.p10, fc.median)
        self.assertLess(fc.median, fc.p90)

    def test_mean_exceeds_median_because_upside_is_skewed(self):
        fc = scoring.forecast(event())
        self.assertGreater(fc.mean, fc.median)

    def test_lower_confidence_widens_the_interval(self):
        wide = scoring.forecast(event(the_venue=venue(capacity=0),
                                      the_artist=artist(prior=None)))
        narrow = scoring.forecast(event(), quote=quote())
        self.assertGreater(wide.sigma, narrow.sigma)

    def test_clear_probability_falls_as_the_ask_rises(self):
        fc = scoring.forecast(event())
        probs = [fc.p_clear_at(m) for m in (1.0, 1.5, 2.0, 3.0, 5.0)]
        self.assertEqual(probs, sorted(probs, reverse=True))
        self.assertTrue(all(0.0 <= p <= 1.0 for p in probs))

    def test_clear_probability_at_the_median_is_one_half(self):
        fc = scoring.forecast(event())
        self.assertAlmostEqual(fc.p_clear_at(fc.median), 0.5, places=6)

    def test_quantile_inverts_the_distribution(self):
        fc = scoring.forecast(event())
        self.assertAlmostEqual(fc.quantile(0.5), fc.median, places=3)
        self.assertAlmostEqual(fc.quantile(0.9), fc.p90, places=2)

    def test_explanation_names_every_signal(self):
        fc = scoring.forecast(event(), quote=quote())
        text = fc.explain()
        for signal in fc.signals:
            self.assertIn(signal.name, text)


class TestSalvage(unittest.TestCase):
    def test_capped_at_face_without_market_evidence(self):
        # Regression: reading the downside off the forecast's own p10 made a
        # bullish forecast produce a bullish floor, which is backwards.
        fc = scoring.forecast(event(the_venue=venue(capacity=400),
                                    tags=("underplay",)))
        self.assertGreater(fc.p10, 1.0)
        self.assertLessEqual(scoring.salvage_multiple(fc, 50.0, None), 0.85)

    def test_observed_market_can_only_raise_the_floor(self):
        e = event(the_venue=venue(capacity=2000), face=(80, 80))
        q = quote(get_in=180, tickets=60)          # thin float, trading at 2.25x
        fc = scoring.forecast(e, quote=q)
        with_market = scoring.salvage_multiple(fc, 80.0, q)
        without = scoring.salvage_multiple(fc, 80.0, None)
        self.assertGreater(with_market, without)

    def test_saturated_float_decays_the_observed_price_harder(self):
        e = event(the_venue=venue(capacity=2000), face=(80, 80))
        thin = quote(get_in=180, tickets=50)
        thick = quote(get_in=180, tickets=600)
        thin_salv = scoring.salvage_multiple(
            scoring.forecast(e, quote=thin), 80.0, thin)
        thick_salv = scoring.salvage_multiple(
            scoring.forecast(e, quote=thick), 80.0, thick)
        self.assertGreater(thin_salv, thick_salv)


class TestOptimalTarget(unittest.TestCase):
    def setUp(self):
        self.buy = BUY_PRESETS["ticketmaster-us"]
        self.sell = SELL_PRESETS["stubhub"]

    def test_finds_an_interior_optimum_not_the_tail(self):
        # Regression: with salvage anchored to the ask, EV rose without
        # bound and the optimizer returned an absurd multiple at ~4% odds.
        fc = scoring.forecast(event(the_venue=venue(capacity=500),
                                    tags=("underplay",)))
        mult, trade = scoring.optimal_target(fc, 55, 2, self.buy, self.sell)
        self.assertLess(mult, fc.p90 * 1.2)
        self.assertGreater(trade.p_sell, 0.20)

    def test_target_never_falls_below_breakeven(self):
        fc = scoring.forecast(event())
        _, trade = scoring.optimal_target(fc, 55, 2, self.buy, self.sell)
        self.assertGreaterEqual(trade.target_price, trade.breakeven_price)

    def test_rejects_zero_face(self):
        with self.assertRaises(ValueError):
            scoring.optimal_target(scoring.forecast(event()), 0, 2,
                                   self.buy, self.sell)


class TestRecommend(unittest.TestCase):
    def setUp(self):
        self.buy = BUY_PRESETS["ticketmaster-us"]
        self.sell = SELL_PRESETS["stubhub"]

    def test_takes_the_underplay(self):
        e = event(the_venue=venue(capacity=500), tags=("underplay",),
                  face=(45, 55))
        rec = scoring.recommend(e, 45, 2, self.buy, self.sell, at=NOW)
        self.assertEqual(rec.action, "BUY")
        self.assertGreater(rec.trade.ev_each, 0)

    def test_passes_the_oversized_arena_date(self):
        e = event(the_venue=venue(capacity=20000),
                  the_artist=artist(followers=900_000, prior=920_000,
                                    listeners=2_000_000, popularity=50),
                  face=(120, 280))
        rec = scoring.recommend(e, 180, 2, self.buy, self.sell,
                                competing_dates=3, at=NOW)
        self.assertTrue(rec.action.startswith("PASS"))

    def test_passes_when_confidence_is_too_low(self):
        bare = event(the_venue=venue(capacity=0),
                     the_artist=artist(prior=None), face=(0, 0))
        rec = scoring.recommend(bare, 50, 2, self.buy, self.sell,
                                min_confidence=0.9, at=NOW)
        self.assertIn("too little data", rec.action)

    def test_hurdle_rate_is_enforced(self):
        e = event(the_venue=venue(capacity=500), tags=("underplay",))
        greedy = scoring.recommend(e, 45, 2, self.buy, self.sell,
                                   min_roi=5.0, at=NOW)
        self.assertIn("hurdle", greedy.action)

    def test_stake_only_sized_on_a_buy(self):
        e = event(the_venue=venue(capacity=20000),
                  the_artist=artist(followers=900_000, prior=920_000,
                                    listeners=2_000_000, popularity=50))
        rec = scoring.recommend(e, 180, 2, self.buy, self.sell,
                                bankroll=10_000, at=NOW)
        self.assertEqual(rec.stake, 0)


class TestCalibration(unittest.TestCase):
    def test_refuses_to_fit_on_too_few_sales(self):
        rows = [({"venue_scarcity": 0.8, "momentum": 0.6}, 2.0, "e1")] * 5
        result = scoring.calibrate(rows)
        self.assertFalse(result.usable)
        self.assertEqual(result.weights, {})
        self.assertIn("Keep recording outcomes", result.message)

    def test_recovers_a_planted_relationship(self):
        import math
        rows = []
        for i in range(60):
            scarcity = (i % 10) / 10.0
            momentum = ((i * 3) % 10) / 10.0
            realized = math.exp(0.2 + 1.5 * scarcity + 0.3 * momentum)
            rows.append(({"venue_scarcity": scarcity, "momentum": momentum},
                         realized, f"e{i}"))
        result = scoring.calibrate(rows, lam=0.01)
        self.assertTrue(result.usable, result.message)
        self.assertGreater(result.r_squared, 0.95)
        self.assertGreater(result.weights["venue_scarcity"],
                           result.weights["momentum"])

    def test_drops_rows_with_impossible_multiples(self):
        rows = [({"venue_scarcity": 0.5}, 0.0, f"e{i}") for i in range(40)]
        self.assertFalse(scoring.calibrate(rows).usable)

    def test_handles_empty_input(self):
        result = scoring.calibrate([])
        self.assertFalse(result.usable)


if __name__ == "__main__":
    unittest.main()
