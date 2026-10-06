import pytest
from openjarvis.tools.browser_visual import (
    VisualBrowserSession,
    VisualBrowserManager,
    SSRFBlockedError,
)

@pytest.mark.asyncio
async def test_visual_browser_session_ssrf_blocking():
    session = VisualBrowserSession(session_id="test_ssrf")
    # Private IP and metadata endpoints should be blocked by check_ssrf
    with pytest.raises(SSRFBlockedError):
        await session.navigate("http://127.0.0.1:8000")

    with pytest.raises(SSRFBlockedError):
        await session.navigate("http://169.254.169.254/latest/meta-data")


@pytest.mark.asyncio
async def test_visual_browser_manager():
    manager = VisualBrowserManager()
    session = await manager.get_or_create_session("sess1")
    assert session.session_id == "sess1"

    sessions = await manager.list_sessions()
    assert len(sessions) == 1
    assert sessions[0]["session_id"] == "sess1"

    closed = await manager.close_session("sess1")
    assert closed is True

    sessions = await manager.list_sessions()
    assert len(sessions) == 0
