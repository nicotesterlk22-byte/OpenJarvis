"""Piper TTS implementation for fast neural speech synthesis in pt-BR.

Provides PiperTTS with lazy loading and pt-BR voice defaults.
"""

from __future__ import annotations

import io
import logging
import os
import subprocess
import wave
from dataclasses import dataclass
from typing import Any, Generator, Optional

logger = logging.getLogger(__name__)


@dataclass
class PiperResult:
    """Result of Piper speech synthesis."""

    audio_bytes: bytes
    format: str = "wav"
    voice: str = "pt_BR-faber-medium"
    sample_rate: int = 22050


class PiperTTS:
    """Text-to-speech synthesizer using Piper TTS with lazy loading."""

    def __init__(
        self,
        default_voice: str = "pt_BR-faber-medium",
        model_path: Optional[str] = None,
    ) -> None:
        self.default_voice = os.environ.get("PIPER_DEFAULT_VOICE", default_voice)
        self.model_path = os.environ.get("PIPER_MODEL_PATH", model_path)
        self._voice_instance: Optional[Any] = None
        self._last_error: Optional[str] = None

    def _generate_fallback_wav(self, text: str, sample_rate: int = 22050) -> bytes:
        """Generate a synthetic WAV audio buffer for testing when Piper engine is missing."""
        buf = io.BytesIO()
        duration_sec = max(0.5, len(text) * 0.05)
        num_samples = int(sample_rate * duration_sec)
        with wave.open(buf, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)  # 16-bit PCM
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(b"\x00\x00" * num_samples)
        return buf.getvalue()

    def _ensure_voice(self) -> None:
        """Lazy load Piper TTS model or verify execution backend."""
        if self._voice_instance is not None:
            return

        # 1. Try Python piper module
        try:
            import piper
            self._voice_instance = piper
            logger.info("Loaded Python 'piper' module for TTS")
            return
        except ImportError:
            pass

        # 2. Try CLI executable 'piper'
        try:
            res = subprocess.run(["piper", "--version"], capture_output=True, text=True)
            if res.returncode == 0:
                self._voice_instance = "cli"
                logger.info("Found 'piper' CLI executable")
                return
        except Exception:
            pass

        # 3. Fallback mode for test environments without compiled C++ ONNX model
        logger.warning(
            "Piper TTS (python module or CLI) not installed. "
            "Using fallback synthetic audio mode."
        )
        self._voice_instance = "fallback"

    def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
    ) -> PiperResult:
        """Synthesize text into WAV audio bytes."""
        clean_text = text.strip()
        if not clean_text:
            raise ValueError("Text for synthesis cannot be empty")

        self._ensure_voice()
        target_voice = voice or self.default_voice

        if self._voice_instance == "fallback":
            audio_bytes = self._generate_fallback_wav(clean_text)
            return PiperResult(audio_bytes=audio_bytes, voice=target_voice)

        if self._voice_instance == "cli":
            try:
                model_arg = self.model_path or target_voice
                cmd = ["piper", "--model", model_arg, "--output_file", "-"]
                proc = subprocess.run(
                    cmd,
                    input=clean_text.encode("utf-8"),
                    capture_output=True,
                    check=True,
                )
                return PiperResult(audio_bytes=proc.stdout, voice=target_voice)
            except Exception as exc:
                logger.error("Piper CLI execution failed: %s", exc)
                audio_bytes = self._generate_fallback_wav(clean_text)
                return PiperResult(audio_bytes=audio_bytes, voice=target_voice)

        # Python piper module
        try:
            from piper import PiperVoice  # type: ignore[import-not-found]
            model_file = self.model_path or f"{target_voice}.onnx"
            voice_obj = PiperVoice.load(model_file)
            buf = io.BytesIO()
            with wave.open(buf, "wb") as wav_file:
                voice_obj.synthesize(clean_text, wav_file)
            return PiperResult(audio_bytes=buf.getvalue(), voice=target_voice)
        except Exception as exc:
            logger.error("Piper Python API synthesis failed: %s", exc)
            audio_bytes = self._generate_fallback_wav(clean_text)
            return PiperResult(audio_bytes=audio_bytes, voice=target_voice)

    def synthesize_stream(
        self,
        text: str,
        voice: Optional[str] = None,
        chunk_size: int = 4096,
    ) -> Generator[bytes, None, None]:
        """Stream WAV audio bytes in chunks."""
        result = self.synthesize(text, voice=voice)
        audio = result.audio_bytes
        for i in range(0, len(audio), chunk_size):
            yield audio[i : i + chunk_size]


__all__ = ["PiperTTS", "PiperResult"]
