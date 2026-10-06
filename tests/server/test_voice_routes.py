"""Tests for voice API routes (STT and TTS endpoints)."""

import os
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openjarvis.server.voice_routes import router as voice_router
from openjarvis.speech.stt_whisper import STTResult, WhisperSTT
from openjarvis.speech.tts_piper import PiperResult, PiperTTS


@pytest.fixture
def app():
    """Create test FastAPI application with voice_router."""
    test_app = FastAPI()
    test_app.include_router(voice_router)
    return test_app


@pytest.fixture
def client(app):
    """Create TestClient instance."""
    return TestClient(app)


def test_auth_required_stt(client):
    """Verify POST /api/voice/stt returns 401 when API key is set but no token provided."""
    with patch.dict(os.environ, {"OPENJARVIS_API_KEY": "secret_key_123"}):
        response = client.post("/api/voice/stt")
        assert response.status_code == 401


def test_auth_required_tts(client):
    """Verify POST /api/voice/tts returns 401 when API key is set but no token provided."""
    with patch.dict(os.environ, {"OPENJARVIS_API_KEY": "secret_key_123"}):
        response = client.post("/api/voice/tts", json={"text": "Olá"})
        assert response.status_code == 401


def test_invalid_bearer_token(client):
    """Verify POST /api/voice/tts returns 401 when token is invalid."""
    with patch.dict(os.environ, {"OPENJARVIS_API_KEY": "secret_key_123"}):
        headers = {"Authorization": "Bearer wrong_token"}
        response = client.post("/api/voice/tts", json={"text": "Olá"}, headers=headers)
        assert response.status_code == 401


def test_post_tts_success(client):
    """Verify POST /api/voice/tts synthesizes text and returns WAV audio."""
    with patch.dict(os.environ, {"OPENJARVIS_API_KEY": "secret_key_123"}):
        headers = {"Authorization": "Bearer secret_key_123"}
        response = client.post(
            "/api/voice/tts",
            json={"text": "Olá, eu sou o Jarvis Móvel", "voice": "pt_BR-faber-medium"},
            headers=headers,
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/wav"
        assert len(response.content) > 0
        # Check WAV header RIFF
        assert response.content[:4] == b"RIFF"


def test_post_tts_streaming(client):
    """Verify POST /api/voice/tts with stream=True returns WAV audio chunks."""
    with patch.dict(os.environ, {"OPENJARVIS_API_KEY": "secret_key_123"}):
        headers = {"Authorization": "Bearer secret_key_123"}
        response = client.post(
            "/api/voice/tts",
            json={"text": "Testando áudio via streaming", "stream": True},
            headers=headers,
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/wav"
        assert len(response.content) > 0


def test_post_tts_empty_text(client):
    """Verify POST /api/voice/tts with empty text returns 400."""
    with patch.dict(os.environ, {"OPENJARVIS_API_KEY": "secret_key_123"}):
        headers = {"Authorization": "Bearer secret_key_123"}
        response = client.post(
            "/api/voice/tts",
            json={"text": "   "},
            headers=headers,
        )
        assert response.status_code == 400


def test_post_stt_transcription(client):
    """Verify POST /api/voice/stt accepts multipart audio and returns transcription JSON."""
    mock_stt = MagicMock(spec=WhisperSTT)
    mock_stt.transcribe.return_value = STTResult(
        text="Olá Jarvis",
        language="pt",
        duration_seconds=1.5,
    )

    with patch.dict(os.environ, {"OPENJARVIS_API_KEY": "secret_key_123"}):
        with patch("openjarvis.server.voice_routes.get_stt_engine", return_value=mock_stt):
            headers = {"Authorization": "Bearer secret_key_123"}
            dummy_wav = b"RIFF" + b"\x00" * 36
            files = {"file": ("test.wav", dummy_wav, "audio/wav")}
            data = {"language": "pt"}

            response = client.post(
                "/api/voice/stt",
                files=files,
                data=data,
                headers=headers,
            )
            assert response.status_code == 200
            json_resp = response.json()
            assert json_resp["text"] == "Olá Jarvis"
            assert json_resp["language"] == "pt"
            assert json_resp["duration_seconds"] == 1.5


def test_whisper_stt_lazy_loading():
    """Test WhisperSTT lazy loading and error when faster-whisper is missing."""
    stt = WhisperSTT(model_size="small")
    assert stt._model is None
    # When faster_whisper module is not installed or mocked as missing
    with patch("openjarvis.speech.stt_whisper.WhisperModel", None):
        with pytest.raises(ImportError) as exc_info:
            stt._ensure_model()
        assert "faster-whisper is not installed" in str(exc_info.value)


def test_piper_tts_fallback_wav():
    """Test PiperTTS synthetic WAV fallback generation when Piper is missing."""
    tts = PiperTTS()
    result = tts.synthesize("Teste de voz")
    assert isinstance(result, PiperResult)
    assert result.voice == "pt_BR-faber-medium"
    assert result.audio_bytes[:4] == b"RIFF"
