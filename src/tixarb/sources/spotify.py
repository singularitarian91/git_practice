"""Spotify Web API adapter, for artist demand and momentum.

Client-credentials flow; no user data touched.

Be clear about what this can and cannot give you. The Web API exposes
``followers.total``, a 0-100 ``popularity`` index, and genres. It does **not**
expose monthly listeners -- that number is on the artist's web profile, not
in the API, and scraping it is a terms violation. So this adapter fills in
followers and popularity, and :attr:`tixarb.models.Artist.draw_proxy`
derives a demand estimate from followers when monthly listeners are unknown.

The estimate is crude and documented as such. The signal that actually
carries weight is the *derivative*: follower growth over 90 days is far more
predictive of a room being mis-sized than the absolute level, and it is
measured against your own snapshots, which makes it immune to the
scaling error in the level.
"""

from __future__ import annotations

import base64
import time
from typing import Optional

from ..models import Artist
from .http import HttpClient

TOKEN_URL = "https://accounts.spotify.com/api/token"
API_BASE = "https://api.spotify.com/v1"

# Spotify follower counts run roughly an order of magnitude below monthly
# listeners for touring acts, though the ratio varies widely by genre and
# catalogue age. Only ever used as a fallback, and only inside a log-scaled
# feature where being off by 2x moves the score very little.
FOLLOWERS_TO_LISTENERS = 12.0


class SpotifySource:
    name = "spotify"

    def __init__(self, cfg, client: Optional[HttpClient] = None):
        self.cfg = cfg
        self.http = client or HttpClient(rate=3.0, burst=6.0)
        self._token: Optional[str] = None
        self._token_expires: float = 0.0

    def available(self) -> bool:
        return bool(self.cfg.spotify_client_id and self.cfg.spotify_client_secret)

    def _access_token(self) -> str:
        # Refresh 60s early; a token that expires mid-batch costs a retry on
        # every remaining artist.
        if self._token and time.time() < self._token_expires - 60:
            return self._token
        creds = f"{self.cfg.spotify_client_id}:{self.cfg.spotify_client_secret}"
        encoded = base64.b64encode(creds.encode()).decode()
        payload = self.http.post_json(
            TOKEN_URL,
            form={"grant_type": "client_credentials"},
            headers={"Authorization": f"Basic {encoded}"},
        )
        self._token = payload["access_token"]
        self._token_expires = time.time() + int(payload.get("expires_in", 3600))
        return self._token

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._access_token()}"}

    def search_artist(self, name: str) -> Optional[dict]:
        payload = self.http.get_json(
            f"{API_BASE}/search",
            params={"q": name, "type": "artist", "limit": 5},
            headers=self._headers(),
        )
        items = ((payload.get("artists") or {}).get("items")) or []
        if not items:
            return None
        # Exact name match beats Spotify's relevance ranking, which happily
        # returns a tribute band or a same-named podcast above the artist.
        lowered = name.strip().lower()
        for item in items:
            if item.get("name", "").strip().lower() == lowered:
                return item
        return items[0]

    def enrich(self, artist: Artist) -> Artist:
        """Fill in followers/popularity/genres, preserving anything already set."""
        from dataclasses import replace

        found = self.search_artist(artist.name)
        if not found:
            return artist
        return replace(
            artist,
            spotify_id=found.get("id") or artist.spotify_id,
            popularity=found.get("popularity") or artist.popularity,
            followers=(found.get("followers") or {}).get("total") or artist.followers,
            genres=tuple(found.get("genres") or artist.genres),
        )
