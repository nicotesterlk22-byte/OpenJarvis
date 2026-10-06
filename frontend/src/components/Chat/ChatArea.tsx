import { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { MessageBubble } from './MessageBubble';
import { InputArea } from './InputArea';
import { StreamingDots } from './StreamingDots';
import { VisualStreamViewer } from './VisualStreamViewer';
import { useAppStore } from '../../lib/store';
import { shouldAutoplayFinishedReply, useTtsStore } from '../../lib/tts';
import { stripThinkTags } from '../../lib/message-text';
import { Sparkles, PanelRightOpen, PanelRightClose, Database, MessageSquare, X, Cpu, Search } from 'lucide-react';
import { listConnectors } from '../../lib/connectors-api';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function ChatArea() {
  const activeId = useAppStore((s) => s.activeId);
  const messages = useAppStore((s) => s.messages);
  const streamState = useAppStore((s) => s.streamState);
  const systemPanelOpen = useAppStore((s) => s.systemPanelOpen);
  const toggleSystemPanel = useAppStore((s) => s.toggleSystemPanel);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const wasStreaming = useRef(false);
  const lastScrollTop = useRef(0);
  const isCurrentChatStreaming = streamState.isStreaming && streamState.conversationId === activeId;

  const voiceOutputEnabled = useAppStore((s) => s.settings.voiceOutputEnabled);
  const voiceAutoplay = useAppStore((s) => s.settings.voiceAutoplay);

  useEffect(() => {
    if (!voiceOutputEnabled) return;
    useTtsStore.getState().ensureHealth();
  }, [voiceOutputEnabled]);

  const streamingConversationRef = useRef<string | null>(null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    const tts = useTtsStore.getState();
    const justFinished = shouldAutoplayFinishedReply(
      streamingConversationRef.current,
      activeId,
      streamState.isStreaming,
      last,
      tts.autoSpokenId,
    );
    streamingConversationRef.current = isCurrentChatStreaming ? activeId : null;

    if (!justFinished) return;
    if (!voiceOutputEnabled || !voiceAutoplay) return;
    if (!last || last.role !== 'assistant' || activeId === null) return;

    const completedConversationId = activeId;
    const completedMessageId = last.id;
    void tts.ensureHealth().then(() => {
      const app = useAppStore.getState();
      const currentTts = useTtsStore.getState();
      const currentLast = app.messages[app.messages.length - 1];
      if (app.activeId !== completedConversationId || app.streamState.isStreaming) return;
      if (!app.settings.voiceOutputEnabled || !app.settings.voiceAutoplay) return;
      if (currentLast?.id !== completedMessageId || currentTts.available !== true) return;
      if (currentTts.autoSpokenId === completedMessageId) return;

      const text = stripThinkTags(currentLast.content);
      if (!text) return;
      currentTts.markAutoSpoken(completedMessageId);
      void currentTts.speak(completedMessageId, text);
    });
  }, [activeId, messages, streamState.isStreaming, isCurrentChatStreaming, voiceOutputEnabled, voiceAutoplay]);

  const currentStreamContent = isCurrentChatStreaming ? streamState.content : '';

  const [hasConnectedSources, setHasConnectedSources] = useState<boolean | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    listConnectors()
      .then((list) => setHasConnectedSources(list.some((c) => c.connected)))
      .catch(() => setHasConnectedSources(null));
  }, []);

  useEffect(() => {
    if (isCurrentChatStreaming && !wasStreaming.current) {
      shouldAutoScroll.current = true;
    }
    wasStreaming.current = isCurrentChatStreaming;
    if (shouldAutoScroll.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, currentStreamContent, isCurrentChatStreaming]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const distance = scrollHeight - scrollTop - clientHeight;
    const scrolledUp = scrollTop < lastScrollTop.current;
    lastScrollTop.current = scrollTop;
    if (scrolledUp && distance >= 1) {
      shouldAutoScroll.current = false;
    } else if (!scrolledUp) {
      shouldAutoScroll.current = distance < 2;
    }
  };

  const isEmpty = messages.length === 0 && !isCurrentChatStreaming;
  const PanelIcon = systemPanelOpen ? PanelRightClose : PanelRightOpen;

  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-[var(--color-bg)]">
      {/* Header Bar for System Panel & Active Model Quick Selector */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-sidebar)] backdrop-blur-md">
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:border-[var(--color-accent)] transition-all cursor-pointer"
        >
          <Cpu size={14} className="text-[var(--color-accent)]" />
          <span className="truncate max-w-[160px] text-[var(--color-text)]">
            {selectedModel || 'Selecionar Modelo'}
          </span>
        </button>

        <button
          onClick={toggleSystemPanel}
          className="touch-target p-2 rounded-xl text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer"
          title={`${systemPanelOpen ? 'Ocultar' : 'Exibir'} painel do sistema`}
        >
          <PanelIcon size={18} />
        </button>
      </div>

      {/* Visual Live Stream Viewer */}
      <VisualStreamViewer />

      {/* Data sources recommendation banner */}
      {hasConnectedSources === false && !bannerDismissed && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-3 my-2 flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs shrink-0 border border-[var(--color-border)] bg-[var(--color-accent-subtle)]"
        >
          <Database size={16} className="text-[var(--color-accent)] shrink-0" />
          <span className="text-[var(--color-text-secondary)] flex-1 leading-snug">
            Conecte suas fontes de dados (Gmail, Slack, etc.) para respostas personalizadas.
          </span>
          <button
            onClick={() => navigate('/data-sources')}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--color-accent)] text-[var(--color-on-accent)] cursor-pointer hover:opacity-90 shrink-0"
          >
            Conectar
          </button>
          <button
            onClick={() => setBannerDismissed(true)}
            className="p-1 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] cursor-pointer"
          >
            <X size={14} />
          </button>
        </motion.div>
      )}

      {/* Messages list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 scroll-smooth"
      >
        {isEmpty ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center justify-center h-full max-w-md mx-auto text-center px-4"
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 shadow-lg bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-border)]"
            >
              <Sparkles size={28} />
            </div>
            <h2 className="text-2xl font-bold mb-2 tracking-tight text-[var(--color-text)]">
              {getGreeting()}, Nico
            </h2>
            <p className="text-xs sm:text-sm text-[var(--color-text-secondary)] mb-6 leading-relaxed">
              O Jarvis Inteligente e Privado está pronto. Faça perguntas, analise dados, execute comandos ou navegue ao vivo.
            </p>

            {/* Quick mobile chips */}
            <div className="flex flex-col sm:flex-row gap-2.5 w-full">
              <button
                onClick={() => navigate('/data-sources')}
                className="flex items-center justify-center gap-2 p-3 rounded-xl text-xs font-medium border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)] transition-all cursor-pointer touch-target"
              >
                <Database size={16} className="text-[var(--color-accent)]" />
                <span>Fontes de Dados</span>
              </button>
              <button
                onClick={() => setCommandPaletteOpen(true)}
                className="flex items-center justify-center gap-2 p-3 rounded-xl text-xs font-medium border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)] transition-all cursor-pointer touch-target"
              >
                <Cpu size={16} className="text-[var(--color-accent)]" />
                <span>Trocar Modelo AI</span>
              </button>
            </div>
          </motion.div>
        ) : (
          <div className="max-w-[var(--chat-max-width)] mx-auto py-2">
            {messages.map((msg, i) => {
              const isLastAssistant =
                i === messages.length - 1 && msg.role === 'assistant';
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isLive={isLastAssistant && isCurrentChatStreaming}
                />
              );
            })}
            {(() => {
              if (!isCurrentChatStreaming || streamState.content !== '') return null;
              const last = messages[messages.length - 1];
              if (last?.role === 'assistant' && last.isResearch) return null;
              return (
                <div className="flex justify-start mb-4">
                  <StreamingDots phase={streamState.phase} />
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <InputArea />
    </div>
  );
}
