import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { motion } from 'framer-motion';
import { Copy, Check } from 'lucide-react';
import { AudioPlayer } from './AudioPlayer';
import { ToolCallCard } from './ToolCallCard';
import { ResearchTimeline } from './ResearchTimeline';
import { rehypeCitations } from '../../lib/rehype-citations';
import { XRayFooter } from './XRayFooter';
import { SpeakMessageButton } from './SpeakMessageButton';
import type { ChatMessage } from '../../types';
import { stripThinkTags } from '../../lib/message-text';

interface Props {
  message: ChatMessage;
  isLive?: boolean;
}

function getTextContent(node: any): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(getTextContent).join('');
  }
  if (node?.props?.children) {
    return getTextContent(node.props.children);
  }
  return '';
}

function CodeBlockPre({ children, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const codeElement = Array.isArray(children) ? children[0] : children;
  const className = codeElement?.props?.className || '';
  const match = /language-([\w-]+)/.exec(className);
  const lang = match ? match[1] : '';
  const code = getTextContent(codeElement?.props?.children).replace(/\n$/, '');

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="code-block-wrapper relative my-3 border border-[var(--color-border)] rounded-xl overflow-hidden shadow-xs"
    >
      <div
        className="flex items-center justify-between px-3.5 py-1.5 text-xs bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]"
      >
        <span className="font-mono text-[11px] font-medium">{lang || 'código'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer"
        >
          {copied ? <Check size={12} className="text-[var(--color-success)]" /> : <Copy size={12} />}
          <span>{copied ? 'Copiado' : 'Copiar'}</span>
        </button>
      </div>
      <pre {...props} className="p-3 text-xs overflow-x-auto bg-[var(--color-code-bg)]">
        {children}
      </pre>
    </div>
  );
}

function CopyMessageButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-all cursor-pointer touch-target"
      title="Copiar mensagem"
    >
      {copied ? <Check size={14} className="text-[var(--color-success)]" /> : <Copy size={14} />}
    </button>
  );
}

export function MessageBubble({ message, isLive = false }: Props) {
  const isUser = message.role === 'user';
  const cleanContent = useMemo(() => stripThinkTags(message.content), [message.content]);

  const sourcesMap = useMemo(() => {
    const m = new Map<number, NonNullable<ChatMessage['researchSources']>[number]>();
    for (const s of message.researchSources ?? []) {
      if (typeof s.ref === 'number') m.set(s.ref, s);
    }
    return m;
  }, [message.researchSources]);

  const rehypePlugins = useMemo(() => {
    const base: any[] = [[rehypeHighlight, { detect: true }], rehypeKatex];
    if (sourcesMap.size > 0) base.push([rehypeCitations, { sources: sourcesMap }]);
    return base;
  }, [sourcesMap]);

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="flex justify-end mb-4"
      >
        <div
          className="max-w-[88%] sm:max-w-[80%] px-4 py-3 text-sm leading-relaxed shadow-sm border border-[var(--color-border)]"
          style={{
            background: 'var(--color-user-bubble)',
            color: 'var(--color-user-bubble-text)',
            borderRadius: '1.25rem 1.25rem 0.25rem 1.25rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {message.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="group mb-6 max-w-full"
    >
      {/* Deep Research timeline */}
      {(message.isResearch || (message.researchTraces && message.researchTraces.length > 0)) && (
        <ResearchTimeline
          traces={message.researchTraces ?? []}
          isLive={isLive}
          hasContent={cleanContent.length > 0}
        />
      )}

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {message.toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}

      {/* Audio player */}
      {message.audio?.url && <AudioPlayer src={message.audio.url} />}

      {/* Assistant message */}
      {cleanContent && (
        <div className="prose max-w-none text-sm text-[var(--color-text)]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={rehypePlugins}
            components={{
              pre: CodeBlockPre,
            }}
          >
            {cleanContent}
          </ReactMarkdown>
        </div>
      )}

      {/* Footer controls */}
      <div className="flex items-center gap-2 mt-2">
        <CopyMessageButton content={cleanContent} />
        {!isUser && !isLive && (
          <SpeakMessageButton messageId={message.id} content={cleanContent} />
        )}
      </div>
      <XRayFooter
        usage={message.usage}
        telemetry={message.telemetry}
        isResearch={message.isResearch}
      />
    </motion.div>
  );
}
