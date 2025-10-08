import { TEST_USER_ID } from '@codebuff/common/old-constants'
import {
  clearMockedModules,
  mockModule,
} from '@codebuff/common/testing/mock-modules'
import { getInitialSessionState } from '@codebuff/common/types/session-state'
import {
  spyOn,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  mock,
} from 'bun:test'

import * as aisdk from '../llm-apis/vercel-ai-sdk/ai-sdk'
import { loopAgentSteps } from '../run-agent-step'
import * as websocketAction from '../websockets/websocket-action'

import type { AgentTemplate } from '../templates/types'
import type { Message } from '@codebuff/common/types/messages/codebuff-message'
import type { ProjectFileContext } from '@codebuff/common/util/file'
import type { WebSocket } from 'ws'

const mockFileContext: ProjectFileContext = {
  projectRoot: '/test',
  cwd: '/test',
  fileTree: [],
  fileTokenScores: {},
  knowledgeFiles: {},
  gitChanges: {
    status: '',
    diff: '',
    diffCached: '',
    lastCommitMessages: '',
  },
  changesSinceLastChat: {},
  shellConfigFiles: {},
  agentTemplates: {},
  customToolDefinitions: {},
  systemInfo: {
    platform: 'test',
    shell: 'test',
    nodeVersion: 'test',
    arch: 'test',
    homedir: '/home/test',
    cpus: 1,
  },
}

class MockWebSocket {
  send(msg: string) {}
  close() {}
  on(event: string, listener: (...args: any[]) => void) {}
  removeListener(event: string, listener: (...args: any[]) => void) {}
}

describe('Prompt Caching for Subagents with inheritParentSystemPrompt', () => {
  let mockLocalAgentTemplates: Record<string, AgentTemplate>
  let capturedMessages: Message[] = []

  beforeAll(() => {
    // Mock logger
    mockModule('@codebuff/backend/util/logger', () => ({
      logger: {
        debug: () => {},
        error: () => {},
        info: () => {},
        warn: () => {},
      },
      withLoggerContext: async (context: any, fn: () => Promise<any>) => fn(),
    }))
  })

  beforeEach(() => {
    capturedMessages = []

    // Setup mock agent templates
    mockLocalAgentTemplates = {
      parent: {
        id: 'parent',
        displayName: 'Parent Agent',
        outputMode: 'last_message',
        inputSchema: {},
        spawnerPrompt: '',
        model: 'anthropic/claude-sonnet-4',
        includeMessageHistory: false,
        inheritParentSystemPrompt: false,
        mcpServers: {},
        toolNames: [],
        spawnableAgents: ['child'],
        systemPrompt: 'Parent agent system prompt for testing',
        instructionsPrompt: '',
        stepPrompt: '',
      } satisfies AgentTemplate,
      child: {
        id: 'child',
        displayName: 'Child Agent',
        outputMode: 'last_message',
        inputSchema: {},
        spawnerPrompt: '',
        model: 'anthropic/claude-sonnet-4', // Same model as parent
        includeMessageHistory: false,
        inheritParentSystemPrompt: true, // Should inherit parent's system prompt
        mcpServers: {},
        toolNames: [],
        spawnableAgents: [],
        systemPrompt: '', // Must be empty when inheritParentSystemPrompt is true
        instructionsPrompt: '',
        stepPrompt: '',
      } satisfies AgentTemplate,
    }

    // Mock LLM API to capture messages and end turn immediately
    spyOn(aisdk, 'promptAiSdkStream').mockImplementation(
      async function* (options) {
        // Capture the messages sent to the LLM
        capturedMessages = options.messages

        // Simulate immediate end turn
        yield {
          type: 'text' as const,
          text: 'Test response',
        }

        if (options.onCostCalculated) {
          await options.onCostCalculated(1)
        }

        return 'mock-message-id'
      },
    )

    // Mock file operations
    spyOn(websocketAction, 'requestFiles').mockImplementation(
      async (params: { ws: any; filePaths: string[] }) => {
        const results: Record<string, string | null> = {}
        params.filePaths.forEach((path) => {
          results[path] = null
        })
        return results
      },
    )

    spyOn(websocketAction, 'requestToolCall').mockImplementation(
      async (ws, userInputId, toolName, input) => {
        return {
          output: [
            {
              type: 'json',
              value: { message: 'Success' },
            },
          ],
        }
      },
    )

    // Mock live user input
    const liveUserInputs = require('../live-user-inputs')
    spyOn(liveUserInputs, 'checkLiveUserInput').mockImplementation(() => true)
  })

  afterEach(() => {
    mock.restore()
  })

  afterAll(() => {
    clearMockedModules()
  })

  it('should inherit parent system prompt when inheritParentSystemPrompt is true', async () => {
    const sessionState = getInitialSessionState(mockFileContext)
    const ws = new MockWebSocket() as unknown as WebSocket

    // Run parent agent first to establish system prompt
    const parentResult = await loopAgentSteps(ws, {
      userInputId: 'test-parent',
      prompt: 'Parent task',
      params: undefined,
      agentType: 'parent',
      agentState: sessionState.mainAgentState,
      fingerprintId: 'test-fingerprint',
      fileContext: mockFileContext,
      localAgentTemplates: mockLocalAgentTemplates,
      userId: TEST_USER_ID,
      clientSessionId: 'test-session',
      onResponseChunk: () => {},
    })

    // Capture parent's messages which include the system prompt
    const parentMessages = capturedMessages
    expect(parentMessages.length).toBeGreaterThan(0)
    expect(parentMessages[0].role).toBe('system')
    const parentSystemPrompt = parentMessages[0].content as string
    expect(parentSystemPrompt).toContain(
      'Parent agent system prompt for testing',
    )

    // Now run child agent with inheritParentSystemPrompt and parentSystemPrompt
    capturedMessages = []
    const childAgentState = {
      ...sessionState.mainAgentState,
      agentId: 'child-agent',
      agentType: 'child' as const,
      messageHistory: [],
    }

    await loopAgentSteps(ws, {
      userInputId: 'test-child',
      prompt: 'Child task',
      params: undefined,
      agentType: 'child',
      agentState: childAgentState,
      fingerprintId: 'test-fingerprint',
      fileContext: mockFileContext,
      localAgentTemplates: mockLocalAgentTemplates,
      userId: TEST_USER_ID,
      clientSessionId: 'test-session',
      onResponseChunk: () => {},
      parentSystemPrompt: parentSystemPrompt,
    })

    // Verify child uses parent's system prompt
    const childMessages = capturedMessages
    expect(childMessages.length).toBeGreaterThan(0)
    expect(childMessages[0].role).toBe('system')
    expect(childMessages[0].content).toBe(parentSystemPrompt)
  })

  it('should generate own system prompt when inheritParentSystemPrompt is false', async () => {
    const sessionState = getInitialSessionState(mockFileContext)
    const ws = new MockWebSocket() as unknown as WebSocket

    // Create a child agent that does NOT inherit parent system prompt
    const standaloneChild: AgentTemplate = {
      id: 'standalone-child',
      displayName: 'Standalone Child',
      outputMode: 'last_message',
      inputSchema: {},
      spawnerPrompt: '',
      model: 'anthropic/claude-sonnet-4',
      includeMessageHistory: false,
      inheritParentSystemPrompt: false,
      mcpServers: {},
      toolNames: [],
      spawnableAgents: [],
      systemPrompt: 'Standalone child system prompt',
      instructionsPrompt: '',
      stepPrompt: '',
    }

    mockLocalAgentTemplates['standalone-child'] = standaloneChild

    // Run parent agent first
    const parentResult = await loopAgentSteps(ws, {
      userInputId: 'test-parent',
      prompt: 'Parent task',
      params: undefined,
      agentType: 'parent',
      agentState: sessionState.mainAgentState,
      fingerprintId: 'test-fingerprint',
      fileContext: mockFileContext,
      localAgentTemplates: mockLocalAgentTemplates,
      userId: TEST_USER_ID,
      clientSessionId: 'test-session',
      onResponseChunk: () => {},
    })

    const parentMessages = capturedMessages
    const parentSystemPrompt = parentMessages[0].content as string

    // Run child agent with inheritParentSystemPrompt=false
    capturedMessages = []
    const childAgentState = {
      ...sessionState.mainAgentState,
      agentId: 'child-agent',
      agentType: 'standalone-child' as const,
      messageHistory: [],
    }

    await loopAgentSteps(ws, {
      userInputId: 'test-child',
      prompt: 'Child task',
      params: undefined,
      agentType: 'standalone-child',
      agentState: childAgentState,
      fingerprintId: 'test-fingerprint',
      fileContext: mockFileContext,
      localAgentTemplates: mockLocalAgentTemplates,
      userId: TEST_USER_ID,
      clientSessionId: 'test-session',
      onResponseChunk: () => {},
      parentSystemPrompt: parentSystemPrompt,
    })

    const childMessages = capturedMessages

    // Verify child uses its own system prompt (not parent's)
    expect(childMessages[0].role).toBe('system')
    expect(childMessages[0].content).not.toBe(parentSystemPrompt)
    expect(childMessages[0].content).toContain('Standalone child system prompt')
  })

  it('should work independently: includeMessageHistory without inheritParentSystemPrompt', async () => {
    const sessionState = getInitialSessionState(mockFileContext)
    const ws = new MockWebSocket() as unknown as WebSocket

    // Create a child that includes message history but uses its own system prompt
    const messageHistoryChild: AgentTemplate = {
      id: 'message-history-child',
      displayName: 'Message History Child',
      outputMode: 'last_message',
      inputSchema: {},
      spawnerPrompt: '',
      model: 'anthropic/claude-sonnet-4',
      includeMessageHistory: true, // Includes message history
      inheritParentSystemPrompt: false, // But uses own system prompt
      mcpServers: {},
      toolNames: [],
      spawnableAgents: [],
      systemPrompt: 'Child with message history system prompt',
      instructionsPrompt: '',
      stepPrompt: '',
    }

    mockLocalAgentTemplates['message-history-child'] = messageHistoryChild

    // Run parent agent first
    await loopAgentSteps(ws, {
      userInputId: 'test-parent',
      prompt: 'Parent task',
      params: undefined,
      agentType: 'parent',
      agentState: sessionState.mainAgentState,
      fingerprintId: 'test-fingerprint',
      fileContext: mockFileContext,
      localAgentTemplates: mockLocalAgentTemplates,
      userId: TEST_USER_ID,
      clientSessionId: 'test-session',
      onResponseChunk: () => {},
    })

    const parentMessages = capturedMessages
    const parentSystemPrompt = parentMessages[0].content as string

    // Run child agent
    capturedMessages = []
    const childAgentState = {
      ...sessionState.mainAgentState,
      agentId: 'child-agent',
      agentType: 'message-history-child' as const,
      messageHistory: [
        { role: 'user' as const, content: 'Previous message' },
        { role: 'assistant' as const, content: 'Previous response' },
      ],
    }

    await loopAgentSteps(ws, {
      userInputId: 'test-child',
      prompt: 'Child task',
      params: undefined,
      agentType: 'message-history-child',
      agentState: childAgentState,
      fingerprintId: 'test-fingerprint',
      fileContext: mockFileContext,
      localAgentTemplates: mockLocalAgentTemplates,
      userId: TEST_USER_ID,
      clientSessionId: 'test-session',
      onResponseChunk: () => {},
      parentSystemPrompt: parentSystemPrompt,
    })

    const childMessages = capturedMessages

    // Verify child uses its own system prompt (not parent's)
    expect(childMessages[0].role).toBe('system')
    expect(childMessages[0].content).not.toBe(parentSystemPrompt)
    expect(childMessages[0].content).toContain(
      'Child with message history system prompt',
    )

    // Verify message history was included
    expect(childMessages.length).toBeGreaterThan(2)
    const hasMessageHistory = childMessages.some(
      (msg) => msg.role === 'user' && msg.content === 'Previous message',
    )
    expect(hasMessageHistory).toBe(true)
  })

  it('should validate that agents with inheritParentSystemPrompt cannot have custom systemPrompt', () => {
    const {
      DynamicAgentTemplateSchema,
    } = require('@codebuff/common/types/dynamic-agent-template')

    // Valid: inheritParentSystemPrompt with empty systemPrompt
    const validAgent = {
      id: 'valid-agent',
      displayName: 'Valid',
      model: 'anthropic/claude-sonnet-4',
      inheritParentSystemPrompt: true,
      systemPrompt: '',
      instructionsPrompt: '',
      stepPrompt: '',
    }
    const validResult = DynamicAgentTemplateSchema.safeParse(validAgent)
    expect(validResult.success).toBe(true)

    // Invalid: inheritParentSystemPrompt with custom systemPrompt
    const invalidAgent = {
      id: 'invalid-agent',
      displayName: 'Invalid',
      model: 'anthropic/claude-sonnet-4',
      inheritParentSystemPrompt: true,
      systemPrompt: 'Custom system prompt',
      instructionsPrompt: '',
      stepPrompt: '',
    }
    const invalidResult = DynamicAgentTemplateSchema.safeParse(invalidAgent)
    expect(invalidResult.success).toBe(false)
    if (!invalidResult.success) {
      expect(invalidResult.error.message).toContain(
        'Cannot specify both systemPrompt and inheritParentSystemPrompt',
      )
    }
  })

  it('should enable prompt caching with matching system prompt prefix', async () => {
    const sessionState = getInitialSessionState(mockFileContext)
    const ws = new MockWebSocket() as unknown as WebSocket

    // Run parent agent
    const parentResult = await loopAgentSteps(ws, {
      userInputId: 'test-parent',
      prompt: 'Parent task',
      params: undefined,
      agentType: 'parent',
      agentState: sessionState.mainAgentState,
      fingerprintId: 'test-fingerprint',
      fileContext: mockFileContext,
      localAgentTemplates: mockLocalAgentTemplates,
      userId: TEST_USER_ID,
      clientSessionId: 'test-session',
      onResponseChunk: () => {},
    })

    const parentMessages = capturedMessages
    const parentSystemPrompt = parentMessages[0].content as string

    // Run child agent with inheritParentSystemPrompt=true
    capturedMessages = []
    const childAgentState = {
      ...sessionState.mainAgentState,
      agentId: 'child-agent',
      agentType: 'child' as const,
      messageHistory: [],
    }

    await loopAgentSteps(ws, {
      userInputId: 'test-child',
      prompt: 'Child task',
      params: undefined,
      agentType: 'child',
      agentState: childAgentState,
      fingerprintId: 'test-fingerprint',
      fileContext: mockFileContext,
      localAgentTemplates: mockLocalAgentTemplates,
      userId: TEST_USER_ID,
      clientSessionId: 'test-session',
      onResponseChunk: () => {},
      parentSystemPrompt: parentSystemPrompt,
    })

    const childMessages = capturedMessages

    // Verify both agents use the same system prompt
    expect(parentMessages[0].role).toBe('system')
    expect(childMessages[0].role).toBe('system')
    expect(childMessages[0].content).toBe(parentMessages[0].content)

    // This matching system prompt enables prompt caching:
    // Both agents will have the same system message at the start,
    // allowing the LLM provider to cache and reuse the system prompt
  })

  it('should support both inheritParentSystemPrompt and includeMessageHistory together', async () => {
    const sessionState = getInitialSessionState(mockFileContext)
    const ws = new MockWebSocket() as unknown as WebSocket

    // Create a child that inherits system prompt AND includes message history
    const fullInheritChild: AgentTemplate = {
      id: 'full-inherit-child',
      displayName: 'Full Inherit Child',
      outputMode: 'last_message',
      inputSchema: {},
      spawnerPrompt: '',
      model: 'anthropic/claude-sonnet-4',
      includeMessageHistory: true, // Includes message history
      inheritParentSystemPrompt: true, // AND inherits system prompt
      mcpServers: {},
      toolNames: [],
      spawnableAgents: [],
      systemPrompt: '', // Must be empty
      instructionsPrompt: '',
      stepPrompt: '',
    }

    mockLocalAgentTemplates['full-inherit-child'] = fullInheritChild

    // Run parent agent first with some message history
    const parentResult = await loopAgentSteps(ws, {
      userInputId: 'test-parent',
      prompt: 'Parent task',
      params: undefined,
      agentType: 'parent',
      agentState: {
        ...sessionState.mainAgentState,
        messageHistory: [
          { role: 'user' as const, content: 'Initial question' },
          { role: 'assistant' as const, content: 'Initial answer' },
        ],
      },
      fingerprintId: 'test-fingerprint',
      fileContext: mockFileContext,
      localAgentTemplates: mockLocalAgentTemplates,
      userId: TEST_USER_ID,
      clientSessionId: 'test-session',
      onResponseChunk: () => {},
    })

    const parentMessages = capturedMessages
    const parentSystemPrompt = parentMessages[0].content as string

    // Run child agent
    capturedMessages = []
    const childAgentState = {
      ...sessionState.mainAgentState,
      agentId: 'child-agent',
      agentType: 'full-inherit-child' as const,
      messageHistory: [
        { role: 'user' as const, content: 'Initial question' },
        { role: 'assistant' as const, content: 'Initial answer' },
      ],
    }

    await loopAgentSteps(ws, {
      userInputId: 'test-child',
      prompt: 'Child task',
      params: undefined,
      agentType: 'full-inherit-child',
      agentState: childAgentState,
      fingerprintId: 'test-fingerprint',
      fileContext: mockFileContext,
      localAgentTemplates: mockLocalAgentTemplates,
      userId: TEST_USER_ID,
      clientSessionId: 'test-session',
      onResponseChunk: () => {},
      parentSystemPrompt: parentSystemPrompt,
    })

    const childMessages = capturedMessages

    // Verify child inherits parent's system prompt
    expect(childMessages[0].role).toBe('system')
    expect(childMessages[0].content).toBe(parentSystemPrompt)

    // Verify message history was included
    expect(childMessages.length).toBeGreaterThan(2)
    const hasMessageHistory = childMessages.some(
      (msg) => msg.role === 'user' && msg.content === 'Initial question',
    )
    expect(hasMessageHistory).toBe(true)
  })
})
