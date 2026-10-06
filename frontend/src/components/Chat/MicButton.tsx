import { useState } from 'react';
import { motion } from 'framer-motion';
import type { SpeechState } from '../../hooks/useSpeech';

interface MicButtonProps {
  state: SpeechState;
  onClick: () => void;
  disabled?: boolean;
  reason?: 'not-enabled' | 'no-backend' | 'streaming';
}

export function MicButton({ state, onClick, disabled, reason }: MicButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const tooltipText =
    reason === 'not-enabled'
      ? 'Habilite nas Configurações'
      : reason === 'no-backend'
        ? 'Backend de voz não configurado'
        : reason === 'streaming'
          ? 'Aguarde a resposta'
          : state === 'recording'
            ? 'Parar gravação'
            : state === 'transcribing'
              ? 'Transcrevendo...'
              : 'Entrada por Voz';

  const isInactive = disabled || state === 'transcribing';

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <motion.button
        whileTap={{ scale: isInactive ? 1 : 0.92 }}
        whileHover={{ scale: isInactive ? 1 : 1.05 }}
        onClick={onClick}
        disabled={isInactive}
        className="touch-target p-2.5 rounded-xl transition-all shrink-0 relative overflow-hidden cursor-pointer"
        style={{
          background: state === 'recording'
            ? 'var(--color-error)'
            : 'var(--color-bg-secondary)',
          color: state === 'recording'
            ? 'white'
            : isInactive
              ? 'var(--color-text-tertiary)'
              : 'var(--color-accent)',
          opacity: isInactive ? 0.4 : 1,
        }}
        aria-label={tooltipText}
      >
        {state === 'recording' && (
          <motion.span
            animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-0 rounded-xl bg-[var(--color-error)]"
          />
        )}

        {state === 'transcribing' ? (
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" className="relative z-10 animate-spin">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" className="relative z-10">
            <path d="M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0V3z" />
            <path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5z" />
          </svg>
        )}
      </motion.button>

      {showTooltip && isInactive && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-xl text-[11px] font-medium whitespace-nowrap pointer-events-none z-30 shadow-md bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)]"
        >
          {tooltipText}
        </div>
      )}
    </div>
  );
}
