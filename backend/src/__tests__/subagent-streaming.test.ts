import { assembleLocalAgentTemplates } from '@codebuff/agent-runtime/templates/agent-registry'
import { TEST_USER_ID } from '@codebuff/common/old-constants'
import {
  TEST_AGENT_RUNTIME_IMPL,
  TEST_AGENT_RUNTIME_SCOPED_IMPL,
} from '@codebuff/common/testing/impl/agent-runtime'
import { getInitialSessionState } from '@codebuff/common/types/session-state'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'

import * as runAgentStep from '../run-agent-step'
import { mockFileContext } from './test-utils'
import { handleSpawnAgents } from '../tools/handlers/tool/spawn-agents'
import * as loggerModule from '../util/logger'

import type { SendSubagentChunk } from '../tools/handlers/tool/spawn-agents'
import type { AgentTemplate } from '@codebuff/agent-runtime/templates/types'
import type { CodebuffToolCall } from '@codebuff/common/tools/list'
import type { Mock } from 'bun:test'

describe('Subagent Streaming', () => {
  let mockSendSubagentChunk: Mock<SendSubagentChunk>
  let mockLoopAgentSteps: Mock<(typeof runAgentStep)['loopAgentSteps']>
  let mockAgentTemplate: any
  let mockWriteToClient: Mock<
    Parameters<typeof handleSpawnAgents>[0]['writeToClient']
  >

  beforeEach(() => {
    // Setup common mock agent template
    mockAgentTemplate = {
      id: 'thinker',
      displayName: 'Thinker',
      outputMode: 'last_message',
      inputSchema: {
        prompt: {
          safeParse: () => ({ success: true }),
        } as any,
      },
      spawnerPrompt: '',
      model: '',
      includeMessageHistory: true,
      inheritParentSystemPrompt: false,
      toolNames: [],
      spawnableAgents: [],
      systemPrompt: '',
      instructionsPrompt: '',
      stepPrompt: '',
    }
  })

  beforeAll(() => {
    // Mock dependencies
    spyOn(loggerModule.logger, 'debug').mockImplementation(() => {})
    spyOn(loggerModule.logger, 'error').mockImplementation(() => {})
    spyOn(loggerModule.logger, 'info').mockImplementation(() => {})
    spyOn(loggerModule.logger, 'warn').mockImplementation(() => {})
    spyOn(loggerModule, 'withLoggerContext').mockImplementation(
      async (context: any, fn: () => Promise<any>) => fn(),
    )

    // Mock sendSubagentChunk function to capture streaming messages
    mockSendSubagentChunk = mock(
      (data: {
        userInputId: string
        agentId: string
        agentType: string
        chunk: string
        prompt?: string
      }) => {},
    )

    // Mock loopAgentSteps to simulate subagent execution with streaming
    mockLoopAgentSteps = spyOn(
      runAgentStep,
      'loopAgentSteps',
    ).mockImplementation(async (options) => {
      // Simulate streaming chunks by calling the callback
      if (options.onResponseChunk) {
        options.onResponseChunk('Thinking about the problem...')
        options.onResponseChunk('Found a solution!')
      }

      return {
        agentState: {
          ...options.agentState,
          messageHistory: [
            { role: 'assistant', content: 'Test response from subagent' },
          ],
        },
        output: { type: 'lastMessage', value: 'Test response from subagent' },
      }
    })

    mockWriteToClient = mock(() => {})

    // Mock assembleLocalAgentTemplates
    spyOn(
      { assembleLocalAgentTemplates },
      'assembleLocalAgentTemplates',
    ).mockImplementation(() => ({
      agentTemplates: {
        [mockAgentTemplate.id]: mockAgentTemplate,
      },
      validationErrors: [],
    }))
  })

  beforeEach(() => {
    mockSendSubagentChunk.mockClear()
    mockLoopAgentSteps.mockClear()
  })

  afterAll(() => {
    mock.restore()
  })

  it('should send subagent-response-chunk messages during agent execution', async () => {
    const sessionState = getInitialSessionState(mockFileContext)
    const agentState = sessionState.mainAgentState

    // Mock parent agent template that can spawn thinker
    const parentTemplate = {
      id: 'base',
      spawnableAgents: ['thinker'],
    } as unknown as AgentTemplate

    const toolCall: CodebuffToolCall<'spawn_agents'> = {
      toolName: 'spawn_agents' as const,
      toolCallId: 'test-tool-call-id',
      input: {
        agents: [
          {
            agent_type: 'thinker',
            prompt: 'Think about this problem',
          },
        ],
      },
    }

    const { result } = handleSpawnAgents({
      ...TEST_AGENT_RUNTIME_IMPL,
      ...TEST_AGENT_RUNTIME_SCOPED_IMPL,
      previousToolCallFinished: Promise.resolve(),
      toolCall,
      fileContext: mockFileContext,
      clientSessionId: 'test-session',
      userInputId: 'test-input',
      writeToClient: mockWriteToClient,
      getLatestState: () => ({ messages: [] }),
      state: {
        fingerprintId: 'test-fingerprint',
        userId: TEST_USER_ID,
        agentTemplate: parentTemplate,
        localAgentTemplates: {
          [mockAgentTemplate.id]: mockAgentTemplate,
        },
        sendSubagentChunk: mockSendSubagentChunk,
        messages: [],
        agentState,
        system: 'Test system prompt',
      },
    })

    await result

    // Verify that subagent streaming messages were sent
    expect(mockWriteToClient).toHaveBeenCalledTimes(2)

    // First call is subagent_start
    expect(mockWriteToClient).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'subagent_start' }),
    )

    // Second call is subagent_finish
    expect(mockWriteToClient).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'subagent_finish' }),
    )
    return
  })

  it('should include correct agentId and agentType in streaming messages', async () => {
    const sessionState = getInitialSessionState(mockFileContext)
    const agentState = sessionState.mainAgentState

    const parentTemplate = {
      id: 'base',
      spawnableAgents: ['thinker'],
    } as unknown as AgentTemplate

    const toolCall: CodebuffToolCall<'spawn_agents'> = {
      toolName: 'spawn_agents' as const,
      toolCallId: 'test-tool-call-id-2',
      input: {
        agents: [
          {
            agent_type: 'thinker',
            prompt: 'Test prompt',
          },
        ],
      },
    }

    const { result } = handleSpawnAgents({
      ...TEST_AGENT_RUNTIME_IMPL,
      ...TEST_AGENT_RUNTIME_SCOPED_IMPL,
      previousToolCallFinished: Promise.resolve(),
      toolCall,
      fileContext: mockFileContext,
      clientSessionId: 'test-session',
      userInputId: 'test-input-123',
      writeToClient: () => {},
      getLatestState: () => ({ messages: [] }),
      state: {
        fingerprintId: 'test-fingerprint',
        userId: TEST_USER_ID,
        agentTemplate: parentTemplate,
        localAgentTemplates: {
          [mockAgentTemplate.id]: mockAgentTemplate,
        },
        sendSubagentChunk: mockSendSubagentChunk,
        messages: [],
        agentState,
        system: 'Test system prompt',
      },
    })
    await result

    // Verify the streaming messages have consistent agentId and correct agentType
    expect(mockSendSubagentChunk.mock.calls.length).toBeGreaterThanOrEqual(2)
    const calls = mockSendSubagentChunk.mock.calls as Array<
      [
        {
          userInputId: string
          agentId: string
          agentType: string
          chunk: string
          prompt?: string
        },
      ]
    >
    const firstCall = calls[0][0]
    const secondCall = calls[1][0]

    expect(firstCall.agentId).toBe(secondCall.agentId) // Same agent ID
    expect(firstCall.agentType).toBe('thinker')
    expect(secondCall.agentType).toBe('thinker')
    expect(firstCall.userInputId).toBe('test-input-123')
    expect(secondCall.userInputId).toBe('test-input-123')
  })
})
