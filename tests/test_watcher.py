import datetime as dt
import io
import unittest

from support import NOW, event, venue

from tixarb import config as config_mod
from tixarb.alerts import Alert, ConsoleSink, Dispatcher, onsale_calendar
from tixarb.models import OnsaleKind, SaleWindow, WatchItem
from tixarb.sources import Registry
from tixarb.sources.fixtures import FixtureSource
from tixarb.store import Store
from tixarb.watcher import Watcher, matches


class FlakySink:
    name = "flaky"

    def send(self, alert):
        raise RuntimeError("endpoint down")


class CountingSink:
    name = "counting"

    def __init__(self):
        self.alerts = []

    def send(self, alert):
        self.alerts.append(alert)


class WatcherCase(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.addCleanup(self.store.close)
        self.cfg = config_mod.Config(alert_lead_minutes=(1440, 60, 10),
                                     alert_log_path="")
        self.sink = CountingSink()
        self.registry = Registry().register(FixtureSource(now=NOW))
        self.watcher = Watcher(self.store, self.registry, self.cfg,
                               Dispatcher([self.sink]))


class TestScan(WatcherCase):
    def test_scan_persists_matching_events(self):
        self.store.add_watch(WatchItem("w1", "Ascendant"))
        report = self.watcher.scan()
        self.assertGreater(report.events_found, 0)
        self.assertEqual(report.events_new, report.events_found)

    def test_rescan_reports_nothing_new(self):
        self.store.add_watch(WatchItem("w1", "Ascendant"))
        self.watcher.scan()
        self.assertEqual(self.watcher.scan().events_new, 0)


class TestWatchFilters(unittest.TestCase):
    def test_face_cap_filters_on_the_cheapest_tier(self):
        e = event(face=(45, 495))
        self.assertTrue(matches(WatchItem("w", "x", max_face="100.00"), e))
        self.assertFalse(matches(WatchItem("w", "x", max_face="30.00"), e))

    def test_market_filter(self):
        e = event()
        self.assertTrue(matches(WatchItem("w", "x", markets=("New York|NY",)), e))
        self.assertFalse(matches(WatchItem("w", "x", markets=("Boston|MA",)), e))

    def test_no_filters_matches_everything(self):
        self.assertTrue(matches(WatchItem("w", "x"), event()))


class TestAlertScheduling(WatcherCase):
    def setUp(self):
        super().setUp()
        self.store.add_watch(WatchItem("w1", "Ascendant"))
        self.watcher.scan()

    def test_one_alert_per_lead_time_per_window(self):
        report = self.watcher.schedule_alerts(at=NOW)
        windows = sum(len([w for w in e.sale_windows if w.starts_at > NOW])
                      for e in self.store.upcoming_events(NOW))
        self.assertEqual(report.alerts_queued,
                         windows * len(self.cfg.alert_lead_minutes))

    def test_rescheduling_queues_nothing_new(self):
        self.watcher.schedule_alerts(at=NOW)
        self.assertEqual(self.watcher.schedule_alerts(at=NOW).alerts_queued, 0)

    def test_windows_already_open_are_skipped(self):
        far_future = NOW + dt.timedelta(days=400)
        self.assertEqual(
            self.watcher.schedule_alerts(at=far_future).alerts_queued, 0)

    def test_min_score_suppresses_weak_events(self):
        self.store.add_watch(WatchItem("w2", "Heritage Sound", min_score=0.95))
        self.watcher.scan()
        report = self.watcher.schedule_alerts(at=NOW)
        queued = [a for a in self.store.due_alerts(NOW + dt.timedelta(days=999))
                  if "Heritage" in (a["payload"] or "")]
        self.assertEqual(queued, [])


class TestDispatch(WatcherCase):
    def setUp(self):
        super().setUp()
        self.store.add_watch(WatchItem("w1", "Ascendant"))
        self.watcher.run_once(at=NOW)
        self.window = min(
            (w for e in self.store.upcoming_events(NOW) for w in e.sale_windows
             if w.starts_at > NOW), key=lambda w: w.starts_at)

    def test_fires_at_each_configured_lead_time(self):
        for lead, expected in ((25 * 60, 0), (23 * 60, 1), (59, 1), (9, 1)):
            self.watcher.run_once(
                at=self.window.starts_at - dt.timedelta(minutes=lead),
                skip_scan=True)
        self.assertEqual(len(self.sink.alerts), 3)

    def test_short_lead_alerts_are_high_urgency(self):
        self.watcher.run_once(
            at=self.window.starts_at - dt.timedelta(minutes=9), skip_scan=True)
        self.assertEqual(self.sink.alerts[-1].urgency, "high")

    def test_gated_windows_are_labelled(self):
        self.watcher.run_once(
            at=self.window.starts_at - dt.timedelta(minutes=9), skip_scan=True)
        self.assertIn("code required", self.sink.alerts[-1].title)

    def test_an_alert_no_sink_accepted_stays_queued_for_retry(self):
        watcher = Watcher(self.store, self.registry, self.cfg,
                          Dispatcher([FlakySink()]))
        at = self.window.starts_at - dt.timedelta(minutes=9)
        first = watcher.dispatch_due(at=at)
        self.assertEqual(first.alerts_sent, 0)
        self.assertTrue(first.errors)
        # Still pending, so a working sink later can still deliver it.
        self.assertTrue(self.store.due_alerts(at))

    def test_a_failing_sink_does_not_block_a_working_one(self):
        counting = CountingSink()
        watcher = Watcher(self.store, self.registry, self.cfg,
                          Dispatcher([FlakySink(), counting]))
        at = self.window.starts_at - dt.timedelta(minutes=9)
        expected = len(self.store.due_alerts(at))
        self.assertGreater(expected, 0)
        report = watcher.dispatch_due(at=at)
        self.assertEqual(len(counting.alerts), expected)
        self.assertEqual(report.alerts_sent, expected)
        # Delivered by the working sink, so nothing should remain queued.
        self.assertEqual(self.store.due_alerts(at), [])


class TestCalendarExport(unittest.TestCase):
    def setUp(self):
        self.events = FixtureSource(now=NOW).search_events("")
        self.ics = onsale_calendar(self.events, alarm_minutes=(1440, 60))

    def test_structure_is_balanced(self):
        self.assertTrue(self.ics.startswith("BEGIN:VCALENDAR"))
        self.assertTrue(self.ics.rstrip().endswith("END:VCALENDAR"))
        self.assertEqual(self.ics.count("BEGIN:VEVENT"),
                         self.ics.count("END:VEVENT"))
        self.assertEqual(self.ics.count("BEGIN:VALARM"),
                         self.ics.count("END:VALARM"))

    def test_one_vevent_per_sale_window(self):
        windows = sum(len(e.sale_windows) for e in self.events)
        self.assertEqual(self.ics.count("BEGIN:VEVENT"), windows)

    def test_two_alarms_per_window(self):
        self.assertEqual(self.ics.count("BEGIN:VALARM"),
                         self.ics.count("BEGIN:VEVENT") * 2)

    def test_uses_crlf_line_endings(self):
        self.assertTrue(self.ics.endswith("\r\n"))
        self.assertNotIn("\n\n", self.ics)

    def test_special_characters_are_escaped(self):
        from dataclasses import replace
        risky = replace(self.events[0], name="Act; with, commas")
        ics = onsale_calendar([risky])
        self.assertIn(r"\;", ics)
        self.assertIn(r"\,", ics)


class TestDispatcher(unittest.TestCase):
    def test_reports_how_many_sinks_accepted(self):
        alert = Alert("public", "t", "b", NOW)
        self.assertEqual(Dispatcher([CountingSink(), CountingSink()]).send(alert), 2)
        self.assertEqual(Dispatcher([FlakySink()]).send(alert), 0)

    def test_console_sink_writes_the_body(self):
        buf = io.StringIO()
        Dispatcher([ConsoleSink(buf)]).send(Alert("public", "Title", "Body", NOW))
        self.assertIn("Title", buf.getvalue())
        self.assertIn("Body", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
