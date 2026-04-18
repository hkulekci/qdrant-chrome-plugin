import { useEffect, useState } from 'react';
import type { Insight } from '../lib/types';
import { AI_PROVIDERS, buildInsightPrompt } from '../lib/ai-prompt';
import type { AIProvider } from '../lib/ai-prompt';

interface Props {
  insight: Insight | null;
  onClose: () => void;
}

export function AskAIDialog({ insight, onClose }: Props) {
  const [prompt, setPrompt] = useState('');
  const [copiedFor, setCopiedFor] = useState<string | null>(null);

  useEffect(() => {
    if (insight) {
      setPrompt(buildInsightPrompt(insight));
      setCopiedFor(null);
    }
  }, [insight]);

  useEffect(() => {
    if (!insight) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [insight, onClose]);

  if (!insight) return null;

  const handleSend = async (provider: AIProvider) => {
    if (provider.supportsUrlPrefill) {
      window.open(provider.buildUrl(prompt), '_blank', 'noopener,noreferrer');
      onClose();
    } else {
      try {
        await navigator.clipboard.writeText(prompt);
        setCopiedFor(provider.key);
        setTimeout(() => {
          window.open(provider.buildUrl(prompt), '_blank', 'noopener,noreferrer');
          onClose();
        }, 800);
      } catch {
        window.open(provider.buildUrl(prompt), '_blank', 'noopener,noreferrer');
        onClose();
      }
    }
  };

  const copyOnly = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedFor('clipboard');
      setTimeout(() => setCopiedFor(null), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog ask-ai-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">Ask AI about this insight</h3>
        <div className="dialog-body">
          <div className="ask-ai-insight-summary">
            <span className={`insight-level-tag ${insight.level}`}>{insight.level}</span>
            <span className="ask-ai-insight-title">{insight.title}</span>
          </div>

          <label className="ask-ai-label">
            Prompt <span className="ask-ai-label-hint">(edit before sending)</span>
          </label>
          <textarea
            className="ask-ai-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={10}
            spellCheck={false}
          />

          <div className="ask-ai-privacy">
            <strong>\u2139 Privacy notice:</strong> This prompt will be sent to the AI service you choose. It contains your cluster's issue title, scope (collection/shard/node names), and the detail message — no API keys or raw data.
          </div>

          <div className="ask-ai-providers">
            {AI_PROVIDERS.map((p) => (
              <button
                key={p.key}
                className="ask-ai-provider-btn"
                style={{ borderColor: p.color, color: p.color }}
                onClick={() => handleSend(p)}
                title={p.supportsUrlPrefill ? `Open ${p.name} with this prompt` : `Copy prompt and open ${p.name}`}
              >
                <span className="ask-ai-provider-dot" style={{ background: p.color }} />
                <span>
                  {copiedFor === p.key ? `Copied — opening ${p.name}…` : `Ask ${p.name}`}
                </span>
                {!p.supportsUrlPrefill && copiedFor !== p.key && (
                  <span className="ask-ai-provider-hint">(copy + open)</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={copyOnly}>
            {copiedFor === 'clipboard' ? 'Copied!' : 'Copy prompt'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
