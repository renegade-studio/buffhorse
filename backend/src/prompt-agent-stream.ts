import { providerModelNames } from '@codebuff/common/old-constants'

import { promptAiSdkStream } from './llm-apis/vercel-ai-sdk/ai-sdk'
import { globalStopSequence } from './tools/constants'

import type { AgentTemplate } from './templates/types'
import type { Message } from '@codebuff/common/types/messages/codebuff-message'
import type { OpenRouterProviderOptions } from '@codebuff/internal/openrouter-ai-sdk'

export const getAgentStreamFromTemplate = (params: {
  clientSessionId: string
  fingerprintId: string
  userInputId: string
  userId: string | undefined
  onCostCalculated?: (credits: number) => Promise<void>
  agentId?: string
  includeCacheControl?: boolean
  provider?: string

  template: AgentTemplate
}) => {
  const {
    clientSessionId,
    fingerprintId,
    userInputId,
    userId,
    onCostCalculated,
    agentId,
    includeCacheControl,
    provider,
    template,
  } = params

  if (!template) {
    throw new Error('Agent template is null/undefined')
  }

  const { model } = template

  const getStream = (messages: Message[]) => {
    const options: Parameters<typeof promptAiSdkStream>[0] = {
      messages,
      model,
      provider,
      stopSequences: [globalStopSequence],
      clientSessionId,
      fingerprintId,
      userInputId,
      userId,
      maxOutputTokens: 32_000,
      onCostCalculated,
      includeCacheControl,
      agentId,
    }

    // Add Gemini-specific options if needed
    const primaryModel = Array.isArray(model) ? model[0] : model
    const derivedProvider =
      providerModelNames[primaryModel as keyof typeof providerModelNames]

    const finalProvider = provider ?? derivedProvider

    if (!options.providerOptions) {
      options.providerOptions = {}
    }
    if (finalProvider === 'gemini') {
      if (!options.providerOptions.gemini) {
        options.providerOptions.gemini = {}
      }
      if (!options.providerOptions.gemini.thinkingConfig) {
        options.providerOptions.gemini.thinkingConfig = { thinkingBudget: 128 }
      }
    }
    if (!options.providerOptions.openrouter) {
      options.providerOptions.openrouter = {}
    }
    ;(
      options.providerOptions.openrouter as OpenRouterProviderOptions
    ).reasoning = template.reasoningOptions

    return promptAiSdkStream(options)
  }

  return { getStream }
}
