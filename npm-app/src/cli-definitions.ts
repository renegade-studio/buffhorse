export interface CliParam {
  flags: string
  description: string
  menuDescription?: string
  menuDetails?: string[]
  hidden?: boolean
}

export const cliArguments: CliParam[] = [
  {
    flags: '[initial-prompt...]',
    description: 'Initial prompt to send',
    menuDescription: 'Initial prompt to send to Codebuff',
  },
]

export const cliOptions: CliParam[] = [
  {
    flags: '--create <template> [name]',
    description: 'Create new project from template',
    menuDetails: [
      'Available templates: nextjs, convex, vite, remix, node-cli,',
      'python-cli, chrome-extension',
      'See all: https://github.com/CodebuffAI/codebuff-community',
    ],
  },
  {
    flags: '--init',
    description:
      'Initialize codebuff on this project for a smoother experience',
    menuDescription: 'Initialize Codebuff for the project',
  },
  {
    flags: '--agent <agent-id>',
    description:
      'Specify which agent to invoke (e.g., "file-picker", "reviewer", "base")',
    menuDescription: 'Invoke a specific agent by ID',
    hidden: false,
  },
  {
    flags: '--params <json>',
    description: 'JSON parameters to pass to the agent',
    menuDescription: 'JSON parameters for the agent',
    hidden: false,
  },
  {
    flags: '--spawn <agent-id>',
    description: 'Spawn a specific agent by ID',
    menuDescription: 'Spawn a specific agent by ID',
    hidden: false,
  },
  {
    flags: '--model <model>',
    description:
      'Specify the main model to use for the agent. Defaults to "gemma3n".',
    menuDescription: 'Specify main LLM (e.g., "gemma3n")',
    hidden: false,
  },
  {
    flags: '--provider <provider>',
    description:
      'Specify the AI provider. Options: "anthropic", "google", "openai", "vllm", "ollama", "lmstudio", "ollm". Defaults to OpenRouter.',
    menuDescription: 'Specify the AI provider (e.g., "ollama")',
    hidden: false,
  },
  {
    flags: '--lite',
    description: 'Use budget models & fetch fewer files',
    menuDescription: 'Use budget models & fetch fewer files (faster)',
    hidden: false,
  },
  {
    flags: '--max',
    description: 'Use higher quality models and fetch more files',
    menuDescription:
      'Use higher quality models and fetch more files (thorough)',
    hidden: false,
  },
  {
    flags: '--ask',
    description: "Start in ask mode (won't change code)",
    menuDescription: "Start in ask mode (won't change code)",
    hidden: false,
  },
  {
    flags: '--experimental',
    description: 'Use cutting-edge experimental features and models',
    hidden: true,
  },
  {
    flags: '--print, -p',
    description:
      'Print-only mode: run until first response completes then exit (requires prompt or params)',
    menuDescription: 'Print-only mode: run once then exit',
    hidden: false,
  },
  {
    flags: '--cwd <directory>',
    description: 'Set the working directory (default: current directory)',
    menuDescription: 'Set the working directory',
    hidden: false,
  },
  {
    flags: '--trace',
    description: 'Log all subagent messages to .agents/traces/*.log files',
    menuDescription: 'Log subagent messages to trace files',
    hidden: false,
  },
  {
    flags: '--force',
    description: 'Force overwrite existing shims',
    hidden: true,
  },
]
