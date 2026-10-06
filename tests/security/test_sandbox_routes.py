"""Tests for FastAPI sandbox execution endpoint (/api/sandbox/execute)."""

from __future__ import annotations

import os

from fastapi.testclient import TestClient
from openjarvis.server.app import create_app


class TestSandboxRoutes:
    """Test suite for /api/sandbox/execute endpoint."""

    def setup_method(self) -> None:
        self.api_key = "test_key_sandbox_123"
        os.environ["OPENJARVIS_API_KEY"] = self.api_key
        self.app = create_app(engine=None, model="test-model", api_key=self.api_key)
        self.client = TestClient(self.app)
        self.headers = {"Authorization": f"Bearer {self.api_key}"}

    def test_missing_auth_returns_401(self) -> None:
        resp = self.client.post(
            "/api/sandbox/execute",
            json={"command": "echo test", "language": "bash"},
        )
        assert resp.status_code == 401

    def test_invalid_auth_returns_401(self) -> None:
        resp = self.client.post(
            "/api/sandbox/execute",
            json={"command": "echo test", "language": "bash"},
            headers={"Authorization": "Bearer invalid_key"},
        )
        assert resp.status_code == 401

    def test_execute_python_hello(self) -> None:
        resp = self.client.post(
            "/api/sandbox/execute",
            json={"command": "print('hello_sandbox')", "language": "python"},
            headers=self.headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["returncode"] == 0
        assert "hello_sandbox" in data["stdout"]
        assert not data["timed_out"]

    def test_execute_bash_pip_list(self) -> None:
        resp = self.client.post(
            "/api/sandbox/execute",
            json={"command": "pip list", "language": "bash"},
            headers=self.headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["returncode"] == 0
        assert len(data["stdout"]) > 0

    def test_secrets_expunged_from_child_env(self) -> None:
        resp = self.client.post(
            "/api/sandbox/execute",
            json={
                "command": "python3 -c \"import os; print(os.environ.get('OPENJARVIS_API_KEY'))\"",
                "language": "bash",
            },
            headers=self.headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert self.api_key not in data["stdout"]
        assert data["stdout"].strip() == "None"
