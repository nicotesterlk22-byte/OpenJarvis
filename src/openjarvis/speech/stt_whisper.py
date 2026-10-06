"""Whisper speech-to-text implementation using faster-whisper.

Provides WhisperSTT with lazy loading and default pt-BR support.
"""

from __future__ import annotations

import logging
import os
import tempfile
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

try:
    from faster_whisper import WhisperModel
except ImportError:
    WhisperModel = None  # type: ignore[assignment, misc]


@dataclass
class STTResult:
    """Result of speech-to-text transcription."""

    text: str
    language: str = "pt"
    confidence: Optional[float] = None
    duration_seconds: float = 0.0
    segments: List[Dict[str, Any]] = field(default_factory=list)


class WhisperSTT:
    """Speech-to-text transcriber using faster-whisper with lazy loading."""

    def __init__(
        self,
        model_size: str = "small",
        device: str = "auto",
        compute_type: str = "default",
        default_language: str = "pt",
    ) -> None:
        self.model_size = os.environ.get("WHISPER_MODEL_SIZE", model_size)
        self.device = os.environ.get("WHISPER_DEVICE", device)
        self.compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", compute_type)
        self.default_language = os.environ.get("WHISPER_LANGUAGE", default_language)
        self._model: Optional[Any] = None
        self._last_error: Optional[str] = None

    def _ensure_model(self) -> Any:
        """Lazy-load the WhisperModel on first transcription request."""
        if self._model is None:
            if WhisperModel is None:
                err_msg = (
                    "faster-whisper is not installed. "
                    "Install with: pip install faster-whisper or uv sync --extra inference-voice"
                )
                self._last_error = err_msg
                raise ImportError(err_msg)
            try:
                logger.info(
                    "Lazy loading faster-whisper model (size=%s, device=%s)",
                    self.model_size,
                    self.device,
                )
                self._model = WhisperModel(
                    self.model_size,
                    device=self.device,
                    compute_type=self.compute_type,
                )
            except Exception as exc:
                self._last_error = str(exc)
                logger.error("Failed to load faster-whisper model: %s", exc)
                raise
        return self._model

    def transcribe(
        self,
        audio_bytes: bytes,
        filename_hint: str = "audio.wav",
        language: Optional[str] = None,
    ) -> STTResult:
        """Transcribe audio bytes to text."""
        if not audio_bytes:
            return STTResult(text="", language=language or self.default_language)

        model = self._ensure_model()
        lang = language or self.default_language

        ext = os.path.splitext(filename_hint)[1] or ".wav"
        if not ext.startswith("."):
            ext = f".{ext}"

        tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
        try:
            with tmp:
                tmp.write(audio_bytes)

            kwargs: Dict[str, Any] = {}
            if lang:
                kwargs["language"] = lang

            segments_iter, info = model.transcribe(tmp.name, **kwargs)
            segments_list = list(segments_iter)

            text = "".join(seg.text for seg in segments_list).strip()
            segments = [
                {
                    "text": seg.text.strip(),
                    "start": getattr(seg, "start", 0.0),
                    "end": getattr(seg, "end", 0.0),
                }
                for seg in segments_list
            ]

            return STTResult(
                text=text,
                language=getattr(info, "language", lang or "pt"),
                confidence=getattr(info, "language_probability", None),
                duration_seconds=getattr(info, "duration", 0.0),
                segments=segments,
            )
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass


__all__ = ["WhisperSTT", "STTResult"]
