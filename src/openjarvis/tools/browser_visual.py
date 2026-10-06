"""Live Visual Browser tool using Playwright with SSRF protection and JPEG streaming."""

from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any, Dict, List, Optional, Set

from openjarvis.security.ssrf import check_ssrf

logger = logging.getLogger(__name__)


class SSRFBlockedError(ValueError):
    """Raised when a URL is blocked by the SSRF security filter."""

    pass


class VisualBrowserSession:
    """Manages an async Playwright headless browser session with live visual streaming."""

    def __init__(
        self,
        session_id: str,
        fps: float = 2.0,
        quality: int = 60,
        viewport_width: int = 1280,
        viewport_height: int = 720,
    ) -> None:
        self.session_id = session_id
        self.fps = max(0.5, min(10.0, fps))
        self.quality = max(10, min(100, quality))
        self.viewport_width = viewport_width
        self.viewport_height = viewport_height

        self._playwright: Any = None
        self._browser: Any = None
        self._context: Any = None
        self._page: Any = None
        self._streaming_task: Optional[asyncio.Task[None]] = None
        self._subscribers: Set[asyncio.Queue[Dict[str, Any]]] = set()
        self._is_active: bool = False
        self._lock = asyncio.Lock()

        self._last_frame_base64: Optional[str] = None
        self._last_frame_bytes: Optional[bytes] = None
        self._current_url: str = "about:blank"
        self._page_title: str = ""

    @property
    def is_active(self) -> bool:
        return self._is_active

    @property
    def current_url(self) -> str:
        return self._current_url

    @property
    def page_title(self) -> str:
        return self._page_title

    @property
    def last_frame_base64(self) -> Optional[str]:
        return self._last_frame_base64

    async def start(self) -> None:
        """Start the Playwright browser session."""
        async with self._lock:
            if self._is_active:
                return

            try:
                from playwright.async_api import async_playwright
            except ImportError:
                raise ImportError(
                    "Playwright is not installed. Install with: pip install playwright && playwright install chromium"
                )

            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-accelerated-2d-canvas",
                    "--disable-gpu",
                ],
            )
            self._context = await self._browser.new_context(
                viewport={"width": self.viewport_width, "height": self.viewport_height},
                user_agent=(
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36 OpenJarvisVisual/1.0"
                ),
            )
            self._page = await self._context.new_page()

            # Set up SSRF protection on network requests
            async def _ssrf_route_interceptor(route: Any) -> None:
                request_url = route.request.url
                if request_url.startswith(("http://", "https://")):
                    reason = check_ssrf(request_url)
                    if reason:
                        logger.warning(
                            "SSRF filter blocked request in session %s: %s (%s)",
                            self.session_id,
                            request_url,
                            reason,
                        )
                        await route.abort("blockedbyclient")
                        return
                await route.continue_()

            await self._page.route("**/*", _ssrf_route_interceptor)

            self._is_active = True
            self._streaming_task = asyncio.create_task(self._stream_loop())
            logger.info("VisualBrowserSession started for session_id=%s", self.session_id)

    async def navigate(self, url: str) -> str:
        """Navigate to a URL after SSRF validation."""
        if not url.startswith(("http://", "https://")):
            url = f"https://{url}"

        reason = check_ssrf(url)
        if reason:
            raise SSRFBlockedError(f"URL blocked by SSRF filter: {reason}")

        if not self._is_active or not self._page:
            await self.start()

        logger.info("Session %s navigating to %s", self.session_id, url)
        await self._page.goto(url, wait_until="domcontentloaded", timeout=30000)
        self._current_url = self._page.url
        try:
            self._page_title = await self._page.title()
        except Exception:
            self._page_title = ""

        # Immediately capture frame on navigation
        await self.capture_screenshot()
        return self._current_url

    async def capture_screenshot(self) -> bytes:
        """Capture a JPEG screenshot of the current page at configured quality."""
        if not self._is_active or not self._page:
            raise RuntimeError("Browser session is not active")

        screenshot_bytes = await self._page.screenshot(
            type="jpeg",
            quality=self.quality,
            full_page=False,
        )
        self._last_frame_bytes = screenshot_bytes
        self._last_frame_base64 = base64.b64encode(screenshot_bytes).decode("ascii")

        # Broadcast immediately to subscribers
        await self._broadcast_frame()
        return screenshot_bytes

    async def click(self, selector: str) -> None:
        """Click an element on the page."""
        if not self._is_active or not self._page:
            raise RuntimeError("Browser session is not active")
        await self._page.click(selector, timeout=10000)
        await asyncio.sleep(0.2)
        await self.capture_screenshot()

    async def type_text(self, selector: str, text: str) -> None:
        """Type text into an input element."""
        if not self._is_active or not self._page:
            raise RuntimeError("Browser session is not active")
        await self._page.fill(selector, text, timeout=10000)
        await asyncio.sleep(0.1)
        await self.capture_screenshot()

    async def scroll(self, direction: str = "down", pixels: int = 500) -> None:
        """Scroll page up or down."""
        if not self._is_active or not self._page:
            raise RuntimeError("Browser session is not active")
        delta_y = pixels if direction.lower() == "down" else -pixels
        await self._page.evaluate(f"window.scrollBy(0, {delta_y})")
        await asyncio.sleep(0.1)
        await self.capture_screenshot()

    async def refresh(self) -> None:
        """Reload current page."""
        if not self._is_active or not self._page:
            raise RuntimeError("Browser session is not active")
        await self._page.reload(wait_until="domcontentloaded", timeout=30000)
        await self.capture_screenshot()

    def subscribe(self) -> asyncio.Queue[Dict[str, Any]]:
        """Subscribe to frame updates."""
        queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=10)
        self._subscribers.add(queue)

        # If a frame is already available, send it immediately
        if self._last_frame_base64:
            payload = self._build_frame_payload()
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                pass

        return queue

    def unsubscribe(self, queue: asyncio.Queue[Dict[str, Any]]) -> None:
        """Unsubscribe from frame updates."""
        self._subscribers.discard(queue)

    def _build_frame_payload(self) -> Dict[str, Any]:
        import time

        return {
            "type": "frame",
            "session_id": self.session_id,
            "url": self._current_url,
            "title": self._page_title,
            "frame": self._last_frame_base64,
            "timestamp": time.time(),
        }

    async def _broadcast_frame(self) -> None:
        if not self._last_frame_base64 or not self._subscribers:
            return

        payload = self._build_frame_payload()
        for queue in list(self._subscribers):
            try:
                if queue.full():
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                queue.put_nowait(payload)
            except Exception:
                pass

    async def _stream_loop(self) -> None:
        """Periodic background loop capturing frames at target FPS."""
        interval = 1.0 / self.fps
        while self._is_active:
            try:
                await asyncio.sleep(interval)
                if self._is_active and self._page and self._subscribers:
                    await self.capture_screenshot()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.debug("Error in stream loop for session %s: %s", self.session_id, exc)

    async def close(self) -> None:
        """Close browser session and cleanup resources."""
        async with self._lock:
            if not self._is_active:
                return

            self._is_active = False

            if self._streaming_task:
                self._streaming_task.cancel()
                try:
                    await self._streaming_task
                except (asyncio.CancelledError, Exception):
                    pass
                self._streaming_task = None

            if self._page:
                try:
                    await self._page.close()
                except Exception:
                    pass
                self._page = None

            if self._context:
                try:
                    await self._context.close()
                except Exception:
                    pass
                self._context = None

            if self._browser:
                try:
                    await self._browser.close()
                except Exception:
                    pass
                self._browser = None

            if self._playwright:
                try:
                    await self._playwright.stop()
                except Exception:
                    pass
                self._playwright = None

            self._subscribers.clear()
            logger.info("VisualBrowserSession closed for session_id=%s", self.session_id)


class VisualBrowserManager:
    """Registry and manager for active visual browser sessions."""

    def __init__(self) -> None:
        self._sessions: Dict[str, VisualBrowserSession] = {}
        self._lock = asyncio.Lock()

    async def get_or_create_session(
        self,
        session_id: str,
        fps: float = 2.0,
        quality: int = 60,
    ) -> VisualBrowserSession:
        async with self._lock:
            if session_id in self._sessions:
                session = self._sessions[session_id]
                if session.is_active:
                    return session
                else:
                    await session.close()

            session = VisualBrowserSession(session_id=session_id, fps=fps, quality=quality)
            self._sessions[session_id] = session
            return session

    async def get_session(self, session_id: str) -> Optional[VisualBrowserSession]:
        async with self._lock:
            return self._sessions.get(session_id)

    async def close_session(self, session_id: str) -> bool:
        async with self._lock:
            session = self._sessions.pop(session_id, None)
            if session:
                await session.close()
                return True
            return False

    async def list_sessions(self) -> List[Dict[str, Any]]:
        async with self._lock:
            return [
                {
                    "session_id": sid,
                    "is_active": sess.is_active,
                    "url": sess.current_url,
                    "title": sess.page_title,
                    "subscribers": len(sess._subscribers),
                }
                for sid, sess in self._sessions.items()
            ]

    async def close_all(self) -> None:
        async with self._lock:
            for session in list(self._sessions.values()):
                try:
                    await session.close()
                except Exception as exc:
                    logger.debug("Error closing session %s: %s", session.session_id, exc)
            self._sessions.clear()


visual_browser_manager = VisualBrowserManager()

__all__ = [
    "VisualBrowserSession",
    "VisualBrowserManager",
    "visual_browser_manager",
    "SSRFBlockedError",
]
