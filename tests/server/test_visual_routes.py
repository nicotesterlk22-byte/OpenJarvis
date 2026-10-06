import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openjarvis.server.visual_routes import router as visual_router

app = FastAPI()
app.include_router(visual_router)

client = TestClient(app)

def test_visual_routes_ssrf_validation():
    # POST /api/visual/start with private IP should return 400
    res = client.post("/api/visual/start", json={"session_id": "s1", "url": "http://127.0.0.1"})
    assert res.status_code == 400
    assert "SSRF blocked" in res.json()["detail"]


def test_visual_routes_navigate_ssrf_validation():
    res = client.post("/api/visual/navigate", json={"session_id": "s1", "url": "http://169.254.169.254"})
    assert res.status_code == 400
    assert "SSRF blocked" in res.json()["detail"]


def test_visual_sessions_empty():
    res = client.get("/api/visual/sessions")
    assert res.status_code == 200
    assert isinstance(res.json(), list)
