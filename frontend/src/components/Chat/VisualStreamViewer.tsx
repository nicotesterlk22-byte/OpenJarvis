import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Tv,
  Globe,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  Maximize2,
  Minimize2,
  X,
  Radio,
  Send,
  AlertCircle,
  Eye,
} from 'lucide-react';
import { getApiKey, getBase } from '../../lib/api';

export interface VisualStreamViewerProps {
  sessionId?: string;
  initialUrl?: string;
  onClose?: () => void;
  className?: string;
}

interface FramePayload {
  type: string;
  session_id?: string;
  url?: string;
  title?: string;
  frame?: string;
  timestamp?: number;
  message?: string;
}

const WS_AUTH_PROTOCOL = 'openjarvis.auth.v1';
const WS_KEY_PROTOCOL_PREFIX = 'openjarvis.key.b64url.';

function utf8ToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildWsProtocols(): string[] | undefined {
  const apiKey = getApiKey();
  return apiKey
    ? [
        WS_AUTH_PROTOCOL,
        `${WS_KEY_PROTOCOL_PREFIX}${utf8ToBase64Url(apiKey)}`,
      ]
    : undefined;
}

export function VisualStreamViewer({
  sessionId = 'default',
  initialUrl = '',
  onClose,
  className = '',
}: VisualStreamViewerProps) {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>(initialUrl);
  const [pageTitle, setPageTitle] = useState<string>('');
  const [inputUrl, setInputUrl] = useState<string>(initialUrl);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);

  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const connectWebSocket = useCallback(() => {
    setStatus('connecting');
    setErrorMessage(null);

    const base = getBase();
    let wsUrl: string;
    try {
      const parsed = new URL(`/api/ws/visual/${encodeURIComponent(sessionId)}`, base || window.location.origin);
      parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = parsed.toString();
    } catch {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/api/ws/visual/${encodeURIComponent(sessionId)}`;
    }

    try {
      const protocols = buildWsProtocols();
      const ws = new WebSocket(wsUrl, protocols);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        if (initialUrl) {
          ws.send(JSON.stringify({ action: 'navigate', url: initialUrl }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const payload: FramePayload = JSON.parse(event.data);
          if (payload.type === 'frame' && payload.frame) {
            setCurrentFrame(payload.frame);
            if (payload.url) {
              setCurrentUrl(payload.url);
              setInputUrl(payload.url);
            }
            if (payload.title) {
              setPageTitle(payload.title);
            }
          } else if (payload.type === 'error') {
            setErrorMessage(payload.message || 'Erro na sessão de navegação visual');
          }
        } catch {
          // ignore parsing error
        }
      };

      ws.onerror = () => {
        setStatus('error');
        setErrorMessage('Falha na conexão WebSocket visual');
      };

      ws.onclose = () => {
        setStatus('disconnected');
      };
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message || 'Erro ao conectar');
    }
  }, [sessionId, initialUrl]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  const sendAction = (actionData: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(actionData));
    }
  };

  const handleNavigateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;
    sendAction({ action: 'navigate', url: inputUrl.trim() });
  };

  const handleScroll = (direction: 'up' | 'down') => {
    sendAction({ action: 'scroll', direction });
  };

  const handleRefresh = () => {
    sendAction({ action: 'refresh' });
  };

  return (
    <div
      ref={containerRef}
      className={`flex flex-col rounded-xl overflow-hidden border shadow-lg transition-all duration-200 ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none border-none' : 'w-full max-w-4xl my-2'
      } ${className}`}
      style={{
        background: 'var(--color-bg, #0f172a)',
        borderColor: 'var(--color-border, #334155)',
      }}
    >
      {/* Top Header Bar */}
      <div
        className="flex items-center justify-between px-3 py-2 text-xs border-b gap-2 shrink-0"
        style={{
          background: 'var(--color-bg-secondary, #1e293b)',
          borderColor: 'var(--color-border, #334155)',
          color: 'var(--color-text, #f8fafc)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 font-medium px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700">
            <Tv size={13} className="text-cyan-400" />
            <span className="hidden sm:inline text-[11px] text-cyan-200 uppercase tracking-wider font-semibold">Visual ao Vivo</span>
          </div>

          {/* Status Badge */}
          {status === 'connected' && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 text-[10px] font-semibold tracking-wide">
              <Radio size={10} className="animate-pulse text-red-500 fill-red-500" />
              <span>AO VIVO</span>
            </div>
          )}
          {status === 'connecting' && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-400 border border-amber-800/60 text-[10px]">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
              <span>Conectando...</span>
            </div>
          )}
          {status === 'disconnected' && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 text-[10px]">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              <span>Desconectado</span>
            </div>
          )}
          {status === 'error' && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-950/80 text-rose-400 border border-rose-800/60 text-[10px]">
              <AlertCircle size={10} />
              <span>Erro</span>
            </div>
          )}

          {/* Title or URL */}
          <span className="truncate text-slate-300 font-mono text-[11px] hidden md:inline ml-1" title={pageTitle || currentUrl}>
            {pageTitle ? `${pageTitle} (${currentUrl})` : currentUrl}
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowControls((prev) => !prev)}
            className="p-1.5 rounded-md hover:bg-slate-700 text-slate-300 transition-colors"
            title={showControls ? 'Ocultar barra de endereço' : 'Exibir barra de endereço'}
          >
            <Globe size={14} />
          </button>
          <button
            onClick={connectWebSocket}
            className="p-1.5 rounded-md hover:bg-slate-700 text-slate-300 transition-colors"
            title="Reconectar"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="p-1.5 rounded-md hover:bg-slate-700 text-slate-300 transition-colors"
            title={isFullscreen ? 'Sair de Tela Cheia' : 'Tela Cheia'}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-rose-900/60 text-slate-300 hover:text-rose-200 transition-colors"
              title="Fechar"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* URL Navigation Bar */}
      {showControls && (
        <form
          onSubmit={handleNavigateSubmit}
          className="flex items-center gap-1.5 px-3 py-1.5 border-b text-xs"
          style={{
            background: 'var(--color-bg, #0f172a)',
            borderColor: 'var(--color-border, #334155)',
          }}
        >
          <Globe size={14} className="text-slate-400 shrink-0" />
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Digite a URL para navegar (ex: https://example.com)"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1 text-slate-200 placeholder-slate-500 font-mono text-xs focus:outline-none focus:border-cyan-500 transition-colors"
          />
          <button
            type="submit"
            disabled={status !== 'connected'}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium transition-colors text-xs"
          >
            <span>Ir</span>
            <Send size={11} />
          </button>
          <button
            type="button"
            onClick={() => handleScroll('up')}
            disabled={status !== 'connected'}
            className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300"
            title="Rolar pra cima"
          >
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            onClick={() => handleScroll('down')}
            disabled={status !== 'connected'}
            className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300"
            title="Rolar pra baixo"
          >
            <ArrowDown size={13} />
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={status !== 'connected'}
            className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300"
            title="Atualizar página"
          >
            <RefreshCw size={13} />
          </button>
        </form>
      )}

      {/* Error Notification Banner */}
      {errorMessage && (
        <div className="flex items-center gap-2 bg-rose-950/90 text-rose-200 border-b border-rose-800 px-3 py-1.5 text-xs">
          <AlertCircle size={14} className="shrink-0 text-rose-400" />
          <span className="flex-1">{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-rose-100">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Live Frame Screen Container */}
      <div className="relative flex-1 bg-black min-h-[300px] flex items-center justify-center overflow-hidden">
        {currentFrame ? (
          <img
            src={`data:image/jpeg;base64,${currentFrame}`}
            alt="Live Stream View"
            className="w-full h-full object-contain max-h-[75vh]"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-slate-400">
            <div className="p-4 rounded-full bg-slate-900 border border-slate-800">
              <Eye size={32} className="text-cyan-400/80 animate-pulse" />
            </div>
            <div className="text-sm font-medium text-slate-300">
              {status === 'connecting'
                ? 'Conectando ao navegador do agente...'
                : status === 'connected'
                ? 'Aguardando quadro do navegador...'
                : 'Nenhum quadro de visualização disponível'}
            </div>
            <p className="text-xs text-slate-500 max-w-sm">
              O agente transmitirá a tela em tempo real à medida que navegar e interagir com as páginas web.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default VisualStreamViewer;
