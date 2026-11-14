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
      'google/gemini-2.5-pro',
      'google/gemini-2.5-flash',
      'openai/gpt-5',
      'openai/gpt-5-mini',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-chat',
    ],
    defaultModel: 'google/gemini-2.5-flash',
    color: '#8b5cf6',
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    keyLabel: 'NVIDIA API key',
    consoleUrl: 'https://build.nvidia.com/',
    baseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    models: [
      'deepseek-ai/deepseek-v4.1-flash',
      'nvidia/nemotron-3-super-120b-a12b',
      'nvidia/nemotron-3-ultra-550b-a55b',
      'nvidia/nemotron-3.5-super-vl-120b-a12b',
      'nvidia/nemotron-3.5-lightning-30b-a3b',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
      'nvidia/nemotron-nano-3-30b-a3b',
      'nvidia/llama-3.1-nemotron-ultra-253b-v1',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'nvidia/llama-3.1-nemotron-51b-instruct',
      'nvidia/nemotron-4-340b-instruct',
      'mistralai/mistral-large-4-1t-a52b',
      'mistralai/mistral-large-2-instruct',
      'mistralai/codestral-22b-instruct-v0.1',
      'mistralai/mistral-7b-instruct-v0.3',
      'mistralai/mixtral-8x22b-v0.1',
      'nv-mistralai/mistral-nemo-12b-instruct',
      'moonshotai/kimi-k2.6',
      'z-ai/glm-5.3-flash',
      'minimaxai/minimax-m3.1-flash',
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
    defaultModel: 'deepseek-ai/deepseek-v4.1-flash',
    color: '#76b900',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    keyLabel: 'Groq API key',
    consoleUrl: 'https://console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'llama-3.3-70b-versatile',
      'qwen/qwen3-32b',
      'llama-3.1-8b-instant',
      'moonshotai/kimi-k2-instruct',
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
      'qwen/qwen3.8-27b',
      'groq/compound',
    ],
    defaultModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    color: '#f55036',
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
  'gemini-2.5-flash': 'Lightweight · 1M context',
  'gemini-2.5-flash-lite': 'Ultra-lightweight · 1M context',
  'gemini-2.5-pro': 'Deep reasoning · 1M context',
  'meta-llama/llama-4-scout-17b-16e-instruct': 'Lightweight · Long context · High TPM',
  'llama-3.1-8b-instant': 'Ultra-fast · High free TPM',
  'llama-3.3-70b-versatile': 'Strong all-rounder · 128K',
  'qwen/qwen3-32b': 'Compact coding & reasoning · 128K',
  'moonshotai/kimi-k2-instruct': 'Long-context tool caller · 128K',
  'openai/gpt-oss-120b': 'Heavy · Low free TPM (rotate keys)',
  'deepseek-ai/deepseek-v4.1-flash': 'Fast · High-capacity NIM default',
  'nvidia/nemotron-3.5-lightning-30b-a3b': 'Lightweight · Fast · Long context',
  'nvidia/nemotron-nano-3-30b-a3b': 'Lightweight · Fast',
  'google/gemini-2.5-flash': 'Lightweight · 1M context',
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

function toolSchema(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
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

async function readError(response) {
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  let detail = body.slice(0, 500);
  try {
    const parsed = JSON.parse(body);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    detail = first?.error?.message || first?.message || first?.detail || parsed?.detail || detail;
  } catch {
    // keep raw body
  }
  if (response.status === 404 && /not found for account/i.test(detail)) {
    detail = `${detail} — Enable "Public API Endpoints" on build.nvidia.com or create a fresh key directly from a model page.`;
  }
  const err = new Error(`Provider returned ${response.status}${detail ? `: ${detail}` : ''}`);
  err.status = response.status;
  err.retryAfterMs = parseRetryAfterMs(response);
  return err;
}

async function streamOpenAICompatible(options) {
  const {
    provider, model, apiKey, messages, tools, signal, onDelta, onStatus,
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
  if (tools && tools.length) {
    body.tools = toolSchema(tools);
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
    if (!response.ok) throw await readError(response);
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

async function testKey(provider, apiKey, model = null) {
  const meta = PROVIDERS[provider];
  if (!meta || !meta.baseUrl) throw new Error('This provider does not use a key.');
  const targetModel = model || meta.defaultModel;
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
    if (!response.ok) throw await readError(response);
    return true;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`${meta.name} (${targetModel}) timed out after 15s during key test.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const MODELS_ENDPOINTS = {
  openrouter: 'https://openrouter.ai/api/v1/models',
  nvidia: 'https://integrate.api.nvidia.com/v1/models',
  groq: 'https://api.groq.com/openai/v1/models',
};

const MODEL_EXCLUDES = {
  nvidia: /(embed|rerank|guard|safety|topic-control|nvclip|deplot|parse|synthetic-video|cosmos-reason|reward)/i,
  groq: /(whisper|orpheus|guard|safeguard|tts|playai)/i,
};

async function fetchProviderModels(provider, apiKey) {
  const meta = PROVIDERS[provider];
  if (!meta) throw new Error(`Unknown provider: ${provider}`);
  if (meta.keyless) return meta.models;
  if ((provider === 'gemini' || provider === 'groq') && !apiKey) {
    throw new Error(`Add a ${meta.name} key first to refresh models.`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    if (provider === 'gemini') {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': apiKey },
        signal: controller.signal,
      });
      if (!response.ok) throw await readError(response);
      const data = await response.json();
      const ids = (data.models || [])
        .filter((item) => Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes('generateContent'))
        .map((item) => String(item.name || '').replace(/^models\//, ''))
        .filter((id) => id && !id.includes('embedding') && !id.includes('imagen'));
      return ids.length ? [...new Set([...meta.models, ...ids])].slice(0, 120) : meta.models;
    }
    const url = MODELS_ENDPOINTS[provider];
    const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) throw await readError(response);
    const data = await response.json();
    const exclude = MODEL_EXCLUDES[provider];
    const ids = (data.data || [])
      .map((item) => item.id)
      .filter((id) => Boolean(id) && (!exclude || !exclude.test(id)));
    return ids.length ? [...new Set([...meta.models, ...ids])].slice(0, 400) : meta.models;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  PROVIDERS, providerList, streamOpenAICompatible, testKey, fetchProviderModels,
};
