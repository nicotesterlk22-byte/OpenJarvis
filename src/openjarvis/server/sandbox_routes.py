"""Sandbox execution routes for running Python/Bash commands safely."""

from __future__ import annotations

import logging
import os
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from openjarvis.security.subprocess_sandbox import SandboxResult, SubprocessSandbox

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sandbox", tags=["sandbox"])


class ExecuteRequest(BaseModel):
    """Request model for code/command execution in sandbox."""

    command: str = Field(..., description="Python script or Bash command to execute")
    language: str = Field("bash", description="Execution language: 'bash' or 'python'")
    timeout: float = Field(30.0, ge=1.0, le=300.0, description="Execution timeout in seconds")
    working_dir: Optional[str] = Field(None, description="Optional working directory")


class ExecuteResponse(BaseModel):
    """Response model for sandbox execution."""

    stdout: str
    stderr: str
    returncode: int
    timed_out: bool
    killed: bool


def verify_bearer_auth(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> None:
    """Verify Bearer token against OPENJARVIS_API_KEY using constant-time comparison."""
    expected_key = getattr(request.app.state, "api_key", "") or os.environ.get("OPENJARVIS_API_KEY", "")
    if not expected_key:
        # Keyless local access mode
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


@router.post("/execute", response_model=ExecuteResponse)
async def execute_sandbox_command(
    req: ExecuteRequest,
    request: Request,
    _: None = Depends(verify_bearer_auth),
) -> ExecuteResponse:
    """Execute Python or Bash command inside the SubprocessSandbox."""
    logger.info("Executing sandbox command (language=%s, timeout=%s)", req.language, req.timeout)

    sandbox = SubprocessSandbox(
        timeout=req.timeout,
        max_memory_mb=512,
        max_cpu_seconds=30,
        max_output_bytes=102_400,
    )

    res: SandboxResult = sandbox.execute(
        command=req.command,
        language=req.language,
        working_dir=req.working_dir,
    )

    # Optional Audit Logging
    audit_logger = getattr(request.app.state, "audit_logger", None)
    if audit_logger is not None:
        try:
            import time
            from openjarvis.security.types import SecurityEvent, SecurityEventType

            preview_len = min(len(req.command), 100)
            event = SecurityEvent(
                event_type=SecurityEventType.TOOL_EXECUTED,
                timestamp=time.time(),
                content_preview=f"[{req.language}] {req.command[:preview_len]}",
                action_taken=f"executed (returncode={res.returncode})",
            )
            audit_logger.log(event)
        except Exception as exc:
            logger.debug("Failed to record sandbox audit log: %s", exc)

    return ExecuteResponse(
        stdout=res.stdout,
        stderr=res.stderr,
        returncode=res.returncode,
        timed_out=res.timed_out,
        killed=res.killed,
    )


__all__ = ["router", "ExecuteRequest", "ExecuteResponse"]
