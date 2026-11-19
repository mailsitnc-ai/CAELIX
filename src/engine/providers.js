'use strict';

const PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    keyLabel: 'Gemini API key',
    consoleUrl: 'https://aistudio.google.com/apikey',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: [
      'gemini-3-flash-preview',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite-preview',
      'gemini-flash-lite-latest',
      'gemini-4-hydrogen',
      'gemini-3.8-flash',
      'gemini-flash-latest',
      'gemma-4-31b-it',
      'gemma-4-26b-a4b-it',
    ],
    defaultModel: 'gemini-3-flash-preview',
    color: '#4285f4',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    keyLabel: 'OpenRouter API key',
    consoleUrl: 'https://openrouter.ai/keys',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    models: [
      'openrouter/free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'nvidia/nemotron-3.5-super-vl:free',
      'nvidia/nemotron-3.5-lightning:free',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      'cohere/north-mini-code:free',
      'inclusionai/ling-3.2-flash:free',
      'baidu/ernie-5.5-flash-preview:free',
      'particle-ai/particle-1:free',
      'dots-studio/dots-3-note-preview:free',
      'recursive/flint-v1.0:free',
      'google/gemma-4-31b-it:free',
      'google/gemma-4-26b-a4b-it:free',
      'liquid/lfm-3-1.7b:free',
      'anthropic/claude-opus-5.5',
      'anthropic/claude-sonnet-5.5',
      'anthropic/claude-haiku-5.5',
      'anthropic/claude-sonnet-4.6',
      'anthropic/claude-opus-4.6',
    ],
    defaultModel: 'openrouter/free',
    color: '#8b5cf6',
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    keyLabel: 'NVIDIA API key',
    consoleUrl: 'https://build.nvidia.com/',
    baseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    models: [
      'nvidia/nemotron-3.5-lightning-30b-a3b',
      'nvidia/nemotron-3.5-super-vl-120b-a12b',
      'nvidia/nemotron-3-ultra-550b-a55b',
      'poolside/laguna-xs-2.1',
      'mistralai/mistral-large-4-1t-a52b',
      'nvidia/nemotron-3.5-bolt-e4b',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
      'minimaxai/minimax-m3.1-flash',
      'meta/muse-glimmer-30b',
    ],
    defaultModel: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    color: '#76b900',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    keyLabel: 'Groq API key',
    consoleUrl: 'https://console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
      'openai/gpt-oss-120b',
      'allam-2-7b',
    ],
    defaultModel: 'openai/gpt-oss-20b',
    color: '#f55036',
  },
  coarena: {
    id: 'coarena',
    name: 'Coarena',
    keyLabel: 'Coarena API key',
    consoleUrl: 'https://coarena.ai/account/api',
    baseUrl: 'https://coarena.ai/api/v1/chat/completions',
    models: [
      'gpt-6-luna',
      'gemini-3-8-flash',
      'deepseek-v4-1-flash-1017',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-fable-5-2',
      'claude-fable-5-1',
      'claude-fable-5',
    ],
    defaultModel: 'gpt-6-luna',
    color: '#06b6d4',
  },
  kilo: {
    id: 'kilo',
    name: 'Kilo Gateway',
    keyLabel: 'Kilo API key (optional — works without one)',
    consoleUrl: 'https://kilo.ai/models',
    baseUrl: 'https://ai-gateway.kilo.ai/api/v1/chat/completions',
    // Curated free rows verified live on 2026-11-18 (catalog: ai-gateway.kilo.ai,
    // no auth required). All advertise tool calling; the Nemotron rows carry
    // 1M-token windows. The live refresh keeps this list current.
    models: [
      'nvidia/nemotron-3.5-super-vl:free',
      'nvidia/nemotron-3.5-lightning:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'baidu/ernie-5.5-flash-preview:free',
      'particle-ai/particle-1:free',
      'dots-studio/dots-3-note-preview:free',
      'cohere/north-mini-code:free',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      'kilo-auto/free',
    ],
    defaultModel: 'nvidia/nemotron-3.5-super-vl:free',
    // Anonymous access: the gateway serves free models without any key
    // (docs: 200 requests/hour per IP). A saved key is optional and only
    // raises the limits.
    anonymous: true,
    color: '#22d3ee',
  },
  numes: {
    id: 'numes',
    name: 'Numes',
    keyLabel: 'Numes API key',
    consoleUrl: 'https://numes.ai/dashboard/keys',
    baseUrl: 'https://api.numes.ai/api/v1/chat/completions',
    probeUrl: 'https://api.numes.ai/api/v1/key',
    models: [
      'deepseek/deepseek-v4.1-flash:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'z-ai/glm-5.3-flash:free',
      'moonshotai/kimi-k3.1-pro:free',
      'z-ai/glm-5.3:free',
      'dealignai/glm-5.3-flash-uncensored-fp8:free',
      'dealignai/deepseek-v4.1-flash-uncensored-fp8:free',
      'dealignai/glm-5.3-uncensored-fp8:free',
      'uniboshi/kimi-k3-abliterated-v1:free',
      'anthropic/claude-opus-5.5',
      'anthropic/claude-sonnet-5.5',
      'anthropic/claude-haiku-5.5',
      'anthropic/claude-fable-5.2',
    ],
    defaultModel: 'deepseek/deepseek-v4.1-flash:free',
    color: '#22d3ee',
  },
  omniroute: {
    id: 'omniroute',
    name: 'OmniRoute',
    keyLabel: 'OmniRoute gateway key',
    consoleUrl: 'http://localhost:20128/dashboard',
    baseUrl: 'http://localhost:20128/v1/chat/completions',
    // The `auto` family always exists; prefixed IDs (groq/…, nvidia/…) appear
    // once the matching connections are added in the OmniRoute dashboard.
    // Refresh in the model picker pulls the real live list.
    models: [
      'auto',
      'auto/coding',
      'auto/fast',
      'auto/cheap',
      'auto/smart',
    ],
    defaultModel: 'auto',
    color: '#8b5cf6',
  },
  claude: {
    id: 'claude',
    name: 'Claude Code (installed CLI)',
    keyLabel: 'No key stored by CAELIX',
    consoleUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    baseUrl: null,
    models: ['default', 'sonnet', 'opus', 'haiku'],
    defaultModel: 'default',
    keyless: true,
    color: '#d97757',
  },
  simulator: {
    id: 'simulator',
    name: 'CAELIX Simulator',
    keyLabel: 'No key needed',
    consoleUrl: null,
    baseUrl: null,
    models: ['sim-1'],
    defaultModel: 'sim-1',
    keyless: true,
    internal: true,
    color: '#7dbdf5',
  },
};

const MODEL_NOTES = {
  'gemini-3-flash-preview': 'Verified free · Fast tools & reasoning',
  'gemini-3.5-flash-lite': 'Verified free · Fastest RPM/RPD · Tools',
  'gemini-3.1-flash-lite': 'Verified free · Lightweight · Tools',
  'gemini-3.1-flash-lite-preview': 'Verified free · Preview lite · Tools',
  'gemini-flash-lite-latest': 'Verified free · Always latest lite · Tools',
  'gemini-4-hydrogen': 'Verified free · Flagship Gemini 4 Hydrogen · Tools',
  'gemini-3.8-flash': 'Free tier · Fast 3.8 Flash (high-demand peaks)',
  'gemini-flash-latest': 'Free tier · Latest Flash alias',
  'gemma-4-31b-it': 'Free tier · Gemma 4 31B on Google AI Studio',
  'gemma-4-26b-a4b-it': 'Free tier · Gemma 4 26B MoE on Google AI Studio',
  'qwen/qwen3.8-27b': 'Fastest verified · High headroom · Separate Groq bucket',
  'openai/gpt-oss-120b': 'Heavy · Eats free TPM quickly',
  'openai/gpt-oss-20b': 'Fast tool caller · Good free TPM',
  'allam-2-7b': 'Lightweight fallback · Verified live',
  'auto': 'OmniRoute router · Falls back across your connected providers',
  'auto/coding': 'OmniRoute · Coding objective',
  'auto/fast': 'OmniRoute · Speed objective',
  'auto/cheap': 'OmniRoute · Cheapest eligible first',
  'auto/smart': 'OmniRoute · Quality objective',
  'nvidia/nemotron-3.5-lightning-30b-a3b': '40 RPM · Verified live · Lightweight & fast tools',
  'nvidia/nemotron-3.5-super-vl-120b-a12b': '40 RPM · Verified live · Strong coder & tools',
  'nvidia/nemotron-3-ultra-550b-a55b': '40 RPM · Verified live · Largest NIM model & tools',
  'poolside/laguna-xs-2.1': '40 RPM · Verified live · Fast coder & tools',
  'mistralai/mistral-large-4-1t-a52b': '40 RPM · Verified live · Large Mistral & tools',
  'nvidia/nemotron-3.5-bolt-e4b': '40 RPM · Verified live · Ultra-fast tools',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': '40 RPM · Verified live · Compact reasoning',
  'minimaxai/minimax-m3.1-flash': '40 RPM · Free tier · Slower (~22s) · Tools',
  'meta/muse-glimmer-30b': '40 RPM · Free tier · Muse Glimmer 30B',
  'openrouter/free': 'Free router · Verified live · Tools',
  'nvidia/nemotron-3-ultra-550b-a55b:free': 'Free · Verified live · 1M context · Tools',
  'nvidia/nemotron-3.5-super-vl:free': 'Free · Verified live · 1M context · Vision & tools',
  'nvidia/nemotron-3.5-lightning:free': 'Free · Verified live · 1M context · Fast tools',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': 'Free · Verified live · 256k · Fast reasoning',
  'cohere/north-mini-code:free': 'Free · Verified live · 256k coding specialist',
  'inclusionai/ling-3.2-flash:free': 'Free · Verified live · 1M context · Tools',
  'baidu/ernie-5.5-flash-preview:free': 'Free · Verified live · 1M context · Tools',
  'particle-ai/particle-1:free': 'Free · Verified live · 1M context · Tools',
  'dots-studio/dots-3-note-preview:free': 'Free · Verified live · 512k context · Tools',
  'recursive/flint-v1.0:free': 'Free · Verified live · 262k context · Tools',
  'google/gemma-4-31b-it:free': 'Free · Verified live · 262k · Tools',
  'google/gemma-4-26b-a4b-it:free': 'Free · Verified live · 262k · Fast MoE',
  'liquid/lfm-3-1.7b:free': 'Free · Verified live · 262k · Compact tools',
  'anthropic/claude-opus-5.5': 'Claude · Paid credits · Flagship Opus',
  'anthropic/claude-sonnet-5.5': 'Claude · Paid credits · Sonnet 5.5',
  'anthropic/claude-haiku-5.5': 'Claude · Paid credits · Fast Haiku 5.5',
  'anthropic/claude-sonnet-4.6': 'Claude · Paid credits · Sonnet 4.6',
  'anthropic/claude-opus-4.6': 'Claude · Paid credits · Opus 4.6',
  'gpt-6-luna': 'Free tier · Coarena · OpenAI · 128k · Vision & tools',
  'gemini-3-8-flash': 'Free tier · Coarena · Google · 128k · Fast vision & tools',
  'deepseek-v4-1-flash-1017': 'Free tier · Coarena · DeepSeek · 128k · Tools & reasoning',
  'claude-opus-5-5': 'Claude · Coarena credits · 128k · Opus 5.5',
  'claude-sonnet-5-5': 'Claude · Coarena credits · 128k · Sonnet 5.5',
  'claude-haiku-5-5': 'Claude · Coarena credits · 128k · Haiku 5.5',
  'claude-fable-5-2': 'Claude · Coarena credits · 128k · Fable 5.2',
  'claude-fable-5-1': 'Claude · Coarena credits · 128k · Fable 5.1',
  'claude-fable-5': 'Claude · Coarena credits · 128k · Fable 5',
  'deepseek/deepseek-v4.1-flash:free': 'Numes · $0/token free tier · 1M · Tools · Default',
  'nvidia/nemotron-3-ultra-550b-a55b:free': 'Numes · $0/token free tier · 1M · Flagship 550B · Tools',
  'z-ai/glm-5.3-flash:free': 'Numes · $0/token free tier · 1M · Fast GLM Flash · Tools',
  'moonshotai/kimi-k3.1-pro:free': 'Numes · $0/token free tier · 1M · Tools & reasoning',
  'z-ai/glm-5.3:free': 'Numes · $0/token free tier · 262k · Flagship GLM (auto-fails over if slow)',
  'dealignai/deepseek-v4.1-flash-uncensored-fp8:free': 'Numes · $0/token · Uncensored (auto-fails over when offline)',
  'dealignai/glm-5.3-flash-uncensored-fp8:free': 'Numes · $0/token · Uncensored GLM Flash (auto-fails over when offline)',
  'dealignai/glm-5.3-uncensored-fp8:free': 'Numes · $0/token · Uncensored GLM (auto-fails over when offline)',
  'uniboshi/kimi-k3-abliterated-v1:free': 'Numes · $0/token · 1M uncensored Kimi K3 (auto-fails over when offline)',
  'anthropic/claude-fable-5.2': 'Claude · Paid credits · Fable 5.2',
};

const NUMES_LEGACY_FREE_ALIASES = {
  'deepseek/deepseek-v4.1-flash': 'deepseek/deepseek-v4.1-flash:free',
  'z-ai/glm-5.3': 'z-ai/glm-5.3:free',
  'z-ai/glm-5.3-flash': 'z-ai/glm-5.3-flash:free',
  'moonshotai/kimi-k3.1-pro': 'moonshotai/kimi-k3.1-pro:free',
  'nvidia/nemotron-3-ultra-550b-a55b': 'nvidia/nemotron-3-ultra-550b-a55b:free',
  'dealignai/glm-5.3-flash-uncensored-fp8': 'dealignai/glm-5.3-flash-uncensored-fp8:free',
  'dealignai/deepseek-v4.1-flash-uncensored-fp8': 'dealignai/deepseek-v4.1-flash-uncensored-fp8:free',
  'dealignai/glm-5.3-uncensored-fp8': 'dealignai/glm-5.3-uncensored-fp8:free',
  'uniboshi/kimi-k3-abliterated-v1': 'uniboshi/kimi-k3-abliterated-v1:free',
};

function normalizeModelForProvider(providerId, modelId) {
  const id = String(modelId || '');
  if (providerId === 'numes' && NUMES_LEGACY_FREE_ALIASES[id]) {
    return NUMES_LEGACY_FREE_ALIASES[id];
  }
  return id;
}

// Providers whose models carry separate RPM/TPM/RPD quota buckets.
const MODEL_FAILOVER = {
  gemini: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3-flash-preview', 'gemini-4-hydrogen'],
  nvidia: ['nvidia/nemotron-3.5-super-vl-120b-a12b', 'nvidia/nemotron-3-ultra-550b-a55b', 'poolside/laguna-xs-2.1', 'nvidia/nemotron-3.5-lightning-30b-a3b'],
  groq: ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b'],
  openrouter: ['openrouter/free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3.5-super-vl:free', 'nvidia/nemotron-3.5-lightning:free', 'baidu/ernie-5.5-flash-preview:free'],
  coarena: ['gpt-6-luna', 'gemini-3-8-flash', 'deepseek-v4-1-flash-1017'],
  kilo: ['nvidia/nemotron-3.5-super-vl:free', 'nvidia/nemotron-3.5-lightning:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'baidu/ernie-5.5-flash-preview:free', 'kilo-auto/free'],
  numes: ['deepseek/deepseek-v4.1-flash:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'z-ai/glm-5.3-flash:free', 'moonshotai/kimi-k3.1-pro:free'],
};

// Order when spilling over across different providers that have saved keys.
// Kilo sits last: it is always available (anonymous), so it must never shadow
// a provider the user actually saved a key for.
const PROVIDER_SPILLOVER = ['gemini', 'nvidia', 'openrouter', 'numes', 'groq', 'kilo'];
const PROVIDER_HIGH_HEADROOM = {
  gemini: 'gemini-3.5-flash-lite',
  nvidia: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  openrouter: 'openrouter/free',
  numes: 'deepseek/deepseek-v4.1-flash:free',
  groq: 'qwen/qwen3.8-27b',
  kilo: 'nvidia/nemotron-3.5-lightning:free',
};

function providerList(selfcheck) {
  return Object.values(PROVIDERS)
    .filter((provider) => selfcheck || !provider.internal)
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      keyLabel: provider.keyLabel,
      consoleUrl: provider.consoleUrl,
      models: provider.models,
      defaultModel: provider.defaultModel,
      keyless: Boolean(provider.keyless),
      anonymous: Boolean(provider.anonymous),
      color: provider.color,
      modelNotes: MODEL_NOTES,
    }));
}

function normalizeMessages(messages, opts = {}) {
  const stripImages = Boolean(opts.stripImages);
  return messages.map((message) => {
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.input || {}) },
          ...(call.extraContent ? { extra_content: call.extraContent } : {}),
        })),
      };
    }
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === 'user' && Array.isArray(message.attachments) && message.attachments.length) {
      const textBlocks = [String(message.content || '')];
      const images = [];
      for (const item of message.attachments) {
        if (item.kind === 'image' && item.dataUrl) {
          if (stripImages) {
            textBlocks.push(`[Image attachment "${item.name || 'image'}" omitted because the active model is text-only]`);
          } else {
            images.push({ type: 'image_url', image_url: { url: item.dataUrl } });
          }
        } else if (item.text) {
          textBlocks.push(`[Attached file: ${item.name || 'file'}]\n${item.text}`);
        }
      }
      const combined = textBlocks.filter(Boolean).join('\n\n');
      if (images.length) {
        return {
          role: 'user',
          content: [{ type: 'text', text: combined || 'See attached image.' }, ...images],
        };
      }
      return { role: 'user', content: combined };
    }
    return { role: message.role, content: message.content };
  });
}

function stripParamDescriptions(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(stripParamDescriptions);
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'description') continue;
    out[k] = stripParamDescriptions(v);
  }
  return out;
}

function compactText(text, max = 84) {
  const first = String(text || '').split(/\.\s+/)[0].trim();
  if (!first) return '';
  return first.length <= max ? first : `${first.slice(0, max - 1)}…`;
}

function toolSchema(tools, compact = false) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: compact ? compactText(tool.description) : tool.description,
      parameters: compact ? stripParamDescriptions(tool.parameters) : tool.parameters,
    },
  }));
}

function parseRetryAfterMs(response) {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(120_000, Math.round(secs * 1000));
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.min(120_000, Math.max(500, at - Date.now()));
  return null;
}

// Some providers (notably Gemini's OpenAI-compatible endpoint) return the
// error payload as a JSON-encoded string, sometimes nested twice. Unwrap it so
// the readable message is shown instead of escaped JSON like [{\"error\": …}].
function unwrapJson(value, depth = 0) {
  let current = value;
  while (typeof current === 'string' && depth < 3) {
    try {
      const next = JSON.parse(current);
      if (next === null || typeof next !== 'object') break;
      current = next;
      depth += 1;
    } catch {
      break;
    }
  }
  return current;
}

// Turn the most common hard-to-read provider rejections into plain next steps.
function friendlyDetail(provider, status, detail) {
  const text = String(detail || '');
  if (provider === 'omniroute' && status === 401) {
    return 'That is not a valid OmniRoute gateway key. Open the OmniRoute dashboard at http://localhost:20128/dashboard, go to Endpoints, copy the key, and save it here in Keys.';
  }
  if (provider === 'gemini' && status === 403) {
    if (/billing/i.test(text)) {
      return 'Billing is not enabled on the Google project behind this key, so every Gemini model is refused. Free-tier Gemini calls need billing enabled once: open https://console.cloud.google.com/billing, enable it for the project that issued the key, then click Test in Keys. Or switch model or provider.';
    }
    if (/api key not valid|api_key_invalid/i.test(text)) {
      return 'Google rejected the Gemini API key. Check the key at https://aistudio.google.com/apikey or save a new one in Keys.';
    }
  }
  if (provider === 'coarena') {
    if (status === 401) {
      return 'Coarena rejected the API key. Copy or create an active key at https://coarena.ai/account/api and save it here in Keys.';
    }
    if (status === 402) {
      return text || 'This Coarena model requires paid credits. Free accounts can use gpt-6-luna, gemini-3-8-flash, and deepseek-v4-1-flash-1017.';
    }
    if (status === 403) {
      if (/terms/i.test(text)) {
        return 'Coarena requires accepting its Model API terms once at https://coarena.ai/account/api before this key can run models.';
      }
      if (/scope/i.test(text)) {
        return 'This Coarena key is missing the inference:write scope. Generate a key with inference access at https://coarena.ai/account/api.';
      }
    }
    if (status === 429) {
      return `${text ? `${text} — ` : ''}Coarena daily free limit or rate limit reached. Request a higher limit in Coarena or switch models/providers.`;
    }
  }
  if (provider === 'numes') {
    if (status === 401) {
      return 'Numes rejected the API key. Copy or create a key at https://numes.ai/dashboard/keys and save it here in Keys.';
    }
    if (status === 402) {
      return `${text ? `${text} — ` : ''}This Claude or paid Numes model requires credits. Top up at https://numes.ai/dashboard or switch to one of Numes' $0 :free models (deepseek/deepseek-v4.1-flash:free, nvidia/nemotron-3-ultra-550b-a55b:free, z-ai/glm-5.3-flash:free).`;
    }
    if (status === 502 || status === 503) {
      return `${text ? `${text} — ` : ''}No Numes endpoint could serve this model right now. Pick another tool-capable :free model in the list, or Refresh the catalog to see what the key can serve.`;
    }
  }
  return text;
}

function cleanErrorDetail(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/<(html|head|body|title|h1|center)\b/i.test(text)) {
    const plain = text
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return plain.slice(0, 240);
  }
  return text.slice(0, 500);
}

async function readError(response, provider = null) {
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  let detail = cleanErrorDetail(body);
  try {
    let parsed = JSON.parse(body);
    if (typeof parsed === 'string') parsed = unwrapJson(parsed, 1);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    detail = first?.error?.message || first?.message || first?.detail
      || (parsed && typeof parsed === 'object' ? parsed?.detail : '')
      || detail;
  } catch {
    // keep cleaned text body
  }
  if (response.status === 504 && (!detail || /504\s+gateway\s+time-?out/i.test(detail))) {
    detail = 'Upstream gateway timed out (504). The selected provider or model took too long — try again or switch models.';
  }
  if (response.status === 404 && /not found for account/i.test(detail)) {
    detail = `${detail} — Model unavailable or account lacks NIM Public API Endpoints. Initialize your cloud profile at cloudaccounts.nvidia.com, switch models (e.g. nvidia/nemotron-3.5-lightning-30b-a3b), or email help@build.nvidia.com.`;
  }
  detail = friendlyDetail(provider, response.status, detail);
  const err = new Error(`Provider returned ${response.status}${detail ? `: ${detail}` : ''}`);
  err.status = response.status;
  err.retryAfterMs = parseRetryAfterMs(response);
  return err;
}

// Resolve the stall budgets for a provider. Exported so the shipped test suite
// can pin the policy without waiting out real timers.
//
// Three phases, because the faults are different:
//   firstByteMs    nothing has arrived yet — a cold start, a queue, or a model
//                  composing a long tool call entirely before streaming
//   reasoningMs    reasoning has arrived but no answer yet — the model is
//                  demonstrably working, so give it room to finish composing
//   idleMs         answer text or tool-call deltas have started, then stopped —
//                  a short silence here is a real fault
//   hardSilenceMs  absolute ceiling for a keepalive-only connection, so a
//                  request that will never answer cannot sit forever
function resolveTimeouts(provider, options = {}) {
  const explicit = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 0;
  const envPin = Number(process.env.CAELIX_REQUEST_TIMEOUT_MS) > 0
    ? Number(process.env.CAELIX_REQUEST_TIMEOUT_MS)
    : 0;
  const pinned = Boolean(explicit || envPin);
  const slow = provider === 'numes';
  const idleMs = explicit || envPin || (slow ? 60_000 : 45_000);
  const reasoningMs = Number(process.env.CAELIX_REASONING_TIMEOUT_MS)
    || (pinned ? idleMs : (slow ? 150_000 : 120_000));
  const firstByteMs = Number(process.env.CAELIX_FIRST_BYTE_TIMEOUT_MS)
    || (pinned ? idleMs : (slow ? 150_000 : 120_000));
  // A keepalive proves the socket is alive but not that work is happening, so
  // it may extend the wait — bounded, never indefinitely.
  const hardSilenceMs = firstByteMs + Math.min(firstByteMs, 60_000);
  // Absolute ceiling for one request. A model that dribbles a reasoning token
  // every few seconds resets the gap watchdog indefinitely, so gap detection
  // alone cannot bound the wait.
  const totalMs = Number(process.env.CAELIX_MAX_REQUEST_MS)
    || (pinned ? Math.max(idleMs * 20, 10_000) : 20 * 60_000);
  return { idleMs, reasoningMs, firstByteMs, hardSilenceMs, totalMs, pinned };
}

async function streamOpenAICompatible(options) {
  const {
    provider, model, apiKey, messages, tools, signal, onDelta, onStatus,
    compactToolSchemas = true,
    stripImages = false,
    maxTokens = null,
    timeoutMs = null,
  } = options;
  const meta = PROVIDERS[provider];
  if (!meta || !meta.baseUrl) throw new Error(`Unknown provider: ${provider}`);

  // See resolveTimeouts: the pre-output budget has to be generous because a
  // large model may compose an entire tool call before streaming a byte, while
  // silence after answer tokens have started is a real fault. Setting
  // CAELIX_REQUEST_TIMEOUT_MS (or an explicit timeoutMs) pins every phase,
  // which keeps tests deterministic.
  const { idleMs, reasoningMs, firstByteMs, hardSilenceMs, totalMs } = resolveTimeouts(provider, { timeoutMs });

  const headers = {
    'content-type': 'application/json',
  };
  // Anonymous gateways (Kilo free tier) are probed with the placeholder key
  // 'anonymous' — sending a bogus Bearer token could get the request
  // rejected, so no Authorization header goes out for it.
  if (apiKey && apiKey !== 'anonymous') headers.authorization = `Bearer ${apiKey}`;
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://caelix.local';
    headers['X-Title'] = 'CAELIX';
  }

  const body = {
    model: normalizeModelForProvider(provider, model),
    messages: normalizeMessages(messages, { stripImages }),
    stream: true,
    temperature: 0.2,
  };
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    body.max_tokens = Math.round(maxTokens);
  } else if (provider === 'coarena' && maxTokens === null) {
    body.max_tokens = 16384;
  }
  if (tools && tools.length) {
    body.tools = toolSchema(tools, compactToolSchemas);
    body.tool_choice = 'auto';
  }

  const requestAbort = new AbortController();
  let timedOut = false;
  const streamStartAt = Date.now();
  const deadlineAt = streamStartAt + totalMs;
  let sawOutput = false;
  let sawAnswer = false;
  let lastOutputAt = Date.now();
  let stallBudget = firstByteMs;
  let stallTimer = null;
  const resetStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      timedOut = true;
      requestAbort.abort();
      return;
    }
    stallTimer = setTimeout(() => {
      timedOut = true;
      requestAbort.abort();
    }, Math.min(stallBudget, remaining));
  };
  // Real output moves the watchdog to the budget that matches what just
  // arrived: reasoning means the model is still composing, answer tokens mean
  // any further silence is a fault.
  const noteOutput = (phase) => {
    sawOutput = true;
    if (phase === 'answer') sawAnswer = true;
    lastOutputAt = Date.now();
    stallBudget = phase === 'reasoning' ? reasoningMs : idleMs;
    resetStall();
  };
  const onCallerAbort = () => requestAbort.abort();
  if (signal?.aborted) throw new Error('Cancelled.');
  if (signal) signal.addEventListener('abort', onCallerAbort, { once: true });

  let waitNoticeTimer = null;
  let progressTimer = null;
  if (typeof onStatus === 'function') {
    waitNoticeTimer = setTimeout(() => {
      onStatus({ stage: 'waiting', message: `Waiting for ${meta.name} (${model})…` });
    }, 2000);
    // A big model can work for over a minute before it emits anything, and a
    // still window must never look like a frozen app. Report real progress.
    progressTimer = setInterval(() => {
      const silent = Date.now() - lastOutputAt;
      if (silent < 12_000) return;
      onStatus({
        stage: sawAnswer ? 'writing' : 'thinking',
        message: `${sawAnswer ? 'Still writing' : 'Still generating'} — ${Math.round(silent / 1000)}s since the last token…`,
      });
    }, 12_000);
  }
  resetStall();

  try {
    let response;
    try {
      response = await fetch(meta.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: requestAbort.signal,
      });
    } catch (error) {
      if (timedOut) {
        const waited = Math.round((Date.now() - streamStartAt) / 1000);
        const err = new Error(`${meta.name} (${model}) did not respond within ${waited}s. The model may be cold-starting, queued, or unavailable for your key — CAELIX will try another model.`);
        err.status = 408;
        // Mark as a stall, not a dead end: the engine fails over to another
        // model for this turn and reports the switch to the user.
        err.stall = true;
        throw err;
      }
      if (signal?.aborted) throw new Error('Cancelled.');
      throw error;
    }
    if (!response.ok) throw await readError(response, provider);
    if (!response.body) throw new Error('The provider returned no response stream.');

    resetStall();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let reasoningChars = 0;
    let reasoningText = '';
    let lastReasoningNotice = 0;
    const calls = new Map();
    let usage = null;
    let finishReason = null;

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.startsWith(':')) {
        // Keepalive SSE comments mean the socket is open, not that tokens are
        // flowing. Extend the wait a little (a queued request is still alive),
        // but never past hardSilenceMs so a request that will never produce
        // tokens still fails instead of hanging forever.
        if (!sawOutput) {
          const waited = Date.now() - streamStartAt;
          if (waited < hardSilenceMs) {
            resetStall();
            onStatus?.({ stage: 'waiting', message: `Queued on ${meta.name} (${model})… ${Math.round(waited / 1000)}s` });
          }
        }
        return;
      }
      if (!trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }
      if (payload.usage) usage = payload.usage;
      const choice = payload.choices && payload.choices[0];
      const sseErr = payload.error || choice?.error;
      if (sseErr) {
        const statusCode = Number(sseErr.code || sseErr.status) || 502;
        const msg = cleanErrorDetail(sseErr.message || JSON.stringify(sseErr));
        const err = new Error(`Provider returned ${statusCode}${msg ? `: ${friendlyDetail(provider, statusCode, msg)}` : ''}`);
        err.status = statusCode;
        throw err;
      }
      if (!choice) return;
      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
        noteOutput('answer');
      }
      const delta = choice.delta || {};
      const reasoningPiece = typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string' ? delta.reasoning : '';
      if (reasoningPiece) {
        noteOutput('reasoning');
        reasoningChars += reasoningPiece.length;
        if (reasoningText.length < 24_000) reasoningText += reasoningPiece.slice(0, 24_000 - reasoningText.length);
        const now = Date.now();
        if (!text && (now - lastReasoningNotice >= 350 || reasoningChars === reasoningPiece.length)) {
          lastReasoningNotice = now;
          onStatus?.({ stage: 'thinking', reasoningChars, message: `Thinking (${reasoningChars} chars)…` });
        }
      }
      if (typeof delta.content === 'string' && delta.content) {
        noteOutput('answer');
        if (waitNoticeTimer) { clearTimeout(waitNoticeTimer); waitNoticeTimer = null; }
        text += delta.content;
        onDelta(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        noteOutput('answer');
        if (waitNoticeTimer) { clearTimeout(waitNoticeTimer); waitNoticeTimer = null; }
        for (const part of delta.tool_calls) {
          const index = part.index || 0;
          const current = calls.get(index) || { id: '', name: '', arguments: '', extraContent: null };
          if (part.id) current.id = part.id;
          if (part.extra_content) current.extraContent = part.extra_content;
          if (part.function?.name) current.name += part.function.name;
          if (part.function?.arguments) current.arguments += part.function.arguments;
          calls.set(index, current);
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          handleLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
        }
      }
      if (buffer.trim()) handleLine(buffer);
    } catch (error) {
      if (timedOut) {
        const waited = Math.round((Date.now() - streamStartAt) / 1000);
        const exhausted = Date.now() - streamStartAt >= totalMs;
        const err = new Error(exhausted
          ? `${meta.name} (${model}) stalled: gave up after ${waited}s without a finished answer.`
          : sawAnswer
            ? `${meta.name} (${model}) stalled: the answer went silent for ${Math.round(idleMs / 1000)}s.`
            : reasoningChars > 0
              ? `${meta.name} (${model}) stalled: ${reasoningChars} chars of reasoning, then ${waited}s with no answer.`
              : `${meta.name} (${model}) stalled: no output after ${waited}s.`);
        err.status = 408;
        // `stall` tells the engine this is a model/host problem it can route
        // around — never a dead end and never a reason to cool the key down.
        err.stall = true;
        err.elapsedMs = Date.now() - streamStartAt;
        throw err;
      }
      if (signal?.aborted) throw new Error('Cancelled.');
      throw error;
    }

    const toolCalls = [...calls.values()]
      .filter((call) => call.name)
      .map((call) => {
        let input = {};
        try {
          input = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          input = { raw: call.arguments };
        }
        return {
          id: call.id || `call_${Math.random().toString(36).slice(2)}`,
          name: call.name,
          input,
          ...(call.extraContent ? { extraContent: call.extraContent } : {}),
        };
      });

    if (!text.trim() && !toolCalls.length) {
      const reason = finishReason === 'length'
        ? 'hit token limit before outputting an answer or tool call'
        : reasoningChars > 0
          ? `stopped after reasoning (${reasoningChars} chars) without returning an answer or tool call`
          : 'returned an empty response (0 tokens and 0 tool calls)';
      const err = new Error(`${meta.name} (${model}) ${reason}.`);
      err.status = 502;
      err.emptyResponse = true;
      err.finishReason = finishReason;
      err.reasoningText = reasoningText.trim();
      throw err;
    }

    return { text, toolCalls, usage, finishReason };
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    if (waitNoticeTimer) clearTimeout(waitNoticeTimer);
    if (progressTimer) clearInterval(progressTimer);
    if (signal) signal.removeEventListener('abort', onCallerAbort);
  }
}

// Verified-live models first: a key test should land on a model the account
// can actually serve, not on catalog entries that hang or 404.
const NVIDIA_TEST_FALLBACKS = [
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'poolside/laguna-xs-2.1',
  'mistralai/mistral-large-4-1t-a52b',
  'nvidia/nemotron-3.5-bolt-e4b',
];

const GEMINI_TEST_FALLBACKS = [
  'gemini-3-flash-preview',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-4-hydrogen',
];

const OPENROUTER_TEST_FALLBACKS = [
  'openrouter/free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'baidu/ernie-5.5-flash-preview:free',
];

const COARENA_TEST_FALLBACKS = [
  'gpt-6-luna',
  'gemini-3-8-flash',
  'deepseek-v4-1-flash-1017',
];

async function probeModel(meta, provider, apiKey, targetModel) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(meta.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://caelix.local', 'X-Title': 'CAELIX' } : {}),
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [{ role: 'user', content: 'Reply with the single word ready.' }],
        max_tokens: 16,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw await readError(response, provider);
    return { ok: true, model: targetModel };
  } catch (error) {
    if (error.name === 'AbortError') {
      const err = new Error(`${meta.name} (${targetModel}) timed out after 15s during key test.`);
      err.status = 408;
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Fetch errors from a local helper carry an ECONNREFUSED cause chain; raw
// "fetch failed" is useless to a user, so translate it.
function connectionMessage(error, helperName, startHint) {
  let cur = error;
  while (cur) {
    if (cur.code === 'ECONNREFUSED' || cur?.cause?.code === 'ECONNREFUSED') {
      return `${helperName} is not running. ${startHint}`;
    }
    cur = cur.cause;
  }
  return error.message;
}

const OMNIROUTE_START_HINT = 'CAELIX starts it automatically the first time you send a message with an OmniRoute model — or run `npx omniroute` in a terminal. Connect providers once in its dashboard at http://localhost:20128/dashboard.';

async function testKey(provider, apiKey, model = null) {
  const meta = PROVIDERS[provider];
  if (!meta || !meta.baseUrl) throw new Error('This provider does not use a key.');
  // The gateway itself is what a gateway key unlocks: a cheap GET /v1/models
  // proves key and helper without spending any upstream tokens.
  if (provider === 'omniroute') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('http://localhost:20128/v1/models', {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!response.ok) throw await readError(response, provider);
      return { ok: true, model: 'gateway' };
    } catch (error) {
      if (error.name === 'AbortError') {
        const err = new Error('OmniRoute did not answer within 8s — it may still be starting. Try again in a moment.');
        err.status = 408;
        throw err;
      }
      error.message = connectionMessage(error, 'OmniRoute', OMNIROUTE_START_HINT);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  // Numes documents /key as the credential probe: 401 for a bad key, 200
  // with the key's balance and usage for a good one. It avoids spending any
  // inference on a test.
  if (provider === 'numes') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(meta.probeUrl || 'https://api.numes.ai/api/v1/key', {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!response.ok) throw await readError(response, provider);
      let budget = '';
      try {
        const data = await response.json();
        const remaining = data?.remaining ?? data?.balance_remaining ?? data?.credits_remaining;
        if (Number.isFinite(Number(remaining))) budget = ` — remaining balance ${Number(remaining)}`;
      } catch { /* balance display is best-effort */ }
      return { ok: true, model: `key${budget}` };
    } catch (error) {
      if (error.name === 'AbortError') {
        const err = new Error('Numes did not answer within 10s during key test.');
        err.status = 408;
        throw err;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  const targetModel = model || meta.defaultModel;
  const candidates = provider === 'nvidia'
    ? [...new Set([targetModel, ...NVIDIA_TEST_FALLBACKS])]
    : provider === 'gemini'
      ? [...new Set([targetModel, ...GEMINI_TEST_FALLBACKS])]
      : provider === 'openrouter'
        ? [...new Set([targetModel, ...OPENROUTER_TEST_FALLBACKS])]
        : provider === 'coarena'
          ? [...new Set([targetModel, ...COARENA_TEST_FALLBACKS])]
          : [targetModel];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const res = await probeModel(meta, provider, apiKey, candidate);
      return {
        ...res,
        fallbackFrom: candidate !== targetModel ? targetModel : null,
      };
    } catch (error) {
      lastError = error;
      const status = Number(error.status || 0);
      // Key-level failures stop the probe at once; model-level ones (404 not
      // on this account, free-tier exclusion on a single model, or a stall) move on.
      const coarenaFreeTierSkip = provider === 'coarena' && status === 402 && /not part of the free tier/i.test(error.message);
      const keyLevel = (status === 401 || status === 402 || status === 403) && !coarenaFreeTierSkip;
      const modelLevel = status === 404 || status === 408 || (provider === 'coarena' && status === 503) || coarenaFreeTierSkip;
      if (keyLevel || !modelLevel) throw error;
    }
  }
  throw lastError;
}

const MODELS_ENDPOINTS = {
  openrouter: 'https://openrouter.ai/api/v1/models',
  nvidia: 'https://integrate.api.nvidia.com/v1/models',
  groq: 'https://api.groq.com/openai/v1/models',
  coarena: 'https://coarena.ai/api/v1/models',
  kilo: 'https://ai-gateway.kilo.ai/api/v1/models',
  omniroute: 'http://localhost:20128/v1/models',
  // Tool-capable text models, cheapest first — free $0 rows sort to the top.
  numes: 'https://api.numes.ai/api/v1/models?output_modalities=text&supported_parameters=tools&sort=pricing-low-to-high',
};

const MODEL_EXCLUDES = {
  nvidia: /(embed|rerank|guard|safety|topic-control|nvclip|deplot|parse|synthetic-video|cosmos-reason|reward|ising-calibration|riva-translate)/i,
  groq: /(whisper|orpheus|guard|safeguard|tts|playai)/i,
};

function isClaudeId(id) {
  return /^(anthropic\/)?claude-/i.test(String(id || '')) && !/:batch$/i.test(String(id || ''));
}

function isZeroPriceRow(item) {
  if (!item?.pricing || typeof item.pricing !== 'object') return false;
  const prompt = Number(item.pricing.prompt);
  const completion = Number(item.pricing.completion);
  return Number.isFinite(prompt) && prompt === 0 && (!Number.isFinite(completion) || completion === 0);
}

function filterLiveProviderRow(provider, item) {
  const id = String(item?.id || '');
  if (!id) return false;
  if (provider === 'openrouter') {
    if (isClaudeId(id)) return true;
    if (/inkling-2-small:free|lyria/i.test(id)) return false;
    const isFree = id === 'openrouter/free' || id.endsWith(':free') || isZeroPriceRow(item);
    if (!isFree) return false;
    if (Array.isArray(item?.supported_parameters) && !item.supported_parameters.includes('tools')) return false;
    return true;
  }
  if (provider === 'coarena') {
    if (item?.lifecycle && item.lifecycle !== 'active') return false;
    return COARENA_TEST_FALLBACKS.includes(id) || isClaudeId(id);
  }
  if (provider === 'kilo') {
    // Kilo's free catalog: keep only rows the gateway serves at no cost and
    // that can drive tools (the whole point of a coding agent).
    const isFree = Boolean(item?.isFree) || id.endsWith(':free') || id === 'kilo-auto/free' || id === 'openrouter/free';
    if (!isFree) return false;
    if (Array.isArray(item?.supported_parameters) && !item.supported_parameters.includes('tools')) return false;
    return true;
  }
  if (provider === 'numes') {
    if (isClaudeId(id)) return true;
    if (!item?.pricing) return true; // Allows mock unit-test catalogs without pricing fields
    return isZeroPriceRow(item);
  }
  return true;
}

async function fetchProviderModels(provider, apiKey) {
  const meta = PROVIDERS[provider];
  if (!meta) throw new Error(`Unknown provider: ${provider}`);
  if (meta.keyless) return meta.models;
  if ((provider === 'gemini' || provider === 'groq' || provider === 'omniroute' || provider === 'numes') && !apiKey) {
    throw new Error(`Add ${/^[AEIOU]/.test(meta.name) ? 'an' : 'a'} ${meta.name} key first to refresh models.`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    if (provider === 'gemini') {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': apiKey },
        signal: controller.signal,
      });
      if (!response.ok) throw await readError(response, 'gemini');
      const data = await response.json();
      const ids = (data.models || [])
        .filter((item) => Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes('generateContent'))
        .map((item) => String(item.name || '').replace(/^models\//, ''))
        .filter((id) => id && !/(embedding|imagen|tts|native-audio|aqa|robotics|computer-use|lyria|deep-research|antigravity|^gemini-2\.)/i.test(id));
      return ids.length ? [...new Set([...meta.models, ...ids])].slice(0, 120) : meta.models;
    }
    const url = MODELS_ENDPOINTS[provider];
    const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
    let response;
    try {
      response = await fetch(url, {
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      error.message = connectionMessage(error, meta.name, OMNIROUTE_START_HINT);
      throw error;
    }
    if (!response.ok) throw await readError(response, provider);
    const data = await response.json();
    const exclude = MODEL_EXCLUDES[provider];
    const rows = Array.isArray(data.data) ? data.data : [];
    const ids = rows
      .filter((item) => filterLiveProviderRow(provider, item))
      .map((item) => item.id)
      .filter((id) => Boolean(id) && (!exclude || !exclude.test(id)));
    if (!ids.length) return meta.models;
    if (provider === 'coarena') {
      const freeSet = new Set(COARENA_TEST_FALLBACKS);
      const freeFirst = COARENA_TEST_FALLBACKS.filter((id) => ids.includes(id));
      const claudeRest = ids.filter((id) => !freeSet.has(id) && isClaudeId(id));
      return [...new Set([...freeFirst, ...claudeRest])].slice(0, 400);
    }
    if (provider === 'numes') {
      const liveSet = new Set(ids);
      const curatedLive = meta.models.filter((id) => liveSet.has(id));
      const rest = ids.filter((id) => !curatedLive.includes(id) && !/^(dealignai|uniboshi)\//i.test(id));
      const unstableRest = ids.filter((id) => !curatedLive.includes(id) && /^(dealignai|uniboshi)\//i.test(id));
      return [...new Set([...curatedLive, ...rest, ...unstableRest])].slice(0, 400);
    }
    return [...new Set([...meta.models, ...ids])].slice(0, 400);
  } finally {
    clearTimeout(timer);
  }
}

// Tiered routing (Antigravity audit item #1): cheap, fast, high-quota models
// handle auxiliary work — read-only research subagents and chat titles — so
// the chat's heavy model is reserved for planning, coding edits and final
// answers. Mirrors how Claude spends flagship tokens only where they matter.
const MODEL_ROUTING = {
  gemini: 'gemini-3.5-flash-lite',
  groq: 'qwen/qwen3.8-27b',
  nvidia: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  openrouter: 'openrouter/free',
  coarena: 'gemini-3-8-flash',
  kilo: 'nvidia/nemotron-3.5-lightning:free',
  numes: 'deepseek/deepseek-v4.1-flash:free',
};

// The auxiliary model for a provider, or the session model when no cheaper
// verified option exists (simulator/claude/omniroute have no routing entry).
function auxiliaryModel(providerId, sessionModel) {
  const fast = MODEL_ROUTING[providerId];
  const catalog = PROVIDERS[providerId]?.models || [];
  if (fast && catalog.includes(fast) && fast !== sessionModel) return fast;
  return sessionModel || PROVIDERS[providerId]?.defaultModel || null;
}

// Team review is the opposite of auxiliary work: the checker must be able to
// actually catch bugs, so it gets the strongest verified cross-family model
// on that provider — never the lite/fast tier.
const REVIEW_MODEL = {
  gemini: 'gemini-3-flash-preview',
  groq: 'openai/gpt-oss-120b',
  nvidia: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  openrouter: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  numes: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  coarena: 'gpt-6-luna',
  kilo: 'nvidia/nemotron-3-ultra-550b-a55b:free',
};

function reviewerModel(providerId) {
  const strong = REVIEW_MODEL[providerId];
  const catalog = PROVIDERS[providerId]?.models || [];
  if (strong && catalog.includes(strong)) return strong;
  return PROVIDERS[providerId]?.defaultModel || null;
}

module.exports = {
  PROVIDERS, MODEL_NOTES, MODEL_FAILOVER, PROVIDER_SPILLOVER, PROVIDER_HIGH_HEADROOM, MODELS_ENDPOINTS,
  MODEL_ROUTING, auxiliaryModel, REVIEW_MODEL, reviewerModel, normalizeModelForProvider,
  providerList, streamOpenAICompatible, resolveTimeouts, testKey, fetchProviderModels, readError,
};
