import type { Insight } from './types';

export function buildInsightPrompt(insight: Insight): string {
  const lines: string[] = [];
  lines.push(`I'm running a Qdrant vector database cluster and my monitoring dashboard flagged this ${insight.level} ${insight.category} issue:`);
  lines.push('');
  lines.push(`**Issue:** ${insight.title}`);

  const scope: string[] = [];
  if (insight.collection) scope.push(`collection \`${insight.collection}\``);
  if (insight.shard !== undefined) scope.push(`shard \`${insight.shard}\``);
  if (insight.node) scope.push(`node \`${insight.node}\``);
  if (scope.length) lines.push(`**Scope:** ${scope.join(', ')}`);

  lines.push('');
  lines.push(`**Details:** ${insight.detail}`);
  lines.push('');
  lines.push('Please explain what this means in Qdrant terms, why it may be happening, and suggest concrete next steps I can take to investigate and resolve it. If relevant, mention any configuration parameters, REST API endpoints, or operational practices I should check.');
  return lines.join('\n');
}

export interface AIProvider {
  key: 'claude' | 'chatgpt' | 'gemini';
  name: string;
  color: string;
  supportsUrlPrefill: boolean;
  buildUrl: (prompt: string) => string;
}

export const AI_PROVIDERS: AIProvider[] = [
  {
    key: 'claude',
    name: 'Claude',
    color: '#cc785c',
    supportsUrlPrefill: true,
    buildUrl: (p) => `https://claude.ai/new?q=${encodeURIComponent(p)}`,
  },
  {
    key: 'chatgpt',
    name: 'ChatGPT',
    color: '#10a37f',
    supportsUrlPrefill: true,
    buildUrl: (p) => `https://chatgpt.com/?q=${encodeURIComponent(p)}`,
  },
  {
    key: 'gemini',
    name: 'Gemini',
    color: '#4285F4',
    supportsUrlPrefill: false,
    buildUrl: () => 'https://gemini.google.com/app',
  },
];
