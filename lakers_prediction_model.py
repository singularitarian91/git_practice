"""
Lakers vs Thunder - Game 1, Western Conference Semifinals
NBA Playoffs 2026 - May 5, 2026 @ Paycom Center, OKC (8:30 PM ET)

Prediction model combining:
  - Market-implied probabilities (moneyline/spread/total)
  - Power ratings from season net ratings
  - Home court adjustment
  - Injury-adjusted lineup value
  - Head-to-head weighting
  - Public vs sharp money divergence signal
"""

import math
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

# ---------------------------------------------------------------------------
# 1. RAW SCRAPED DATA
# ---------------------------------------------------------------------------

GAME_META = {
    "home_team": "Oklahoma City Thunder",
    "away_team": "Los Angeles Lakers",
    "date": "2026-05-05",
    "tip_off_et": "20:30",
    "venue": "Paycom Center, Oklahoma City",
    "series": "Western Conference Semifinals, Game 1",
    "home_seed": 1,
    "away_seed": 4,
}

# Consensus lines as of May 5, 2026 (aggregated from OddsShark, CBS Sports, Yahoo Sports)
ODDS = {
    "spread_home": -15.5,          # Thunder -15.5
    "spread_away": +15.5,          # Lakers  +15.5
    "moneyline_home": -1111,       # Thunder
    "moneyline_away": +700,        # Lakers
    "total": 213.5,                # Over/Under
    "series_lakers_win": +900,     # Full-series odds (Lakers)
    "series_thunder_win": -1500,   # Full-series odds (Thunder)
}

# Public betting splits (tickets / handle) - OddsShark
BETTING_SPLITS = {
    "ml_tickets_away_pct": 90,     # 90% of tickets on Lakers ML
    "ml_handle_away_pct": 74,      # 74% of handle on Lakers ML
    "spread_tickets_away_pct": 73, # 73% of spread tickets on Lakers +15.5
    "spread_handle_away_pct": 62,  # 62% of spread handle on Lakers +15.5
    "total_over_tickets_pct": 74,  # 74% of total tickets on Over
    "total_over_handle_pct": 69,
}

# 2025-26 Regular-season advanced stats
TEAM_STATS = {
    "OKC": {
        "wins": 55, "losses": 15,
        "off_rtg": 118.3,          # Points per 100 possessions (8th)
        "def_rtg": 107.3,          # Points allowed per 100 (1st best)
        "net_rtg": 11.0,           # Best in NBA
        "pace": 99.5,              # Estimated possessions per 48 min
        "h2h_wins_vs_lal": 4,      # 4-0 vs LAL regular season
        "h2h_avg_margin": 29.3,    # Average margin vs LAL regular season
        "home_record": "31-5",
    },
    "LAL": {
        "wins": 47, "losses": 35,   # 4-seed
        "off_rtg": 115.76,
        "def_rtg": 114.77,
        "net_rtg": 1.0,            # Estimated from offensive/defensive delta
        "pace": 99.25,
        "h2h_wins_vs_okc": 0,
        "h2h_avg_margin": -29.3,
        "home_record": "26-15",
    },
}

# Key player data
PLAYERS = {
    "Shai Gilgeous-Alexander": {
        "team": "OKC",
        "ppg_season": 31.1,        # 2nd in NBA
        "apg_season": 5.2,
        "rpg_season": 5.5,
        "fg_pct": 0.521,
        "ts_pct": 0.641,
        "ppg_playoffs_r1": 33.8,   # vs PHX
        "apg_playoffs_r1": 8.0,
        "fg_pct_playoffs": 0.551,
        "status": "ACTIVE",
    },
    "LeBron James": {
        "team": "LAL",
        "ppg_season": 20.9,
        "apg_season": 8.0,
        "rpg_season": 7.5,
        "fg_pct": 0.499,
        "ts_pct": 0.598,
        "ppg_playoffs_r1": 23.2,   # vs HOU
        "apg_playoffs_r1": 8.3,
        "rpg_playoffs_r1": 7.2,
        "status": "ACTIVE",
    },
    "Luka Doncic": {
        "team": "LAL",
        "ppg_season": 28.5,        # Estimated co-star role
        "status": "OUT",           # Grade 2 hamstring strain
        "injury_detail": "Grade 2 left hamstring strain",
    },
    "Austin Reaves": {
        "team": "LAL",
        "ppg_season": 16.8,
        "status": "QUESTIONABLE",
    },
    "Jalen Williams": {
        "team": "OKC",
        "ppg_season": 22.5,
        "status": "OUT",           # Hamstring
        "injury_detail": "Hamstring (Game 2 vs PHX)",
    },
}

# ---------------------------------------------------------------------------
# 2. HELPER FUNCTIONS
# ---------------------------------------------------------------------------

def american_to_implied_prob(american_odds: int) -> float:
    """Convert American odds to raw implied probability (vig included)."""
    if american_odds < 0:
        return abs(american_odds) / (abs(american_odds) + 100)
    else:
        return 100 / (american_odds + 100)


def remove_vig(prob_home: float, prob_away: float) -> Tuple[float, float]:
    """Normalize implied probabilities to remove bookmaker margin (vig)."""
    total = prob_home + prob_away
    return prob_home / total, prob_away / total


def spread_to_win_prob(spread: float, std_dev: float = 12.0) -> float:
    """
    Convert a point spread to a win probability using a normal distribution.
    std_dev of ~12 points is standard for NBA single-game outcomes.
    A negative spread means the home team is favored by |spread| points.
    Returns P(home team wins).
    """
    # P(home wins) = P(margin > 0) where margin ~ N(-spread, std_dev)
    z = -spread / std_dev
    return _normal_cdf(z)


def _normal_cdf(z: float) -> float:
    """Cumulative distribution function for standard normal using math.erfc."""
    return 0.5 * math.erfc(-z / math.sqrt(2))


def _normal_quantile(p: float) -> float:
    """
    Rational approximation for the normal quantile (inverse CDF).
    Accurate to ~4 decimal places across the middle range.
    Source: Abramowitz & Stegun 26.2.23 approximation.
    """
    p = max(1e-10, min(1 - 1e-10, p))
    if p < 0.5:
        sign = -1
        q = p
    else:
        sign = 1
        q = 1 - p
    t = math.sqrt(-2 * math.log(q))
    c = (2.515517, 0.802853, 0.010328)
    d = (1.432788, 0.189269, 0.001308)
    num = c[0] + c[1] * t + c[2] * t * t
    den = 1 + d[0] * t + d[1] * t * t + d[2] * t * t * t
    return sign * (t - num / den)


def net_rtg_to_spread(net_rtg_home: float, net_rtg_away: float,
                      home_court_advantage: float = 3.0,
                      pace_factor: float = 1.0) -> float:
    """
    Estimate expected point spread from net ratings.
    Home court advantage in the NBA playoffs is typically ~2.5-3.5 pts.
    Net rating differential is scaled to approximate margin per game.
    """
    diff = (net_rtg_home - net_rtg_away) * pace_factor / 100 * 100
    # Roughly, a 1-point net rating delta ~ 1 point per game spread
    return -(diff + home_court_advantage)  # negative = home favored


def injury_adjustment(team: str, players: Dict) -> float:
    """
    Estimate point value lost/gained due to injuries.
    Uses a simplified RAPM-like approximation: a starter's absence
    costs roughly 40-60% of their PPG contribution adjusted for minutes.
    Returns adjustment to AWAY team's expected score (negative = bad for away).
    """
    adj = 0.0
    for name, p in players.items():
        if p["team"] == team and p["status"] == "OUT":
            # Rough WAR-equivalent: ~50% of PPG as net impact
            ppg = p.get("ppg_season", 0)
            adj += ppg * 0.45  # points lost per game
        elif p["status"] == "QUESTIONABLE" and p["team"] == team:
            ppg = p.get("ppg_season", 0)
            adj += ppg * 0.45 * 0.50  # 50% chance of being out
    return adj


def implied_total_scores(total: float, spread: float) -> Tuple[float, float]:
    """Derive expected team scores from total and spread."""
    # home - away = -spread (positive spread means away favored)
    # home + away = total
    home_score = (total - spread) / 2
    away_score = (total + spread) / 2
    return home_score, away_score


def sharp_money_signal(tickets_pct: float, handle_pct: float) -> str:
    """
    Detect sharp (professional) money vs public action.
    If handle % >> ticket %, large bets are on that side (sharp money signal).
    Returns the side that sharp money favors.
    """
    divergence = handle_pct - tickets_pct
    if divergence > 10:
        return "SHARP_ON_THIS_SIDE"
    elif divergence < -10:
        return "SHARP_AGAINST_THIS_SIDE"
    else:
        return "MIXED"


# ---------------------------------------------------------------------------
# 3. CORE MODEL
# ---------------------------------------------------------------------------

@dataclass
class ModelOutput:
    home_win_prob: float = 0.0
    away_win_prob: float = 0.0
    expected_home_score: float = 0.0
    expected_away_score: float = 0.0
    expected_spread: float = 0.0
    model_spread: float = 0.0       # Our model's spread vs market spread
    spread_edge: float = 0.0        # +edge means we see value on away +spread
    cover_prob_away: float = 0.0    # P(away covers the spread)
    over_prob: float = 0.0
    model_total: float = 0.0        # Injury-adjusted expected total
    component_probs: Dict[str, float] = field(default_factory=dict)


def run_model() -> ModelOutput:
    out = ModelOutput()

    # --- Component 1: Market Implied Probability ---
    raw_home = american_to_implied_prob(ODDS["moneyline_home"])
    raw_away = american_to_implied_prob(ODDS["moneyline_away"])
    market_home_prob, market_away_prob = remove_vig(raw_home, raw_away)
    out.component_probs["market_implied"] = market_home_prob

    # --- Component 2: Spread-Implied Probability ---
    spread_home_prob = spread_to_win_prob(ODDS["spread_home"])  # -15.5 -> P(OKC wins)
    out.component_probs["spread_implied"] = spread_home_prob

    # --- Component 3: Power Rating Model (Net Rating Based) ---
    okc_net = TEAM_STATS["OKC"]["net_rtg"]
    lal_net = TEAM_STATS["LAL"]["net_rtg"]
    power_spread = net_rtg_to_spread(okc_net, lal_net, home_court_advantage=3.0)
    power_home_prob = spread_to_win_prob(power_spread)
    out.component_probs["power_rating"] = power_home_prob

    # --- Component 4: Head-to-Head Weighting ---
    # 4-0 with +29.3 margin is extreme but playoff context differs
    # Apply a 50% regression to mean since regular season can be inflated
    h2h_margin = TEAM_STATS["OKC"]["h2h_avg_margin"] * 0.50  # regressed
    h2h_spread = -(h2h_margin + 3.0)                          # + home court
    h2h_home_prob = spread_to_win_prob(h2h_spread)
    out.component_probs["h2h_regressed"] = h2h_home_prob

    # --- Component 5: Injury-Adjusted Model ---
    # Luka OUT is massive for LAL; Jalen Williams OUT hurts OKC
    lal_injury_cost = injury_adjustment("LAL", PLAYERS)   # pts/game lost by LAL
    okc_injury_cost = injury_adjustment("OKC", PLAYERS)   # pts/game lost by OKC
    net_injury_impact = lal_injury_cost - okc_injury_cost  # positive = OKC benefits
    injury_adj_spread = power_spread - net_injury_impact
    injury_home_prob = spread_to_win_prob(injury_adj_spread)
    out.component_probs["injury_adjusted"] = injury_home_prob

    # --- Ensemble: Weighted Average of Components ---
    # Weights: market signal is most reliable; injury and H2H add information
    weights = {
        "market_implied":  0.35,
        "spread_implied":  0.25,
        "power_rating":    0.15,
        "h2h_regressed":   0.10,
        "injury_adjusted": 0.15,
    }
    assert abs(sum(weights.values()) - 1.0) < 1e-9, "Weights must sum to 1"

    ensemble_home_prob = sum(
        out.component_probs[k] * w for k, w in weights.items()
    )
    out.home_win_prob = round(ensemble_home_prob, 4)
    out.away_win_prob = round(1 - ensemble_home_prob, 4)

    # --- Expected Scores ---
    # Market total/spread already price in all known injuries.
    # Use market-derived base scores as the anchor.
    # Model spread is derived from the ensemble win probability, not raw scores.
    home_base, away_base = implied_total_scores(
        ODDS["total"], ODDS["spread_home"]
    )
    out.expected_home_score = round(home_base, 1)
    out.expected_away_score = round(away_base, 1)

    # Convert ensemble win prob back to an implied spread for comparison
    # Invert spread_to_win_prob: z = norminv(p), spread = -z * std_dev
    model_z = _normal_quantile(ensemble_home_prob)
    model_implied_spread = -(model_z * 12.0)  # OKC perspective

    out.model_spread = round(model_implied_spread, 1)
    out.expected_spread = round(-model_implied_spread, 1)

    # Spread edge: how much our model differs from the market line
    # Negative = model favors OKC more than market; positive = value on LAL +15.5
    out.spread_edge = round(ODDS["spread_home"] - model_implied_spread, 1)

    # P(away covers +15.5): use model spread as expected margin
    out.cover_prob_away = round(
        _normal_cdf((-model_implied_spread - abs(ODDS["spread_home"])) / 12.0), 4
    )

    # Total: net injury delta as a small lean (market largely already prices this)
    # lal_injury_cost and okc_injury_cost represent pts/game impact; apply 30%
    # discount since the market has had time to absorb known injury news.
    net_injury_surplus = lal_injury_cost - okc_injury_cost
    model_total = ODDS["total"] - net_injury_surplus * 0.30
    out.model_total = round(model_total, 1)
    total_std = 14.0
    z_over = (model_total - ODDS["total"]) / total_std
    out.over_prob = round(_normal_cdf(z_over), 4)

    return out


# ---------------------------------------------------------------------------
# 4. SHARP MONEY ANALYSIS
# ---------------------------------------------------------------------------

def analyze_betting_market() -> Dict[str, str]:
    results = {}

    # Moneyline - sharp signal
    ml_signal = sharp_money_signal(
        BETTING_SPLITS["ml_tickets_away_pct"],
        BETTING_SPLITS["ml_handle_away_pct"]
    )
    results["moneyline_lakers"] = ml_signal

    # Spread - sharp signal
    spread_signal = sharp_money_signal(
        BETTING_SPLITS["spread_tickets_away_pct"],
        BETTING_SPLITS["spread_handle_away_pct"]
    )
    results["spread_lakers_plus15.5"] = spread_signal

    # Total - over signal
    over_signal = sharp_money_signal(
        BETTING_SPLITS["total_over_tickets_pct"],
        BETTING_SPLITS["total_over_handle_pct"]
    )
    results["total_over_213.5"] = over_signal

    return results


# ---------------------------------------------------------------------------
# 5. REPORT
# ---------------------------------------------------------------------------

def print_report(model: ModelOutput, sharp: Dict[str, str]) -> None:
    sep = "=" * 65

    print(sep)
    print("  NBA PLAYOFFS 2026 - GAME 1 PREDICTION MODEL")
    print(f"  {GAME_META['away_team']} @ {GAME_META['home_team']}")
    print(f"  {GAME_META['date']}  |  {GAME_META['tip_off_et']} ET")
    print(f"  {GAME_META['venue']}")
    print(f"  {GAME_META['series']}")
    print(sep)

    print("\n[MARKET ODDS]")
    print(f"  Moneyline  : OKC {ODDS['moneyline_home']:+d}  |  LAL {ODDS['moneyline_away']:+d}")
    print(f"  Spread     : OKC {ODDS['spread_home']:+.1f}  |  LAL {ODDS['spread_away']:+.1f}")
    print(f"  Total (O/U): {ODDS['total']}")
    raw_home = american_to_implied_prob(ODDS["moneyline_home"])
    raw_away = american_to_implied_prob(ODDS["moneyline_away"])
    print(f"  Vig        : {(raw_home + raw_away - 1) * 100:.1f}%")

    print("\n[INJURY REPORT]")
    for name, p in PLAYERS.items():
        flag = ""
        if p["status"] != "ACTIVE":
            detail = p.get("injury_detail", "")
            flag = f"  <- {detail}" if detail else ""
        print(f"  {p['team']:3s}  {name:<28s} {p['status']}{flag}")

    print("\n[COMPONENT WIN PROBABILITIES - OKC]")
    labels = {
        "market_implied":  "Market implied (ML, no vig)",
        "spread_implied":  "Spread implied (-15.5)",
        "power_rating":    "Power rating (net rtg diff)",
        "h2h_regressed":   "Head-to-head (50% regressed)",
        "injury_adjusted": "Injury-adjusted power rating",
    }
    weights = {
        "market_implied":  0.35,
        "spread_implied":  0.25,
        "power_rating":    0.15,
        "h2h_regressed":   0.10,
        "injury_adjusted": 0.15,
    }
    for k, label in labels.items():
        p = model.component_probs[k]
        w = weights[k]
        bar = "#" * int(p * 30)
        print(f"  {label:<36s}  {p*100:5.1f}%  (wt={w:.2f})  |{bar}")

    print(f"\n[ENSEMBLE WIN PROBABILITY]")
    print(f"  OKC Thunder win prob  : {model.home_win_prob * 100:.1f}%")
    print(f"  LAL Lakers  win prob  : {model.away_win_prob * 100:.1f}%")

    print(f"\n[EXPECTED SCORE]")
    print(f"  OKC Thunder : {model.expected_home_score}")
    print(f"  LAL Lakers  : {model.expected_away_score}")
    print(f"  Margin      : OKC by {model.expected_spread:.1f}")
    print(f"  Model spread: OKC -{model.model_spread:.1f}")
    print(f"  Market line : OKC {ODDS['spread_home']:.1f}")
    edge_dir = "OKC" if model.spread_edge < 0 else "LAL"
    print(f"  Spread edge : {abs(model.spread_edge):.1f} pts toward {edge_dir}")

    print(f"\n[COVER PROBABILITY]")
    print(f"  P(LAL covers +15.5)  : {model.cover_prob_away * 100:.1f}%")
    print(f"  P(OKC covers -15.5)  : {(1 - model.cover_prob_away) * 100:.1f}%")

    print(f"\n[TOTAL ANALYSIS]")
    print(f"  Market-implied total : {model.expected_home_score + model.expected_away_score:.1f}")
    print(f"  Model-adjusted total : {model.model_total:.1f}  (30% injury discount applied)")
    print(f"  Market total (O/U)   : {ODDS['total']}")
    diff = model.model_total - ODDS["total"]
    direction = "OVER" if diff > 0 else "UNDER"
    print(f"  Model lean           : {direction} by {abs(diff):.1f} pts")
    print(f"  P(Over {ODDS['total']})      : {model.over_prob * 100:.1f}%")

    print(f"\n[SHARP MONEY SIGNALS]")
    for market, signal in sharp.items():
        emoji_map = {
            "SHARP_ON_THIS_SIDE": ">> SHARP",
            "SHARP_AGAINST_THIS_SIDE": "<< FADE",
            "MIXED": "-- MIXED",
        }
        tickets_key = f"{'ml' if 'moneyline' in market else 'spread' if 'spread' in market else 'total_over'}_tickets_away_pct"
        handle_key  = f"{'ml' if 'moneyline' in market else 'spread' if 'spread' in market else 'total_over'}_handle_away_pct"
        t = BETTING_SPLITS.get(tickets_key, 0)
        h = BETTING_SPLITS.get(handle_key, 0)
        print(f"  {market:<30s} tickets={t:2d}%  handle={h:2d}%  {emoji_map[signal]}")

    print(f"\n[SERIES CONTEXT]")
    print(f"  OKC vs LAL regular season: 4-0, avg margin +{TEAM_STATS['OKC']['h2h_avg_margin']:.1f} pts")
    print(f"  OKC net rating : +{TEAM_STATS['OKC']['net_rtg']:.1f} (#1 NBA)")
    print(f"  LAL net rating : +{TEAM_STATS['LAL']['net_rtg']:.1f}")
    print(f"  Series odds    : OKC {ODDS['series_thunder_win']:+d}  |  LAL {ODDS['series_lakers_win']:+d}")

    print(f"\n[MODEL SUMMARY]")
    print(f"  PREDICTION   : OKC THUNDER WIN")
    print(f"  WIN PROB     : {model.home_win_prob * 100:.1f}% OKC / {model.away_win_prob * 100:.1f}% LAL")
    print(f"  FINAL SCORE  : OKC {model.expected_home_score:.0f}  -  LAL {model.expected_away_score:.0f}")
    print(f"  SPREAD PICK  : {'LAL +15.5 (value)' if model.spread_edge > 1 else 'OKC -15.5 (line has edge)'}")
    print(f"  TOTAL PICK   : {'OVER' if model.over_prob > 0.52 else 'UNDER'} {ODDS['total']}")

    print(f"\n[DATA SOURCES]")
    print("  OddsShark  : https://www.oddsshark.com/nba/los-angeles-oklahoma-city-odds-may-5-2026-2522964")
    print("  CBS Sports : https://www.cbssports.com/nba/news/lakers-thunder-odds-prediction-spread-time-2026-nba-playoff-picks-game-1-best-bets/")
    print("  NBC Sports : https://www.nbcsports.com/nba/news/thunder-vs-lakers-gm-1-rd-2-nba-playoffs-predictions-odds-stats-trends-and-best-bets-for-may-5")
    print("  Yahoo      : https://sports.yahoo.com/nba/betting/article/nba-playoffs-2026-current-odds-for-lakers-thunder-every-second-round-series-032523020.html")
    print("  NBA.com    : https://www.nba.com/news/2026-nba-playoffs-series-preview-thunder-lakers")
    print(sep)


# ---------------------------------------------------------------------------
# 6. ENTRY POINT
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    model_output = run_model()
    sharp_signals = analyze_betting_market()
    print_report(model_output, sharp_signals)
