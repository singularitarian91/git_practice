# Legal boundaries

Not legal advice. Ticket resale law is jurisdiction-specific, actively
changing, and enforced. Talk to a lawyer before operating at scale, and
verify anything below against current sources — some of it will be out of
date by the time you read it.

This page exists because the boundary is not a matter of taste. It decided
the architecture: it is why this system alerts you to an onsale instead of
buying for you, and why it has no scraper for resale marketplaces.

## The bright line: the BOTS Act

The **Better Online Ticket Sales Act of 2016** (15 U.S.C. § 45c) makes two
things unlawful in the US:

1. **Circumventing a security measure, access control system, or other
   technological control** on a ticket seller's website that is used to
   enforce posted purchase limits or to maintain the integrity of posted
   online purchasing rules.
2. **Selling, or offering to sell, tickets you know were obtained that way** —
   including tickets somebody else acquired.

Violations are treated as unfair or deceptive practices under the FTC Act.
The FTC enforces it, state attorneys general can sue, and the civil
penalties are per-violation — which, against software that fires thousands
of requests, compounds fast. The FTC has brought and settled cases under it.

**In practice this rules out**, whatever the tooling:

- Bots that queue, hold carts, or check out faster than a person can.
- Solving, farming, or outsourcing CAPTCHAs.
- Rotating IPs, proxies, or device fingerprints to look like many buyers.
- Multiple accounts or identities to exceed a posted per-person limit.
- Reselling inventory you know was acquired by any of the above.

**It does not ban resale.** Buying tickets the ordinary way, within the
posted limits, and reselling them is legal in most US jurisdictions. The Act
targets *how* inventory is acquired, not the fact of reselling it.

## What this system does and does not automate

| Step | Automated | Why |
|---|---|---|
| Discovering events and onsale times | Yes | Official Ticketmaster Discovery API |
| Artist demand and momentum tracking | Yes | Official Spotify Web API |
| Resale comps and venue capacity | Yes | Official SeatGeek Platform API |
| Forecasting markup, sizing positions | Yes | Local computation on your own data |
| Alerting you before a window opens | Yes | Your own calendar and webhooks |
| **Purchasing** | **No** | BOTS Act §1 — this is the line |
| Repricing your own listings | Yes | Ordinary commerce via seller APIs |
| Portfolio and tax records | Yes | Your own data |

Everything except the purchase is automatable without going anywhere near
the Act. The purchase step is a human, buying within the limits, like
everyone else.

That is less of a handicap than it sounds. See
[PLAYBOOK.md](PLAYBOOK.md) — the edge in this business is preparation and
exit discipline, not milliseconds. Most desirable inventory never reaches
the public onsale at all.

## Why there is no marketplace scraper

Scraping StubHub, Vivid Seats, or Ticketmaster listing pages would give
richer comps than the official APIs. It is deliberately absent:

- It breaches those sites' terms of service.
- Their anti-bot defenses are exactly the "technological measures" the BOTS
  Act protects, and defeating them to inform ticket purchasing is the
  conduct the statute describes.
- A data pipeline that one ToS enforcement or one layout change can kill is
  not a foundation for a business.

Where an official feed does not exist, this system takes hand-entered comps
(`tixarb quote`). Ten seconds reading a get-in price off a page is accurate,
legitimate, and cannot get an account banned.

## Other law that will reach you

**State licensing.** Several states regulate ticket resale as a business.
New York requires a reseller license to resell above face value in the
course of business, with bonding requirements. Other states impose
registration, price caps, or venue-specific restrictions. Check the states
you buy and sell in — this is the requirement most often discovered late.

**Speculative ticketing.** Several states prohibit listing tickets you do
not yet own. If you plan to list before tickets are in hand, check first.

**Non-transferable tickets.** Many tours now issue restricted or
delayed-transfer tickets that cannot legally be resold outside an official
platform. Buying these to flip elsewhere does not work, and the model in
this repo cannot see the restriction — check the event page before buying.

**All-in pricing.** The FTC's Rule on Unfair or Deceptive Fees (16 CFR Part
464) has required total-price disclosure for live-event tickets since May
2025. This affects strategy, not just compliance: buyers now compare
fee-inclusive prices, which compresses what you can ask. `SellFees.buyer_pct`
and `display_price()` model it.

**Outside the US.** The UK's Digital Economy Act 2017 criminalized bot
purchasing, and the Consumer Rights Act 2015 requires sellers to disclose
seat, row, and restrictions. Ireland's Sale of Tickets Act 2021 bans resale
above face value for designated events and venues. Several EU states have
similar caps. None of the code here is jurisdiction-aware.

**Tax.** Resale profit is taxable income, whether or not a marketplace
issues you a 1099-K, and the 1099-K reporting threshold has changed several
times in recent years — verify the current one rather than trusting a number
you remember. Marketplaces report payouts to the IRS. `tixarb pnl` tracks
cost basis and realized gains; it is a record, not a tax return.

## The honest summary

Legal: being organized, informed, patient, and disciplined about exits.

Illegal: being fast by defeating the controls that make everyone else slow.

This system is built entirely for the first, which is also — see the
playbook — where the durable money is.
