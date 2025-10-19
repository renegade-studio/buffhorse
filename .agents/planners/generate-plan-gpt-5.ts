import generatePlan from './generate-plan'
import type { SecretAgentDefinition } from '../types/secret-agent-definition'

const definition: SecretAgentDefinition = {
  ...generatePlan,
  id: 'generate-plan-gpt-5',
  model: 'openai/gpt-5',
}

export default definition
