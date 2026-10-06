"""FastAPI routes and WebSocket endpoint for live visual browser streaming."""

from __future__ import annotations

import asyncio
import logging
import os
import secrets
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from pydantic import BaseModel, Field

from openjarvis.security.ssrf import check_ssrf
from openjarvis.server.auth_middleware import authenticate_websocket
from openjarvis.tools.browser_visual import (
    SSRFBlockedError,
    VisualBrowserSession,
    visual_browser_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["visual"])


def verify_bearer_auth(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> None:
    """Verify Bearer token against OPENJARVIS_API_KEY using constant-time comparison."""
    expected_key = getattr(request.app.state, "api_key", "") or os.environ.get(
        "OPENJARVIS_API_KEY", ""
    )
    if not expected_key:
        return

    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization scheme")

    try:
        token_bytes = token.encode("utf-8")
        expected_bytes = expected_key.encode("utf-8")
    except UnicodeEncodeError:
        raise HTTPException(status_code=401, detail="Invalid API key")

    if not secrets.compare_digest(token_bytes, expected_bytes):
        raise HTTPException(status_code=401, detail="Invalid API key")


class StartSessionRequest(BaseModel):
    session_id: str = Field(..., description="Unique visual session identifier")
    url: Optional[str] = Field(None, description="Initial URL to navigate to")
    fps: float = Field(2.0, ge=0.5, le=10.0, description="Streaming frames per second")
    quality: int = Field(60, ge=10, le=100, description="JPEG quality percentage")


class NavigateRequest(BaseModel):
    session_id: str
    url: str


class ActionRequest(BaseModel):
    session_id: str
    action: str = Field(..., description="Action: click, type, scroll, refresh, snapshot")
    selector: Optional[str] = None
    text: Optional[str] = None
    direction: Optional[str] = "down"


class StopSessionRequest(BaseModel):
    session_id: str


@router.post("/api/visual/start")
async def start_visual_session(
    req: StartSessionRequest,
    _: None = Depends(verify_bearer_auth),
) -> Dict[str, Any]:
    """Start or retrieve a visual browser streaming session."""
    if req.url:
        reason = check_ssrf(req.url)
        if reason:
            raise HTTPException(status_code=400, detail=f"SSRF blocked: {reason}")

    try:
        session = await visual_browser_manager.get_or_create_session(
            session_id=req.session_id, fps=req.fps, quality=req.quality
        )
        if not session.is_active:
            await session.start()

        if req.url:
            await session.navigate(req.url)

        return {
            "status": "started",
            "session_id": session.session_id,
            "url": session.current_url,
            "title": session.page_title,
        }
    except ImportError as err:
        raise HTTPException(status_code=503, detail=str(err))
    except SSRFBlockedError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except Exception as err:
        logger.exception("Failed to start visual session %s", req.session_id)
        raise HTTPException(status_code=500, detail=f"Session error: {err}")


@router.post("/api/visual/navigate")
async def navigate_visual_session(
    req: NavigateRequest,
    _: None = Depends(verify_bearer_auth),
) -> Dict[str, Any]:
    """Navigate an existing visual session to a new URL."""
    reason = check_ssrf(req.url)
    if reason:
        raise HTTPException(status_code=400, detail=f"SSRF blocked: {reason}")

    session = await visual_browser_manager.get_session(req.session_id)
    if not session or not session.is_active:
        raise HTTPException(status_code=404, detail="Visual session not found or inactive")

    try:
        current_url = await session.navigate(req.url)
        return {
            "status": "navigated",
            "session_id": req.session_id,
            "url": current_url,
            "title": session.page_title,
        }
    except SSRFBlockedError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


@router.post("/api/visual/action")
async def perform_visual_action(
    req: ActionRequest,
    _: None = Depends(verify_bearer_auth),
) -> Dict[str, Any]:
    """Perform UI interaction in visual browser session."""
    session = await visual_browser_manager.get_session(req.session_id)
    if not session or not session.is_active:
        raise HTTPException(status_code=404, detail="Visual session not found or inactive")

    try:
        if req.action == "click" and req.selector:
            await session.click(req.selector)
        elif req.action == "type" and req.selector and req.text is not None:
            await session.type_text(req.selector, req.text)
        elif req.action == "scroll":
            await session.scroll(direction=req.direction or "down")
        elif req.action == "refresh":
            await session.refresh()
        elif req.action == "snapshot":
            await session.capture_screenshot()
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported action: {req.action}")

        return {
            "status": "success",
            "session_id": req.session_id,
            "action": req.action,
            "url": session.current_url,
            "title": session.page_title,
        }
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


@router.post("/api/visual/stop")
async def stop_visual_session(
    req: StopSessionRequest,
    _: None = Depends(verify_bearer_auth),
) -> Dict[str, Any]:
    """Stop a visual browser session."""
    closed = await visual_browser_manager.close_session(req.session_id)
    return {"status": "stopped" if closed else "not_found", "session_id": req.session_id}


@router.get("/api/visual/sessions")
async def list_visual_sessions(
    _: None = Depends(verify_bearer_auth),
) -> List[Dict[str, Any]]:
    """List all active visual browser sessions."""
    return await visual_browser_manager.list_sessions()


@router.websocket("/api/ws/visual/{session_id}")
async def visual_websocket_stream(websocket: WebSocket, session_id: str) -> None:
    """WebSocket endpoint streaming JPEG screenshots of the browser session in real time."""
    expected_key = getattr(websocket.app.state, "api_key", "") or os.environ.get(
        "OPENJARVIS_API_KEY", ""
    )
    authorized, selected_protocol = authenticate_websocket(websocket, expected_key)
    if not authorized:
        await websocket.close(code=1008)  # Policy Violation / Unauthorized
        return

    await websocket.accept(subprotocol=selected_protocol)

    try:
        session = await visual_browser_manager.get_or_create_session(session_id)
        if not session.is_active:
            await session.start()
    except ImportError as err:
        await websocket.send_json(
            {"type": "error", "message": f"Playwright error: {err}"}
        )
        await websocket.close(code=1011)
        return
    except Exception as err:
        await websocket.send_json(
            {"type": "error", "message": f"Failed to initialize session: {err}"}
        )
        await websocket.close(code=1011)
        return

    queue = session.subscribe()
    recv_task: Optional[asyncio.Task[None]] = None
    send_task: Optional[asyncio.Task[None]] = None

    async def _handle_client_messages() -> None:
        try:
            while True:
                data = await websocket.receive_json()
                action = data.get("action")
                if action == "navigate" and "url" in data:
                    url = data["url"]
                    reason = check_ssrf(url)
                    if reason:
                        await websocket.send_json(
                            {"type": "error", "message": f"SSRF blocked: {reason}"}
                        )
                    else:
                        try:
                            await session.navigate(url)
                        except SSRFBlockedError as err:
                            await websocket.send_json(
                                {"type": "error", "message": str(err)}
                            )
                        except Exception as err:
                            await websocket.send_json(
                                {"type": "error", "message": f"Navigation error: {err}"}
                            )
                elif action == "click" and "selector" in data:
                    try:
                        await session.click(data["selector"])
                    except Exception as err:
                        await websocket.send_json(
                            {"type": "error", "message": f"Click error: {err}"}
                        )
                elif action == "scroll":
                    try:
                        await session.scroll(direction=data.get("direction", "down"))
                    except Exception as err:
                        await websocket.send_json(
                            {"type": "error", "message": f"Scroll error: {err}"}
                        )
                elif action == "refresh":
                    try:
                        await session.refresh()
                    except Exception as err:
                        await websocket.send_json(
                            {"type": "error", "message": f"Refresh error: {err}"}
                        )
                elif action == "ping":
                    await websocket.send_json({"type": "pong"})
        except (WebSocketDisconnect, RuntimeError):
            pass
        except Exception as exc:
            logger.debug("WS receive loop ended for session %s: %s", session_id, exc)

    async def _send_frames_to_client() -> None:
        try:
            while True:
                payload = await queue.get()
                await websocket.send_json(payload)
        except (WebSocketDisconnect, RuntimeError):
            pass
        except Exception as exc:
            logger.debug("WS send loop ended for session %s: %s", session_id, exc)

    recv_task = asyncio.create_task(_handle_client_messages())
    send_task = asyncio.create_task(_send_frames_to_client())

    try:
        done, pending = await asyncio.wait(
            {recv_task, send_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
    finally:
        session.unsubscribe(queue)
        logger.info("WebSocket disconnected for visual session %s", session_id)


__all__ = ["router"]
