#!/usr/bin/env node

import { type CostMode } from '@codebuff/common/old-constants'
import { AnalyticsEvent } from '@codebuff/common/constants/analytics-events'
import { Command, Option } from 'commander'
import { red, yellow, green, bold } from 'picocolors'

import { displayLoadedAgents, loadLocalAgents } from './agents/load-agents'
import { CLI } from './cli'
import { cliArguments, cliOptions } from './cli-definitions'
import { handlePublish } from './cli-handlers/publish'
import { handleInitAgents } from './cli-handlers/init-agents'
import { handleSaveAgent } from './cli-handlers/save-agent'
import {
  handleShimsInstall,
  handleShimsUninstall,
  handleShimsList,
  handleShimsUpdate,
  handleShimsDoctor,
  handleShimsUpgrade,
} from './cli-handlers/shims'
import { generateEvalCommand } from './shell-dispatcher'
import { npmAppVersion } from './config'
import { createTemplateProject } from './create-template-project'
import { printModeLog, setPrintMode } from './display/print-mode'
import { enableSquashNewlines } from './display/squash-newlines'
import { loadCodebuffConfig } from './json-config/parser'
import {
  getProjectRoot,
  getWorkingDirectory,
  initializeProjectRootAndWorkingDir,
  initProjectFileContextWithWorker,
} from './project-files'
import { rageDetectors } from './rage-detectors'
import { logAndHandleStartup } from './startup-process-handler'
import { recreateShell } from './terminal/run-command'
import { validateAgentDefinitionsIfAuthenticated } from './utils/agent-validation'
import { initAnalytics, trackEvent } from './utils/analytics'
import { logger } from './utils/logger'

import type { CliOptions } from './types'

async function codebuff({
  initialInput,
  git,
  costMode,
  runInitFlow,
  model,
  provider,
  agent,
  params,
  print,
  cwd,
  trace,
  spawn,
}: CliOptions) {
  enableSquashNewlines()
  const workingDir = getWorkingDirectory()
  const projectRoot = getProjectRoot()
  await recreateShell(workingDir)

  // Kill all processes we failed to kill before
  const processCleanupPromise = logAndHandleStartup()

  initAnalytics()
  rageDetectors.startupTimeDetector.start()

  const initFileContextPromise = initProjectFileContextWithWorker(projectRoot)

  // Load agents and validate definitions
  const loadAndValidatePromise: Promise<void> = loadLocalAgents({
    verbose: true,
  }).then((agents) => {
    validateAgentDefinitionsIfAuthenticated(Object.values(agents))

    const codebuffConfig = loadCodebuffConfig()
    if (!agent) {
      displayLoadedAgents(codebuffConfig)
    }
  })

  const readyPromise = Promise.all([
    initFileContextPromise,
    processCleanupPromise,
    loadAndValidatePromise,
  ])

  // Initialize the CLI singleton
  CLI.initialize(readyPromise, {
    git,
    costMode,
    model,
    provider,
    agent,
    params,
    print,
    trace,
  })

  // Handle --spawn flag by converting to @agent-id syntax
  if (spawn) {
    initialInput = initialInput ? `@${spawn} ${initialInput}` : `@${spawn}`
  }

  const cli = CLI.getInstance()
  await cli.printInitialPrompt({ initialInput, runInitFlow })

  rageDetectors.startupTimeDetector.end()
}

if (require.main === module) {
  const program = new Command()

  program.name('codebuff').version(npmAppVersion || '0.0.0')

  // Add arguments from shared definitions
  cliArguments.forEach((arg) => {
    // For hidden arguments, just skip adding them to the help text
    if (!arg.hidden) {
      program.argument(arg.flags, arg.description)
    }
  })

  // Add options from shared definitions
  cliOptions.forEach((opt) => {
    const optionInstance = new Option(opt.flags, opt.description)
    if (opt.hidden) {
      optionInstance.hideHelp(true)
    }
    program.addOption(optionInstance)
  })

  program.addHelpText(
    'after',
    `
Examples:
  $ codebuff                                  # Start in current directory
  $ codebuff -p "tell me about the codebase"  # Print mode (non-interactive)
  $ codebuff --cwd my-project                 # Start in specific directory
  $ codebuff --trace                          # Enable subagent trace logging to .agents/traces/*.log
  $ codebuff --create nextjs my-app           # Create and scaffold a new Next.js project
  $ codebuff init-agents                      # Create example agent files in .agents directory
  $ codebuff save-agent my-agent-id           # Add agent ID to spawnable agents list
  $ codebuff publish my-agent                 # Publish agent template to store
  $ codebuff --agent file-picker "find relevant files for authentication"
  $ codebuff --agent reviewer --params '{"focus": "security"}' "review this code"
  $ codebuff --spawn researcher "analyze this code"
  $ codebuff --spawn file-picker

Direct Commands (via shell shims):
  $ codebuff shims install codebuff/base-lite@1.0.0               # One-step setup!
  $ eval "$(codebuff shims env)"              # Run this for immediate use
  $ base-lite "fix the bug"                   # Direct command (after eval)
  $ codebuff shims list                       # List installed shims
  $ codebuff shims upgrade                    # Upgrade all shims to latest versions

For all commands and options, run 'codebuff' and then type 'help'.
`,
  )

  program.parse()

  const options = program.opts()
  const args = program.args // Handle template creation

  // Initialize project root and working directory
  initializeProjectRootAndWorkingDir(options.cwd)

  if (options.create) {
    const template = options.create
    const projectDir = args[0] || '.'
    const projectName = args[1] || template
    createTemplateProject(template, projectDir, projectName)
    process.exit(0)
  }

  // Handle publish command
  if (args[0] === 'publish') {
    const agentNames = args.slice(1)
    await handlePublish(agentNames)
    process.exit(0)
  }

  // Handle init-agents command
  if (args[0] === 'init-agents') {
    await handleInitAgents()
    process.exit(0)
  }

  // Handle save-agent command
  if (args[0] === 'save-agent') {
    const agentIds = args.slice(1)
    await handleSaveAgent(agentIds)
    process.exit(0)
  }

  // Handle shims command
  if (args[0] === 'shims') {
    const subcommand = args[1]
    const subArgs = args.slice(2)

    switch (subcommand) {
      case 'install':
        await handleShimsInstall(subArgs, {
          force: options.force,
        })
        break
      case 'uninstall':
      case 'remove':
        await handleShimsUninstall(subArgs.length > 0 ? subArgs : undefined)
        break
      case 'list':
        await handleShimsList()
        break
      case 'update':
        await handleShimsUpdate(subArgs.length > 0 ? subArgs : undefined)
        break
      case 'doctor':
        await handleShimsDoctor()
        break
      case 'upgrade':
        await handleShimsUpgrade()
        break
      case 'env':
        console.log(generateEvalCommand())
        break
      default:
        console.error(red(`Unknown shims subcommand: ${subcommand}`))
        console.log(
          'Available subcommands: install, uninstall, list, update, doctor, upgrade, env',
        )
        process.exit(1)
    }
    process.exit(0)
  }

  // Handle deprecated --pro flag
  if (options.pro) {
    console.error(
      red(
        'Warning: The --pro flag is deprecated. Please restart codebuff and use the --max option instead.',
      ),
    )
    logger.error(
      {
        errorMessage:
          'The --pro flag is deprecated. Please restart codebuff and use the --max option instead.',
      },
      'Deprecated --pro flag used',
    )
    process.exit(1)
  }

  // Determine cost mode
  let costMode: CostMode = 'normal'
  if (options.lite) {
    costMode = 'lite'
  } else if (options.max) {
    costMode = 'max'
  } else if (options.experimental) {
    costMode = 'experimental'
  } else if (options.ask) {
    costMode = 'ask'
  }

  // Handle git integration
  const git = options.git === 'stage' ? ('stage' as const) : undefined

  // Validate print mode requirements
  if (options.print) {
    const hasPrompt = args.length > 0
    const hasParams = options.params

    setPrintMode(true)
    trackEvent(AnalyticsEvent.PRINT_MODE, {
      args,
      options,
    })

    if (!hasPrompt && !hasParams) {
      printModeLog({
        type: 'error',
        message: 'Error: Print mode requires a prompt to be set',
      })
      process.exit(1)
    }
  }

  // Parse agent params if provided
  let parsedAgentParams: Record<string, any> | undefined
  if (options.params) {
    try {
      parsedAgentParams = JSON.parse(options.params)
    } catch (error) {
      console.error(red(`Error parsing --params JSON: ${error}`))
      process.exit(1)
    }
  }

  // Remove the first argument if it's the compiled binary path which bun weirdly injects (starts with /$bunfs)
  const filteredArgs = args[0]?.startsWith('/$bunfs') ? args.slice(1) : args

  // If first arg is a command like 'publish' or 'save-agent', don't treat it as initial input
  const isCommand = ['publish', 'init-agents', 'save-agent', 'shims'].includes(
    filteredArgs[0],
  )
  const initialInput = isCommand ? '' : filteredArgs.join(' ')

  codebuff({
    initialInput,
    git,
    costMode,
    runInitFlow: options.init,
    model: options.model,
    provider: options.provider,
    agent: options.agent,
    params: parsedAgentParams,
    print: options.print,
    cwd: options.cwd,
    trace: options.trace,
    spawn: options.spawn,
  })
}
