import * as analytics from '@codebuff/common/analytics'
import db from '@codebuff/common/db'
import { TEST_USER_ID } from '@codebuff/common/old-constants'
import {
  clearMockedModules,
  mockModule,
} from '@codebuff/common/testing/mock-modules'
import { getToolCallString } from '@codebuff/common/tools/utils'
import { getInitialSessionState } from '@codebuff/common/types/session-state'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'

import { withAppContext } from '../context/app-context'
import { loopAgentSteps } from '../run-agent-step'
import { clearAgentGeneratorCache } from '../run-programmatic-step'
import { mockFileContext, MockWebSocket } from './test-utils'
import * as aisdk from '../llm-apis/vercel-ai-sdk/ai-sdk'

import type { AgentTemplate } from '../templates/types'
import type { StepGenerator } from '@codebuff/common/types/agent-template'
import type { AgentState } from '@codebuff/common/types/session-state'
import type { WebSocket } from 'ws'
import { z } from 'zod/v4'

describe('loopAgentSteps - runAgentStep vs runProgrammaticStep behavior', () => {
  let mockTemplate: AgentTemplate
  let mockAgentState: AgentState
  let llmCallCount: number

  const runLoopAgentStepsWithContext = async (
    ws: WebSocket,
    options: Parameters<typeof loopAgentSteps>[1],
  ) => {
    return await withAppContext(
      {
        userId: options.userId,
        clientSessionId: options.clientSessionId,
      },
      {
        currentUserId: options.userId,
        processedRepoId: 'test-repo',
      },
      async () => loopAgentSteps(ws, options),
    )
  }

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

    // Mock bigquery
    mockModule('@codebuff/bigquery', () => ({
      insertTrace: () => {},
    }))

    // Mock agent registry
    mockModule('@codebuff/backend/templates/agent-registry', () => ({
      getAgentTemplate: async (agentType: string, localTemplates: any) => {
        return localTemplates[agentType] || mockTemplate
      },
    }))

    // Mock template strings
    mockModule('@codebuff/backend/templates/strings', () => ({
      getAgentPrompt: async () => 'Mock prompt',
    }))

    // Mock live user inputs - default to true to allow tests to run
    mockModule('@codebuff/backend/live-user-inputs', () => ({
      checkLiveUserInput: () => true,
      resetLiveUserInputsState: () => {},
      startUserInput: () => {},
      endUserInput: () => {},
      cancelUserInput: () => {},
      setSessionConnected: () => {},
      getLiveUserInputIds: () => undefined,
    }))

    // Mock file reading updates
    mockModule('@codebuff/backend/get-file-reading-updates', () => ({
      getFileReadingUpdates: async () => [],
    }))
  })

  beforeEach(() => {
    clearAgentGeneratorCache()

    llmCallCount = 0

    // Setup spies for database operations
    spyOn(db, 'insert').mockReturnValue({
      values: mock(() => {
        return Promise.resolve({ id: 'test-run-id' })
      }),
    } as any)

    spyOn(db, 'update').mockReturnValue({
      set: mock(() => ({
        where: mock(() => {
          return Promise.resolve()
        }),
      })),
    } as any)

    spyOn(aisdk, 'promptAiSdkStream').mockImplementation(async function* ({}) {
      llmCallCount++
      yield {
        type: 'text' as const,
        text: `LLM response\n\n${getToolCallString('end_turn', {})}`,
      }
      return 'mock-message-id'
    })

    // Mock analytics
    spyOn(analytics, 'initAnalytics').mockImplementation(() => {})
    spyOn(analytics, 'trackEvent').mockImplementation(() => {})

    // Mock crypto.randomUUID
    spyOn(crypto, 'randomUUID').mockImplementation(
      () => 'mock-uuid-0000-0000-0000-000000000000' as const,
    )

    // Create mock template with programmatic agent
    mockTemplate = {
      id: 'test-agent',
      displayName: 'Test Agent',
      spawnerPrompt: 'Testing',
      model: 'claude-3-5-sonnet-20241022',
      inputSchema: {},
      outputMode: 'structured_output',
      includeMessageHistory: true,
      inheritParentSystemPrompt: false,
      mcpServers: {},
      toolNames: ['read_files', 'write_file', 'end_turn'],
      spawnableAgents: [],
      systemPrompt: 'Test system prompt',
      instructionsPrompt: 'Test user prompt',
      stepPrompt: 'Test agent step prompt',
      handleSteps: undefined, // Will be set in individual tests
    } as AgentTemplate

    // Create mock agent state
    const sessionState = getInitialSessionState(mockFileContext)
    mockAgentState = {
      ...sessionState.mainAgentState,
      agentId: 'test-agent-id',
      messageHistory: [
        { role: 'user', content: 'Initial message' },
        { role: 'assistant', content: 'Initial response' },
      ],
      output: undefined,
      stepsRemaining: 10, // Ensure we don't hit the limit
    }
  })

  afterEach(() => {
    clearAgentGeneratorCache()

    mock.restore()
  })

  afterAll(() => {
    clearMockedModules()
  })

  it('should verify correct STEP behavior - LLM called once after STEP', async () => {
    // This test verifies that when a programmatic agent yields STEP,
    // the LLM should be called once in the next iteration

    let stepCount = 0
    const mockGeneratorFunction = function* () {
      stepCount++
      // Execute a tool, then STEP
      yield { toolName: 'read_files', input: { paths: ['file1.txt'] } }
      yield 'STEP' // Should pause here and let LLM run
      // Continue after LLM runs (this won't be reached in this test since LLM ends turn)
      yield {
        toolName: 'write_file',
        input: { path: 'output.txt', content: 'test' },
      }
      yield { toolName: 'end_turn', input: {} }
    } as () => StepGenerator

    mockTemplate.handleSteps = mockGeneratorFunction

    const localAgentTemplates = {
      'test-agent': mockTemplate,
    }

    const result = await runLoopAgentStepsWithContext(
      new MockWebSocket() as unknown as WebSocket,
      {
        userInputId: 'test-user-input',
        agentType: 'test-agent',
        agentState: mockAgentState,
        prompt: 'Test prompt',
        params: undefined,
        fingerprintId: 'test-fingerprint',
        fileContext: mockFileContext,
        localAgentTemplates,
        userId: TEST_USER_ID,
        clientSessionId: 'test-session',
        onResponseChunk: () => {},
      },
    )

    console.log(`LLM calls made: ${llmCallCount}`)
    console.log(`Step count: ${stepCount}`)

    // CORRECT BEHAVIOR: After STEP, LLM should be called once
    // The programmatic agent yields STEP, then LLM runs once and ends turn
    expect(llmCallCount).toBe(1) // LLM called once after STEP

    // The programmatic agent should have been called once (yielded STEP)
    expect(stepCount).toBe(1)
  })

  it('should demonstrate correct behavior when programmatic agent completes without STEP', async () => {
    // This test shows that when a programmatic agent doesn't yield STEP,
    // it should complete without calling the LLM at all (since it ends with end_turn)

    const mockGeneratorFunction = function* () {
      yield { toolName: 'read_files', input: { paths: ['file1.txt'] } }
      yield {
        toolName: 'write_file',
        input: { path: 'output.txt', content: 'test' },
      }
      yield { toolName: 'end_turn', input: {} }
    } as () => StepGenerator

    mockTemplate.handleSteps = mockGeneratorFunction

    const localAgentTemplates = {
      'test-agent': mockTemplate,
    }

    const result = await runLoopAgentStepsWithContext(
      new MockWebSocket() as unknown as WebSocket,
      {
        userInputId: 'test-user-input',
        agentType: 'test-agent',
        agentState: mockAgentState,
        prompt: 'Test prompt',
        params: undefined,
        fingerprintId: 'test-fingerprint',
        fileContext: mockFileContext,
        localAgentTemplates,
        userId: TEST_USER_ID,
        clientSessionId: 'test-session',
        onResponseChunk: () => {},
      },
    )

    // Should NOT call LLM since the programmatic agent ended with end_turn
    expect(llmCallCount).toBe(0)
    // The result should have agentState
    expect(result.agentState).toBeDefined()
  })

  it('should run programmatic step first, then LLM step, then continue', async () => {
    // This test verifies the correct execution order in loopAgentSteps:
    // 1. Programmatic step runs first and yields STEP
    // 2. LLM step runs once
    // 3. Loop continues but generator is complete after first STEP

    let stepCount = 0
    const mockGeneratorFunction = function* () {
      stepCount++
      // First execution: do some work, then STEP
      yield { toolName: 'read_files', input: { paths: ['file1.txt'] } }
      yield 'STEP' // Hand control to LLM
      // After LLM runs, continue (this happens in the same generator instance)
      yield {
        toolName: 'write_file',
        input: { path: 'output.txt', content: 'updated by LLM' },
      }
      yield { toolName: 'end_turn', input: {} }
    } as () => StepGenerator

    mockTemplate.handleSteps = mockGeneratorFunction

    const localAgentTemplates = {
      'test-agent': mockTemplate,
    }

    const result = await runLoopAgentStepsWithContext(
      new MockWebSocket() as unknown as WebSocket,
      {
        userInputId: 'test-user-input',
        agentType: 'test-agent',
        agentState: mockAgentState,
        prompt: 'Test execution order',
        params: undefined,
        fingerprintId: 'test-fingerprint',
        fileContext: mockFileContext,
        localAgentTemplates,
        userId: TEST_USER_ID,
        clientSessionId: 'test-session',
        onResponseChunk: () => {},
      },
    )

    // Verify execution order:
    // 1. Programmatic step function was called once (creates generator)
    // 2. LLM was called once after STEP
    // 3. Generator continued after LLM step
    expect(stepCount).toBe(1) // Generator function called once
    expect(llmCallCount).toBe(1) // LLM called once after first STEP
    expect(result.agentState).toBeDefined()
  })

  it('should handle programmatic agent that yields STEP_ALL', async () => {
    // Test STEP_ALL behavior - should run LLM then continue with programmatic step

    let stepCount = 0
    const mockGeneratorFunction = function* () {
      stepCount++
      yield { toolName: 'read_files', input: { paths: ['file1.txt'] } }
      yield 'STEP_ALL' // Hand all remaining control to LLM
      // Should continue after LLM completes all its steps
      yield {
        toolName: 'write_file',
        input: { path: 'final.txt', content: 'done' },
      }
      yield { toolName: 'end_turn', input: {} }
    } as () => StepGenerator

    mockTemplate.handleSteps = mockGeneratorFunction

    const localAgentTemplates = {
      'test-agent': mockTemplate,
    }

    const result = await runLoopAgentStepsWithContext(
      new MockWebSocket() as unknown as WebSocket,
      {
        userInputId: 'test-user-input',
        agentType: 'test-agent',
        agentState: mockAgentState,
        prompt: 'Test STEP_ALL behavior',
        params: undefined,
        fingerprintId: 'test-fingerprint',
        fileContext: mockFileContext,
        localAgentTemplates,
        userId: TEST_USER_ID,
        clientSessionId: 'test-session',
        onResponseChunk: () => {},
      },
    )

    expect(stepCount).toBe(1) // Generator function called once
    expect(llmCallCount).toBe(1) // LLM should be called once
    expect(result.agentState).toBeDefined()
  })

  it('should not call LLM when programmatic agent returns without STEP', async () => {
    // Test that programmatic agents that don't yield STEP don't trigger LLM

    const mockGeneratorFunction = function* () {
      yield { toolName: 'read_files', input: { paths: ['test.txt'] } }
      yield {
        toolName: 'write_file',
        input: { path: 'result.txt', content: 'processed' },
      }
      // No STEP - agent completes without LLM involvement
      yield { toolName: 'end_turn', input: {} }
    } as () => StepGenerator

    mockTemplate.handleSteps = mockGeneratorFunction

    const localAgentTemplates = {
      'test-agent': mockTemplate,
    }

    const result = await runLoopAgentStepsWithContext(
      new MockWebSocket() as unknown as WebSocket,
      {
        userInputId: 'test-user-input',
        agentType: 'test-agent',
        agentState: mockAgentState,
        prompt: 'Test no LLM call',
        params: undefined,
        fingerprintId: 'test-fingerprint',
        fileContext: mockFileContext,
        localAgentTemplates,
        userId: TEST_USER_ID,
        clientSessionId: 'test-session',
        onResponseChunk: () => {},
      },
    )

    expect(llmCallCount).toBe(0) // No LLM calls should be made
    expect(result.agentState).toBeDefined()
  })

  it('should handle LLM-only agent (no handleSteps)', async () => {
    // Test traditional LLM-based agents that don't have handleSteps

    const llmOnlyTemplate = {
      ...mockTemplate,
      handleSteps: undefined, // No programmatic step function
    }

    const localAgentTemplates = {
      'test-agent': llmOnlyTemplate,
    }

    const result = await runLoopAgentStepsWithContext(
      new MockWebSocket() as unknown as WebSocket,
      {
        userInputId: 'test-user-input',
        agentType: 'test-agent',
        agentState: mockAgentState,
        prompt: 'Test LLM-only agent',
        params: undefined,
        fingerprintId: 'test-fingerprint',
        fileContext: mockFileContext,
        localAgentTemplates,
        userId: TEST_USER_ID,
        clientSessionId: 'test-session',
        onResponseChunk: () => {},
      },
    )

    expect(llmCallCount).toBe(1) // LLM should be called once
    expect(result.agentState).toBeDefined()
  })

  it('should handle programmatic agent error and still call LLM', async () => {
    // Test error handling in programmatic step - should still allow LLM to run

    const mockGeneratorFunction = function* () {
      yield { toolName: 'read_files', input: { paths: ['file1.txt'] } }
      throw new Error('Programmatic step failed')
    } as () => StepGenerator

    mockTemplate.handleSteps = mockGeneratorFunction

    const localAgentTemplates = {
      'test-agent': mockTemplate,
    }

    const result = await runLoopAgentStepsWithContext(
      new MockWebSocket() as unknown as WebSocket,
      {
        userInputId: 'test-user-input',
        agentType: 'test-agent',
        agentState: mockAgentState,
        prompt: 'Test error handling',
        params: undefined,
        fingerprintId: 'test-fingerprint',
        fileContext: mockFileContext,
        localAgentTemplates,
        userId: TEST_USER_ID,
        clientSessionId: 'test-session',
        onResponseChunk: () => {},
      },
    )

    // After programmatic step error, should end turn and not call LLM
    expect(llmCallCount).toBe(0)
    expect(result.agentState).toBeDefined()
    expect(result.agentState.output?.error).toContain(
      'Error executing handleSteps for agent test-agent',
    )
  })

  it('should handle mixed execution with multiple STEP yields', async () => {
    // Test complex scenario with multiple STEP yields and LLM interactions
    // Note: In current implementation, LLM typically ends turn after running,
    // so this tests the first STEP interaction

    let stepCount = 0
    const mockGeneratorFunction = function* () {
      stepCount++
      yield { toolName: 'read_files', input: { paths: ['input.txt'] } }
      yield 'STEP' // First LLM interaction
      yield {
        toolName: 'write_file',
        input: { path: 'temp.txt', content: 'intermediate' },
      }
      yield {
        toolName: 'write_file',
        input: { path: 'final.txt', content: 'complete' },
      }
      yield { toolName: 'end_turn', input: {} }
    } as () => StepGenerator

    mockTemplate.handleSteps = mockGeneratorFunction

    const localAgentTemplates = {
      'test-agent': mockTemplate,
    }

    const result = await runLoopAgentStepsWithContext(
      new MockWebSocket() as unknown as WebSocket,
      {
        userInputId: 'test-user-input',
        agentType: 'test-agent',
        agentState: mockAgentState,
        prompt: 'Test multiple STEP interactions',
        params: undefined,
        fingerprintId: 'test-fingerprint',
        fileContext: mockFileContext,
        localAgentTemplates,
        userId: TEST_USER_ID,
        clientSessionId: 'test-session',
        onResponseChunk: () => {},
      },
    )

    expect(stepCount).toBe(1) // Generator function called once
    expect(llmCallCount).toBe(1) // LLM called once after STEP
    expect(result.agentState).toBeDefined()
  })
  it('should pass shouldEndTurn: true as stepsComplete when end_turn tool is called', async () => {
    // Test that when LLM calls end_turn, shouldEndTurn is correctly passed to runProgrammaticStep

    let runProgrammaticStepCalls: any[] = []

    // Mock runProgrammaticStep module to capture calls and verify stepsComplete parameter
    const mockedRunProgrammaticStep = await mockModule(
      '@codebuff/backend/run-programmatic-step',
      () => ({
        runProgrammaticStep: async (agentState: any, options: any) => {
          runProgrammaticStepCalls.push({ agentState, options })
          // Return default behavior
          return { agentState, endTurn: false }
        },
        clearAgentGeneratorCache: () => {},
        agentIdToStepAll: new Set(),
      }),
    )

    const mockGeneratorFunction = function* () {
      yield 'STEP' // Hand control to LLM
    } as () => StepGenerator

    mockTemplate.handleSteps = mockGeneratorFunction

    const localAgentTemplates = {
      'test-agent': mockTemplate,
    }

    await runLoopAgentStepsWithContext(
      new MockWebSocket() as unknown as WebSocket,
      {
        userInputId: 'test-user-input',
        agentType: 'test-agent',
        agentState: mockAgentState,
        prompt: 'Test shouldEndTurn to stepsComplete flow',
        params: undefined,
        fingerprintId: 'test-fingerprint',
        fileContext: mockFileContext,
        localAgentTemplates,
        userId: TEST_USER_ID,
        clientSessionId: 'test-session',
        onResponseChunk: () => {},
      },
    )

    mockedRunProgrammaticStep.clear()

    // Verify that runProgrammaticStep was called twice:
    // 1. First with stepsComplete: false (initial call)
    // 2. Second with stepsComplete: true (after LLM called end_turn)
    expect(runProgrammaticStepCalls).toHaveLength(2)

    // First call should have stepsComplete: false
    expect(runProgrammaticStepCalls[0].options.stepsComplete).toBe(false)

    // Second call should have stepsComplete: true (after end_turn tool was called)
    expect(runProgrammaticStepCalls[1].options.stepsComplete).toBe(true)
  })

  it('should restart loop when agent finishes without setting required output', async () => {
    // Test that when an agent has outputSchema but finishes without calling set_output,
    // the loop restarts with a system message

    const outputSchema = z.object({
      result: z.string(),
      status: z.string(),
    })

    const templateWithOutputSchema = {
      ...mockTemplate,
      outputSchema,
      toolNames: ['set_output', 'end_turn'], // Add set_output to available tools
      handleSteps: undefined, // LLM-only agent
    }

    const localAgentTemplates = {
      'test-agent': templateWithOutputSchema,
    }

    let llmCallNumber = 0
    let capturedAgentState: AgentState | null = null

    spyOn(aisdk, 'promptAiSdkStream').mockImplementation(async function* ({}) {
      llmCallNumber++
      if (llmCallNumber === 1) {
        // First call: agent tries to end turn without setting output
        yield {
          type: 'text' as const,
          text: `First response without output\n\n${getToolCallString('end_turn', {})}`,
        }
      } else if (llmCallNumber === 2) {
        // Second call: agent sets output after being reminded
        // Manually set the output to simulate the set_output tool execution
        if (capturedAgentState) {
          capturedAgentState.output = {
            result: 'test result',
            status: 'success',
          }
        }
        yield {
          type: 'text' as const,
          text: `Setting output now\n\n${getToolCallString('set_output', { result: 'test result', status: 'success' })}\n\n${getToolCallString('end_turn', {})}`,
        }
      } else {
        // Safety: if called more than twice, just end
        yield {
          type: 'text' as const,
          text: `Ending\n\n${getToolCallString('end_turn', {})}`,
        }
      }
      return 'mock-message-id'
    })

    mockAgentState.output = undefined
    capturedAgentState = mockAgentState

    const result = await runLoopAgentStepsWithContext(
      new MockWebSocket() as unknown as WebSocket,
      {
        userInputId: 'test-user-input',
        agentType: 'test-agent',
        agentState: mockAgentState,
        prompt: 'Test output schema validation',
        params: undefined,
        fingerprintId: 'test-fingerprint',
        fileContext: mockFileContext,
        localAgentTemplates,
        userId: TEST_USER_ID,
        clientSessionId: 'test-session',
        onResponseChunk: () => {},
      },
    )

    // Should call LLM twice: once to try ending without output, once after reminder
    expect(llmCallNumber).toBe(2)

    // Should have output set after the second attempt
    expect(result.agentState.output).toEqual({
      result: 'test result',
      status: 'success',
    })

    // Check that a system message was added to message history
    const systemMessages = result.agentState.messageHistory.filter(
      (msg) =>
        msg.role === 'user' &&
        typeof msg.content === 'string' &&
        msg.content.includes('set_output'),
    )
    expect(systemMessages.length).toBeGreaterThan(0)
  })

  it('should not restart loop if output is set correctly', async () => {
    // Test that when an agent has outputSchema and sets output correctly,
    // the loop ends normally without restarting

    const outputSchema = z.object({
      result: z.string(),
    })

    const templateWithOutputSchema = {
      ...mockTemplate,
      outputSchema,
      toolNames: ['set_output', 'end_turn'],
      handleSteps: undefined,
    }

    const localAgentTemplates = {
      'test-agent': templateWithOutputSchema,
    }

    let llmCallNumber = 0
    let capturedAgentState: AgentState | null = null

    spyOn(aisdk, 'promptAiSdkStream').mockImplementation(async function* ({}) {
      llmCallNumber++
      // Agent sets output correctly on first call
      if (capturedAgentState) {
        capturedAgentState.output = { result: 'success' }
      }
      yield {
        type: 'text' as const,
        text: `Setting output\n\n${getToolCallString('set_output', { result: 'success' })}\n\n${getToolCallString('end_turn', {})}`,
      }
      return 'mock-message-id'
    })

    mockAgentState.output = undefined
    capturedAgentState = mockAgentState

    const result = await runLoopAgentStepsWithContext(
      new MockWebSocket() as unknown as WebSocket,
      {
        userInputId: 'test-user-input',
        agentType: 'test-agent',
        agentState: mockAgentState,
        prompt: 'Test with correct output',
        params: undefined,
        fingerprintId: 'test-fingerprint',
        fileContext: mockFileContext,
        localAgentTemplates,
        userId: TEST_USER_ID,
        clientSessionId: 'test-session',
        onResponseChunk: () => {},
      },
    )

    // Should only call LLM once since output was set correctly
    expect(llmCallNumber).toBe(1)

    // Should have output set
    expect(result.agentState.output).toEqual({ result: 'success' })
  })

  it('should allow agents without outputSchema to end normally', async () => {
    // Test that agents without outputSchema can end without setting output

    const templateWithoutOutputSchema = {
      ...mockTemplate,
      outputSchema: undefined,
      handleSteps: undefined,
    }

    const localAgentTemplates = {
      'test-agent': templateWithoutOutputSchema,
    }

    let llmCallNumber = 0
    spyOn(aisdk, 'promptAiSdkStream').mockImplementation(async function* ({}) {
      llmCallNumber++
      yield {
        type: 'text' as const,
        text: `Response without output\n\n${getToolCallString('end_turn', {})}`,
      }
      return 'mock-message-id'
    })

    const result = await runLoopAgentStepsWithContext(
      new MockWebSocket() as unknown as WebSocket,
      {
        userInputId: 'test-user-input',
        agentType: 'test-agent',
        agentState: mockAgentState,
        prompt: 'Test without output schema',
        params: undefined,
        fingerprintId: 'test-fingerprint',
        fileContext: mockFileContext,
        localAgentTemplates,
        userId: TEST_USER_ID,
        clientSessionId: 'test-session',
        onResponseChunk: () => {},
      },
    )

    // Should only call LLM once and end normally
    expect(llmCallNumber).toBe(1)

    // Output should be undefined since no outputSchema required
    expect(result.agentState.output).toBeUndefined()
  })

  it('should continue loop if agent does not end turn (has more work)', async () => {
    // Test that validation only triggers when shouldEndTurn is true

    const outputSchema = z.object({
      result: z.string(),
    })

    const templateWithOutputSchema = {
      ...mockTemplate,
      outputSchema,
      toolNames: ['read_files', 'set_output', 'end_turn'],
      handleSteps: undefined,
    }

    const localAgentTemplates = {
      'test-agent': templateWithOutputSchema,
    }

    let llmCallNumber = 0
    let capturedAgentState: AgentState | null = null

    spyOn(aisdk, 'promptAiSdkStream').mockImplementation(async function* ({}) {
      llmCallNumber++
      if (llmCallNumber === 1) {
        // First call: agent does some work but doesn't end turn
        yield {
          type: 'text' as const,
          text: `Doing work\n\n${getToolCallString('read_files', { paths: ['test.txt'] })}`,
        }
      } else {
        // Second call: agent sets output and ends
        if (capturedAgentState) {
          capturedAgentState.output = { result: 'done' }
        }
        yield {
          type: 'text' as const,
          text: `Finishing\n\n${getToolCallString('set_output', { result: 'done' })}\n\n${getToolCallString('end_turn', {})}`,
        }
      }
      return 'mock-message-id'
    })

    mockAgentState.output = undefined
    capturedAgentState = mockAgentState

    const result = await runLoopAgentStepsWithContext(
      new MockWebSocket() as unknown as WebSocket,
      {
        userInputId: 'test-user-input',
        agentType: 'test-agent',
        agentState: mockAgentState,
        prompt: 'Test loop continues',
        params: undefined,
        fingerprintId: 'test-fingerprint',
        fileContext: mockFileContext,
        localAgentTemplates,
        userId: TEST_USER_ID,
        clientSessionId: 'test-session',
        onResponseChunk: () => {},
      },
    )

    // Should call LLM twice: once for work, once to set output and end
    expect(llmCallNumber).toBe(2)

    // Should have output set
    expect(result.agentState.output).toEqual({ result: 'done' })
  })
})
