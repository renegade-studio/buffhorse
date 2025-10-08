// Set environment variables before any imports
process.env.LINKUP_API_KEY = 'test-api-key'

import * as bigquery from '@codebuff/bigquery'
import * as analytics from '@codebuff/common/analytics'
import { TEST_USER_ID } from '@codebuff/common/old-constants'
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

import researcherAgent from '../../../.agents/researcher'
import * as checkTerminalCommandModule from '../check-terminal-command'
import * as requestFilesPrompt from '../find-files/request-files-prompt'
import * as liveUserInputs from '../live-user-inputs'
import { MockWebSocket, mockFileContext } from './test-utils'
import * as linkupApi from '../llm-apis/linkup-api'
import * as aisdk from '../llm-apis/vercel-ai-sdk/ai-sdk'
import { runAgentStep } from '../run-agent-step'
import { assembleLocalAgentTemplates } from '../templates/agent-registry'
import * as websocketAction from '../websockets/websocket-action'

import type { Logger } from '@codebuff/types/logger'
import type { WebSocket } from 'ws'

function mockAgentStream(content: string | string[]) {
  spyOn(aisdk, 'promptAiSdkStream').mockImplementation(async function* ({}) {
    if (typeof content === 'string') {
      content = [content]
    }
    for (const chunk of content) {
      yield { type: 'text' as const, text: chunk }
    }
    return 'mock-message-id'
  })
}

describe('web_search tool with researcher agent', () => {
  const logger: Logger = {
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {},
  }

  beforeEach(() => {
    // Mock analytics and tracing
    spyOn(analytics, 'initAnalytics').mockImplementation(() => {})
    analytics.initAnalytics({ logger })
    spyOn(analytics, 'trackEvent').mockImplementation(() => {})
    spyOn(bigquery, 'insertTrace').mockImplementation(() =>
      Promise.resolve(true),
    )

    // Mock websocket actions
    spyOn(websocketAction, 'requestFiles').mockImplementation(async () => ({}))
    spyOn(websocketAction, 'requestFile').mockImplementation(async () => null)
    spyOn(websocketAction, 'requestToolCall').mockImplementation(async () => ({
      output: [
        {
          type: 'json',
          value: 'Tool call success',
        },
      ],
    }))

    // Mock LLM APIs
    spyOn(aisdk, 'promptAiSdk').mockImplementation(() =>
      Promise.resolve('Test response'),
    )

    // Mock other required modules
    spyOn(requestFilesPrompt, 'requestRelevantFiles').mockImplementation(
      async () => [],
    )
    spyOn(
      checkTerminalCommandModule,
      'checkTerminalCommand',
    ).mockImplementation(async () => null)

    // Mock live user inputs
    spyOn(liveUserInputs, 'checkLiveUserInput').mockImplementation(() => true)
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

  test('should call searchWeb function when web_search tool is used', async () => {
    const mockSearchResult = 'Test search result'

    spyOn(linkupApi, 'searchWeb').mockImplementation(
      async () => mockSearchResult,
    )

    const mockResponse =
      getToolCallString('web_search', {
        query: 'test query',
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates(
      mockFileContextWithAgents,
    )

    await runAgentStep(new MockWebSocket() as unknown as WebSocket, {
      system: 'Test system prompt',
      userId: TEST_USER_ID,
      userInputId: 'test-input',
      clientSessionId: 'test-session',
      fingerprintId: 'test-fingerprint',
      onResponseChunk: () => {},
      agentType: 'researcher',
      fileContext: mockFileContext,
      localAgentTemplates: agentTemplates,
      agentState,
      prompt: 'Search for test',
      params: undefined,
    })

    // Just verify that searchWeb was called
    expect(linkupApi.searchWeb).toHaveBeenCalledWith('test query', {
      depth: 'standard',
    })
  })

  test('should successfully perform web search with basic query', async () => {
    const mockSearchResult =
      'Next.js 15 introduces new features including improved performance and React 19 support. You can explore the latest features and improvements in Next.js 15.'

    spyOn(linkupApi, 'searchWeb').mockImplementation(
      async () => mockSearchResult,
    )

    const mockResponse =
      getToolCallString('web_search', {
        query: 'Next.js 15 new features',
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates(
      mockFileContextWithAgents,
    )

    const { agentState: newAgentState } = await runAgentStep(
      new MockWebSocket() as unknown as WebSocket,
      {
        system: 'Test system prompt',
        userId: TEST_USER_ID,
        userInputId: 'test-input',
        clientSessionId: 'test-session',
        fingerprintId: 'test-fingerprint',
        onResponseChunk: () => {},
        agentType: 'researcher',
        fileContext: mockFileContext,
        localAgentTemplates: agentTemplates,
        agentState,
        prompt: 'Search for Next.js 15 new features',
        params: undefined,
      },
    )

    expect(linkupApi.searchWeb).toHaveBeenCalledWith(
      'Next.js 15 new features',
      {
        depth: 'standard',
      },
    )

    // Check that the search results were added to the message history
    const toolResultMessages = newAgentState.messageHistory.filter(
      (m) => m.role === 'tool' && m.content.toolName === 'web_search',
    )
    expect(toolResultMessages.length).toBeGreaterThan(0)
    expect(
      JSON.stringify(toolResultMessages[toolResultMessages.length - 1].content),
    ).toContain(mockSearchResult)
  })

  test('should handle custom depth parameter', async () => {
    const mockSearchResult =
      'A comprehensive guide to React Server Components and their implementation.'

    spyOn(linkupApi, 'searchWeb').mockImplementation(
      async () => mockSearchResult,
    )

    const mockResponse =
      getToolCallString('web_search', {
        query: 'React Server Components tutorial',
        depth: 'deep',
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates(
      mockFileContextWithAgents,
    )

    await runAgentStep(new MockWebSocket() as unknown as WebSocket, {
      system: 'Test system prompt',
      userId: TEST_USER_ID,
      userInputId: 'test-input',
      clientSessionId: 'test-session',
      fingerprintId: 'test-fingerprint',
      onResponseChunk: () => {},
      agentType: 'researcher',
      fileContext: mockFileContext,
      localAgentTemplates: agentTemplates,
      agentState,
      prompt: 'Search for React Server Components tutorial with deep search',
      params: undefined,
    })

    expect(linkupApi.searchWeb).toHaveBeenCalledWith(
      'React Server Components tutorial',
      {
        depth: 'deep',
      },
    )
  })

  test('should handle case when no search results are found', async () => {
    spyOn(linkupApi, 'searchWeb').mockImplementation(async () => null)

    const mockResponse =
      getToolCallString('web_search', {
        query: 'very obscure search query that returns nothing',
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates(
      mockFileContextWithAgents,
    )

    const { agentState: newAgentState } = await runAgentStep(
      new MockWebSocket() as unknown as WebSocket,
      {
        system: 'Test system prompt',
        userId: TEST_USER_ID,
        userInputId: 'test-input',
        clientSessionId: 'test-session',
        fingerprintId: 'test-fingerprint',
        onResponseChunk: () => {},
        agentType: 'researcher',
        fileContext: mockFileContext,
        localAgentTemplates: agentTemplates,
        agentState,
        prompt: "Search for something that doesn't exist",
        params: undefined,
      },
    )

    // Verify that searchWeb was called
    expect(linkupApi.searchWeb).toHaveBeenCalledWith(
      'very obscure search query that returns nothing',
      {
        depth: 'standard',
      },
    )

    // Check that the "no results found" message was added
    const toolResultMessages = newAgentState.messageHistory.filter(
      (m) => m.role === 'tool' && m.content.toolName === 'web_search',
    )
    expect(toolResultMessages.length).toBeGreaterThan(0)
    expect(
      JSON.stringify(toolResultMessages[toolResultMessages.length - 1].content),
    ).toContain('No search results found')
  })

  test('should handle API errors gracefully', async () => {
    const mockError = new Error('Linkup API timeout')

    spyOn(linkupApi, 'searchWeb').mockImplementation(async () => {
      throw mockError
    })

    const mockResponse =
      getToolCallString('web_search', {
        query: 'test query',
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates(
      mockFileContextWithAgents,
    )

    const { agentState: newAgentState } = await runAgentStep(
      new MockWebSocket() as unknown as WebSocket,
      {
        system: 'Test system prompt',
        userId: TEST_USER_ID,
        userInputId: 'test-input',
        clientSessionId: 'test-session',
        fingerprintId: 'test-fingerprint',
        onResponseChunk: () => {},
        agentType: 'researcher',
        fileContext: mockFileContext,
        localAgentTemplates: agentTemplates,
        agentState,
        prompt: 'Search for something',
        params: undefined,
      },
    )

    // Verify that searchWeb was called
    expect(linkupApi.searchWeb).toHaveBeenCalledWith('test query', {
      depth: 'standard',
    })

    // Check that the error message was added
    const toolResultMessages = newAgentState.messageHistory.filter(
      (m) => m.role === 'tool' && m.content.toolName === 'web_search',
    )
    expect(toolResultMessages.length).toBeGreaterThan(0)
    expect(
      JSON.stringify(toolResultMessages[toolResultMessages.length - 1].content),
    ).toContain('Error performing web search')
    expect(
      JSON.stringify(toolResultMessages[toolResultMessages.length - 1].content),
    ).toContain('Linkup API timeout')
  })

  test('should handle null response from searchWeb', async () => {
    spyOn(linkupApi, 'searchWeb').mockImplementation(async () => null)

    const mockResponse =
      getToolCallString('web_search', {
        query: 'test query',
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates(
      mockFileContextWithAgents,
    )

    const { agentState: newAgentState } = await runAgentStep(
      new MockWebSocket() as unknown as WebSocket,
      {
        system: 'Test system prompt',
        userId: TEST_USER_ID,
        userInputId: 'test-input',
        clientSessionId: 'test-session',
        fingerprintId: 'test-fingerprint',
        onResponseChunk: () => {},
        agentType: 'researcher',
        fileContext: mockFileContext,
        localAgentTemplates: agentTemplates,
        agentState,
        prompt: 'Search for something',
        params: undefined,
      },
    )

    // Verify that searchWeb was called
    expect(linkupApi.searchWeb).toHaveBeenCalledWith('test query', {
      depth: 'standard',
    })
  })

  test('should handle non-Error exceptions', async () => {
    spyOn(linkupApi, 'searchWeb').mockImplementation(async () => {
      throw 'String error'
    })

    const mockResponse =
      getToolCallString('web_search', {
        query: 'test query',
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates(
      mockFileContextWithAgents,
    )

    const { agentState: newAgentState } = await runAgentStep(
      new MockWebSocket() as unknown as WebSocket,
      {
        system: 'Test system prompt',
        userId: TEST_USER_ID,
        userInputId: 'test-input',
        clientSessionId: 'test-session',
        fingerprintId: 'test-fingerprint',
        onResponseChunk: () => {},
        agentType: 'researcher',
        fileContext: mockFileContext,
        localAgentTemplates: agentTemplates,
        agentState,
        prompt: 'Search for something',
        params: undefined,
      },
    )

    // Verify that searchWeb was called
    expect(linkupApi.searchWeb).toHaveBeenCalledWith('test query', {
      depth: 'standard',
    })

    // Check that the error message was added
    const toolResultMessages = newAgentState.messageHistory.filter(
      (m) => m.role === 'tool' && m.content.toolName === 'web_search',
    )
    expect(toolResultMessages.length).toBeGreaterThan(0)
    expect(
      JSON.stringify(toolResultMessages[toolResultMessages.length - 1].content),
    ).toContain('Error performing web search')
  })

  test('should format search results correctly', async () => {
    const mockSearchResult =
      'This is the first search result content. This is the second search result content.'

    spyOn(linkupApi, 'searchWeb').mockImplementation(
      async () => mockSearchResult,
    )

    const mockResponse =
      getToolCallString('web_search', {
        query: 'test formatting',
      }) + getToolCallString('end_turn', {})

    mockAgentStream(mockResponse)

    const sessionState = getInitialSessionState(mockFileContextWithAgents)
    const agentState = {
      ...sessionState.mainAgentState,
      agentType: 'researcher' as const,
    }
    const { agentTemplates } = assembleLocalAgentTemplates(
      mockFileContextWithAgents,
    )

    const { agentState: newAgentState } = await runAgentStep(
      new MockWebSocket() as unknown as WebSocket,
      {
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
        prompt: 'Test search result formatting',
        params: undefined,
      },
    )

    // Verify that searchWeb was called
    expect(linkupApi.searchWeb).toHaveBeenCalledWith('test formatting', {
      depth: 'standard',
    })

    // Check that the search results were formatted correctly
    const toolResultMessages = newAgentState.messageHistory.filter(
      (m) => m.role === 'tool' && m.content.toolName === 'web_search',
    )
    expect(toolResultMessages.length).toBeGreaterThan(0)
    expect(
      JSON.stringify(toolResultMessages[toolResultMessages.length - 1].content),
    ).toContain(mockSearchResult)
  })
})
