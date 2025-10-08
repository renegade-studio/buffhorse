import { CodebuffConfigSchema } from '@codebuff/common/json-config/constants'
import { escapeString } from '@codebuff/common/util/string'
import { schemaToJsonStr } from '@codebuff/common/util/zod-schema'
import { z } from 'zod/v4'

import { getAgentTemplate } from './agent-registry'
import { buildSpawnableAgentsDescription } from './prompts'
import { PLACEHOLDER, placeholderValues } from './types'
import {
  getGitChangesPrompt,
  getProjectFileTreePrompt,
  getSystemInfoPrompt,
} from '../system-prompt/prompts'
import {
  fullToolList,
  getShortToolInstructions,
  getToolsInstructions,
} from '../tools/prompts'
import { parseUserMessage } from '../util/messages'

import type { AgentTemplate, PlaceholderValue } from './types'
import type {
  AgentState,
  AgentTemplateType,
} from '@codebuff/common/types/session-state'
import type { ProjectFileContext } from '@codebuff/common/util/file'

export async function formatPrompt({
  prompt,
  fileContext,
  agentState,
  tools,
  spawnableAgents,
  agentTemplates,
  intitialAgentPrompt,
  additionalToolDefinitions,
}: {
  prompt: string
  fileContext: ProjectFileContext
  agentState: AgentState
  tools: readonly string[]
  spawnableAgents: AgentTemplateType[]
  agentTemplates: Record<string, AgentTemplate>
  intitialAgentPrompt?: string
  additionalToolDefinitions: () => Promise<
    ProjectFileContext['customToolDefinitions']
  >
}): Promise<string> {
  const { messageHistory } = agentState
  const lastUserMessage = messageHistory.findLast(
    ({ role, content }) =>
      role === 'user' &&
      typeof content === 'string' &&
      parseUserMessage(content),
  )
  const lastUserInput = lastUserMessage
    ? parseUserMessage(lastUserMessage.content as string)
    : undefined

  const agentTemplate = agentState.agentType
    ? await getAgentTemplate(agentState.agentType, agentTemplates)
    : null

  const toInject: Record<PlaceholderValue, () => string | Promise<string>> = {
    [PLACEHOLDER.AGENT_NAME]: () =>
      agentTemplate ? agentTemplate.displayName || 'Unknown Agent' : 'Buffy',
    [PLACEHOLDER.CONFIG_SCHEMA]: () => schemaToJsonStr(CodebuffConfigSchema),
    [PLACEHOLDER.FILE_TREE_PROMPT_SMALL]: () =>
      getProjectFileTreePrompt(fileContext, 2_500, 'agent'),
    [PLACEHOLDER.FILE_TREE_PROMPT]: () =>
      getProjectFileTreePrompt(fileContext, 10_000, 'agent'),
    [PLACEHOLDER.GIT_CHANGES_PROMPT]: () => getGitChangesPrompt(fileContext),
    [PLACEHOLDER.REMAINING_STEPS]: () => `${agentState.stepsRemaining!}`,
    [PLACEHOLDER.PROJECT_ROOT]: () => fileContext.projectRoot,
    [PLACEHOLDER.SYSTEM_INFO_PROMPT]: () => getSystemInfoPrompt(fileContext),
    [PLACEHOLDER.TOOLS_PROMPT]: async () =>
      getToolsInstructions(tools, await additionalToolDefinitions()),
    [PLACEHOLDER.AGENTS_PROMPT]: () =>
      buildSpawnableAgentsDescription(spawnableAgents, agentTemplates),
    [PLACEHOLDER.USER_CWD]: () => fileContext.cwd,
    [PLACEHOLDER.USER_INPUT_PROMPT]: () => escapeString(lastUserInput ?? ''),
    [PLACEHOLDER.INITIAL_AGENT_PROMPT]: () =>
      escapeString(intitialAgentPrompt ?? ''),
    [PLACEHOLDER.KNOWLEDGE_FILES_CONTENTS]: () =>
      Object.entries({
        ...Object.fromEntries(
          Object.entries(fileContext.knowledgeFiles)
            .filter(([path]) =>
              [
                'knowledge.md',
                'CLAUDE.md',
                'codebuff.json',
                'codebuff.jsonc',
              ].includes(path),
            )
            .map(([path, content]) => [path, content.trim()]),
        ),
        ...fileContext.userKnowledgeFiles,
      })
        .map(([path, content]) => {
          return `\`\`\`${path}\n${content.trim()}\n\`\`\``
        })
        .join('\n\n'),
  }

  for (const varName of placeholderValues) {
    const value = await (toInject[varName] ?? (() => ''))()
    prompt = prompt.replaceAll(varName, value)
  }
  return prompt
}
type StringField = 'systemPrompt' | 'instructionsPrompt' | 'stepPrompt'

export async function collectParentInstructions(params: {
  agentType: string
  agentTemplates: Record<string, AgentTemplate>
}): Promise<string[]> {
  const { agentType, agentTemplates } = params
  const instructions: string[] = []

  for (const template of Object.values(agentTemplates)) {
    if (template.parentInstructions) {
      const instruction = template.parentInstructions[agentType]
      if (instruction) {
        instructions.push(instruction)
      }
    }
  }

  return instructions
}

const additionalPlaceholders = {
  systemPrompt: [PLACEHOLDER.TOOLS_PROMPT, PLACEHOLDER.AGENTS_PROMPT],
  instructionsPrompt: [],
  stepPrompt: [],
} satisfies Record<StringField, string[]>
export async function getAgentPrompt<T extends StringField>({
  agentTemplate,
  promptType,
  fileContext,
  agentState,
  agentTemplates,
  additionalToolDefinitions,
}: {
  agentTemplate: AgentTemplate
  promptType: { type: T }
  fileContext: ProjectFileContext
  agentState: AgentState
  agentTemplates: Record<string, AgentTemplate>
  additionalToolDefinitions: () => Promise<
    ProjectFileContext['customToolDefinitions']
  >
}): Promise<string | undefined> {
  let promptValue = agentTemplate[promptType.type]
  for (const placeholder of additionalPlaceholders[promptType.type]) {
    if (!promptValue.includes(placeholder)) {
      promptValue += `\n\n${placeholder}`
    }
  }

  if (promptValue === undefined) {
    return undefined
  }

  let prompt = await formatPrompt({
    prompt: promptValue,
    fileContext,
    agentState,
    tools: agentTemplate.toolNames,
    spawnableAgents: agentTemplate.spawnableAgents,
    agentTemplates,
    additionalToolDefinitions,
  })

  let addendum = ''

  if (promptType.type === 'stepPrompt' && agentState.agentType) {
    // Put step prompt within a system_reminder tag so agent doesn't think the user just spoke again.
    prompt = `<system_reminder>${prompt}</system_reminder>`
  }

  // Add tool instructions, spawnable agents, and output schema prompts to instructionsPrompt
  if (promptType.type === 'instructionsPrompt' && agentState.agentType) {
    const toolsInstructions = agentTemplate.inheritParentSystemPrompt
      ? fullToolList(agentTemplate.toolNames, await additionalToolDefinitions())
      : getShortToolInstructions(
          agentTemplate.toolNames,
          await additionalToolDefinitions(),
        )
    addendum +=
      '\n\n' +
      toolsInstructions +
      '\n\n' +
      (await buildSpawnableAgentsDescription(
        agentTemplate.spawnableAgents,
        agentTemplates,
      ))

    const parentInstructions = await collectParentInstructions({
      agentType: agentState.agentType,
      agentTemplates,
    })

    if (parentInstructions.length > 0) {
      addendum += '\n\n## Additional Instructions for Spawning Agents\n\n'
      addendum += parentInstructions
        .map((instruction) => `- ${instruction}`)
        .join('\n')
    }

    // Add output schema information if defined
    if (agentTemplate.outputSchema) {
      addendum += '\n\n## Output Schema\n\n'
      addendum +=
        'When using the set_output tool, your output must conform to this schema:\n\n'
      addendum += '```json\n'
      try {
        // Convert Zod schema to JSON schema for display
        const jsonSchema = z.toJSONSchema(agentTemplate.outputSchema, {
          io: 'input',
        })
        delete jsonSchema['$schema'] // Remove the $schema field for cleaner display
        addendum += JSON.stringify(jsonSchema, null, 2)
      } catch {
        // Fallback to a simple description
        addendum += JSON.stringify(
          { type: 'object', description: 'Output schema validation enabled' },
          null,
          2,
        )
      }
      addendum += '\n```'
    }
  }

  return prompt + addendum
}
