import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Cpu, X, Download, Loader2, Trash2, Check, Cloud, Key, Sparkles, Terminal } from 'lucide-react';
import { Command } from 'cmdk';
import { useAppStore } from '../lib/store';
import {
  pullModel,
  deleteModel,
  fetchModels,
  preloadModel,
  isTauri,
  getCloudKeyStatus,
  saveCloudKey,
} from '../lib/api';

/** Popular models in catalogue */
const CATALOGUE_MODELS = [
  { id: 'qwen3.5:0.8b', size: '~1 GB', desc: 'Qwen 3.5 0.8B — ultra rápido e leve' },
  { id: 'qwen3.5:2b', size: '~2.7 GB', desc: 'Qwen 3.5 2B' },
  { id: 'qwen3.5:4b', size: '~3.4 GB', desc: 'Qwen 3.5 4B — recomendado' },
  { id: 'qwen3.5:9b', size: '~6.6 GB', desc: 'Qwen 3.5 9B' },
  { id: 'qwen3.5:27b', size: '~17 GB', desc: 'Qwen 3.5 27B' },
  { id: 'llama3.3:latest', size: '~4.9 GB', desc: 'Llama 3.3 8B' },
  { id: 'mistral:latest', size: '~4.1 GB', desc: 'Mistral 7B' },
  { id: 'gemma3:latest', size: '~3.3 GB', desc: 'Gemma 3 4B' },
  { id: 'deepseek-r1:7b', size: '~4.7 GB', desc: 'DeepSeek R1 7B' },
];

interface CloudProvider {
  name: string;
  envKey: string;
  models: Array<{ id: string; desc: string }>;
}

const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-4o', desc: 'GPT-4o — multimodal' },
      { id: 'gpt-4o-mini', desc: 'GPT-4o Mini — rápido e econômico' },
      { id: 'o3-mini', desc: 'o3-mini — raciocínio avançado' },
    ],
  },
  {
    name: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-sonnet-4-6', desc: 'Claude Sonnet 4.6 — equilibrado' },
      { id: 'claude-opus-4-6', desc: 'Claude Opus 4.6 — mais capaz' },
      { id: 'claude-haiku-4-5', desc: 'Claude Haiku 4.5 — ultra rápido' },
    ],
  },
  {
    name: 'Google',
    envKey: 'GEMINI_API_KEY',
    models: [
      { id: 'gemini-2.5-pro', desc: 'Gemini 2.5 Pro — flagship' },
      { id: 'gemini-2.5-flash', desc: 'Gemini 2.5 Flash' },
    ],
  },
  {
    name: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    models: [
      { id: 'openrouter/auto', desc: 'Auto — seleciona o melhor modelo' },
      { id: 'openrouter/anthropic/claude-sonnet-4', desc: 'Claude Sonnet 4 via OpenRouter' },
      { id: 'openrouter/deepseek/deepseek-r1', desc: 'DeepSeek R1 via OpenRouter' },
    ],
  },
];

type Tab = 'installed' | 'catalogue' | 'cloud';

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('installed');
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pullSuccess, setPullSuccess] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState('');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [cloudKeyStatus, setCloudKeyStatus] = useState<Record<string, boolean>>({});
  const [cloudKeyError, setCloudKeyError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const models = useAppStore((s) => s.models);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const setModels = useAppStore((s) => s.setModels);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);

  const installedIds = new Set(models.map((m) => m.id));
  const desktopKeyStorage = isTauri();

  const refreshCloudKeyStatus = useCallback(async () => {
    if (!desktopKeyStorage) {
      setCloudKeyStatus({});
      return;
    }
    try {
      setCloudKeyStatus(await getCloudKeyStatus());
      setCloudKeyError(null);
    } catch (e: any) {
      setCloudKeyError(e?.message || 'Erro ao ler chaves');
    }
  }, [desktopKeyStorage]);

  useEffect(() => {
    void refreshCloudKeyStatus();
  }, [refreshCloudKeyStatus]);

  const handleSelect = async (modelId: string, owner?: string) => {
    const previousModel = selectedModel;
    setSelectedModel(modelId);
    setCommandPaletteOpen(false);

    if (modelId !== previousModel) {
      const { setModelLoading, addLogEntry } = useAppStore.getState();
      setModelLoading(true);
      addLogEntry({ timestamp: Date.now(), level: 'info', category: 'model', message: `Alternando para ${modelId}...` });
      try {
        await preloadModel(modelId, owner);
        addLogEntry({ timestamp: Date.now(), level: 'info', category: 'model', message: `${modelId} carregado` });
      } catch (e: any) {
        addLogEntry({ timestamp: Date.now(), level: 'error', category: 'model', message: `Falha ao carregar ${modelId}: ${e.message}` });
      } finally {
        setModelLoading(false);
      }
    }
  };

  const refreshModels = async () => {
    try {
      const m = await fetchModels();
      setModels(m);
    } catch {}
  };

  const handlePull = async (modelId: string) => {
    setPulling(modelId);
    setPullError(null);
    try {
      await pullModel(modelId);
      setPullSuccess(modelId);
      await refreshModels();
      setSelectedModel(modelId);
    } catch (e: any) {
      setPullError(e.message || 'Falha no download');
    } finally {
      setPulling(null);
    }
  };

  const handleDelete = async (modelId: string) => {
    setDeleting(modelId);
    try {
      await deleteModel(modelId);
      await refreshModels();
      if (selectedModel === modelId) {
        const remaining = models.filter((m) => m.id !== modelId);
        if (remaining.length > 0) setSelectedModel(remaining[0].id);
      }
    } catch {} finally {
      setDeleting(null);
    }
  };

  const handleSaveKey = async (provider: CloudProvider, value: string) => {
    const keyValue = value.trim();
    setSavingKey(provider.envKey);
    setCloudKeyError(null);
    try {
      await saveCloudKey(provider.envKey, keyValue);
      setApiKeys((prev) => ({ ...prev, [provider.envKey]: '' }));
      await refreshCloudKeyStatus();
      await refreshModels();
    } catch (e: any) {
      setCloudKeyError(e?.message || `Falha ao salvar chave do ${provider.name}`);
    } finally {
      setSavingKey(null);
    }
  };

  const filteredInstalled = query
    ? models.filter((m) => m.id.toLowerCase().includes(query.toLowerCase()))
    : models;

  const filteredCatalogue = CATALOGUE_MODELS.filter(
    (m) =>
      !installedIds.has(m.id) &&
      (!query || m.id.toLowerCase().includes(query.toLowerCase()) || m.desc.toLowerCase().includes(query.toLowerCase()))
  );

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-start sm:items-center justify-center pt-12 sm:pt-0 px-3 pb-safe bg-black/60 backdrop-blur-md"
        onClick={() => setCommandPaletteOpen(false)}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="relative w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] flex flex-col max-h-[85vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header & Tabs */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-1 bg-[var(--color-bg-secondary)] p-1 rounded-xl">
              <button
                onClick={() => setTab('installed')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  tab === 'installed'
                    ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                }`}
              >
                Instalados ({models.length})
              </button>
              <button
                onClick={() => setTab('catalogue')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  tab === 'catalogue'
                    ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                }`}
              >
                Baixar
              </button>
              <button
                onClick={() => setTab('cloud')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  tab === 'cloud'
                    ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                }`}
              >
                Nuvem
              </button>
            </div>

            <button
              onClick={() => setCommandPaletteOpen(false)}
              className="p-2 rounded-xl text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Search bar inside cmdk */}
          {tab !== 'cloud' && (
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <Search size={18} className="text-[var(--color-text-tertiary)] shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === 'installed' ? 'Buscar modelos instalados...' : 'Buscar catálogo de modelos...'}
                className="w-full bg-transparent text-sm outline-none text-[var(--color-text)] placeholder-[var(--color-text-tertiary)] font-medium"
                autoFocus
              />
            </div>
          )}

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-2">
            {tab === 'installed' && (
              <div className="flex flex-col gap-1">
                {filteredInstalled.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[var(--color-text-secondary)]">
                    Nenhum modelo encontrado. Baixe um modelo no catálogo!
                  </div>
                ) : (
                  filteredInstalled.map((model) => {
                    const isSelected = selectedModel === model.id;
                    return (
                      <div
                        key={model.id}
                        onClick={() => handleSelect(model.id, model.owned_by)}
                        className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-[var(--color-accent-subtle)] border border-[var(--color-accent)]'
                            : 'hover:bg-[var(--color-bg-secondary)] border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Cpu size={18} className={isSelected ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-tertiary)]'} />
                          <div className="min-w-0">
                            <span className="text-sm font-medium block truncate text-[var(--color-text)]">
                              {model.id}
                            </span>
                            <span className="text-[11px] text-[var(--color-text-secondary)] block">
                              {model.owned_by || 'Ollama Local'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isSelected && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[var(--color-accent)] text-[var(--color-on-accent)]">
                              Ativo
                            </span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(model.id);
                            }}
                            disabled={deleting === model.id}
                            className="p-2 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-error)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                            title="Remover modelo"
                          >
                            {deleting === model.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Trash2 size={16} />
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {tab === 'catalogue' && (
              <div className="flex flex-col gap-1">
                {filteredCatalogue.map((model) => {
                  const isDownloading = pulling === model.id;
                  return (
                    <div
                      key={model.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:border-[var(--color-accent)] transition-all"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--color-text)]">
                            {model.id}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
                            {model.size}
                          </span>
                        </div>
                        <span className="text-xs text-[var(--color-text-secondary)] block truncate">
                          {model.desc}
                        </span>
                      </div>

                      <button
                        onClick={() => handlePull(model.id)}
                        disabled={isDownloading}
                        className="px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:opacity-90 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        {isDownloading ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            <span>Baixando...</span>
                          </>
                        ) : (
                          <>
                            <Download size={14} />
                            <span>Baixar</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === 'cloud' && (
              <div className="flex flex-col gap-3 p-1">
                <p className="text-xs text-[var(--color-text-secondary)] mb-1">
                  Configure suas chaves de API dos provedores de nuvem para usar modelos remotos.
                </p>

                {CLOUD_PROVIDERS.map((provider) => {
                  const hasKey = cloudKeyStatus[provider.envKey];
                  return (
                    <div
                      key={provider.envKey}
                      className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Cloud size={16} className="text-[var(--color-accent)]" />
                          <span className="text-sm font-semibold text-[var(--color-text)]">
                            {provider.name}
                          </span>
                        </div>
                        {hasKey && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-success)]/15 text-[var(--color-success)] border border-[var(--color-success)]/30">
                            Chave Configurada
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          placeholder={hasKey ? '••••••••••••••••' : `Insira a chave ${provider.name}`}
                          value={apiKeys[provider.envKey] || ''}
                          onChange={(e) =>
                            setApiKeys((prev) => ({ ...prev, [provider.envKey]: e.target.value }))
                          }
                          className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-[var(--color-input-bg)] border border-[var(--color-border)] text-[var(--color-text)] outline-none"
                        />
                        <button
                          onClick={() => handleSaveKey(provider, apiKeys[provider.envKey] || '')}
                          disabled={savingKey === provider.envKey}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-accent)] text-[var(--color-on-accent)] cursor-pointer hover:opacity-90 disabled:opacity-50"
                        >
                          {savingKey === provider.envKey ? 'Salvando...' : 'Salvar'}
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1 mt-1">
                        {provider.models.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => handleSelect(m.id, provider.name)}
                            className="px-2 py-1 rounded-md text-[11px] bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-accent-subtle)] transition-colors text-left cursor-pointer"
                          >
                            {m.id}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
