import type { LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { Settings } from '@shared/types'
import { getSecret } from './settings'

/** Builds the user's chosen model. Every provider goes through the same AI SDK interface. */
export function getModel(s: Settings): { model: LanguageModel; label: string } {
  const key = getSecret(s.llmProvider)
  const modelId = s.llmModel.trim()
  if (!modelId) throw new Error('No model configured. Open Settings and choose a model.')
  const needsKey = !['ollama', 'openai-compatible'].includes(s.llmProvider)
  if (needsKey && !key) throw new Error(`No API key saved for ${s.llmProvider}. Add one in Settings.`)

  const label = `${s.llmProvider}:${modelId}`
  switch (s.llmProvider) {
    case 'anthropic':
      return { model: createAnthropic({ apiKey: key })(modelId), label }
    case 'openai':
      return { model: createOpenAI({ apiKey: key })(modelId), label }
    case 'google':
      return {
        model: createGoogleGenerativeAI({ apiKey: key })(modelId),
        label
      }
    case 'openrouter':
      return {
        model: createOpenAICompatible({
          name: 'openrouter',
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey: key,
          supportsStructuredOutputs: true,
          headers: { 'X-Title': 'Clerisy' }
        })(modelId),
        label
      }
    case 'ollama':
      return {
        model: createOpenAICompatible({
          name: 'ollama',
          baseURL: s.llmBaseUrl || 'http://localhost:11434/v1',
          supportsStructuredOutputs: true
        })(modelId),
        label
      }
    case 'openai-compatible':
      if (!s.llmBaseUrl) throw new Error('Set a base URL for the OpenAI-compatible provider (e.g. LM Studio http://localhost:1234/v1).')
      return {
        model: createOpenAICompatible({
          name: 'custom',
          baseURL: s.llmBaseUrl,
          apiKey: key || undefined,
          supportsStructuredOutputs: true
        })(modelId),
        label
      }
  }
}
