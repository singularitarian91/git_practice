import datetime as dt
import unittest

from support import NOW, artist, event, quote, venue

from tixarb.models import (
    Artist, OnsaleKind, Position, PositionStatus, SaleWindow, WatchItem,
)
from tixarb.money import money
from tixarb.store import Store


class StoreCase(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.addCleanup(self.store.close)


class TestRoundTrip(StoreCase):
    def test_event_survives_a_round_trip(self):
        original = event(tags=("underplay", "final-tour"))
        self.store.upsert_event(original)
        got = self.store.get_event(original.id)
        self.assertEqual(got.name, original.name)
        self.assertEqual(got.starts_at, original.starts_at)
        self.assertEqual(got.local_start, original.local_start)
        self.assertEqual(got.face_min, original.face_min)
        self.assertEqual(got.tags, original.tags)
        self.assertEqual(got.venue.capacity, original.venue.capacity)
        self.assertEqual(len(got.sale_windows), len(original.sale_windows))

    def test_money_survives_as_exact_cents(self):
        e = event(face=(45.55, 99.99))
        self.store.upsert_event(e)
        got = self.store.get_event(e.id)
        self.assertEqual(got.face_min, money("45.55"))
        self.assertEqual(got.face_max, money("99.99"))

    def test_sale_windows_keep_their_gating(self):
        e = event()
        gated = SaleWindow(OnsaleKind.VERIFIED_FAN, NOW + dt.timedelta(days=2),
                           name="Verified Fan", code_required=True)
        from dataclasses import replace
        self.store.upsert_event(replace(e, sale_windows=e.sale_windows + (gated,)))
        got = self.store.get_event(e.id)
        kinds = {w.kind: w for w in got.sale_windows}
        self.assertIn(OnsaleKind.VERIFIED_FAN, kinds)
        self.assertTrue(kinds[OnsaleKind.VERIFIED_FAN].code_required)

    def test_upsert_is_idempotent(self):
        e = event()
        self.store.upsert_event(e)
        self.store.upsert_event(e)
        self.assertEqual(len(self.store.upcoming_events(NOW)), 1)

    def test_position_round_trip(self):
        e = event()
        self.store.upsert_event(e)
        pos = Position("p1", e.id, 2, face_each="59.00", cost_each="79.28",
                       purchased_at=NOW, section="ORCH", row="G")
        self.store.save_position(pos)
        got = self.store.get_position("p1")
        self.assertEqual(got.cost_total, money("158.56"))
        self.assertEqual((got.section, got.row), ("ORCH", "G"))
        self.assertTrue(got.is_open)


class TestCapacityPreservation(StoreCase):
    def test_a_source_without_capacity_cannot_erase_a_known_one(self):
        # SeatGeek supplies capacity; Ticketmaster does not. A later
        # Ticketmaster scan must not blank out what SeatGeek established.
        self.store.upsert_venue(venue(capacity=1850, vid="v:x"))
        self.store.upsert_venue(venue(capacity=0, vid="v:x"))
        self.assertEqual(self.store.get_venue("v:x").capacity, 1850)

    def test_a_real_capacity_still_updates(self):
        self.store.upsert_venue(venue(capacity=1850, vid="v:x"))
        self.store.upsert_venue(venue(capacity=1900, vid="v:x"))
        self.assertEqual(self.store.get_venue("v:x").capacity, 1900)


class TestArtistMetrics(StoreCase):
    def test_snapshots_accumulate(self):
        self.store.upsert_artist(artist(followers=100_000))
        self.store.upsert_artist(artist(followers=120_000))
        rows = self.store.conn.execute(
            "SELECT COUNT(*) c FROM artist_metrics").fetchone()
        self.assertGreaterEqual(rows["c"], 1)

    def test_momentum_abstains_when_history_is_too_short(self):
        # Only today's snapshot exists, so a 90-day growth rate cannot be
        # computed and must come back as None rather than as zero growth.
        self.store.upsert_artist(Artist("a:new", "New Act", followers=50_000))
        self.assertIsNone(self.store.followers_as_of("a:new", days_ago=90))
        self.assertIsNone(self.store.get_artist("a:new").follower_growth_90d)

    def test_growth_is_computed_once_history_reaches_back(self):
        old = (NOW - dt.timedelta(days=120)).isoformat()
        self.store.upsert_artist(Artist("a:x", "X", followers=200_000),
                                 snapshot=False)
        self.store.conn.execute(
            "INSERT INTO artist_metrics(artist_id, observed_at, followers) "
            "VALUES('a:x', ?, 100000)", (old,))
        self.store.conn.commit()
        self.assertEqual(self.store.followers_as_of("a:x", days_ago=90), 100_000)
        self.assertAlmostEqual(
            self.store.get_artist("a:x").follower_growth_90d, 1.0, places=6)


class TestQuotes(StoreCase):
    def test_latest_quote_wins(self):
        e = event()
        self.store.upsert_event(e)
        self.store.record_quote(quote(e.id, get_in=100, at=NOW))
        self.store.record_quote(
            quote(e.id, get_in=150, at=NOW + dt.timedelta(hours=1)))
        self.assertEqual(self.store.latest_quote(e.id).get_in, money("150.00"))
        self.assertEqual(len(self.store.quote_history(e.id)), 2)

    def test_sections_are_tracked_separately(self):
        e = event()
        self.store.upsert_event(e)
        from tixarb.models import Quote
        self.store.record_quote(Quote(e.id, NOW, "t", get_in=100))
        self.store.record_quote(Quote(e.id, NOW, "t", get_in=400,
                                      section="FLOOR"))
        self.assertEqual(self.store.latest_quote(e.id).get_in, money("100.00"))
        self.assertEqual(self.store.latest_quote(e.id, "FLOOR").get_in,
                         money("400.00"))


class TestMetroClustering(StoreCase):
    def test_finds_competing_dates_in_the_same_metro(self):
        for i in range(3):
            self.store.upsert_event(event(eid=f"e{i}", days_out=70 + i * 3))
        found = self.store.events_in_metro("new york|ny",
                                           NOW + dt.timedelta(days=70))
        self.assertEqual(len(found), 3)

    def test_ignores_other_metros(self):
        self.store.upsert_event(event(eid="ny", days_out=70))
        self.store.upsert_event(event(
            eid="la", days_out=70,
            the_venue=venue(city="Los Angeles", region="CA", vid="v:la")))
        self.assertEqual(
            len(self.store.events_in_metro("new york|ny",
                                           NOW + dt.timedelta(days=70))), 1)

    def test_ignores_dates_outside_the_window(self):
        self.store.upsert_event(event(eid="near", days_out=70))
        self.store.upsert_event(event(eid="far", days_out=400))
        self.assertEqual(
            len(self.store.events_in_metro("new york|ny",
                                           NOW + dt.timedelta(days=70))), 1)


class TestAlerts(StoreCase):
    def test_queueing_the_same_id_twice_is_refused(self):
        fires = NOW + dt.timedelta(hours=1)
        self.assertTrue(self.store.queue_alert("a1", "public", fires))
        self.assertFalse(self.store.queue_alert("a1", "public", fires))

    def test_only_due_and_unsent_alerts_come_back(self):
        self.store.queue_alert("past", "public", NOW - dt.timedelta(hours=1))
        self.store.queue_alert("future", "public", NOW + dt.timedelta(hours=1))
        due = self.store.due_alerts(NOW)
        self.assertEqual([d["id"] for d in due], ["past"])
        self.store.mark_alert_sent("past")
        self.assertEqual(self.store.due_alerts(NOW), [])


class TestWatchlist(StoreCase):
    def test_add_list_remove(self):
        self.store.add_watch(WatchItem("w1", "Test Act", max_face="80.00",
                                       markets=("new york|ny",), min_score=0.6))
        items = self.store.watchlist()
        self.assertEqual(items[0].max_face, money("80.00"))
        self.assertEqual(items[0].markets, ("new york|ny",))
        self.assertTrue(self.store.remove_watch("w1"))
        self.assertFalse(self.store.remove_watch("w1"))
        self.assertEqual(self.store.watchlist(), [])


class TestTrainingRows(StoreCase):
    def test_only_sold_positions_become_labels(self):
        # Unsold inventory is censored data. Treating it as a low multiple
        # would bias the model toward optimism about liquidity.
        e = event()
        self.store.upsert_event(e)
        self.store.record_forecast(e.id, 2.0, 1.2, 2.0, 3.2, 0.8,
                                   {"venue_scarcity": 0.8})
        held = Position("p1", e.id, 2, "50.00", "68.00", NOW)
        self.store.save_position(held)
        self.assertEqual(self.store.training_rows(), [])

        held.status = PositionStatus.SOLD
        held.sold_price = money("125.00")
        held.sold_at = NOW
        self.store.save_position(held)
        rows = self.store.training_rows()
        self.assertEqual(len(rows), 1)
        features, realized, event_id = rows[0]
        self.assertEqual(features["venue_scarcity"], 0.8)
        self.assertAlmostEqual(realized, 2.5, places=6)


class TestSchema(StoreCase):
    def test_refuses_a_newer_schema(self):
        self.store.conn.execute(
            "UPDATE meta SET value = '99' WHERE key = 'schema_version'")
        self.store.conn.commit()
        with self.assertRaises(RuntimeError):
            self.store._migrate()


if __name__ == "__main__":
    unittest.main()
