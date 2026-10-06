"""Subprocess sandbox — secure process execution with environment isolation."""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from typing import Dict, List, Optional

try:
    import resource
except ImportError:
    resource = None  # type: ignore

logger = logging.getLogger(__name__)

# Safe environment variables to pass through
_SAFE_ENV_VARS = frozenset(
    {
        "PATH",
        "HOME",
        "USER",
        "LANG",
        "TERM",
        "SHELL",
        "LC_ALL",
        "LC_CTYPE",
        "TMPDIR",
        "TZ",
        "PYTHONPATH",
        "VIRTUAL_ENV",
        "PYTHONUNBUFFERED",
    }
)

# Patterns that identify secret / credential env vars to expunge
_SECRET_KEYWORDS = (
    "KEY",
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PASSWD",
    "AUTH",
    "CREDENTIAL",
    "PRIVATE",
    "BEARER",
    "OPENJARVIS_",
    "OPENAI_",
    "ANTHROPIC_",
    "GEMINI_",
    "MISTRAL_",
    "GROQ_",
    "AWS_",
    "AZURE_",
    "GITHUB_",
)


@dataclass(slots=True)
class SandboxResult:
    """Result of a sandboxed subprocess execution."""

    stdout: str = ""
    stderr: str = ""
    returncode: int = -1
    timed_out: bool = False
    killed: bool = False


def _is_secret_key(key: str) -> bool:
    """Check if an environment variable key looks like a secret/credential."""
    upper_key = key.upper()
    return any(kw in upper_key for kw in _SECRET_KEYWORDS)


def build_safe_env(
    passthrough: Optional[List[str]] = None,
    extra: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Build a sanitized environment dict.

    Only copies safe vars from current env, plus any in passthrough list
    (provided they do not look like secrets).
    Expunges any secrets and sensitive credentials.
    """
    env: Dict[str, str] = {}
    allowed = _SAFE_ENV_VARS | frozenset(passthrough or [])
    for key in allowed:
        if _is_secret_key(key):
            continue
        val = os.environ.get(key)
        if val is not None:
            env[key] = val

    if extra:
        for k, v in extra.items():
            if not _is_secret_key(k):
                env[k] = v

    # Final purge pass to guarantee zero secrets in env
    keys_to_purge = [k for k in env if _is_secret_key(k)]
    for k in keys_to_purge:
        del env[k]

    return env


def kill_process_tree(pid: int) -> None:
    """Kill a process and all its children (best effort)."""
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except (OSError, ProcessLookupError) as exc:
        logger.debug("Failed to terminate process %d: %s", pid, exc)
    try:
        os.kill(pid, signal.SIGKILL)
    except (OSError, ProcessLookupError) as exc:
        logger.debug("Failed to kill process %d: %s", pid, exc)


def _setup_child_limits(max_memory_bytes: int, max_cpu_seconds: int):
    """preexec_fn callable to set process group and resource limits in child."""
    def _preexec():
        try:
            os.setsid()
        except OSError:
            pass

        if resource is not None:
            # CPU time limit in seconds
            if max_cpu_seconds > 0:
                try:
                    resource.setrlimit(resource.RLIMIT_CPU, (max_cpu_seconds, max_cpu_seconds + 5))
                except (ValueError, OSError):
                    pass

            # Address space (RAM) limit in bytes
            if max_memory_bytes > 0:
                try:
                    resource.setrlimit(resource.RLIMIT_AS, (max_memory_bytes, max_memory_bytes))
                except (ValueError, OSError):
                    pass

            # Maximum processes limit
            if hasattr(resource, "RLIMIT_NPROC"):
                try:
                    resource.setrlimit(resource.RLIMIT_NPROC, (100, 100))
                except (ValueError, OSError):
                    pass

    return _preexec


def run_sandboxed(
    command: str,
    *,
    language: str = "bash",
    timeout: float = 30.0,
    working_dir: Optional[str] = None,
    env_passthrough: Optional[List[str]] = None,
    env_extra: Optional[Dict[str, str]] = None,
    max_output_bytes: int = 102_400,
    max_memory_mb: int = 512,
    max_cpu_seconds: int = 30,
) -> SandboxResult:
    """Execute a command in a sandboxed subprocess.

    Features:
    - Clean environment (secrets expunged, only safe vars passed through)
    - Resource limits (RAM 512MB default, CPU max, NPROC)
    - Isolated working directory
    - Timeout enforcement with process tree kill
    - Output truncation (100KB limit)
    - New process group for clean cleanup
    """
    env = build_safe_env(passthrough=env_passthrough, extra=env_extra)
    max_memory_bytes = max_memory_mb * 1024 * 1024

    # Handle temporary isolated working directory
    temp_dir_obj: Optional[tempfile.TemporaryDirectory] = None
    if working_dir and os.path.isdir(working_dir):
        cwd = working_dir
    else:
        temp_dir_obj = tempfile.TemporaryDirectory(prefix=f"oj_sandbox_{uuid.uuid4().hex[:8]}_")
        cwd = temp_dir_obj.name

    result = SandboxResult()
    try:
        # Check execution language
        is_python = language.lower() in ("python", "python3", "py")
        if is_python:
            script_path = os.path.join(cwd, "_sandbox_script.py")
            with open(script_path, "w", encoding="utf-8") as f:
                f.write(command)
            exec_cmd = f"{sys.executable} _sandbox_script.py"
        else:
            exec_cmd = command

        proc = subprocess.Popen(
            exec_cmd,
            shell=True,  # nosec B602
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
            cwd=cwd,
            preexec_fn=_setup_child_limits(max_memory_bytes, int(max_cpu_seconds)),
        )
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
            result.stdout = stdout[:max_output_bytes] if stdout else ""
            result.stderr = stderr[:max_output_bytes] if stderr else ""
            result.returncode = proc.returncode
        except subprocess.TimeoutExpired:
            kill_process_tree(proc.pid)
            proc.wait(timeout=5)
            result.timed_out = True
            result.killed = True
            result.returncode = -1
            result.stdout = "(timed out)"
            result.stderr = ""
    except OSError as exc:
        result.stderr = f"Execution error: {exc}"
        result.returncode = -1
    finally:
        if temp_dir_obj is not None:
            try:
                temp_dir_obj.cleanup()
            except Exception as exc:
                logger.debug("Failed to cleanup sandbox temp dir: %s", exc)

    return result


class SubprocessSandbox:
    """Secure subprocess sandbox implementation for executing code safely."""

    def __init__(
        self,
        *,
        timeout: float = 30.0,
        max_memory_mb: int = 512,
        max_cpu_seconds: int = 30,
        max_output_bytes: int = 102_400,
    ) -> None:
        self.timeout = timeout
        self.max_memory_mb = max_memory_mb
        self.max_cpu_seconds = max_cpu_seconds
        self.max_output_bytes = max_output_bytes

    def execute(
        self,
        command: str,
        *,
        language: str = "bash",
        working_dir: Optional[str] = None,
        env_passthrough: Optional[List[str]] = None,
        env_extra: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> SandboxResult:
        return run_sandboxed(
            command,
            language=language,
            timeout=timeout if timeout is not None else self.timeout,
            working_dir=working_dir,
            env_passthrough=env_passthrough,
            env_extra=env_extra,
            max_output_bytes=self.max_output_bytes,
            max_memory_mb=self.max_memory_mb,
            max_cpu_seconds=self.max_cpu_seconds,
        )


__all__ = [
    "SandboxResult",
    "SubprocessSandbox",
    "build_safe_env",
    "kill_process_tree",
    "run_sandboxed",
]
