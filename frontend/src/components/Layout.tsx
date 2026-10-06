import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, BarChart3, Database, Bot, Settings, ScrollText, Plus, PanelLeft } from 'lucide-react';
import { ApprovalBell } from './ApprovalBell';
import { Sidebar } from './Sidebar/Sidebar';
import { SystemPulse } from './SystemPulse';
import { useAppStore } from '../lib/store';
import { checkHealth } from '../lib/api';

export function Layout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const createConversation = useAppStore((s) => s.createConversation);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const messages = useAppStore((s) => s.messages);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const check = () => checkHealth().then(setApiReachable);
    check();
    const interval = setInterval(check, 30000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const handleNewChat = () => {
    if (messages.length > 0) {
      createConversation(selectedModel);
    }
    navigate('/');
  };

  const navItems = [
    { path: '/', icon: MessageSquare, label: 'Chat' },
    { path: '/data-sources', icon: Database, label: 'Fontes' },
    { path: '/agents', icon: Bot, label: 'Agentes' },
    { path: '/dashboard', icon: BarChart3, label: 'Painel' },
    { path: '/logs', icon: ScrollText, label: 'Logs' },
    { path: '/settings', icon: Settings, label: 'Ajustes' },
  ];

  return (
    <div className="flex flex-col h-full w-full overflow-hidden relative pt-safe pb-safe bg-[var(--color-bg)]">
      <div className="hud-backdrop" aria-hidden="true" />
      <SystemPulse apiReachable={apiReachable} />
      <ApprovalBell />

      {/* Mobile Top Safe Area Header for notch & quick sidebar toggle */}
      <div className="md:hidden flex items-center justify-between px-3 py-2 z-20 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-sidebar)] backdrop-blur-md">
        <button
          onClick={toggleSidebar}
          className="touch-target p-2 rounded-lg text-[var(--color-text-secondary)] active:scale-95 transition-transform"
          aria-label="Abrir menu"
        >
          <PanelLeft size={20} />
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wider text-[var(--color-accent)] font-mono">
            JARVIS MÓVEL
          </span>
          {apiReachable === true && (
            <span className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse" />
          )}
        </div>

        <button
          onClick={handleNewChat}
          className="touch-target p-2 rounded-lg text-[var(--color-accent)] bg-[var(--color-accent-subtle)] active:scale-95 transition-transform"
          aria-label="Nova conversa"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Health check banner */}
      <AnimatePresence>
        {apiReachable === false && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex items-center gap-3 px-4 py-2 text-xs shrink-0 z-20"
            style={{
              background: 'color-mix(in srgb, var(--color-error) 12%, transparent)',
              borderBottom: '1px solid color-mix(in srgb, var(--color-error) 20%, transparent)',
              color: 'var(--color-text)',
            }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0 animate-ping"
              style={{ background: 'var(--color-error)' }}
            />
            <span className="font-medium">Sem conexão com o backend OpenJarvis</span>
            <button
              onClick={() => navigate('/settings')}
              className="text-xs underline cursor-pointer ml-auto shrink-0 font-medium"
              style={{ color: 'var(--color-accent)' }}
            >
              Configurar URL
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-1 min-h-0 relative z-10">
        <Sidebar />

        {/* Mobile backdrop with fade transition */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-20 bg-black/60 backdrop-blur-xs md:hidden"
              onClick={() => useAppStore.getState().setSidebarOpen(false)}
            />
          )}
        </AnimatePresence>

        <main className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden bg-transparent">
          <div className="flex-1 flex flex-col min-w-0 min-h-0 relative z-[2]">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="flex-1 flex flex-col min-h-0 h-full"
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden flex items-center justify-around px-1 py-1.5 shrink-0 z-20 border-t border-[var(--color-border)] bg-[var(--color-sidebar)] backdrop-blur-xl">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="relative flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer touch-target min-w-[52px]"
              style={{
                color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              }}
            >
              {isActive && (
                <motion.div
                  layoutId="activeTabGlow"
                  className="absolute inset-0 rounded-xl bg-[var(--color-accent-subtle)]"
                  transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                />
              )}
              <item.icon size={18} className="relative z-10 mb-0.5" />
              <span className="relative z-10 text-[10px] font-medium tracking-tight">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
