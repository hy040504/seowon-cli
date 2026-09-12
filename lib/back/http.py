"""HTTPS 클라이언트. e-campus 쿠키를 직접 들고 다닌다.

표준 라이브러리 ``urllib`` 만 쓰고, 쿠키 저장소는 ``Cookie`` 목록으로 직접 관리한다.
"""

from __future__ import annotations

import ssl
import uuid
from dataclasses import dataclass, field
from typing import Any
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import HTTPSHandler, OpenerDirector, Request, build_opener

from lib.seowon import BASE_URL, HOST, USER_AGENT, Cookie


@dataclass
class HttpClient:
    """urllib HTTPS. 쿠키는 직접 들고 e-campus 세션을 유지한다.

    Attributes:
        host: 요청 호스트.
        port: 포트.
        https: TLS 사용 여부.
        cookies: 현재 세션 쿠키.
        last_error: 마지막 네트워크 오류 메시지.
        origin: ``scheme://host[:port]``.
    """

    host: str = HOST
    port: int = 443
    https: bool = True
    cookies: list[Cookie] = field(default_factory=list)
    last_error: str = ""
    origin: str = BASE_URL
    _opener: OpenerDirector | None = field(default=None, repr=False)

    def init(self, base_url: str = BASE_URL) -> None:
        """호스트·TLS 를 연다. 쿠키 저장소는 비우지 않는다.

        Args:
            base_url: origin. 비면 e-campus 기본값.
        """
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
        """이름·값이 있는 쿠키가 하나라도 있으면 True.

        Returns:
            세션으로 쓸 쿠키가 있으면 True.
        """
        return any(c.name and c.value for c in self.cookies)

    def set_cookie(self, name: str, value: str, domain: str | None = None) -> None:
        """같은 이름 쿠키를 덮어쓴다.

        Args:
            name: 쿠키 이름. 비면 무시.
            value: 쿠키 값.
            domain: 호스트. None 이면 현재 host.
        """
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
        """세션에서 복원한 쿠키를 넣는다.

        Args:
            items: ``session.json`` 에서 읽은 쿠키.
        """
        for c in items:
            self.set_cookie(c.name, c.value, c.domain)

    def snapshot(self) -> list[Cookie]:
        """``session.json`` 에 넣을 복사본.

        Returns:
            이름·값·도메인·경로를 복제한 목록.
        """
        return [Cookie(name=c.name, value=c.value, domain=c.domain, path=c.path) for c in self.cookies]

    def _cookie_header(self) -> str:
        """요청에 붙일 Cookie 헤더.

        Returns:
            ``name=value; ...``. 없으면 빈 문자열.
        """
        return "; ".join(f"{c.name}={c.value}" for c in self.cookies if c.name)

    def _absorb_set_cookie(self, headers: Any) -> None:
        """응답의 Set-Cookie 를 저장한다.

        Args:
            headers: urllib 응답 헤더.
        """
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

    def request_raw(
        self,
        method: str,
        path: str,
        referer: str | None = None,
        content_type: str | None = None,
        payload: bytes | str | None = None,
        ajax: bool = False,
    ) -> tuple[bytes, int, dict[str, str]]:
        """한 번 요청하고 바이트·상태·헤더를 돌린다.

        Set-Cookie 는 내부 쿠키 저장소에 흡수한다.

        Parameters
        ----------
        method : str
            ``GET`` / ``POST``.
        path : str
            절대 URL 또는 origin 기준 경로.
        referer : str or None
            Referer 헤더.
        content_type : str or None
            Content-Type. 없으면 넣지 않는다.
        payload : bytes or str or None
            본문. 문자열이면 UTF-8 로 인코딩한다.
        ajax : bool
            True 면 ``X-Requested-With: XMLHttpRequest``.

        Returns
        -------
        bytes
            응답 본문.
        int
            HTTP 상태.
        dict
            ``content-disposition``, ``content-type``.

        Raises
        ------
        URLError
            네트워크 오류. ``last_error`` 에 이유를 남긴다.
        """
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
        extra: dict[str, str] = {}
        try:
            opener = self._opener or build_opener()
            with opener.open(req, timeout=60) as resp:
                status = getattr(resp, "status", 200)
                body = resp.read()
                self._absorb_set_cookie(resp.headers)
                disp = resp.headers.get("Content-Disposition") or ""
                ctype = resp.headers.get("Content-Type") or ""
                extra["content-disposition"] = disp
                extra["content-type"] = ctype
        except URLError as e:
            self.last_error = str(e.reason if getattr(e, "reason", None) else e)
            raise
        except Exception as e:
            self.last_error = str(e)
            raise
        return body, int(status), extra

    def request(
        self,
        method: str,
        path: str,
        referer: str | None = None,
        content_type: str | None = None,
        payload: bytes | str | None = None,
        ajax: bool = False,
    ) -> tuple[str, int]:
        """한 번 요청하고 본문을 문자열로 돌린다.

        Args:
            method: HTTP 메서드.
            path: 경로 또는 절대 URL.
            referer: Referer.
            content_type: Content-Type.
            payload: 본문.
            ajax: XMLHttpRequest 헤더 여부.

        Returns:
            ``(텍스트, 상태)``. UTF-8 실패 시 cp949.
        """
        body, status, _ = self.request_raw(method, path, referer, content_type, payload, ajax)
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError:
            text = body.decode("cp949", errors="replace")
        return text, int(status)

    def get_bytes(self, path: str, referer: str | None = None) -> tuple[bytes, int, dict[str, str]]:
        """첨부 다운로드용 GET.

        Args:
            path: 경로 또는 절대 URL.
            referer: Referer.

        Returns:
            ``(바이트, 상태, 헤더 dict)``.
        """
        return self.request_raw("GET", path, referer=referer, ajax=False)

    def get(self, path: str, referer: str | None = None, ajax: bool = False) -> tuple[str, int]:
        """GET 텍스트 요청.

        Args:
            path: 경로 또는 절대 URL.
            referer: Referer.
            ajax: XMLHttpRequest 헤더 여부.

        Returns:
            ``(텍스트, 상태)``.
        """
        return self.request("GET", path, referer=referer, ajax=ajax)

    def post(
        self,
        path: str,
        referer: str | None,
        content_type: str,
        payload: str,
        ajax: bool = True,
    ) -> tuple[str, int]:
        """POST. 로그인·목록은 ``ajax=True``.

        Args:
            path: 경로.
            referer: Referer.
            content_type: Content-Type.
            payload: 본문 문자열.
            ajax: XMLHttpRequest 헤더. 기본 True.

        Returns:
            ``(텍스트, 상태)``.
        """
        return self.request(
            "POST",
            path,
            referer=referer,
            content_type=content_type,
            payload=payload,
            ajax=ajax,
        )

    def post_multipart(
        self,
        path: str,
        referer: str | None,
        fields: list[tuple[str, str]],
        files: list[tuple[str, str, bytes, str]],
    ) -> tuple[str, int]:
        """파일 업로드용 multipart POST.

        Parameters
        ----------
        path : str
            업로드 경로.
        referer : str or None
            Referer.
        fields : list of tuple
            ``(필드명, 값)`` 일반 폼 필드.
        files : list of tuple
            ``(필드명, 파일명, 바이트, MIME)``.

        Returns
        -------
        tuple of (str, int)
            응답 텍스트와 상태.
        """
        boundary = "----SeowonForm" + uuid.uuid4().hex
        chunks: list[bytes] = []
        for name, value in fields:
            chunks.append(
                (
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                    f"{value}\r\n"
                ).encode("utf-8")
            )
        for field, filename, data, mime in files:
            header = (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
                f"Content-Type: {mime or 'application/octet-stream'}\r\n\r\n"
            ).encode("utf-8")
            chunks.append(header + data + b"\r\n")
        chunks.append(f"--{boundary}--\r\n".encode("ascii"))
        return self.request(
            "POST",
            path,
            referer=referer,
            content_type=f"multipart/form-data; boundary={boundary}",
            payload=b"".join(chunks),
            ajax=True,
        )
