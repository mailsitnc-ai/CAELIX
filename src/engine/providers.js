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
      'meta/llama-3.3-70b-instruct',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'deepseek-ai/deepseek-r1',
      'qwen/qwen2.5-coder-32b-instruct',
    ],
    defaultModel: 'meta/llama-3.3-70b-instruct',
    color: '#76b900',
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
    detail = parsed.error?.message || parsed.message || detail;
  } catch {
    // keep raw body
  }
  return `Provider returned ${response.status}${detail ? `: ${detail}` : ''}`;
}

async function streamOpenAICompatible(options) {
  const {
    provider, model, apiKey, messages, tools, signal, onDelta,
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

  const response = await fetch(meta.baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  if (!response.body) throw new Error('The provider returned no response stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const calls = new Map();
  let usage = null;
  let finishReason = null;

  const handleLine = (line) => {
    const trimmed = line.trim();
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
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta || {};
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content;
      onDelta(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
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
}

async function testKey(provider, apiKey) {
  const meta = PROVIDERS[provider];
  if (!meta || !meta.baseUrl) throw new Error('This provider does not use a key.');
  const response = await fetch(meta.baseUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://caelix.local', 'X-Title': 'CAELIX' } : {}),
    },
    body: JSON.stringify({
      model: meta.defaultModel,
      messages: [{ role: 'user', content: 'Reply with the single word ready.' }],
      max_tokens: 8,
      stream: false,
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return true;
}

module.exports = {
  PROVIDERS, providerList, streamOpenAICompatible, testKey,
};
