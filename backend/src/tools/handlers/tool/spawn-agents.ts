import {
  validateSpawnState,
  validateAndGetAgentTemplate,
  validateAgentInput,
  createAgentState,
  logAgentSpawn,
  executeSubagent,
} from './spawn-agent-utils'
import { logger } from '../../../util/logger'

import type { CodebuffToolHandlerFunction } from '../handler-function-type'
import type {
  CodebuffToolCall,
  CodebuffToolOutput,
} from '@codebuff/common/tools/list'
import type { AgentTemplate } from '@codebuff/common/types/agent-template'
import type { Message } from '@codebuff/common/types/messages/codebuff-message'
import type { PrintModeEvent } from '@codebuff/common/types/print-mode'
import type { AgentState } from '@codebuff/common/types/session-state'
import type { ProjectFileContext } from '@codebuff/common/util/file'
import type { WebSocket } from 'ws'

export type SendSubagentChunk = (data: {
  userInputId: string
  agentId: string
  agentType: string
  chunk: string
  prompt?: string
}) => void

type ToolName = 'spawn_agents'
export const handleSpawnAgents = ((params: {
  previousToolCallFinished: Promise<void>
  toolCall: CodebuffToolCall<ToolName>

  fileContext: ProjectFileContext
  clientSessionId: string
  userInputId: string
  writeToClient: (chunk: string | PrintModeEvent) => void

  getLatestState: () => { messages: Message[] }
  state: {
    ws?: WebSocket
    fingerprintId?: string
    userId?: string
    agentTemplate?: AgentTemplate
    localAgentTemplates?: Record<string, AgentTemplate>
    sendSubagentChunk?: SendSubagentChunk
    messages?: Message[]
    agentState?: AgentState
    system?: string
  }
}): { result: Promise<CodebuffToolOutput<ToolName>>; state: {} } => {
  const {
    previousToolCallFinished,
    toolCall,

    fileContext,
    clientSessionId,
    userInputId,
    getLatestState,
    state,
    writeToClient,
  } = params
  const { agents } = toolCall.input
  const validatedState = validateSpawnState(state, 'spawn_agents')
  const { sendSubagentChunk, system: parentSystemPrompt } = state

  if (!sendSubagentChunk) {
    throw new Error(
      'Internal error for spawn_agents: Missing sendSubagentChunk in state',
    )
  }

  const {
    ws,
    fingerprintId,
    userId,
    agentTemplate: parentAgentTemplate,
    localAgentTemplates,
    agentState: parentAgentState,
  } = validatedState

  const triggerSpawnAgents = async () => {
    const results = await Promise.allSettled(
      agents.map(async ({ agent_type: agentTypeStr, prompt, params }) => {
        const { agentTemplate, agentType } = await validateAndGetAgentTemplate(
          agentTypeStr,
          parentAgentTemplate,
          localAgentTemplates,
        )

        validateAgentInput(agentTemplate, agentType, prompt, params)

        const subAgentState = createAgentState(
          agentType,
          agentTemplate,
          parentAgentState,
          getLatestState().messages,
          {},
        )

        logAgentSpawn(
          agentTemplate,
          agentType,
          subAgentState.agentId,
          subAgentState.parentId,
          prompt,
          params,
        )

        const result = await executeSubagent({
          ws,
          userInputId: `${userInputId}-${agentType}${subAgentState.agentId}`,
          prompt: prompt || '',
          params,
          agentTemplate,
          parentAgentState,
          agentState: subAgentState,
          fingerprintId,
          fileContext,
          localAgentTemplates,
          userId,
          clientSessionId,
          isOnlyChild: agents.length === 1,
          parentSystemPrompt,
          onResponseChunk: (chunk: string | PrintModeEvent) => {
            if (agents.length === 1) {
              writeToClient(chunk)
            }
            if (typeof chunk !== 'string') {
              return
            }
            // Send subagent streaming chunks to client
            sendSubagentChunk({
              userInputId,
              agentId: subAgentState.agentId,
              agentType,
              chunk,
              prompt,
            })
          },
        })
        return { ...result, agentType, agentName: agentTemplate.displayName }
      }),
    )

    const reports = await Promise.all(
      results.map(async (result, index) => {
        if (result.status === 'fulfilled') {
          const { output, agentType, agentName } = result.value
          return {
            agentName,
            agentType,
            value: output,
          }
        } else {
          const agentTypeStr = agents[index].agent_type
          return {
            agentType: agentTypeStr,
            agentName: agentTypeStr,
            value: { errorMessage: `Error spawning agent: ${result.reason}` },
          }
        }
      }),
    )

    // Aggregate costs from subagents
    results.forEach((result, index) => {
      const agentInfo = agents[index]
      let subAgentCredits = 0

      if (result.status === 'fulfilled') {
        subAgentCredits = result.value.agentState.creditsUsed || 0
        // Note (James): Try not to include frequent logs with narrow debugging value.
        // logger.debug(
        //   {
        //     parentAgentId: validatedState.agentState.agentId,
        //     subAgentType: agentInfo.agent_type,
        //     subAgentCredits,
        //   },
        //   'Aggregating successful subagent cost',
        // )
      } else if (result.reason?.agentState?.creditsUsed) {
        // Even failed agents may have incurred partial costs
        subAgentCredits = result.reason.agentState.creditsUsed || 0
        logger.debug(
          {
            parentAgentId: validatedState.agentState.agentId,
            subAgentType: agentInfo.agent_type,
            subAgentCredits,
          },
          'Aggregating failed subagent partial cost',
        )
      }

      if (subAgentCredits > 0) {
        validatedState.agentState.creditsUsed += subAgentCredits
        // Note (James): Try not to include frequent logs with narrow debugging value.
        // logger.debug(
        //   {
        //     parentAgentId: validatedState.agentState.agentId,
        //     addedCredits: subAgentCredits,
        //     totalCredits: validatedState.agentState.creditsUsed,
        //   },
        //   'Updated parent agent total cost',
        // )
      }
    })

    return reports
  }
  return {
    result: (async () => {
      await previousToolCallFinished
      return [
        {
          type: 'json',
          value: await triggerSpawnAgents(),
        },
      ]
    })(),
    state: {},
  }
}) satisfies CodebuffToolHandlerFunction<ToolName>
