import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  Plus,
  BarChart3,
  Settings,
  Search,
  PanelLeftClose,
  PanelLeft,
  Cpu,
  Rocket,
  Bot,
  Sun,
  Moon,
  Monitor,
  Loader2,
  ScrollText,
  Database,
} from 'lucide-react';
import { ConversationList } from './ConversationList';
import { useAppStore } from '../../lib/store';

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState('');

  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const createConversation = useAppStore((s) => s.createConversation);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const serverInfo = useAppStore((s) => s.serverInfo);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const modelLoading = useAppStore((s) => s.modelLoading);
  const deepResearch = useAppStore((s) => s.deepResearch);

  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const ThemeIcon = settings.theme === 'light' ? Sun : settings.theme === 'dark' ? Moon : Monitor;
  const nextTheme = settings.theme === 'light' ? 'dark' : settings.theme === 'dark' ? 'system' : 'light';

  const messages = useAppStore((s) => s.messages);
  const handleNewChat = () => {
    if (messages.length === 0) {
      navigate('/');
      return;
    }
    createConversation(selectedModel);
    navigate('/');
    if (window.innerWidth < 768) {
      useAppStore.getState().setSidebarOpen(false);
    }
  };

  const navItems = [
    { path: '/', icon: MessageSquare, label: 'Conversa (Chat)' },
    { path: '/data-sources', icon: Database, label: 'Fontes de Dados' },
    { path: '/agents', icon: Bot, label: 'Agentes de IA' },
    { path: '/dashboard', icon: BarChart3, label: 'Painel & Métricas' },
    { path: '/logs', icon: ScrollText, label: 'Logs do Sistema' },
    { path: '/settings', icon: Settings, label: 'Configurações' },
    { path: '/get-started', icon: Rocket, label: 'Guia do Jarvis' },
  ];

  return (
    <>
      {/* Desktop collapse button when sidebar is hidden */}
      {!sidebarOpen && (
        <button
          onClick={toggleSidebar}
          className="hidden md:flex fixed top-3 left-3 z-30 p-2.5 rounded-xl transition-all hover:scale-105 cursor-pointer border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-sm"
          style={{ color: 'var(--color-text-secondary)' }}
          title="Expandir menu lateral"
        >
          <PanelLeft size={18} />
        </button>
      )}

      <aside
        className={`
          flex flex-col h-full shrink-0 transition-all duration-200 ease-out overflow-hidden
          fixed md:relative z-30
          ${sidebarOpen ? 'w-[280px]' : 'w-0'}
        `}
        style={{
          background: 'var(--color-sidebar)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRight: sidebarOpen ? '1px solid var(--color-border)' : 'none',
        }}
      >
        <div className="flex flex-col h-full w-[280px] pt-safe pb-safe">
          {/* Header */}
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <button
              onClick={toggleSidebar}
              className="touch-target p-2 rounded-xl transition-colors cursor-pointer text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
            >
              <PanelLeftClose size={20} />
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => updateSettings({ theme: nextTheme })}
                className="touch-target p-2 rounded-xl transition-colors cursor-pointer text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
                title={`Tema: ${settings.theme} (clique para ${nextTheme})`}
              >
                <ThemeIcon size={18} />
              </button>
              <button
                onClick={handleNewChat}
                className="touch-target p-2 rounded-xl transition-colors cursor-pointer text-[var(--color-accent)] bg-[var(--color-accent-subtle)] hover:opacity-90"
                title="Nova conversa"
              >
                <Plus size={20} />
              </button>
            </div>
          </div>

          {/* Model selector badge */}
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setCommandPaletteOpen(true)}
            className="mx-3 mb-3 flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs transition-colors cursor-pointer border border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:border-[var(--color-accent)]"
          >
            {modelLoading ? (
              <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
            ) : (
              <Cpu size={16} className="text-[var(--color-accent)]" />
            )}
            <div className="flex-1 min-w-0">
              <span
                className="truncate block text-left font-medium"
                style={{ color: deepResearch ? 'var(--color-accent)' : 'var(--color-text)' }}
              >
                {deepResearch
                  ? 'Deep Research'
                  : selectedModel || serverInfo?.model || 'Selecionar modelo'}
              </span>
              {modelLoading && (
                <span className="text-[10px] block text-left text-[var(--color-accent)]">
                  Carregando modelo...
                </span>
              )}
            </div>
            {!modelLoading && (
              <kbd
                className="text-[10px] px-1.5 py-0.5 rounded-md font-mono bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]"
              >
                ⌘K
              </kbd>
            )}
          </motion.button>

          {/* Search box */}
          <div className="px-3 mb-2">
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
            >
              <Search size={16} className="text-[var(--color-text-tertiary)]" />
              <input
                type="text"
                placeholder="Buscar conversas..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm text-[var(--color-text)] placeholder-[var(--color-text-tertiary)]"
              />
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto px-2 my-1">
            <ConversationList searchQuery={searchQuery} />
          </div>

          {/* Bottom nav menu */}
          <nav className="px-2 pb-3 pt-2 flex flex-col gap-1 border-t border-[var(--color-border)]">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => {
                    navigate(item.path);
                    if (window.innerWidth < 768) {
                      useAppStore.getState().setSidebarOpen(false);
                    }
                  }}
                  className="relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all w-full text-left cursor-pointer touch-target"
                  style={{
                    background: isActive ? 'var(--color-accent-subtle)' : 'transparent',
                    color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)',
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {isActive && (
                    <motion.span
                      layoutId="sidebarActiveBar"
                      className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-[var(--color-accent)]"
                    />
                  )}
                  <item.icon
                    size={18}
                    style={{ color: isActive ? 'var(--color-accent)' : 'inherit' }}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>
    </>
  );
}
