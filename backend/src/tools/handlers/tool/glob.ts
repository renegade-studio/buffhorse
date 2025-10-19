import type { CodebuffToolHandlerFunction } from '@codebuff/agent-runtime/tools/handlers/handler-function-type'
import type {
  ClientToolCall,
  CodebuffToolCall,
  CodebuffToolOutput,
} from '@codebuff/common/tools/list'

type ToolName = 'glob'
export const handleGlob = ((params: {
  previousToolCallFinished: Promise<void>
  toolCall: CodebuffToolCall<ToolName>
  requestClientToolCall: (
    toolCall: ClientToolCall<ToolName>,
  ) => Promise<CodebuffToolOutput<ToolName>>
}): {
  result: Promise<CodebuffToolOutput<ToolName>>
  state: {}
} => {
  const { previousToolCallFinished, toolCall, requestClientToolCall } = params

  return {
    result: (async () => {
      await previousToolCallFinished
      return await requestClientToolCall(toolCall)
    })(),
    state: {},
  }
}) satisfies CodebuffToolHandlerFunction<ToolName>
