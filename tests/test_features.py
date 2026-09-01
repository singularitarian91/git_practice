import unittest

from support import NOW, artist, event, quote, venue

from tixarb import features
from tixarb.models import Artist, Event


class TestAbstention(unittest.TestCase):
    """Missing data must abstain, never default. A fabricated 0.5 is
    indistinguishable from a measured one downstream."""

    def test_momentum_abstains_without_follower_history(self):
        e = event(the_artist=artist(prior=None))
        signal = features.momentum(e)
        self.assertFalse(signal.available)
        self.assertIn("90-day", signal.rationale)

    def test_venue_scarcity_abstains_on_unknown_capacity(self):
        signal = features.venue_scarcity(event(the_venue=venue(capacity=0)))
        self.assertFalse(signal.available)

    def test_venue_scarcity_abstains_without_audience_data(self):
        anon = Artist("a:x", "Unknown", popularity=0, followers=0)
        self.assertFalse(features.venue_scarcity(event(the_artist=anon)).available)

    def test_float_and_premium_abstain_without_a_quote(self):
        e = event()
        self.assertFalse(features.float_thinness(e, None).available)
        self.assertFalse(features.realized_premium(e, None).available)

    def test_face_headroom_abstains_without_a_published_price(self):
        self.assertFalse(features.face_headroom(event(face=(0, 0))).available)

    def test_prestige_scores_low_rather_than_abstaining(self):
        # An untagged event is a routine tour date -- real information, not
        # absent data.
        signal = features.prestige(event(tags=()))
        self.assertTrue(signal.available)
        self.assertLess(signal.value, 0.3)


class TestSignalDirection(unittest.TestCase):
    def test_scarcity_rises_as_the_room_shrinks(self):
        big = features.venue_scarcity(event(the_venue=venue(capacity=20000)))
        small = features.venue_scarcity(event(the_venue=venue(capacity=500)))
        self.assertGreater(small.value, big.value)

    def test_momentum_rises_with_follower_growth(self):
        flat = features.momentum(event(the_artist=artist(followers=400_000,
                                                         prior=400_000)))
        fast = features.momentum(event(the_artist=artist(followers=800_000,
                                                         prior=400_000)))
        self.assertGreater(fast.value, flat.value)

    def test_flat_growth_is_mildly_bearish_not_neutral(self):
        flat = features.momentum(event(the_artist=artist(followers=400_000,
                                                         prior=400_000)))
        self.assertLess(flat.value, 0.35)

    def test_weekend_beats_midweek(self):
        friday = features.weekday_premium(event(weekday=4))
        tuesday = features.weekday_premium(event(weekday=1))
        self.assertGreater(friday.value, tuesday.value)

    def test_competing_dates_dilute_scarcity(self):
        alone = features.date_density(event(), competing_dates=1)
        crowded = features.date_density(event(), competing_dates=4)
        self.assertGreater(alone.value, crowded.value)

    def test_thin_float_scores_above_saturated(self):
        e = event(the_venue=venue(capacity=1000))
        thin = features.float_thinness(e, quote(tickets=20))
        thick = features.float_thinness(e, quote(tickets=300))
        self.assertGreater(thin.value, thick.value)

    def test_cheaper_face_leaves_more_headroom(self):
        cheap = features.face_headroom(event(face=(30, 30)))
        dear = features.face_headroom(event(face=(240, 240)))
        self.assertGreater(cheap.value, dear.value)

    def test_all_values_stay_in_unit_range(self):
        for e in (event(), event(the_venue=venue(capacity=90000)),
                  event(face=(5, 5)), event(face=(900, 900))):
            for signal in features.extract(e, quote(), competing_dates=3):
                if signal.available:
                    self.assertGreaterEqual(signal.value, 0.0, signal.name)
                    self.assertLessEqual(signal.value, 1.0, signal.name)


class TestComposite(unittest.TestCase):
    def test_confidence_reflects_available_weight(self):
        full = features.extract(event(), quote(), competing_dates=1)
        _, conf_full = features.composite(full)
        bare = features.extract(event(), None, competing_dates=1)
        _, conf_bare = features.composite(bare)
        self.assertGreater(conf_full, conf_bare)
        self.assertLessEqual(conf_full, 1.0)

    def test_no_signals_yields_zero_confidence(self):
        score, conf = features.composite([])
        self.assertEqual((score, conf), (0.0, 0.0))

    def test_pre_onsale_mode_excludes_market_signals(self):
        signals = features.extract(event(), quote(), include_post_onsale=False)
        names = {s.name for s in signals}
        self.assertNotIn("float_thinness", names)
        self.assertNotIn("realized_premium", names)

    def test_feature_dict_omits_abstained_signals(self):
        vector = features.as_dict(features.extract(event(), None))
        self.assertNotIn("float_thinness", vector)
        self.assertIn("venue_scarcity", vector)


class TestDrawProxy(unittest.TestCase):
    def test_monthly_listeners_win_when_present(self):
        a = artist(listeners=5_000_000, followers=100_000)
        self.assertEqual(a.draw_proxy, 5_000_000)

    def test_falls_back_to_scaled_followers(self):
        a = Artist("a:x", "X", followers=100_000, monthly_listeners=0)
        self.assertEqual(a.draw_proxy, 1_200_000)

    def test_zero_when_nothing_is_known(self):
        self.assertEqual(Artist("a:x", "X").draw_proxy, 0)


if __name__ == "__main__":
    unittest.main()
