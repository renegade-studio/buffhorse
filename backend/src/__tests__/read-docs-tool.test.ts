import { assembleLocalAgentTemplates } from '@codebuff/agent-runtime/templates/agent-registry'
import * as bigquery from '@codebuff/bigquery'
import * as analytics from '@codebuff/common/analytics'
import { TEST_USER_ID } from '@codebuff/common/old-constants'
import {
  TEST_AGENT_RUNTIME_IMPL,
  TEST_AGENT_RUNTIME_SCOPED_IMPL,
} from '@codebuff/common/testing/impl/agent-runtime'
import { getToolCallString } from '@codebuff/common/tools/utils'
import { getInitialSessionState } from '@codebuff/common/types/session-state'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'

import researcherAgent from '../../../.agents/researcher/researcher'
import * as checkTerminalCommandModule from '../check-terminal-command'
import * as requestFilesPrompt from '../find-files/request-files-prompt'
import * as liveUserInputs from '../live-user-inputs'
import { mockFileContext } from './test-utils'
import * as context7Api from '../llm-apis/context7-api'
import { runAgentStep } from '../run-agent-step'

import type {
  AgentRuntimeDeps,
  AgentRuntimeScopedDeps,
} from '@codebuff/common/types/contracts/agent-runtime'

let agentRuntimeImpl: AgentRuntimeDeps

function mockAgentStream(content: string | string[]) {
  agentRuntimeImpl.promptAiSdkStream = async function* ({}) {
    if (typeof content === 'string') {
      content = [content]
    }
    for (const chunk of content) {
      yield { type: 'text' as const, text: chunk }
    }
    return 'mock-message-id'
  }
}

describe('read_docs tool with researcher agent', () => {
  // Track all mocked functions to verify they're being used
  const mockedFunctions: Array<{ name: string; spy: any }> = []
  let agentRuntimeScopedImpl: AgentRuntimeScopedDeps

  beforeEach(() => {
    agentRuntimeImpl = { ...TEST_AGENT_RUNTIME_IMPL }
    agentRuntimeScopedImpl = {
      ...TEST_AGENT_RUNTIME_SCOPED_IMPL,
      sendAction: () => {},
    }

    // Clear tracked mocks
    mockedFunctions.length = 0

    // Mock analytics and tracing
    const analyticsInitSpy = spyOn(
      analytics,
      'initAnalytics',
    ).mockImplementation(() => {})
    mockedFunctions.push({
      name: 'analytics.initAnalytics',
      spy: analyticsInitSpy,
    })
    analytics.initAnalytics(agentRuntimeImpl)

    const trackEventSpy = spyOn(analytics, 'trackEvent').mockImplementation(
      () => {},
    )
    mockedFunctions.push({ name: 'analytics.trackEvent', spy: trackEventSpy })

    const flushAnalyticsSpy = spyOn(
      analytics,
      'flushAnalytics',
    ).mockImplementation(() => Promise.resolve())
    mockedFunctions.push({
      name: 'analytics.flushAnalytics',
      spy: flushAnalyticsSpy,
    })

    const insertTraceSpy = spyOn(bigquery, 'insertTrace').mockImplementation(
      () => Promise.resolve(true),
    )
    mockedFunctions.push({ name: 'bigquery.insertTrace', spy: insertTraceSpy })

    // Mock websocket actions
    agentRuntimeScopedImpl.requestFiles = async () => ({})
    agentRuntimeScopedImpl.requestOptionalFile = async () => null
    agentRuntimeScopedImpl.requestToolCall = async () => ({
      output: [
        {
          type: 'json',
          value: 'Tool call success',
        },
      ],
    })

    // Mock other required modules
    const requestRelevantFilesSpy = spyOn(
      requestFilesPrompt,
      'requestRelevantFiles',
    ).mockImplementation(async () => [])
    mockedFunctions.push({
      name: 'requestFilesPrompt.requestRelevantFiles',
      spy: requestRelevantFilesSpy,
    })

    const checkTerminalCommandSpy = spyOn(
      checkTerminalCommandModule,
      'checkTerminalCommand',
    ).mockImplementation(async () => null)
    mockedFunctions.push({
      name: 'checkTerminalCommand',
      spy: checkTerminalCommandSpy,
    })

    // Mock live user inputs - these should return false to avoid waiting
    const checkLiveUserInputSpy = spyOn(
      liveUserInputs,
      'checkLiveUserInput',
    ).mockImplementation(() => false)
    mockedFunctions.push({
      name: 'liveUserInputs.checkLiveUserInput',
      spy: checkLiveUserInputSpy,
    })

    const startUserInputSpy = spyOn(
      liveUserInputs,
      'startUserInput',
    ).mockImplementation(() => {})
    mockedFunctions.push({
      name: 'liveUserInputs.startUserInput',
      spy: startUserInputSpy,
    })

    const cancelUserInputSpy = spyOn(
      liveUserInputs,
      'cancelUserInput',
    ).mockImplementation(() => {})
    mockedFunctions.push({
      name: 'liveUserInputs.cancelUserInput',
      spy: cancelUserInputSpy,
    })
  })

  afterEach(() => {
    mock.restore()
  })

  // MockWebSocket and mockFileContext imported from test-utils
  const mockFileContextWithAgents = {
    ...mockFileContext,
    agentTemplates: {
      researcher: researcherAgent,
    },
  }

  test('mock verification - ensure all mocks are properly set up', async () => {
    // Verify that all mocked functions are actually mocked
    for (const { name, spy } of mockedFunctions) {
      expect(spy.getMockImplementation()).toBeDefined()
      // Ensure the mock is callable without errors
      expect(() => {
        if (spy.getMockImplementation().constructor.name === 'AsyncFunction') {
          // For async functions, ensure they return a promise
          const result = spy.getMockImplementation()()
          expect(result).toBeInstanceOf(Promise)
        } else if (
          spy.getMockImplementation().constructor.name ===
          'AsyncGeneratorFunction'
        ) {
          // For async generators, ensure they return an async iterator
          const result = spy.getMockImplementation()()
          expect(result.next).toBeDefined()
        } else {
          // For sync functions, just call them
          spy.getMockImplementation()()
        }
      }).not.toThrow()
    }

    // Verify critical mocks that prevent hanging
    const liveUserInputMock = mockedFunctions.find(
      (m) => m.name === 'liveUserInputs.checkLiveUserInput',
    )
    expect(liveUserInputMock?.spy()).toBe(false) // Must return false to avoid waiting

    // Verify async mocks resolve properly
    const flushAnalyticsMock = mockedFunctions.find(
      (m) => m.name === 'analytics.flushAnalytics',
    )
    await expect(flushAnalyticsMock?.spy()).resolves.toBeUndefined()

    const insertTraceMock = mockedFunctions.find(
      (m) => m.name === 'bigquery.insertTrace',
    )
    await expect(insertTraceMock?.spy()).resolves.toBe(true)
  })

  test('should successfully fetch documentation with basic query', async () => {
    const mockDocumentation =
      'React is a JavaScript library for building user interfaces...'

    spyOn(context7Api, 'searchLibraries').mockImplementation(async () => [
      {
        id: 'react-123',
        title: 'React',
        description: 'A JavaScript library for building user interfaces',
        branch: 'main',
        lastUpdateDate: '2023-01-01',
        state: 'finalized',
        totalTokens: 10000,
        totalSnippets: 100,
        totalPages: 50,
      },
    ])
    spyOn(context7Api, 'fetchContext7LibraryDocumentation').mockImplementation(
      async () => mockDocumentation,
    )

    const mockResponse =
      getToolCallString('read_docs', {
        libraryTitle: 'React',
        topic: 'hooks',
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates({
      ...agentRuntimeImpl,
      fileContext: mockFileContextWithAgents,
    })

    const { agentState: newAgentState } = await runAgentStep({
      ...agentRuntimeImpl,
      ...agentRuntimeScopedImpl,
      system: 'Test system prompt',
      userId: TEST_USER_ID,
      userInputId: 'test-input',
      clientSessionId: 'test-session',
      fingerprintId: 'test-fingerprint',
      onResponseChunk: () => {},
      agentType: 'researcher',
      fileContext: mockFileContextWithAgents,
      localAgentTemplates: agentTemplates,
      agentState,
      prompt: 'Get React documentation',
      spawnParams: undefined,
    })

    expect(context7Api.fetchContext7LibraryDocumentation).toHaveBeenCalledWith({
      query: 'React',
      topic: 'hooks',
      logger: expect.anything(),
    })

    // Check that the documentation was added to the message history
    const toolResultMessages = newAgentState.messageHistory.filter(
      (m) => m.role === 'tool' && m.content.toolName === 'read_docs',
    )
    expect(toolResultMessages.length).toBeGreaterThan(0)
    expect(
      JSON.stringify(toolResultMessages[toolResultMessages.length - 1].content),
    ).toContain(JSON.stringify(mockDocumentation).slice(1, -1))
  }, 10000)

  test('should fetch documentation with topic and max_tokens', async () => {
    const mockDocumentation =
      'React hooks allow you to use state and other React features...'

    spyOn(context7Api, 'searchLibraries').mockImplementation(async () => [
      {
        id: 'react-123',
        title: 'React',
        description: 'A JavaScript library for building user interfaces',
        branch: 'main',
        lastUpdateDate: '2023-01-01',
        state: 'finalized',
        totalTokens: 10000,
        totalSnippets: 100,
        totalPages: 50,
      },
    ])
    spyOn(context7Api, 'fetchContext7LibraryDocumentation').mockImplementation(
      async () => mockDocumentation,
    )

    const mockResponse =
      getToolCallString('read_docs', {
        libraryTitle: 'React',
        topic: 'hooks',
        max_tokens: 5000,
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates({
      ...agentRuntimeImpl,
      fileContext: mockFileContextWithAgents,
    })

    await runAgentStep({
      ...agentRuntimeImpl,
      ...agentRuntimeScopedImpl,
      system: 'Test system prompt',
      userId: TEST_USER_ID,
      userInputId: 'test-input',
      clientSessionId: 'test-session',
      fingerprintId: 'test-fingerprint',
      onResponseChunk: () => {},
      agentType: 'researcher',
      fileContext: mockFileContextWithAgents,
      localAgentTemplates: agentTemplates,
      agentState,
      prompt: 'Get React hooks documentation',
      spawnParams: undefined,
    })

    expect(context7Api.fetchContext7LibraryDocumentation).toHaveBeenCalledWith({
      query: 'React',
      topic: 'hooks',
      tokens: 5000,
      logger: expect.anything(),
    })
  }, 10000)

  test('should handle case when no documentation is found', async () => {
    // Mock both searchLibraries and fetchContext7LibraryDocumentation to avoid network calls
    spyOn(context7Api, 'searchLibraries').mockImplementation(async () => [])
    spyOn(context7Api, 'fetchContext7LibraryDocumentation').mockImplementation(
      async () => null,
    )

    const mockResponse =
      getToolCallString('read_docs', {
        libraryTitle: 'NonExistentLibrary',
        topic: 'blah',
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates({
      ...agentRuntimeImpl,
      fileContext: mockFileContextWithAgents,
    })

    const { agentState: newAgentState } = await runAgentStep({
      ...agentRuntimeImpl,
      ...agentRuntimeScopedImpl,
      system: 'Test system prompt',
      userId: TEST_USER_ID,
      userInputId: 'test-input',
      clientSessionId: 'test-session',
      fingerprintId: 'test-fingerprint',
      onResponseChunk: () => {},
      agentType: 'researcher',
      fileContext: mockFileContextWithAgents,
      localAgentTemplates: agentTemplates,
      agentState,
      prompt: 'Get documentation for NonExistentLibrary',
      spawnParams: undefined,
    })

    // Check that the "no documentation found" message was added
    const toolResultMessages = newAgentState.messageHistory.filter(
      (m) => m.role === 'tool' && m.content.toolName === 'read_docs',
    )
    expect(toolResultMessages.length).toBeGreaterThan(0)
    expect(
      JSON.stringify(toolResultMessages[toolResultMessages.length - 1].content),
    ).toContain('No documentation found for \\"NonExistentLibrary\\"')
  }, 10000)

  test('should handle API errors gracefully', async () => {
    const mockError = new Error('Network timeout')

    spyOn(context7Api, 'searchLibraries').mockImplementation(async () => [
      {
        id: 'react-123',
        title: 'React',
        description: 'A JavaScript library for building user interfaces',
        branch: 'main',
        lastUpdateDate: '2023-01-01',
        state: 'finalized',
        totalTokens: 10000,
        totalSnippets: 100,
        totalPages: 50,
      },
    ])
    spyOn(context7Api, 'fetchContext7LibraryDocumentation').mockImplementation(
      async () => {
        throw mockError
      },
    )

    const mockResponse =
      getToolCallString('read_docs', {
        libraryTitle: 'React',
        topic: 'hooks',
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates({
      ...agentRuntimeImpl,
      fileContext: mockFileContextWithAgents,
    })

    const { agentState: newAgentState } = await runAgentStep({
      ...agentRuntimeImpl,
      ...agentRuntimeScopedImpl,
      system: 'Test system prompt',
      userId: TEST_USER_ID,
      userInputId: 'test-input',
      clientSessionId: 'test-session',
      fingerprintId: 'test-fingerprint',
      onResponseChunk: () => {},
      agentType: 'researcher',
      fileContext: mockFileContextWithAgents,
      localAgentTemplates: agentTemplates,
      agentState,
      prompt: 'Get React documentation',
      spawnParams: undefined,
    })

    // Check that the error message was added
    const toolResultMessages = newAgentState.messageHistory.filter(
      (m) => m.role === 'tool' && m.content.toolName === 'read_docs',
    )
    expect(toolResultMessages.length).toBeGreaterThan(0)
    expect(
      JSON.stringify(toolResultMessages[toolResultMessages.length - 1].content),
    ).toContain('Error fetching documentation for \\"React\\"')
    expect(
      JSON.stringify(toolResultMessages[toolResultMessages.length - 1].content),
    ).toContain('Network timeout')
  }, 10000)

  test('should include topic in error message when specified', async () => {
    spyOn(context7Api, 'searchLibraries').mockImplementation(async () => [
      {
        id: 'react-123',
        title: 'React',
        description: 'A JavaScript library for building user interfaces',
        branch: 'main',
        lastUpdateDate: '2023-01-01',
        state: 'finalized',
        totalTokens: 10000,
        totalSnippets: 100,
        totalPages: 50,
      },
    ])
    spyOn(context7Api, 'fetchContext7LibraryDocumentation').mockImplementation(
      async () => null,
    )

    const mockResponse =
      getToolCallString('read_docs', {
        libraryTitle: 'React',
        topic: 'server-components',
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates({
      ...agentRuntimeImpl,
      fileContext: mockFileContextWithAgents,
    })

    const { agentState: newAgentState } = await runAgentStep({
      ...agentRuntimeImpl,
      ...agentRuntimeScopedImpl,
      system: 'Test system prompt',
      userId: TEST_USER_ID,
      userInputId: 'test-input',
      clientSessionId: 'test-session',
      fingerprintId: 'test-fingerprint',
      onResponseChunk: () => {},
      agentType: 'researcher',
      fileContext: mockFileContextWithAgents,
      localAgentTemplates: agentTemplates,
      agentState,
      prompt: 'Get React server components documentation',
      spawnParams: undefined,
    })

    // Check that the topic is included in the error message
    const toolResultMessages = newAgentState.messageHistory.filter(
      (m) => m.role === 'tool' && m.content.toolName === 'read_docs',
    )
    expect(toolResultMessages.length).toBeGreaterThan(0)
    expect(
      JSON.stringify(toolResultMessages[toolResultMessages.length - 1].content),
    ).toContain(
      'No documentation found for \\"React\\" with topic \\"server-components\\"',
    )
  }, 10000)

  test('should handle non-Error exceptions', async () => {
    spyOn(context7Api, 'searchLibraries').mockImplementation(async () => [
      {
        id: 'react-123',
        title: 'React',
        description: 'A JavaScript library for building user interfaces',
        branch: 'main',
        lastUpdateDate: '2023-01-01',
        state: 'finalized',
        totalTokens: 10000,
        totalSnippets: 100,
        totalPages: 50,
      },
    ])
    spyOn(context7Api, 'fetchContext7LibraryDocumentation').mockImplementation(
      async () => {
        throw 'String error'
      },
    )

    const mockResponse =
      getToolCallString('read_docs', {
        libraryTitle: 'React',
        topic: 'hooks',
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates({
      ...agentRuntimeImpl,
      fileContext: mockFileContextWithAgents,
    })

    const { agentState: newAgentState } = await runAgentStep({
      ...agentRuntimeImpl,
      ...agentRuntimeScopedImpl,
      system: 'Test system prompt',
      userId: TEST_USER_ID,
      userInputId: 'test-input',
      clientSessionId: 'test-session',
      fingerprintId: 'test-fingerprint',
      onResponseChunk: () => {},
      agentType: 'researcher',
      fileContext: mockFileContextWithAgents,
      localAgentTemplates: agentTemplates,
      agentState,
      prompt: 'Get React documentation',
      spawnParams: undefined,
    })

    // Check that the generic error message was added
    const toolResultMessages = newAgentState.messageHistory.filter(
      (m) => m.role === 'tool' && m.content.toolName === 'read_docs',
    )
    expect(toolResultMessages.length).toBeGreaterThan(0)
    expect(
      JSON.stringify(toolResultMessages[toolResultMessages.length - 1].content),
    ).toContain('Error fetching documentation for \\"React\\"')
    expect(
      JSON.stringify(toolResultMessages[toolResultMessages.length - 1].content),
    ).toContain('Unknown error')
  }, 10000)
})
