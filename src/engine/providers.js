'use strict';

const PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    keyLabel: 'Gemini API key',
    consoleUrl: 'https://aistudio.google.com/apikey',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
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
      'qwen/qwen3-coder:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemma-3-27b-it:free',
      'google/gemini-2.5-flash',
      'google/gemini-2.5-pro',
      'deepseek/deepseek-chat',
      'openai/gpt-5-mini',
      'openai/gpt-5',
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
      // Verified live against a real NIM key on 2026-11-15 (probe: OK twice each).
      'nvidia/nemotron-3.5-lightning-30b-a3b',
      'nvidia/nemotron-3.5-super-vl-120b-a12b',
      'nvidia/nemotron-3-ultra-550b-a55b',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
      'mistralai/mistral-large-4-1t-a52b',
      'minimaxai/minimax-m3.1-flash',
      // Catalog entries that 404 or hang on some accounts; kept for accounts that have them.
      'deepseek-ai/deepseek-v4.1-flash',
      'nvidia/nemotron-3-super-120b-a12b',
      'nvidia/nemotron-nano-3-30b-a3b',
      'nvidia/llama-3.1-nemotron-ultra-253b-v1',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'nvidia/llama-3.1-nemotron-51b-instruct',
      'nvidia/nemotron-4-340b-instruct',
      'mistralai/mistral-large-2-instruct',
      'mistralai/codestral-22b-instruct-v0.1',
      'mistralai/mistral-7b-instruct-v0.3',
      'mistralai/mixtral-8x22b-v0.1',
      'nv-mistralai/mistral-nemo-12b-instruct',
      'moonshotai/kimi-k2.6',
      'z-ai/glm-5.3-flash',
      'stepfun-ai/step-5-preview',
      'openai/gpt-oss-20b',
      'google/gemma-4-31b-it',
      'google/gemma-3-12b-it',
      'google/gemma-3-4b-it',
      'meta/llama-3.2-90b-vision-instruct',
      'meta/codellama-70b',
      'poolside/laguna-xs-2.1',
      '01-ai/yi-large',
      'microsoft/phi-3.5-moe-instruct',
      'microsoft/phi-3-vision-128k-instruct',
      'ibm/granite-34b-code-instruct',
      'ibm/granite-3.0-8b-instruct',
      'bigcode/starcoder2-15b',
      'databricks/dbrx-instruct',
      'ai21labs/jamba-1.5-large-instruct',
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
    // Verified live against a real Groq key on 2026-11-15 (probe: OK, 79-316 ms).
    // Groq rotated its catalog: the llama-4/llama-3.3 IDs no longer exist.
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
      'gpt-6-1-sol',
      'gpt-6-1-terra',
      'gpt-6-astra',
      'gemini-4-carbon',
      'gemini-4-argon',
      'grok-4-7',
      'kimi-k3-1-pro',
    ],
    defaultModel: 'gpt-6-luna',
    color: '#06b6d4',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama Cloud',
    keyLabel: 'Ollama API key',
    consoleUrl: 'https://ollama.com/settings/keys',
    baseUrl: 'https://ollama.com/v1/chat/completions',
    models: [
      'gpt-oss:120b',
      'gpt-oss:20b',
      'kimi-k2.7-code',
      'deepseek-v4.1-flash',
      'deepseek-v4-pro:0813',
      'kimi-k3.1-pro',
      'glm-5.3',
      'glm-5.3-flash',
      'mistral-large-4',
      'minimax-m3.1-flash',
      'nemotron-3-ultra',
      'nemotron-3-super',
      'gemma4:31b',
      'mimo-v2.6-pro',
      'mimo-v2.6-flash',
      'muse-spark-open',
    ],
    defaultModel: 'gpt-oss:120b',
    color: '#f97316',
  },
  numes: {
    id: 'numes',
    name: 'Numes',
    keyLabel: 'Numes API key',
    consoleUrl: 'https://numes.ai/dashboard/keys',
    baseUrl: 'https://api.numes.ai/api/v1/chat/completions',
    // The provider-documented credential probe: 401 bad, 200 good (balance).
    probeUrl: 'https://api.numes.ai/api/v1/key',
    // The provider's published free ($0/token) tool-capable models first.
    // The dealignai rows are third-party "uncensored" variants Numes itself
    // lists; they are that provider's models, not something CAELIX curates.
    // Live Refresh pulls whatever the key can actually serve.
    models: [
      'deepseek/deepseek-v4.1-flash',
      'moonshotai/kimi-k3.1-pro',
      'nvidia/nemotron-3-ultra-550b-a55b',
      'dealignai/deepseek-v4.1-flash-uncensored-fp8',
      'dealignai/glm-5.3-flash-uncensored-fp8',
      'dealignai/glm-5.3-uncensored-fp8',
      'anthropic/claude-sonnet-5.5',
      'anthropic/claude-opus-5.5',
    ],
    defaultModel: 'deepseek/deepseek-v4.1-flash',
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
  'gemini-2.5-flash-lite': 'Best for limits · Highest RPM/RPD · 1M context',
  'gemini-2.5-flash': 'Lightweight · High headroom · 1M context',
  'gemini-2.0-flash': 'Separate Gemini quota · 1M context',
  'gemini-2.5-pro': 'Heavy · Lower RPM/RPD · 1M context',
  'llama-3.1-8b-instant': 'Rotated out of Groq · Not on current keys',
  'meta-llama/llama-4-scout-17b-16e-instruct': 'Rotated out of Groq · Not on current keys',
  'llama-3.3-70b-versatile': 'Rotated out of Groq · Not on current keys',
  'qwen/qwen3.8-27b': 'Fastest verified · High headroom · Separate Groq bucket',
  'qwen/qwen3-32b': 'Rotated out of Groq · Not on current keys',
  'moonshotai/kimi-k2-instruct': 'Rotated out of Groq · Not on current keys',
  'openai/gpt-oss-120b': 'Heavy · Eats free TPM quickly',
  'openai/gpt-oss-20b': 'Fast tool caller · Good free TPM',
  'allam-2-7b': 'Lightweight fallback · Verified live',
  'auto': 'OmniRoute router · Falls back across your connected providers',
  'auto/coding': 'OmniRoute · Coding objective',
  'auto/fast': 'OmniRoute · Speed objective',
  'auto/cheap': 'OmniRoute · Cheapest eligible first',
  'auto/smart': 'OmniRoute · Quality objective',
  'deepseek-ai/deepseek-v4.1-flash': 'Hangs on many accounts · Key test moves on after it stalls',
  'nvidia/llama-3.1-nemotron-70b-instruct': '40 RPM · Not on all NIM accounts',
  'nvidia/nemotron-3.5-lightning-30b-a3b': '40 RPM · Verified live · Lightweight & fast',
  'nvidia/nemotron-3.5-super-vl-120b-a12b': '40 RPM · Verified live · Strong coder',
  'nvidia/nemotron-3-ultra-550b-a55b': '40 RPM · Verified live · Largest NIM model',
  'mistralai/mistral-large-4-1t-a52b': '40 RPM · Verified live · Large Mistral',
  'minimaxai/minimax-m3.1-flash': '40 RPM · Verified live · Fast fallback',
  'nvidia/nemotron-nano-3-30b-a3b': '40 RPM · Lightweight & fast',
  'mistralai/codestral-22b-instruct-v0.1': '40 RPM · Fast compact coder',
  'openrouter/free': 'Free router · Does not spend credits',
  'qwen/qwen3-coder:free': 'Free coding · Separate bucket',
  'meta-llama/llama-3.3-70b-instruct:free': 'Free · Strong general & code',
  'google/gemma-3-27b-it:free': 'Free · Fast lightweight backup',
  'google/gemini-2.5-flash': 'Paid credits · Lightweight · 1M context',
  'gpt-6-luna': 'Free tier · Coarena · OpenAI · 128k · Vision & tools',
  'gemini-3-8-flash': 'Free tier · Coarena · Google · 128k · Fast vision & tools',
  'deepseek-v4-1-flash-1017': 'Free tier · Coarena · DeepSeek · 128k · Tools & reasoning',
  'gpt-6-1-sol': 'Paid credits · Coarena · OpenAI · 128k · Vision & tools',
  'gpt-6-1-terra': 'Paid credits · Coarena · OpenAI · 128k · Vision & tools',
  'gpt-6-astra': 'Paid credits · Coarena · OpenAI · 128k · Vision & tools',
  'gemini-4-carbon': 'Paid credits · Coarena · Google · 128k · Vision & tools',
  'gemini-4-argon': 'Paid credits · Coarena · Google · 128k · Vision & tools',
  'grok-4-7': 'Paid credits · Coarena · xAI · 128k · Vision & tools',
  'kimi-k3-1-pro': 'Paid credits · Coarena · Moonshot · 128k · Vision & tools',
  'gpt-oss:120b': 'Ollama Cloud · OpenAI open-weight 120B · Tools & thinking',
  'gpt-oss:20b': 'Ollama Cloud · Fast 20B · Tools & thinking',
  'kimi-k2.7-code': 'Ollama Cloud · Coding specialist · Vision & tools',
  'deepseek-v4.1-flash': 'Ollama Cloud · Fast reasoning & tools',
  'deepseek-v4-pro:0813': 'Ollama Cloud · Heavy reasoning & tools',
  'glm-5.3': 'Ollama Cloud · Flagship GLM · Tools & thinking',
  'glm-5.3-flash': 'Ollama Cloud · Fast GLM · Vision & tools',
  'mistral-large-4': 'Ollama Cloud · 1M context · Vision & tools',
  'minimax-m3.1-flash': 'Ollama Cloud · 1M context · Vision & tools',
  'nemotron-3-ultra': 'Ollama Cloud · 262k context · Heavy reasoning & tools',
  'gemma4:31b': 'Ollama Cloud · Compact 31B · Vision & tools',
  'deepseek/deepseek-v4.1-flash': 'Numes · $0/token free tier · Tools · Default',
  'moonshotai/kimi-k3.1-pro': 'Numes · $0/token free tier · Tools & reasoning',
  'nvidia/nemotron-3-ultra-550b-a55b': 'Numes · $0/token free tier · 200k context · Heavy reasoning',
  'dealignai/deepseek-v4.1-flash-uncensored-fp8': 'Numes · $0/token · Third-party uncensored variant (dealignai)',
  'dealignai/glm-5.3-flash-uncensored-fp8': 'Numes · $0/token · Third-party uncensored variant (dealignai)',
  'dealignai/glm-5.3-uncensored-fp8': 'Numes · $0/token · Third-party uncensored variant (dealignai)',
  'anthropic/claude-sonnet-5.5': 'Numes · Paid credits · Tools',
  'anthropic/claude-opus-5.5': 'Numes · Paid credits · Heaviest',
};

// Providers whose models carry separate RPM/TPM/RPD quota buckets.
const MODEL_FAILOVER = {
  gemini: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  groq: ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b'],
  openrouter: ['openrouter/free', 'qwen/qwen3-coder:free', 'meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-3-27b-it:free'],
  coarena: ['gpt-6-luna', 'gemini-3-8-flash', 'deepseek-v4-1-flash-1017'],
  ollama: ['gpt-oss:120b', 'kimi-k2.7-code', 'deepseek-v4.1-flash', 'gpt-oss:20b'],
  numes: ['deepseek/deepseek-v4.1-flash', 'moonshotai/kimi-k3.1-pro', 'nvidia/nemotron-3-ultra-550b-a55b'],
};

// Order when spilling over across different providers that have saved keys.
const PROVIDER_SPILLOVER = ['gemini', 'nvidia', 'openrouter', 'ollama', 'numes', 'groq'];
const PROVIDER_HIGH_HEADROOM = {
  gemini: 'gemini-2.5-flash-lite',
  nvidia: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  openrouter: 'openrouter/free',
  ollama: 'gpt-oss:120b',
  numes: 'deepseek/deepseek-v4.1-flash',
  groq: 'qwen/qwen3.8-27b',
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
      color: provider.color,
      modelNotes: MODEL_NOTES,
    }));
}

function normalizeMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.input || {}) },
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
          images.push({ type: 'image_url', image_url: { url: item.dataUrl } });
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
  if (provider === 'ollama') {
    if (status === 401) {
      return 'Ollama Cloud rejected the API key. Copy or create a key at https://ollama.com/settings/keys and save it here in Keys.';
    }
    if (status === 429) {
      return `${text ? `${text} — ` : ''}Ollama Cloud rate or usage limit reached. Add another key to rotate, switch models, or wait for reset.`;
    }
  }
  if (provider === 'numes') {
    if (status === 401) {
      return 'Numes rejected the API key. Copy or create a key at https://numes.ai/dashboard/keys and save it here in Keys.';
    }
    if (status === 402) {
      return `${text ? `${text} — ` : ''}The prepaid balance behind this Numes key is used up for paid models. Top up at https://numes.ai/dashboard or switch to one of Numes' $0 models (deepseek/deepseek-v4.1-flash, moonshotai/kimi-k3.1-pro, nvidia/nemotron-3-ultra-550b-a55b).`;
    }
    if (status === 503) {
      return `${text ? `${text} — ` : ''}No Numes endpoint could serve this model right now. Pick another tool-capable model in the list, or Refresh the catalog to see what the key can serve.`;
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

async function streamOpenAICompatible(options) {
  const {
    provider, model, apiKey, messages, tools, signal, onDelta, onStatus,
    compactToolSchemas = true,
    maxTokens = null,
    timeoutMs = Number(process.env.CAELIX_REQUEST_TIMEOUT_MS) || 35_000,
  } = options;
  const meta = PROVIDERS[provider];
  if (!meta || !meta.baseUrl) throw new Error(`Unknown provider: ${provider}`);

  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://caelix.local';
    headers['X-Title'] = 'CAELIX';
  }

  const body = {
    model,
    messages: normalizeMessages(messages),
    stream: true,
    temperature: 0.2,
  };
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    body.max_tokens = Math.round(maxTokens);
  }
  if (tools && tools.length) {
    body.tools = toolSchema(tools, compactToolSchemas);
    body.tool_choice = 'auto';
  }

  const requestAbort = new AbortController();
  let timedOut = false;
  let stallTimer = null;
  const resetStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      timedOut = true;
      requestAbort.abort();
    }, timeoutMs);
  };
  const onCallerAbort = () => requestAbort.abort();
  if (signal?.aborted) throw new Error('Cancelled.');
  if (signal) signal.addEventListener('abort', onCallerAbort, { once: true });

  let waitNoticeTimer = null;
  if (typeof onStatus === 'function') {
    waitNoticeTimer = setTimeout(() => {
      onStatus({ stage: 'waiting', message: `Waiting for ${meta.name} (${model})…` });
    }, 2000);
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
        const err = new Error(`${meta.name} (${model}) did not respond within ${Math.round(timeoutMs / 1000)}s. The model may be cold-starting, queued, or unavailable for your key — try switching models or clicking Test in Keys.`);
        err.status = 408;
        err.noRetry = true;
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
    let lastReasoningNotice = 0;
    const calls = new Map();
    let usage = null;
    let finishReason = null;

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.startsWith(':')) {
        resetStall();
        if (!text && !reasoningChars) {
          onStatus?.({ stage: 'waiting', message: `Queued on ${meta.name} (${model})…` });
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
      resetStall();
      if (payload.usage) usage = payload.usage;
      const choice = payload.choices && payload.choices[0];
      if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};
      const reasoningPiece = typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string' ? delta.reasoning : '';
      if (reasoningPiece) {
        reasoningChars += reasoningPiece.length;
        const now = Date.now();
        if (!text && (now - lastReasoningNotice >= 350 || reasoningChars === reasoningPiece.length)) {
          lastReasoningNotice = now;
          onStatus?.({ stage: 'thinking', reasoningChars, message: `Thinking (${reasoningChars} chars)…` });
        }
      }
      if (typeof delta.content === 'string' && delta.content) {
        if (waitNoticeTimer) { clearTimeout(waitNoticeTimer); waitNoticeTimer = null; }
        text += delta.content;
        onDelta(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        if (waitNoticeTimer) { clearTimeout(waitNoticeTimer); waitNoticeTimer = null; }
        for (const part of delta.tool_calls) {
          const index = part.index || 0;
          const current = calls.get(index) || { id: '', name: '', arguments: '' };
          if (part.id) current.id = part.id;
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
        resetStall();
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
        const err = new Error(`${meta.name} (${model}) stalled for ${Math.round(timeoutMs / 1000)}s without sending output. Try switching models.`);
        err.status = 408;
        err.noRetry = true;
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
        return { id: call.id || `call_${Math.random().toString(36).slice(2)}`, name: call.name, input };
      });

    return { text, toolCalls, usage, finishReason };
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    if (waitNoticeTimer) clearTimeout(waitNoticeTimer);
    if (signal) signal.removeEventListener('abort', onCallerAbort);
  }
}

// Verified-live models first: a key test should land on a model the account
// can actually serve, not on catalog entries that hang or 404.
const NVIDIA_TEST_FALLBACKS = [
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'minimaxai/minimax-m3.1-flash',
  'mistralai/mistral-large-4-1t-a52b',
];

const COARENA_TEST_FALLBACKS = [
  'gpt-6-luna',
  'gemini-3-8-flash',
  'deepseek-v4-1-flash-1017',
];

const OLLAMA_TEST_FALLBACKS = [
  'gpt-oss:120b',
  'gpt-oss:20b',
  'kimi-k2.7-code',
  'gemma4:31b',
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
    : provider === 'coarena'
      ? [...new Set([targetModel, ...COARENA_TEST_FALLBACKS])]
      : provider === 'ollama'
        ? [...new Set([targetModel, ...OLLAMA_TEST_FALLBACKS])]
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
  ollama: 'https://ollama.com/v1/models',
  omniroute: 'http://localhost:20128/v1/models',
  // Tool-capable text models, cheapest first — free $0 rows sort to the top.
  numes: 'https://api.numes.ai/api/v1/models?output_modalities=text&supported_parameters=tools&sort=pricing-low-to-high',
};

const MODEL_EXCLUDES = {
  nvidia: /(embed|rerank|guard|safety|topic-control|nvclip|deplot|parse|synthetic-video|cosmos-reason|reward)/i,
  groq: /(whisper|orpheus|guard|safeguard|tts|playai)/i,
  ollama: /^(clef:|embed|rerank)/i,
};

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
        .filter((id) => id && !id.includes('embedding') && !id.includes('imagen'));
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
    const activeRows = provider === 'coarena'
      ? rows.filter((item) => !item.lifecycle || item.lifecycle === 'active')
      : rows;
    const ids = activeRows
      .map((item) => item.id)
      .filter((id) => Boolean(id) && (!exclude || !exclude.test(id)));
    if (!ids.length) return meta.models;
    if (provider === 'coarena') {
      const freeSet = new Set(COARENA_TEST_FALLBACKS);
      const freeFirst = COARENA_TEST_FALLBACKS.filter((id) => ids.includes(id));
      const rest = ids.filter((id) => !freeSet.has(id));
      return [...freeFirst, ...rest].slice(0, 400);
    }
    return [...new Set([...meta.models, ...ids])].slice(0, 400);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  PROVIDERS, MODEL_NOTES, MODEL_FAILOVER, PROVIDER_SPILLOVER, PROVIDER_HIGH_HEADROOM, MODELS_ENDPOINTS,
  providerList, streamOpenAICompatible, testKey, fetchProviderModels, readError,
};
