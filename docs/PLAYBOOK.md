# Operating playbook

Where the money actually is, and where it is not.

## The arithmetic you must internalize first

Run `tixarb fees`:

```
    face    landed  fee load  breakeven  x face  buyer sees
   35.00     50.48     44.2%      58.02   1.66x       72.53
   55.00     74.48     35.4%      85.61   1.56x      107.01
   85.00    110.48     30.0%     126.99   1.49x      158.74
  125.00    158.48     26.8%     182.16   1.46x      227.70
  195.00    242.48     24.3%     278.71   1.43x      348.39
  295.00    362.48     22.9%     416.64   1.41x      520.80
```

Every row is the resale price that returns your capital **and nothing more**.

A $35 ticket must resell at $58 to break even. That is a 66% markup for zero
profit. Most people who try this lose money not because they pick bad shows
but because they compare resale price to *face* instead of to *landed cost
plus the seller's cut*, and book a loss as a win.

Three consequences:

1. **Cheap tickets are worse trades than they look.** Flat per-ticket fees
   are a bigger share of a small face value. Below about $40 face the
   breakeven multiple gets punishing.
2. **Buying in pairs beats singles.** Per-order fees amortize.
3. **Box office purchases can skip the entire primary fee load.** In person,
   often no service fee at all. That drops the breakeven multiple from ~1.5x
   to ~1.15x — a bigger edge than any forecasting improvement in this repo.
   `BUY_PRESETS["box-office"]` models it.

## Where the edge actually is

Not in speed. The public onsale is the most competitive, most surveilled,
most legally constrained moment in the cycle, and by the time it opens the
good inventory is frequently gone.

**1. Eligibility, bought weeks early.** Most desirable inventory moves in
gated presales — artist fan club, card issuer, venue, verified fan. Those
gates are eligibility, not speed: a fan club membership bought three weeks
ahead, a card you already hold. `tixarb scan` surfaces every presale window
Ticketmaster publishes, with its name, so you can work out which gates you
can pass *before* the window opens. This is the single highest-return habit
in the whole system, and it is pure preparation.

**2. Mis-sized rooms.** Tours are routed six to twelve months ahead, against
the act's numbers at routing time. An act that breaks in between plays a room
booked for who they used to be. `venue_scarcity` and `momentum` exist to find
exactly this, and it is the one signal that reliably produces multiples above
2x. The fixture demo's "Ascendant at Bowery Ballroom" is this case.

**3. Exit discipline.** Dull, unglamorous, and probably the largest single
source of returns. See below.

**4. Not trading.** Most events are negative expected value after fees. The
correct action on the large majority of what you scan is to pass. A system
whose main output is "no" is working.

## The cycle

**Set up once**

```bash
tixarb init
export TICKETMASTER_API_KEY=... SEATGEEK_CLIENT_ID=...
export SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=...
tixarb watch add "Artist Name" --max-face 120
```

Start scanning **months** before you intend to trade. `momentum` needs 90
days of follower snapshots before it says anything, and it is one of the
strongest pre-onsale signals. A database started today is blind until roughly
December.

**Weekly**

```bash
tixarb scan                       # discover, snapshot, queue alerts
tixarb rank --explain 5           # what looks tradeable, and why
tixarb calendar --out onsales.ics # subscribe your phone to this
```

Read `--explain`. If the score is being carried by one signal you do not
believe, do not take the trade — the model is a checklist you can argue with,
not an oracle.

**At the onsale**

The alert fires at 24h, 1h, and 10min. You buy — within the posted limit,
one account, like anyone else. Then record what you actually paid:

```bash
tixarb buy tm:XXXX --qty 2 --face 55 --paid 148.96
```

Always pass `--paid`. It back-solves your true fee load and prints it against
what the model assumed. Two or three receipts in, you will know your real
rates, and every breakeven number after that is correct instead of plausible.

**Weekly while holding**

```bash
tixarb quote tm:XXXX --get-in 165 --tickets 84   # 30 seconds on the listing page
tixarb price --ladder                            # what to ask, and when
tixarb pnl                                       # what needs attention
```

The `--tickets` figure — seats listed — matters more than the price. Float is
what predicts which way the last two weeks break.

## Exit discipline

The rules the repricing engine encodes, because they are the ones people
break:

**An unsold ticket is worth zero at doors.** Not what you paid. The market
has never once cared about anyone's cost basis.

**A market below your breakeven with three weeks left is a sell signal, not
a reason to wait.** It decays from there. `tixarb price` will say `dump` and
show you a loss. Take the loss. The alternative is usually a bigger one.

**Float direction beats price level.** Get-in holding steady while listings
climb from 3% to 9% of the house is a collapse in progress. One thin-float
show at 1.8x beats three saturated ones at a nominal 2.5x, because only one
of them clears.

**Never hold for "at least breakeven."** That is the anchor that converts a
recoverable 30% loss into a total one.

## Sizing

`tixarb rank` reports a stake from quarter-Kelly, hard-capped at 5% of
bankroll per event. The cap does the real work. Kelly assumes the win
probability is known; here it is a model output with wide error bars, and
overbetting a mis-estimated edge is the standard way to go broke while being
right on average.

Watch correlation, not just position size. Eight dates on one tour reprice
together — that is one bet with eight receipts. `tixarb pnl` warns when a
single act passes 40% of open capital across multiple dates.

## Making the model yours

The shipped weights are priors — informed guesses, not fitted values. Record
every sale with `tixarb sold`. After 25 realized sales:

```bash
tixarb calibrate
```

Below 25 it refuses and tells you to keep trading the priors. That refusal is
deliberate: a ten-feature fit on a dozen sales is memorization, and shipping
it would replace defensible priors with noise that looks like science.

The same applies to fee presets. They are estimates with an `as_of` of
"estimate". Yours are on your receipts.

## Honest expectations

- Most scanned events are negative EV. Expect to pass on the large majority.
- Hit rates near 60-70% with disciplined exits beat 90% hit rates with a fat
  tail — `evaluate()` will show you why.
- Capital is illiquid until the event. A 90-day hold is normal.
- Every input here is an estimate: fee rates, capacities, follower-to-listener
  ratios, salvage assumptions. The model is a disciplined way to be roughly
  right, not a way to be precisely right.
- Marketplaces change fees, tours go non-transferable, and states change the
  rules. Re-read [LEGAL.md](LEGAL.md) periodically.
