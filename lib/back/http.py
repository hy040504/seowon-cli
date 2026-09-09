"""HTTPS 클라이언트. e-campus 쿠키를 직접 들고 다닌다."""

from __future__ import annotations

import ssl
from dataclasses import dataclass, field
from typing import Any
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import HTTPSHandler, OpenerDirector, Request, build_opener

from lib.seowon import BASE_URL, HOST, USER_AGENT, Cookie


@dataclass
class HttpClient:
    """urllib HTTPS. 쿠키는 직접 들고 e-campus 세션을 유지한다."""

    host: str = HOST
    port: int = 443
    https: bool = True
    cookies: list[Cookie] = field(default_factory=list)
    last_error: str = ""
    origin: str = BASE_URL
    _opener: OpenerDirector | None = field(default=None, repr=False)

    def init(self, base_url: str = BASE_URL) -> None:
        """호스트·TLS 를 연다. 쿠키 저장소는 비우지 않는다."""
        parsed = urlparse(base_url or BASE_URL)
        self.https = parsed.scheme != "http"
        self.host = parsed.hostname or HOST
        self.port = parsed.port or (443 if self.https else 80)
        self.origin = f"{'https' if self.https else 'http'}://{self.host}"
        if parsed.port:
            self.origin += f":{parsed.port}"
        ctx = ssl.create_default_context()
        self._opener = build_opener(HTTPSHandler(context=ctx))

    def cookie_usable(self) -> bool:
        """이름·값이 있는 쿠키가 하나라도 있으면 True."""
        return any(c.name and c.value for c in self.cookies)

    def set_cookie(self, name: str, value: str, domain: str | None = None) -> None:
        """같은 이름 쿠키를 덮어쓴다."""
        if not name:
            return
        for c in self.cookies:
            if c.name == name:
                c.value = value
                if domain:
                    c.domain = domain
                return
        self.cookies.append(Cookie(name=name, value=value, domain=domain or self.host))

    def apply_cookies(self, items: list[Cookie]) -> None:
        """세션에서 복원한 쿠키를 넣는다."""
        for c in items:
            self.set_cookie(c.name, c.value, c.domain)

    def snapshot(self) -> list[Cookie]:
        """session.json 에 넣을 복사본."""
        return [Cookie(name=c.name, value=c.value, domain=c.domain, path=c.path) for c in self.cookies]

    def _cookie_header(self) -> str:
        """Cookie 헤더."""
        return "; ".join(f"{c.name}={c.value}" for c in self.cookies if c.name)

    def _absorb_set_cookie(self, headers: Any) -> None:
        """Set-Cookie 를 저장한다."""
        values: list[str] = []
        if hasattr(headers, "get_all"):
            values = headers.get_all("Set-Cookie") or []
        elif "Set-Cookie" in headers:
            raw = headers.get("Set-Cookie")
            if raw:
                values = [raw]
        for line in values:
            part = line.split(";", 1)[0]
            if "=" not in part:
                continue
            name, value = part.split("=", 1)
            name, value = name.strip(), value.strip()
            if name:
                self.set_cookie(name, value, self.host)

    def request(
        self,
        method: str,
        path: str,
        referer: str | None = None,
        content_type: str | None = None,
        payload: bytes | str | None = None,
        ajax: bool = False,
    ) -> tuple[str, int]:
        """한 번 요청하고 Set-Cookie 를 흡수한다."""
        if path.startswith("http://") or path.startswith("https://"):
            url = path
        else:
            url = self.origin + (path if path.startswith("/") else "/" + path)
        data = payload.encode("utf-8") if isinstance(payload, str) else payload
        headers = {
            "User-Agent": USER_AGENT,
            "Cache-Control": "no-cache, no-store",
            "Pragma": "no-cache",
            "Origin": self.origin,
        }
        if ajax:
            headers["X-Requested-With"] = "XMLHttpRequest"
        if content_type:
            headers["Content-Type"] = content_type
        if referer:
            headers["Referer"] = referer
        ck = self._cookie_header()
        if ck:
            headers["Cookie"] = ck
        req = Request(url, data=data, headers=headers, method=method)
        try:
            opener = self._opener or build_opener()
            with opener.open(req, timeout=60) as resp:
                status = getattr(resp, "status", 200)
                body = resp.read()
                self._absorb_set_cookie(resp.headers)
        except URLError as e:
            self.last_error = str(e.reason if getattr(e, "reason", None) else e)
            raise
        except Exception as e:
            self.last_error = str(e)
            raise
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError:
            text = body.decode("cp949", errors="replace")
        return text, int(status)

    def get(self, path: str, referer: str | None = None, ajax: bool = False) -> tuple[str, int]:
        """GET."""
        return self.request("GET", path, referer=referer, ajax=ajax)

    def post(
        self,
        path: str,
        referer: str | None,
        content_type: str,
        payload: str,
        ajax: bool = True,
    ) -> tuple[str, int]:
        """POST. 로그인·목록은 ajax=True."""
        return self.request(
            "POST",
            path,
            referer=referer,
            content_type=content_type,
            payload=payload,
            ajax=ajax,
        )
