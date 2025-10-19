import { ToolCall } from 'types/agent-definition'
import { publisher } from '../constants'

import {
  PLACEHOLDER,
  type SecretAgentDefinition,
} from '../types/secret-agent-definition'

const definition: SecretAgentDefinition = {
  id: 'file-picker',
  displayName: 'Fletcher the File Fetcher',
  publisher,
  model: 'google/gemini-2.5-flash',
  spawnerPrompt:
    'Spawn to find relevant files in a codebase related to the prompt. Cannot do string searches on the codebase.',
  inputSchema: {
    prompt: {
      type: 'string',
      description: 'A coding task to complete',
    },
  },
  outputMode: 'last_message',
  includeMessageHistory: false,
  toolNames: ['find_files'],
  spawnableAgents: [],

  systemPrompt: `You are an expert at finding relevant files in a codebase. ${PLACEHOLDER.FILE_TREE_PROMPT_SMALL}`,

  instructionsPrompt: `Instructions:
Provide a short report of the locations in the codebase that could be helpful. Focus on the files that are most relevant to the user prompt.
In your report, please give a very concise analysis that includes the full paths of files that are relevant and (briefly) how they could be useful.
  `.trim(),

  handleSteps: function* ({ agentState, prompt, params }) {
    yield {
      toolName: 'find_files',
      input: { prompt: prompt ?? '' },
    } satisfies ToolCall
    yield 'STEP_ALL'
  },
}

export default definition
