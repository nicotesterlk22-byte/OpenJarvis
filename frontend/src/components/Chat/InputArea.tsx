import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Square, Paperclip, Search, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore, generateId } from '../../lib/store';
import { streamChat, streamResearch } from '../../lib/sse';
import { fetchSavings, getBase } from '../../lib/api';
import { listConnectors, getSyncStatus } from '../../lib/connectors-api';
import { serializeToolCallArguments } from '../../lib/tool-call';
import {
  engineFromCompletionChunk,
  resolveChatEngine,
} from '../../lib/chat-telemetry';
import { MicButton } from './MicButton';
import { useSpeech } from '../../hooks/useSpeech';
import type {
  ChatMessage,
  MessageTelemetry,
  ResearchSearchTrace,
  ResearchSource,
  TokenUsage,
  ToolCallInfo,
} from '../../types';

// While Deep Research is toggled on, poll connected sources for sync
// progress so we can surface "Searching over N items — sync in progress"
// next to the toggle. Polling is gated on `enabled` so toggling DR off
// stops the network chatter immediately.
function useResearchCorpusSync(enabled: boolean): {
  syncing: boolean;
  itemsSynced: number;
} {
  const [state, setState] = useState({ syncing: false, itemsSynced: 0 });

  useEffect(() => {
    if (!enabled) {
      setState({ syncing: false, itemsSynced: 0 });
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const list = await listConnectors();
        const connected = list.filter((c) => c.connected);
        if (connected.length === 0) {
          if (!cancelled) setState({ syncing: false, itemsSynced: 0 });
          return;
        }
        const results = await Promise.all(
          connected.map(async (c) => {
            try {
              return await getSyncStatus(c.connector_id);
            } catch {
              return null;
            }
          }),
        );
        let syncing = false;
        let itemsSynced = 0;
        for (const r of results) {
          if (!r) continue;
          if (r.state === 'syncing') syncing = true;
          itemsSynced += r.items_synced ?? 0;
        }
        if (!cancelled) setState({ syncing, itemsSynced });
      } catch {
        // Network blip — leave previous state intact.
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return state;
}

export function InputArea() {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeId = useAppStore((s) => s.activeId);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const streamState = useAppStore((s) => s.streamState);
  const messages = useAppStore((s) => s.messages);
  const speechEnabled = useAppStore((s) => s.settings.speechEnabled);
  const maxTokens = useAppStore((s) => s.settings.maxTokens);
  const temperature = useAppStore((s) => s.settings.temperature);
  const createConversation = useAppStore((s) => s.createConversation);
  const addMessage = useAppStore((s) => s.addMessage);
  const updateLastAssistant = useAppStore((s) => s.updateLastAssistant);
  const setStreamState = useAppStore((s) => s.setStreamState);
  const resetStream = useAppStore((s) => s.resetStream);
  const modelLoading = useAppStore((s) => s.modelLoading);
  const deepResearch = useAppStore((s) => s.deepResearch);
  const setDeepResearch = useAppStore((s) => s.setDeepResearch);
  const corpusSync = useResearchCorpusSync(deepResearch);
  const isCurrentChatStreaming = streamState.isStreaming && streamState.conversationId === activeId;

  const {
    state: speechState,
    error: speechError,
    available: speechAvailable,
    startRecording,
    stopRecording,
  } = useSpeech();

  // Abort in-flight stream when the user switches models mid-generation.
  // This prevents errors from trying to continue a stream with a stale model.
  const prevModelRef = useRef(selectedModel);
  useEffect(() => {
    if (prevModelRef.current !== selectedModel && streamState.isStreaming) {
      abortRef.current?.abort();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      resetStream();
      abortRef.current = null;
    }
    prevModelRef.current = selectedModel;
  }, [selectedModel, streamState.isStreaming, resetStream]);

  const micDisabled = !speechEnabled || !speechAvailable || streamState.isStreaming;
  const micReason: 'not-enabled' | 'no-backend' | 'streaming' | undefined =
    !speechEnabled ? 'not-enabled'
    : !speechAvailable ? 'no-backend'
    : streamState.isStreaming ? 'streaming'
    : undefined;

  useEffect(() => {
    if (speechError) {
      toast.error(speechError, { duration: 8000 });
    }
  }, [speechError]);

  const handleMicClick = useCallback(async () => {
    if (speechState === 'recording') {
      try {
        const text = await stopRecording();
        if (text) {
          setInput((prev) => (prev ? prev + ' ' + text : text));
        }
      } catch {
        // Error is captured in useSpeech
      }
    } else {
      await startRecording();
    }
  }, [speechState, startRecording, stopRecording]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    resetStream();
  }, [resetStream]);

  const sendMessage = useCallback(async () => {
    const content = input.trim();
    if (!content || streamState.isStreaming) return;
    if (!selectedModel) {
      toast.error('Pick a model first (⌘K)');
      return;
    }

    setInput('');

    let convId = activeId;
    if (!convId) {
      convId = createConversation(selectedModel);
    }

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    addMessage(convId, userMsg);

    // Build API messages before adding assistant placeholder
    const currentMessages = useAppStore.getState().messages;
    const apiMessages = currentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isResearch: deepResearch || undefined,
    };
    addMessage(convId, assistantMsg);

    // Start streaming
    const startTime = Date.now();
    const timer = setInterval(() => {
      setStreamState({ elapsedMs: Date.now() - startTime });
    }, 100);
    timerRef.current = timer;

    const controller = new AbortController();
    abortRef.current = controller;

    let accumulatedContent = '';
    let usage: TokenUsage | undefined;
    let complexity: { score: number; tier: string; suggested_max_tokens: number } | undefined;
    let routedEngine: string | undefined;
    const toolCalls: ToolCallInfo[] = [];
    const researchTraces: ResearchSearchTrace[] = [];
    const researchSourcesByRef = new Map<number, ResearchSource>();
    const flushSources = () =>
      Array.from(researchSourcesByRef.values()).sort((a, b) => a.ref - b.ref);
    let lastFlush = 0;
    let ttftMs: number | undefined;

    setStreamState({
      conversationId: convId,
      isStreaming: true,
      phase: deepResearch ? 'Researching...' : 'Generating...',
      elapsedMs: 0,
      activeToolCalls: [],
      content: '',
    });
    useAppStore.getState().addLogEntry({
      timestamp: Date.now(),
      level: 'info',
      category: 'chat',
      message: deepResearch
        ? `Research: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"`
        : `Request: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}" → ${selectedModel}`,
    });

    try {
      if (deepResearch) {
        for await (const ev of streamResearch(
          content,
          selectedModel,
          controller.signal,
        )) {
          if (ev.type === 'search_call') {
            const trace: ResearchSearchTrace = {
              id: generateId(),
              query: ev.arguments?.query ?? '',
              person: ev.arguments?.person,
              timeRange: ev.arguments?.time_range,
              status: 'pending',
            };
            researchTraces.push(trace);
            setStreamState({ phase: `Searching: ${trace.query}` });
            updateLastAssistant(
              convId,
              accumulatedContent,
              undefined,
              undefined,
              undefined,
              undefined,
              [...researchTraces],
              flushSources(),
            );
            useAppStore.getState().addLogEntry({
              timestamp: Date.now(),
              level: 'info',
              category: 'tool',
              message: `Search: "${trace.query}"${trace.person ? ` (person: ${trace.person})` : ''}`,
            });
          } else if (ev.type === 'search_result') {
            const pending = [...researchTraces].reverse().find((t) => t.status === 'pending');
            if (pending) {
              pending.status = 'complete';
              pending.numHits = ev.num_hits;
              pending.topTitles = ev.top_titles;
            }
            if (ev.sources) {
              for (const src of ev.sources) {
                if (src && typeof src.ref === 'number' && !researchSourcesByRef.has(src.ref)) {
                  researchSourcesByRef.set(src.ref, src);
                }
              }
            }
            updateLastAssistant(
              convId,
              accumulatedContent,
              undefined,
              undefined,
              undefined,
              undefined,
              [...researchTraces],
              flushSources(),
            );
          } else if (ev.type === 'synthesis') {
            if (!ttftMs) ttftMs = Date.now() - startTime;
            accumulatedContent += ev.text;
            setStreamState({ content: accumulatedContent, phase: '' });
            const now = Date.now();
            if (now - lastFlush >= 80) {
              updateLastAssistant(
                convId,
                accumulatedContent,
                undefined,
                undefined,
                undefined,
                undefined,
                [...researchTraces],
                flushSources(),
              );
              lastFlush = now;
            }
          } else if (ev.type === 'system_metrics') {
            // Live GPU sample — feed straight to the System panel so Power
            // (W) and Energy (kJ) tick up in real time as the agent runs.
            useAppStore.getState().setLiveEnergy({
              power_w: ev.power_w,
              energy_j: ev.energy_j,
              duration_s: ev.duration_s,
            });
          } else if (ev.type === 'error') {
            const msg = ev.message || 'Research failed (no detail provided)';
            accumulatedContent = accumulatedContent
              ? `${accumulatedContent}\n\n**Research stopped:** ${msg}`
              : `**Research failed:** ${msg}`;
            setStreamState({ content: accumulatedContent, phase: '' });
            useAppStore.getState().addLogEntry({
              timestamp: Date.now(),
              level: 'error',
              category: 'chat',
              message: `Deep Research error: ${msg}`,
            });
            toast.error(msg, { duration: 8000 });
          } else if (ev.type === 'done') {
            if (ev.usage) {
              usage = {
                prompt_tokens: ev.usage.prompt_tokens ?? 0,
                completion_tokens: ev.usage.completion_tokens ?? 0,
                total_tokens:
                  ev.usage.total_tokens ??
                  (ev.usage.prompt_tokens ?? 0) +
                    (ev.usage.completion_tokens ?? 0),
              };
              useAppStore.getState().incrementSavings(usage);
            }
            window.setTimeout(() => {
              useAppStore.getState().setLiveEnergy(null);
            }, 1500);
            break;
          }
        }
      } else {
        for await (const sseEvent of streamChat(
          { model: selectedModel, messages: apiMessages, stream: true, temperature, max_tokens: maxTokens },
          controller.signal,
        )) {
          const eventName = sseEvent.event;

          if (eventName === 'agent_turn_start') {
            setStreamState({ phase: 'Agent thinking...' });
          } else if (eventName === 'inference_start') {
            setStreamState({ phase: 'Generating...' });
            useAppStore.getState().addLogEntry({
              timestamp: Date.now(), level: 'info', category: 'chat',
              message: `Generating with ${selectedModel}...`,
            });
          } else if (eventName === 'tool_call_start') {
            try {
              const data = JSON.parse(sseEvent.data);
              const tc: ToolCallInfo = {
                id: generateId(),
                tool: data.tool,
                arguments: serializeToolCallArguments(data.arguments),
                status: 'running',
              };
              toolCalls.push(tc);
              setStreamState({
                phase: `Calling ${data.tool}...`,
                activeToolCalls: [...toolCalls],
              });
              updateLastAssistant(convId, accumulatedContent, [...toolCalls]);
              useAppStore.getState().addLogEntry({
                timestamp: Date.now(), level: 'info', category: 'tool',
                message: `Calling ${data.tool}(${serializeToolCallArguments(data.arguments)})`,
              });
            } catch {}
          } else if (eventName === 'tool_call_end') {
            try {
              const data = JSON.parse(sseEvent.data);
              const tc = toolCalls.find(
                (t) => t.tool === data.tool && t.status === 'running',
              );
              if (tc) {
                tc.status = data.success ? 'success' : 'error';
                tc.latency = data.latency;
                tc.result = data.result;
                setStreamState({ activeToolCalls: [...toolCalls] });
                updateLastAssistant(convId, accumulatedContent, [...toolCalls]);
                useAppStore.getState().addLogEntry({
                  timestamp: Date.now(), level: 'info', category: 'tool',
                  message: `${data.tool} -> ${data.success ? 'ok' : 'error'} (${data.latency ?? 0}ms)`,
                });
              }
            } catch {}
          } else if (eventName === 'delta' || !eventName) {
            try {
              const data = JSON.parse(sseEvent.data);
              const delta = data.choices?.[0]?.delta?.content || data.content || '';
              if (delta) {
                if (!ttftMs) ttftMs = Date.now() - startTime;
                accumulatedContent += delta;
                setStreamState({ content: accumulatedContent, phase: '' });

                const now = Date.now();
                if (now - lastFlush >= 80) {
                  updateLastAssistant(
                    convId,
                    accumulatedContent,
                    toolCalls.length > 0 ? [...toolCalls] : undefined,
                  );
                  lastFlush = now;
                }
              }
              const engine = engineFromCompletionChunk(data);
              if (engine) routedEngine = engine;

              if (data.usage) {
                usage = {
                  prompt_tokens: data.usage.prompt_tokens ?? 0,
                  completion_tokens: data.usage.completion_tokens ?? 0,
                  total_tokens: data.usage.total_tokens ?? 0,
                };
              }
              if (data.complexity) {
                complexity = data.complexity;
              }
            } catch {
              if (sseEvent.data && sseEvent.data !== '[DONE]') {
                if (!ttftMs) ttftMs = Date.now() - startTime;
                accumulatedContent += sseEvent.data;
                setStreamState({ content: accumulatedContent });
              }
            }
          }
        }
      }

      const totalMs = Date.now() - startTime;
      const teleEngine = routedEngine ?? resolveChatEngine({ selectedModel });
      const telemetry: MessageTelemetry = {
        ttft_ms: ttftMs,
        total_ms: totalMs,
        engine: teleEngine,
        complexity_score: complexity?.score,
        complexity_tier: complexity?.tier,
      };

      updateLastAssistant(
        convId,
        accumulatedContent,
        toolCalls.length > 0 ? [...toolCalls] : undefined,
        usage,
        telemetry,
        undefined,
        researchTraces.length > 0 ? [...researchTraces] : undefined,
        flushSources(),
      );

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      resetStream();
      useAppStore.getState().addLogEntry({
        timestamp: Date.now(), level: 'info', category: 'chat',
        message: `Response: ${accumulatedContent.length} chars`,
      });
      abortRef.current = null;

      if (!deepResearch) {
        fetchSavings()
          .then((data) => useAppStore.getState().setSavings(data))
          .catch(() => {});
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        const errorContent = accumulatedContent
          ? `${accumulatedContent}\n\n*[Stream error: ${e.message || 'Connection lost'}]*`
          : `*[Failed to connect to backend at ${getBase()}]*`;
        updateLastAssistant(convId, errorContent);
        useAppStore.getState().addLogEntry({
          timestamp: Date.now(), level: 'error', category: 'chat',
          message: `Stream error: ${e.message}`,
        });
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      resetStream();
      abortRef.current = null;
    }
  }, [
    input,
    activeId,
    selectedModel,
    streamState.isStreaming,
    createConversation,
    addMessage,
    updateLastAssistant,
    setStreamState,
    resetStream,
    deepResearch,
    temperature,
    maxTokens,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="px-3 sm:px-4 pb-3 pt-2 w-full max-w-[var(--chat-max-width)] mx-auto relative z-20">
      <div className="mb-2 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={() => setDeepResearch(!deepResearch)}
            disabled={streamState.isStreaming}
            aria-pressed={deepResearch}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer disabled:cursor-default disabled:opacity-50 touch-target"
            style={{
              background: deepResearch ? 'var(--color-accent-subtle)' : 'var(--color-bg-secondary)',
              border: `1px solid ${deepResearch ? 'var(--color-accent)' : 'var(--color-border)'}`,
              color: deepResearch ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            }}
            title={deepResearch ? 'Deep Research: ativo' : 'Deep Research: desligado'}
          >
            <Sparkles size={14} className={deepResearch ? 'text-[var(--color-accent)] animate-pulse' : ''} />
            <span>Deep Research</span>
          </motion.button>
        </div>
        {deepResearch && corpusSync.syncing && corpusSync.itemsSynced > 0 && (
          <div
            className="text-[11px] leading-snug px-1 text-[var(--color-text-tertiary)]"
          >
            Sincronizando{' '}
            <span key={corpusSync.itemsSynced} className="font-semibold text-[var(--color-text-secondary)]">
              {corpusSync.itemsSynced.toLocaleString()}
            </span>{' '}
            itens de dados em segundo plano.
          </div>
        )}
      </div>

      <div
        className="flex items-center gap-2 rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 transition-all border border-[var(--color-border)] bg-[var(--color-input-bg)] shadow-md focus-within:border-[var(--color-accent)]"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={selectedModel ? 'Pergunte ao Jarvis...' : 'Selecione um modelo (⌘K)...'}
          rows={1}
          className="flex-1 bg-transparent outline-none resize-none text-sm sm:text-base leading-relaxed text-[var(--color-text)] placeholder-[var(--color-text-tertiary)]"
          style={{ maxHeight: '180px' }}
          disabled={streamState.isStreaming || modelLoading}
        />
        {isCurrentChatStreaming ? (
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={stopStreaming}
            className="touch-target p-2.5 rounded-xl transition-colors shrink-0 cursor-pointer bg-[var(--color-error)] text-[var(--color-on-accent)]"
            title="Parar geração"
          >
            <Square size={16} />
          </motion.button>
        ) : (
          <div className="flex items-center gap-1.5">
            <MicButton
              state={speechState}
              onClick={handleMicClick}
              disabled={micDisabled}
              reason={micReason}
            />
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={sendMessage}
              disabled={streamState.isStreaming || !input.trim() || modelLoading || !selectedModel}
              title={selectedModel ? 'Enviar mensagem' : 'Selecione um modelo primeiro (⌘K)'}
              className="touch-target p-2.5 rounded-xl transition-all shrink-0 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: input.trim() ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                color: input.trim() ? 'var(--color-on-accent)' : 'var(--color-text-tertiary)',
              }}
            >
              <Send size={16} />
            </motion.button>
          </div>
        )}
      </div>
    </div>
  );
}
