import {
  clearMockedModules,
  mockModule,
} from '@codebuff/common/testing/mock-modules'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'

import { searchWeb } from '../linkup-api'

// Mock environment variables
process.env.LINKUP_API_KEY = 'test-api-key'

describe('Linkup API', () => {
  // Mock logger with spy functions to verify logging calls
  const mockLogger = {
    debug: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
  }

  beforeAll(() => {
    mockModule('@codebuff/internal', () => ({
      env: {
        LINKUP_API_KEY: 'test-api-key',
      },
    }))

    // Mock withTimeout utility
    mockModule('@codebuff/common/util/promise', () => ({
      withTimeout: async (promise: Promise<any>, timeout: number) => promise,
    }))
  })

  beforeEach(() => {
    // Reset fetch mock before each test
    spyOn(global, 'fetch').mockResolvedValue(new Response())
    // Reset logger mocks
    mockLogger.debug.mockClear()
    mockLogger.error.mockClear()
    mockLogger.info.mockClear()
    mockLogger.warn.mockClear()
  })

  afterEach(() => {
    mock.restore()
  })

  afterAll(() => {
    clearMockedModules()
  })

  test('should successfully search with basic query', async () => {
    const mockResponse = {
      answer:
        'React is a JavaScript library for building user interfaces. You can learn how to build your first React application by following the official documentation.',
      sources: [
        {
          name: 'React Documentation',
          url: 'https://react.dev',
          snippet:
            'React is a JavaScript library for building user interfaces.',
        },
      ],
    }

    spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await searchWeb({
      query: 'React tutorial',
      logger: mockLogger,
    })

    expect(result).toBe(
      'React is a JavaScript library for building user interfaces. You can learn how to build your first React application by following the official documentation.',
    )

    // Verify fetch was called with correct parameters
    expect(fetch).toHaveBeenCalledWith(
      'https://api.linkup.so/v1/search',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-api-key',
        },
        body: JSON.stringify({
          q: 'React tutorial',
          depth: 'standard',
          outputType: 'sourcedAnswer',
        }),
      }),
    )
  })

  test('should handle custom depth', async () => {
    const mockResponse = {
      answer:
        'Advanced React patterns include render props, higher-order components, and custom hooks for building reusable and maintainable components.',
      sources: [
        {
          name: 'Advanced React Patterns',
          url: 'https://example.com/advanced-react',
          snippet: 'Deep dive into React patterns and best practices.',
        },
      ],
    }

    spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await searchWeb({
      query: 'React patterns',
      depth: 'deep',
      logger: mockLogger,
    })

    expect(result).toBe(
      'Advanced React patterns include render props, higher-order components, and custom hooks for building reusable and maintainable components.',
    )

    // Verify fetch was called with correct parameters
    expect(fetch).toHaveBeenCalledWith(
      'https://api.linkup.so/v1/search',
      expect.objectContaining({
        body: JSON.stringify({
          q: 'React patterns',
          depth: 'deep',
          outputType: 'sourcedAnswer',
        }),
      }),
    )
  })

  test('should handle API errors gracefully', async () => {
    spyOn(global, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', {
        status: 500,
        statusText: 'Internal Server Error',
      }),
    )

    const result = await searchWeb({ query: 'test query', logger: mockLogger })

    expect(result).toBeNull()
  })

  test('should handle network errors', async () => {
    spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'))

    const result = await searchWeb({ query: 'test query', logger: mockLogger })

    expect(result).toBeNull()
  })

  test('should handle invalid response format', async () => {
    spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ invalid: 'format' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await searchWeb({ query: 'test query', logger: mockLogger })

    expect(result).toBeNull()
  })

  test('should handle missing answer field', async () => {
    spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sources: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await searchWeb({ query: 'test query', logger: mockLogger })

    expect(result).toBeNull()
  })
  test('should handle empty answer', async () => {
    const mockResponse = {
      answer: '',
      sources: [],
    }

    spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await searchWeb({ query: 'test query', logger: mockLogger })

    expect(result).toBeNull()
  })

  test('should use default options when none provided', async () => {
    const mockResponse = {
      answer: 'Test answer content',
      sources: [
        { name: 'Test', url: 'https://example.com', snippet: 'Test content' },
      ],
    }

    spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await searchWeb({ query: 'test query', logger: mockLogger })

    // Verify fetch was called with default parameters
    expect(fetch).toHaveBeenCalledWith(
      'https://api.linkup.so/v1/search',
      expect.objectContaining({
        body: JSON.stringify({
          q: 'test query',
          depth: 'standard',
          outputType: 'sourcedAnswer',
        }),
      }),
    )
  })

  test('should handle malformed JSON response', async () => {
    spyOn(global, 'fetch').mockResolvedValue(
      new Response('invalid json{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await searchWeb({ query: 'test query', logger: mockLogger })

    expect(result).toBeNull()
    // Verify that error logging was called
    expect(mockLogger.error).toHaveBeenCalled()
  })

  test('should log detailed error information for 404 responses', async () => {
    const mockErrorResponse =
      'Not Found - The requested endpoint does not exist'
    spyOn(global, 'fetch').mockResolvedValue(
      new Response(mockErrorResponse, {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'text/plain' },
      }),
    )

    const result = await searchWeb({
      query: 'test query for 404',
      logger: mockLogger,
    })

    expect(result).toBeNull()
    // Verify that detailed error logging was called with 404 info
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 404,
        statusText: 'Not Found',
        responseBody: mockErrorResponse,
        requestUrl: 'https://api.linkup.so/v1/search',
        query: 'test query for 404',
      }),
      expect.stringContaining('404'),
    )
  })
})
