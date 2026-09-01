"""Minimal, well-behaved HTTP client for the source adapters.

Stdlib only, so the package installs with no dependencies. Three behaviours
matter more than features here:

* **Rate limiting.** A token bucket per host, sized under the documented
  quota. Getting an API key revoked for hammering costs far more than the
  latency saved.
* **Backoff that honours ``Retry-After``.** A 429 is the server telling you
  the rate you may use; retrying immediately is how a temporary throttle
  becomes a ban.
* **An identifying User-Agent.** Anonymous bulk traffic is what providers
  block first.
"""

from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Optional

USER_AGENT = "tixarb/0.1 (ticket market research; +https://github.com/singularitarian91/git_practice)"


class HttpError(RuntimeError):
    def __init__(self, status: int, url: str, body: str = ""):
        super().__init__(f"HTTP {status} for {url}: {body[:300]}")
        self.status = status
        self.url = url
        self.body = body


class RateLimitError(HttpError):
    """Raised when retries are exhausted against a throttling server."""


@dataclass
class TokenBucket:
    """Simple token bucket. ``rate`` is tokens per second."""

    rate: float
    capacity: float
    _tokens: float = field(default=0.0, init=False)
    _last: float = field(default_factory=time.monotonic, init=False)

    def __post_init__(self):
        self._tokens = self.capacity

    def take(self, tokens: float = 1.0) -> None:
        while True:
            now = time.monotonic()
            self._tokens = min(self.capacity, self._tokens + (now - self._last) * self.rate)
            self._last = now
            if self._tokens >= tokens:
                self._tokens -= tokens
                return
            time.sleep(max(0.01, (tokens - self._tokens) / self.rate))


@dataclass
class HttpClient:
    timeout: float = 20.0
    max_retries: int = 4
    rate: float = 4.0          # requests per second, sustained
    burst: float = 8.0
    user_agent: str = USER_AGENT
    _bucket: TokenBucket = field(init=False, default=None)

    def __post_init__(self):
        self._bucket = TokenBucket(rate=self.rate, capacity=self.burst)

    def get_json(self, url: str, params: Optional[dict] = None,
                 headers: Optional[dict] = None) -> dict:
        if params:
            clean = {k: v for k, v in params.items() if v is not None}
            url = f"{url}{'&' if '?' in url else '?'}{urllib.parse.urlencode(clean)}"
        return self._request("GET", url, headers=headers)

    def post_json(self, url: str, data: Optional[dict] = None,
                  headers: Optional[dict] = None,
                  form: Optional[dict] = None) -> dict:
        body = None
        headers = dict(headers or {})
        if form is not None:
            body = urllib.parse.urlencode(form).encode()
            headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
        elif data is not None:
            body = json.dumps(data).encode()
            headers.setdefault("Content-Type", "application/json")
        return self._request("POST", url, body=body, headers=headers)

    def _request(self, method: str, url: str, body: Optional[bytes] = None,
                 headers: Optional[dict] = None) -> dict:
        last_error = None
        for attempt in range(self.max_retries + 1):
            self._bucket.take()
            req = urllib.request.Request(url, data=body, method=method)
            req.add_header("User-Agent", self.user_agent)
            req.add_header("Accept", "application/json")
            for key, value in (headers or {}).items():
                req.add_header(key, value)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    payload = resp.read().decode("utf-8", "replace")
                    return json.loads(payload) if payload else {}
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", "replace")
                last_error = HttpError(exc.code, url, detail)
                if exc.code in (429, 500, 502, 503, 504) and attempt < self.max_retries:
                    time.sleep(self._backoff(attempt, exc.headers.get("Retry-After")))
                    continue
                if exc.code == 429:
                    raise RateLimitError(exc.code, url, detail) from exc
                raise last_error from exc
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = RuntimeError(f"{method} {url} failed: {exc}")
                if attempt < self.max_retries:
                    time.sleep(self._backoff(attempt, None))
                    continue
                raise last_error from exc
        raise last_error or RuntimeError("request failed")

    @staticmethod
    def _backoff(attempt: int, retry_after: Optional[str]) -> float:
        """Exponential backoff, deferring to Retry-After when the server sets it."""
        if retry_after:
            try:
                return min(120.0, float(retry_after))
            except ValueError:
                pass
        # Jitter matters: several adapters waking on the same schedule and
        # backing off in lockstep just re-collide on every retry.
        return min(30.0, (2 ** attempt)) * (0.5 + random.random() / 2)
