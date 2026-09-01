"""Command line interface.

``python -m tixarb <command>``. Start with ``tixarb demo``, which runs the
whole pipeline against built-in fixtures and needs no API keys.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import uuid
from decimal import Decimal, InvalidOperation
from pathlib import Path

from . import alerts as alerts_mod
from . import config as config_mod
from . import economics, portfolio, pricing, scoring
from .models import (
    Position, PositionStatus, Quote, WatchItem, utcnow,
)
from .money import money
from .sources import Registry, build_registry
from .sources.fixtures import FixtureSource
from .store import Store
from .watcher import Watcher

RULE = "-" * 78


def _open_store(args) -> tuple:
    cfg = config_mod.load(getattr(args, "config", None))
    if getattr(args, "db", None):
        cfg.db_path = args.db
    return cfg, Store(cfg.resolved_db_path())


def _money_arg(value: str) -> Decimal:
    try:
        return money(value)
    except (InvalidOperation, ValueError, ArithmeticError):
        raise argparse.ArgumentTypeError(f"{value!r} is not a valid amount")


def _competing(store, event) -> int:
    if not event.venue:
        return 1
    return max(1, len(store.events_in_metro(event.venue.metro, event.starts_at)))


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------

def cmd_init(args) -> int:
    path = config_mod.write_template(args.config)
    cfg = config_mod.load(args.config)
    store = Store(cfg.resolved_db_path())
    print(f"config: {path}")
    print(f"database: {cfg.resolved_db_path()}")
    print("\nNext: set credentials as environment variables --")
    print("  export TICKETMASTER_API_KEY=...   # onsale + presale timing")
    print("  export SEATGEEK_CLIENT_ID=...     # venue capacity + resale comps")
    print("  export SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=...")
    print("\nThen: tixarb watch add <artist>  &&  tixarb scan")
    print("No keys yet? Run `tixarb demo` to see the whole pipeline offline.")
    store.close()
    return 0


def cmd_sources(args) -> int:
    cfg, store = _open_store(args)
    registry = build_registry(cfg, store, include_fixtures=args.fixtures)
    print(registry.describe())
    print(f"\nfees in: {cfg.buy_fees().name}   fees out: {cfg.sell_fees().name}")
    store.close()
    return 0


def cmd_watch(args) -> int:
    cfg, store = _open_store(args)
    if args.watch_cmd == "add":
        item = WatchItem(
            id=args.id or f"w-{uuid.uuid4().hex[:8]}",
            query=args.query, max_face=args.max_face,
            markets=tuple(args.market or ()), min_score=args.min_score,
        )
        store.add_watch(item)
        print(f"watching {item.query!r} as {item.id}")
    elif args.watch_cmd == "rm":
        print("removed" if store.remove_watch(args.id) else f"no watch {args.id}")
    else:
        items = store.watchlist(active_only=False)
        if not items:
            print("watchlist is empty -- tixarb watch add <artist>")
        for item in items:
            bits = [item.id, item.query]
            if item.max_face:
                bits.append(f"max face {item.max_face}")
            if item.markets:
                bits.append(f"markets {','.join(item.markets)}")
            if item.min_score:
                bits.append(f"min score {item.min_score}")
            print("  " + "  |  ".join(bits))
    store.close()
    return 0


def cmd_scan(args) -> int:
    cfg, store = _open_store(args)
    registry = build_registry(cfg, store, include_fixtures=args.fixtures)
    if not registry.active(registry.event_sources):
        print("no event sources configured. Set TICKETMASTER_API_KEY or "
              "SEATGEEK_CLIENT_ID, or pass --fixtures to use demo data.",
              file=sys.stderr)
        store.close()
        return 1
    dispatcher = alerts_mod.build_dispatcher(cfg)
    report = Watcher(store, registry, cfg, dispatcher).run_once()
    print(report.summary())
    for error in report.errors:
        print(f"  ! {error}", file=sys.stderr)
    store.close()
    return 0


def cmd_rank(args) -> int:
    cfg, store = _open_store(args)
    registry = build_registry(cfg, store, include_fixtures=args.fixtures)
    if args.fixtures:
        for event in FixtureSource().search_events(""):
            store.upsert_event(event)

    buy, sell = cfg.buy_fees(), cfg.sell_fees()
    rows = []
    for event in store.upcoming_events():
        quote = store.latest_quote(event.id)
        face = args.face if args.face else event.face_min or event.face_mid
        if face <= 0:
            continue
        rec = scoring.recommend(
            event, face, args.qty, buy, sell, quote=quote,
            competing_dates=_competing(store, event),
            bankroll=cfg.bankroll if cfg.bankroll > 0 else None,
            min_roi=cfg.min_roi, min_confidence=cfg.min_confidence,
        )
        rows.append((event, rec))

    rows.sort(key=lambda r: r[1].trade.ev_each, reverse=True)
    if args.buy_only:
        rows = [r for r in rows if r[1].action == "BUY"]
    if not rows:
        print("nothing to rank. Run `tixarb scan` first, or pass --fixtures.")
        store.close()
        return 0

    print(f"{'event':<40} {'med':>6} {'conf':>5} {'ask':>8} {'p':>5} "
          f"{'EV/ea':>8} {'ROI':>7}  action")
    print(RULE)
    for event, rec in rows[:args.limit]:
        fc = rec.forecast
        print(f"{event.name[:39]:<40} {fc.median:>5.2f}x {fc.confidence:>4.0%} "
              f"{rec.trade.target_price:>8} {rec.trade.p_sell:>4.0%} "
              f"{rec.trade.ev_each:>8} {rec.trade.roi:>6.0%}  {rec.action}")
    if args.explain:
        print(f"\n{RULE}")
        for event, rec in rows[:args.explain]:
            print(f"\n{event.name} @ {event.venue.name}")
            print(rec.forecast.explain())
            print(f"    -> {rec.explain()}")
            if rec.stake > 0:
                print(f"    -> size at {rec.stake} "
                      f"(quarter-Kelly, capped at {cfg.max_position_pct:.0%} of bankroll)")
    store.close()
    return 0


def cmd_calendar(args) -> int:
    cfg, store = _open_store(args)
    if args.fixtures:
        for event in FixtureSource().search_events(""):
            store.upsert_event(event)
    events = [e for e in store.upcoming_events() if e.sale_windows]
    ics = alerts_mod.onsale_calendar(events, tuple(cfg.alert_lead_minutes))
    if args.out:
        Path(args.out).expanduser().write_text(ics, encoding="utf-8")
        windows = sum(len(e.sale_windows) for e in events)
        print(f"wrote {windows} sale windows across {len(events)} events "
              f"to {args.out}")
        print("Subscribe a phone to this file and the alarms fire even when "
              "this machine is off.")
    else:
        sys.stdout.write(ics)
    store.close()
    return 0


def cmd_quote(args) -> int:
    cfg, store = _open_store(args)
    if store.get_event(args.event) is None:
        print(f"unknown event {args.event}", file=sys.stderr)
        store.close()
        return 1
    store.record_quote(Quote(
        event_id=args.event, observed_at=utcnow(), source=args.source,
        get_in=args.get_in, median=args.median or args.get_in,
        listing_count=args.listings, ticket_count=args.tickets or args.listings,
        section=args.section,
    ))
    print(f"recorded {args.source} quote for {args.event}: "
          f"get-in {money(args.get_in)}, {args.tickets or args.listings} seats listed")
    store.close()
    return 0


def cmd_buy(args) -> int:
    cfg, store = _open_store(args)
    if store.get_event(args.event) is None:
        print(f"unknown event {args.event}", file=sys.stderr)
        store.close()
        return 1
    buy = cfg.buy_fees()
    if args.paid is not None:
        cost_each = money(Decimal(str(args.paid)) / args.qty)
        source = "actual order total"
    else:
        cost_each = economics.landed_cost(args.face, args.qty, buy).cost_each
        source = f"modelled from {buy.name} fees"
    position = Position(
        id=args.id or f"p-{uuid.uuid4().hex[:8]}", event_id=args.event,
        qty=args.qty, face_each=args.face, cost_each=cost_each,
        purchased_at=utcnow(), section=args.section, row=args.row,
        marketplace=args.marketplace,
    )
    store.save_position(position)
    sell = cfg.sell_fees()
    breakeven = economics.breakeven_list_price(cost_each, args.qty, sell)
    print(f"{position.id}: {args.qty} x {money(args.face)} face, "
          f"cost {cost_each} each ({source})")
    print(f"breakeven ask {breakeven} "
          f"({breakeven / money(args.face):.2f}x face) -- "
          f"buyer will see {economics.display_price(breakeven, sell)}")
    if args.paid is not None:
        load = economics.implied_buy_load(args.face, args.qty, args.paid)
        print(f"actual fee load {load * 100:.1f}% over face "
              f"(model assumes {buy.service_pct * 100:.0f}% + flat fees) -- "
              f"if these keep diverging, update buy_fees_override in config")
    store.close()
    return 0


def cmd_sold(args) -> int:
    cfg, store = _open_store(args)
    position = store.get_position(args.id)
    if position is None:
        print(f"unknown position {args.id}", file=sys.stderr)
        store.close()
        return 1
    position.status = PositionStatus.SOLD
    position.sold_price = money(args.price)
    position.sold_at = utcnow()
    store.save_position(position)
    pnl = portfolio.realized_pnl(position, cfg.sell_fees())
    print(f"{position.id} sold at {position.sold_price} each -- "
          f"realized {pnl} on {position.cost_total} cost")
    store.close()
    return 0


def cmd_price(args) -> int:
    cfg, store = _open_store(args)
    buy, sell = cfg.buy_fees(), cfg.sell_fees()
    positions = ([store.get_position(args.id)] if args.id
                 else store.open_positions())
    positions = [p for p in positions if p is not None]
    if not positions:
        print("no open positions")
        store.close()
        return 0

    for position in positions:
        event = store.get_event(position.event_id)
        if event is None:
            print(f"{position.id}: event {position.event_id} not in store")
            continue
        quote = store.latest_quote(position.event_id)
        fc = scoring.forecast(event, quote=quote,
                              competing_dates=_competing(store, event))
        advice = pricing.advise(position, event, fc, quote, buy, sell)
        print(f"\n{position.id}  {event.name}")
        print(f"  {advice.explain()}")
        if args.ladder:
            print(f"  {'date':<12}{'days':>6}{'ask':>10}{'buyer sees':>12}"
                  f"{'net':>10}{'vs BE':>9}")
            for row in pricing.ladder(position, event, fc, quote, sell):
                print(f"  {row['date']:<12}{row['days_out']:>6.0f}"
                      f"{str(row['ask']):>10}{str(row['display']):>12}"
                      f"{str(row['net']):>10}{str(row['vs_breakeven']):>9}")
    store.close()
    return 0


def cmd_pnl(args) -> int:
    cfg, store = _open_store(args)
    summary = portfolio.summarize(store, cfg)
    print(summary.explain())
    attention = portfolio.needs_attention(store, cfg, horizon_days=args.horizon)
    if attention:
        print(f"\nneeds attention within {args.horizon:.0f} days:")
        for marked in attention:
            state = "underwater" if marked.is_underwater else "in profit"
            print(f"  T-{marked.days_to_event:>4.0f}d  {marked.event_name[:38]:<40}"
                  f"{marked.unrealized_total:>10}  {state}")
    store.close()
    return 0


def cmd_fees(args) -> int:
    cfg, store = _open_store(args)
    buy, sell = cfg.buy_fees(), cfg.sell_fees()
    print(f"buy:  {buy.name}  service {buy.service_pct * 100:.1f}% + "
          f"facility {buy.facility_fee} + order {buy.order_fee}")
    print(f"sell: {sell.name}  seller {sell.seller_pct * 100:.1f}% + "
          f"payment {sell.payment_pct * 100:.1f}%, "
          f"buyer pays {sell.buyer_pct * 100:.1f}% on top")
    if buy.note:
        print(f"      note: {buy.note}")
    print(f"\n{'face':>8}{'landed':>10}{'fee load':>10}{'breakeven':>11}"
          f"{'x face':>8}{'buyer sees':>12}")
    print(RULE)
    for face in (35, 55, 85, 125, 195, 295):
        breakdown = economics.landed_cost(face, args.qty, buy)
        be = economics.breakeven_list_price(breakdown.cost_each, args.qty, sell)
        print(f"{money(face):>8}{breakdown.cost_each:>10}"
              f"{breakdown.fee_load * 100:>9.1f}%{be:>11}"
              f"{be / money(face):>7.2f}x{economics.display_price(be, sell):>12}")
    print("\nEvery row is the price that returns your capital and nothing "
          "more.\nA '50% markup' on most of these is a losing trade.")
    store.close()
    return 0


def cmd_calibrate(args) -> int:
    cfg, store = _open_store(args)
    rows = store.training_rows()
    result = scoring.calibrate(rows, min_rows=args.min_rows)
    print(result.message)
    if not result.usable:
        print("\nDefault weights stay in force. They are priors, not fitted "
              "values -- record every sale with `tixarb sold` and this "
              "becomes a fitted model.")
        store.close()
        return 0
    print(f"\n{'feature':<20}{'prior':>8}{'fitted':>8}")
    print(RULE)
    from .features import DEFAULT_WEIGHTS
    for name in sorted(result.weights):
        print(f"{name:<20}{DEFAULT_WEIGHTS.get(name, 1.0):>8.2f}"
              f"{result.weights[name]:>8.2f}")
    if args.write:
        path = Path(args.write).expanduser()
        path.write_text(json.dumps(result.weights, indent=2) + "\n")
        print(f"\nwrote {path}")
    store.close()
    return 0


def cmd_demo(args) -> int:
    """End-to-end run on fixtures. No network, no keys, no database side effects."""
    cfg = config_mod.load()
    cfg.bankroll = money("10000.00")
    store = Store(":memory:")
    registry = Registry().register(FixtureSource())
    buy, sell = cfg.buy_fees(), cfg.sell_fees()

    print("1. WATCHLIST AND SCAN")
    for query in ("Ascendant", "Heritage Sound", "Middle Distance"):
        store.add_watch(WatchItem(id=f"w-{query[:4].lower()}", query=query))
    dispatcher = alerts_mod.Dispatcher([alerts_mod.ConsoleSink()])
    report = Watcher(store, registry, cfg, dispatcher).run_once()
    print(f"   {report.summary()}")

    print(f"\n2. BREAKEVEN ({buy.name} in, {sell.name} out)")
    for face in (55, 195):
        breakdown = economics.landed_cost(face, 2, buy)
        be = economics.breakeven_list_price(breakdown.cost_each, 2, sell)
        print(f"   ${face} face -> {breakdown.cost_each} landed -> "
              f"breakeven ask {be} ({be / money(face):.2f}x face)")

    print("\n3. RANKED CANDIDATES")
    ranked = []
    for event in store.upcoming_events():
        quote = registry.quote_for(event)
        if quote:
            store.record_quote(quote)
        rec = scoring.recommend(
            event, event.face_min, 2, buy, sell, quote=quote,
            competing_dates=_competing(store, event), bankroll=cfg.bankroll,
            min_roi=cfg.min_roi, min_confidence=cfg.min_confidence,
        )
        ranked.append((event, rec))
    ranked.sort(key=lambda r: r[1].trade.ev_each, reverse=True)
    for event, rec in ranked:
        print(f"   {event.name[:38]:<40} {rec.forecast.median:>5.2f}x med  "
              f"EV {rec.trade.ev_each:>8}/ea  {rec.action}")

    best_event, best_rec = ranked[0]
    print(f"\n   why {best_event.name}:")
    for line in best_rec.forecast.explain().splitlines()[1:]:
        print(f"   {line}")

    print("\n4. TAKE THE POSITION AND WORK THE EXIT")
    cost = economics.landed_cost(best_event.face_min, 2, buy).cost_each
    position = Position(id="p-demo", event_id=best_event.id, qty=2,
                        face_each=best_event.face_min, cost_each=cost,
                        purchased_at=utcnow())
    store.save_position(position)
    quote = store.latest_quote(best_event.id)
    fc = scoring.forecast(best_event, quote=quote)
    print(f"   bought 2 @ {best_event.face_min} face, {cost} landed each")
    print(f"   {'date':<12}{'days':>6}{'ask':>10}{'buyer sees':>12}{'net':>10}")
    for row in pricing.ladder(position, best_event, fc, quote, sell, steps=6):
        print(f"   {row['date']:<12}{row['days_out']:>6.0f}{str(row['ask']):>10}"
              f"{str(row['display']):>12}{str(row['net']):>10}")

    print("\n5. BOOK")
    print("   " + portfolio.summarize(store, cfg).explain().replace("\n", "\n   "))
    print("\nAll of the above ran offline on fixtures. The purchase step is "
          "the one thing\nthis system will not do for you -- see docs/LEGAL.md.")
    store.close()
    return 0


# --------------------------------------------------------------------------
# parser
# --------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tixarb",
        description="Decision support for buying and reselling event tickets.",
        epilog="Start with: tixarb demo",
    )
    parser.add_argument("--config", type=Path, help="path to config.json")
    parser.add_argument("--db", help="override the database path")
    sub = parser.add_subparsers(dest="command", required=True)

    def add(name, func, help_text, fixtures=False):
        sp = sub.add_parser(name, help=help_text)
        sp.set_defaults(func=func)
        if fixtures:
            sp.add_argument("--fixtures", action="store_true",
                            help="include built-in demo data (no API keys needed)")
        return sp

    add("init", cmd_init, "create config and database")
    add("sources", cmd_sources, "show configured data sources", fixtures=True)
    add("demo", cmd_demo, "run the whole pipeline offline on fixtures")

    watch = add("watch", cmd_watch, "manage the watchlist")
    watch_sub = watch.add_subparsers(dest="watch_cmd")
    watch.set_defaults(watch_cmd="list")
    add_watch = watch_sub.add_parser("add", help="watch an artist or keyword")
    add_watch.add_argument("query")
    add_watch.add_argument("--id")
    add_watch.add_argument("--max-face", type=_money_arg)
    add_watch.add_argument("--market", action="append",
                           help="restrict to a metro, e.g. 'new york|ny'")
    add_watch.add_argument("--min-score", type=float, default=0.0,
                           help="suppress alerts below this markup score")
    watch_sub.add_parser("list", help="show the watchlist")
    rm_watch = watch_sub.add_parser("rm", help="stop watching")
    rm_watch.add_argument("id")

    add("scan", cmd_scan, "fetch events, queue and send onsale alerts",
        fixtures=True)

    rank = add("rank", cmd_rank, "rank upcoming events by expected value",
               fixtures=True)
    rank.add_argument("--qty", type=int, default=2)
    rank.add_argument("--face", type=_money_arg,
                      help="assume this face value instead of the published minimum")
    rank.add_argument("--limit", type=int, default=25)
    rank.add_argument("--explain", type=int, default=0,
                      metavar="N", help="show the full signal breakdown for the top N")
    rank.add_argument("--buy-only", action="store_true")

    cal = add("calendar", cmd_calendar, "export onsales as an iCalendar feed",
              fixtures=True)
    cal.add_argument("--out", help="write to this path instead of stdout")

    quote = add("quote", cmd_quote, "record a secondary-market comp by hand")
    quote.add_argument("event")
    quote.add_argument("--get-in", type=_money_arg, required=True,
                       help="cheapest seller-side listing price")
    quote.add_argument("--median", type=_money_arg)
    quote.add_argument("--listings", type=int, default=0)
    quote.add_argument("--tickets", type=int, default=0,
                       help="seats listed; drives the float ratio")
    quote.add_argument("--section", default="")
    quote.add_argument("--source", default="manual")

    buy = add("buy", cmd_buy, "record a purchased position")
    buy.add_argument("event")
    buy.add_argument("--qty", type=int, required=True)
    buy.add_argument("--face", type=_money_arg, required=True)
    buy.add_argument("--paid", type=_money_arg,
                     help="actual order total; overrides the modelled fee stack")
    buy.add_argument("--id")
    buy.add_argument("--section", default="")
    buy.add_argument("--row", default="")
    buy.add_argument("--marketplace", default="")

    sold = add("sold", cmd_sold, "mark a position sold")
    sold.add_argument("id")
    sold.add_argument("--price", type=_money_arg, required=True,
                      help="seller-side sale price per ticket")

    price = add("price", cmd_price, "repricing advice for open positions")
    price.add_argument("--id", help="one position; default is all open")
    price.add_argument("--ladder", action="store_true",
                       help="show the full schedule to showtime")

    pnl = add("pnl", cmd_pnl, "portfolio value and risk")
    pnl.add_argument("--horizon", type=float, default=21.0)

    fees = add("fees", cmd_fees, "show the fee model and breakeven table")
    fees.add_argument("--qty", type=int, default=2)

    calib = add("calibrate", cmd_calibrate, "refit weights on realized sales")
    calib.add_argument("--min-rows", type=int, default=scoring.MIN_CALIBRATION_ROWS)
    calib.add_argument("--write", help="write fitted weights to this path")

    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        return 130
    except BrokenPipeError:
        return 0


if __name__ == "__main__":
    sys.exit(main())
