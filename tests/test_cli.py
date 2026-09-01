import contextlib
import datetime as dt
import io
import json
import tempfile
import unittest
from pathlib import Path

import support  # noqa: F401  (path setup)

from tixarb import cli


class CliCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = str(Path(self.tmp.name) / "t.db")
        self.config = Path(self.tmp.name) / "config.json"
        self.config.write_text(json.dumps({"db_path": self.db,
                                           "alert_log_path": ""}))

    def run_cli(self, *args):
        buf, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err):
            code = cli.main(["--config", str(self.config), "--db", self.db,
                             *args])
        return code, buf.getvalue(), err.getvalue()


class TestDemo(unittest.TestCase):
    def test_runs_end_to_end_offline(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = cli.main(["demo"])
        out = buf.getvalue()
        self.assertEqual(code, 0)
        for section in ("WATCHLIST AND SCAN", "BREAKEVEN", "RANKED CANDIDATES",
                        "WORK THE EXIT", "BOOK"):
            self.assertIn(section, out)
        # The demo must reach a decision, not just print a table.
        self.assertIn("BUY", out)
        self.assertIn("PASS", out)

    def test_demo_leaves_no_database_behind(self):
        with contextlib.redirect_stdout(io.StringIO()):
            cli.main(["demo"])
        self.assertFalse(Path("tixarb.db").exists())


class TestFees(CliCase):
    def test_breakeven_table_renders(self):
        code, out, _ = self.run_cli("fees")
        self.assertEqual(code, 0)
        self.assertIn("breakeven", out)
        self.assertIn("1.66x", out)   # $35 face needs 1.66x to return capital


class TestWatchlist(CliCase):
    def test_add_list_remove_cycle(self):
        self.run_cli("watch", "add", "Ascendant", "--id", "w1",
                     "--max-face", "80")
        _, out, _ = self.run_cli("watch", "list")
        self.assertIn("Ascendant", out)
        self.assertIn("max face 80.00", out)
        _, out, _ = self.run_cli("watch", "rm", "w1")
        self.assertIn("removed", out)
        _, out, _ = self.run_cli("watch", "list")
        self.assertIn("empty", out)

    def test_rejects_a_bad_amount(self):
        with self.assertRaises(SystemExit):
            self.run_cli("watch", "add", "X", "--max-face", "not-a-number")


class TestScanAndRank(CliCase):
    def test_scan_without_sources_fails_clearly(self):
        code, _, err = self.run_cli("scan")
        self.assertEqual(code, 1)
        self.assertIn("no event sources configured", err)

    def test_scan_with_fixtures_succeeds(self):
        self.run_cli("watch", "add", "Ascendant")
        code, out, _ = self.run_cli("scan", "--fixtures")
        self.assertEqual(code, 0)
        self.assertIn("events", out)

    def test_rank_orders_by_expected_value(self):
        code, out, _ = self.run_cli("rank", "--fixtures")
        self.assertEqual(code, 0)
        self.assertIn("action", out)
        self.assertIn("BUY", out)

    def test_rank_explains_on_request(self):
        _, out, _ = self.run_cli("rank", "--fixtures", "--explain", "1")
        self.assertIn("venue_scarcity", out)
        self.assertIn("confidence", out)

    def test_rank_can_filter_to_buys(self):
        _, out, _ = self.run_cli("rank", "--fixtures", "--buy-only")
        self.assertNotIn("PASS", out)


class TestPositionLifecycle(CliCase):
    def setUp(self):
        super().setUp()
        self.run_cli("rank", "--fixtures")     # seeds fixtures into the db

    def test_buy_reports_the_breakeven_ask(self):
        code, out, _ = self.run_cli("buy", "fx:1", "--qty", "2",
                                    "--face", "45", "--id", "p1")
        self.assertEqual(code, 0)
        self.assertIn("breakeven ask", out)
        self.assertIn("x face", out)

    def test_buy_with_a_real_receipt_reports_the_actual_fee_load(self):
        _, out, _ = self.run_cli("buy", "fx:1", "--qty", "2", "--face", "45",
                                 "--paid", "128.00", "--id", "p2")
        self.assertIn("actual fee load", out)
        self.assertIn("42.2%", out)          # (64 - 45) / 45

    def test_buy_rejects_an_unknown_event(self):
        code, _, err = self.run_cli("buy", "nope", "--qty", "2", "--face", "45")
        self.assertEqual(code, 1)
        self.assertIn("unknown event", err)

    def test_quote_then_price_produces_advice(self):
        self.run_cli("buy", "fx:1", "--qty", "2", "--face", "45", "--id", "p1")
        self.run_cli("quote", "fx:1", "--get-in", "150", "--tickets", "30")
        code, out, _ = self.run_cli("price", "--id", "p1")
        self.assertEqual(code, 0)
        self.assertIn("breakeven", out)

    def test_price_ladder_renders(self):
        self.run_cli("buy", "fx:1", "--qty", "2", "--face", "45", "--id", "p1")
        _, out, _ = self.run_cli("price", "--id", "p1", "--ladder")
        self.assertIn("buyer sees", out)

    def test_sold_records_realized_pnl(self):
        self.run_cli("buy", "fx:1", "--qty", "2", "--face", "45", "--id", "p1")
        code, out, _ = self.run_cli("sold", "p1", "--price", "150")
        self.assertEqual(code, 0)
        self.assertIn("realized", out)

    def test_pnl_summarizes_the_book(self):
        self.run_cli("buy", "fx:1", "--qty", "2", "--face", "45", "--id", "p1")
        code, out, _ = self.run_cli("pnl")
        self.assertEqual(code, 0)
        self.assertIn("cost:", out)
        self.assertIn("total P&L", out)


class TestCalendar(CliCase):
    def test_writes_an_ics_file(self):
        out_path = Path(self.tmp.name) / "onsales.ics"
        code, out, _ = self.run_cli("calendar", "--fixtures",
                                    "--out", str(out_path))
        self.assertEqual(code, 0)
        text = out_path.read_text()
        self.assertTrue(text.startswith("BEGIN:VCALENDAR"))
        self.assertIn("BEGIN:VALARM", text)
        self.assertIn("sale windows", out)


class TestCalibrate(CliCase):
    def test_refuses_to_fit_without_history(self):
        code, out, _ = self.run_cli("calibrate")
        self.assertEqual(code, 0)
        self.assertIn("Keep recording outcomes", out)


class TestSources(CliCase):
    def test_reports_which_adapters_are_configured(self):
        code, out, _ = self.run_cli("sources", "--fixtures")
        self.assertEqual(code, 0)
        self.assertIn("unconfigured", out)
        self.assertIn("fixture", out)


class TestInit(CliCase):
    def test_creates_config_and_database(self):
        fresh = Path(self.tmp.name) / "fresh.json"
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = cli.main(["--config", str(fresh), "--db", self.db, "init"])
        self.assertEqual(code, 0)
        self.assertTrue(fresh.exists())
        self.assertIn("Next:", buf.getvalue())

    def test_does_not_clobber_an_existing_config(self):
        original = self.config.read_text()
        with contextlib.redirect_stdout(io.StringIO()):
            cli.main(["--config", str(self.config), "--db", self.db, "init"])
        self.assertEqual(self.config.read_text(), original)


if __name__ == "__main__":
    unittest.main()
