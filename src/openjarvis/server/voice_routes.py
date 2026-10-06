"""Voice API routes for speech-to-text (STT) and text-to-speech (TTS)."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from openjarvis.server.sandbox_routes import verify_bearer_auth
from openjarvis.speech.stt_whisper import WhisperSTT
from openjarvis.speech.tts_piper import PiperTTS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])

# Module-level singletons (initialized with lazy loading)
_stt_engine: Optional[WhisperSTT] = None
_tts_engine: Optional[PiperTTS] = None


def get_stt_engine() -> WhisperSTT:
    """Get or initialize WhisperSTT engine."""
    global _stt_engine
    if _stt_engine is None:
        _stt_engine = WhisperSTT()
    return _stt_engine


def get_tts_engine() -> PiperTTS:
    """Get or initialize PiperTTS engine."""
    global _tts_engine
    if _tts_engine is None:
        _tts_engine = PiperTTS()
    return _tts_engine


class STTResponse(BaseModel):
    """Response model for speech-to-text transcription."""

    text: str
    language: str
    duration_seconds: float


class TTSRequest(BaseModel):
    """Request model for text-to-speech synthesis."""

    text: str = Field(..., description="Text to synthesize")
    voice: Optional[str] = Field("pt_BR-faber-medium", description="Piper voice identifier")
    speed: Optional[float] = Field(1.0, ge=0.5, le=2.0, description="Speech speed rate")
    stream: bool = Field(False, description="Whether to stream WAV audio chunks")


@router.post("/stt", response_model=STTResponse)
async def transcribe_audio(
    request: Request,
    file: UploadFile = File(...),
    language: Optional[str] = Form("pt"),
    _: None = Depends(verify_bearer_auth),
) -> STTResponse:
    """Transcribe multipart audio file to text using faster-whisper."""
    if not file:
        raise HTTPException(status_code=400, detail="Audio file is required")

    try:
        audio_bytes = await file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio file provided")

        stt = get_stt_engine()
        result = stt.transcribe(
            audio_bytes=audio_bytes,
            filename_hint=file.filename or "audio.wav",
            language=language or "pt",
        )

        return STTResponse(
            text=result.text,
            language=result.language,
            duration_seconds=result.duration_seconds,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("STT transcription failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}")


@router.post("/tts")
async def synthesize_speech(
    req: TTSRequest,
    request: Request,
    _: None = Depends(verify_bearer_auth),
):
    """Synthesize text into WAV audio or stream audio chunks using Piper TTS."""
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Text for synthesis cannot be empty")

    try:
        tts = get_tts_engine()

        if req.stream:
            stream_gen = tts.synthesize_stream(
                text=req.text,
                voice=req.voice,
            )
            return StreamingResponse(
                stream_gen,
                media_type="audio/wav",
                headers={
                    "Content-Disposition": 'inline; filename="speech.wav"',
                },
            )

        result = tts.synthesize(
            text=req.text,
            voice=req.voice,
            speed=req.speed or 1.0,
        )

        return Response(
            content=result.audio_bytes,
            media_type="audio/wav",
            headers={
                "Content-Disposition": 'inline; filename="speech.wav"',
            },
        )
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as exc:
        logger.error("TTS synthesis failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Speech synthesis failed: {exc}")


__all__ = ["router", "STTResponse", "TTSRequest"]
