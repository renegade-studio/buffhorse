import * as os from 'os'
import * as path from 'path'

import { z } from 'zod/v4'

import { CodebuffConfigSchema } from '../json-config/constants'

import type { CodebuffFileSystem } from '../types/filesystem'

export const FileTreeNodeSchema: z.ZodType<FileTreeNode> = z.object({
  name: z.string(),
  type: z.enum(['file', 'directory']),
  children: z.lazy(() => z.array(FileTreeNodeSchema).optional()),
  filePath: z.string(),
})

export interface FileTreeNode {
  name: string
  type: 'file' | 'directory'
  filePath: string
  lastReadTime?: number
  children?: FileTreeNode[]
}

export interface DirectoryNode extends FileTreeNode {
  type: 'directory'
  children: FileTreeNode[]
}

export interface FileNode extends FileTreeNode {
  type: 'file'
  lastReadTime: number
}

export const FileVersionSchema = z.object({
  path: z.string(),
  content: z.string(),
})

export type FileVersion = z.infer<typeof FileVersionSchema>

export const customToolDefinitionsSchema = z
  .record(
    z.string(),
    z.object({
      inputJsonSchema: z.any(),
      endsAgentStep: z.boolean().optional().default(false),
      description: z.string().optional(),
      exampleInputs: z.record(z.string(), z.any()).array().optional(),
    }),
  )
  .default(() => ({}))
export type CustomToolDefinitions = z.input<typeof customToolDefinitionsSchema>

export const ProjectFileContextSchema = z.object({
  projectRoot: z.string(),
  cwd: z.string(),
  fileTree: z.array(z.custom<FileTreeNode>()),
  fileTokenScores: z.record(z.string(), z.record(z.string(), z.number())),
  tokenCallers: z
    .record(z.string(), z.record(z.string(), z.array(z.string())))
    .optional(),
  knowledgeFiles: z.record(z.string(), z.string()),
  userKnowledgeFiles: z.record(z.string(), z.string()).optional(),
  agentTemplates: z.record(z.string(), z.any()).default(() => ({})),
  customToolDefinitions: customToolDefinitionsSchema,
  codebuffConfig: CodebuffConfigSchema.optional(),
  gitChanges: z.object({
    status: z.string(),
    diff: z.string(),
    diffCached: z.string(),
    lastCommitMessages: z.string(),
  }),
  changesSinceLastChat: z.record(z.string(), z.string()),
  shellConfigFiles: z.record(z.string(), z.string()),
  systemInfo: z.object({
    platform: z.string(),
    shell: z.string(),
    nodeVersion: z.string(),
    arch: z.string(),
    homedir: z.string(),
    cpus: z.number(),
  }),
})

export type ProjectFileContext = z.infer<typeof ProjectFileContextSchema>

export const fileRegex =
  /<write_file>\s*<path>([^<]+)<\/path>\s*<content>([\s\S]*?)<\/content>\s*<\/write_file>/g
export const fileWithNoPathRegex = /<write_file>([\s\S]*?)<\/write_file>/g

export const parseFileBlocks = (fileBlocks: string) => {
  let fileMatch
  const files: Record<string, string> = {}
  while ((fileMatch = fileRegex.exec(fileBlocks)) !== null) {
    const [, filePath, fileContent] = fileMatch
    files[filePath] = fileContent.startsWith('\n')
      ? fileContent.slice(1)
      : fileContent
  }
  return files
}

export const getStubProjectFileContext = (): ProjectFileContext => ({
  projectRoot: '',
  cwd: '',
  fileTree: [],
  fileTokenScores: {},
  knowledgeFiles: {},
  userKnowledgeFiles: {},
  agentTemplates: {},
  customToolDefinitions: {},
  codebuffConfig: undefined,
  gitChanges: {
    status: '',
    diff: '',
    diffCached: '',
    lastCommitMessages: '',
  },
  changesSinceLastChat: {},
  shellConfigFiles: {},
  systemInfo: {
    platform: '',
    shell: '',
    nodeVersion: '',
    arch: '',
    homedir: '',
    cpus: 0,
  },
})

export const createMarkdownFileBlock = (filePath: string, content: string) => {
  return `\`\`\`${filePath}\n${content}\n\`\`\``
}

export const parseMarkdownCodeBlock = (content: string) => {
  const match = content.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*)\n```$/)
  if (match) {
    return match[1] + '\n'
  }
  return content
}

export const createSearchReplaceBlock = (search: string, replace: string) => {
  return `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`
}

export function printFileTree(
  nodes: FileTreeNode[],
  depth: number = 0,
): string {
  let result = ''
  const indentation = ' '.repeat(depth)
  for (const node of nodes) {
    result += `${indentation}${node.name}${node.type === 'directory' ? '/' : ''}\n`
    if (node.type === 'directory' && node.children) {
      result += printFileTree(node.children, depth + 1)
    }
  }
  return result
}

export function printFileTreeWithTokens(
  nodes: FileTreeNode[],
  fileTokenScores: Record<string, Record<string, number>>,
  path: string[] = [],
): string {
  let result = ''
  const depth = path.length
  const indentToken = ' '
  const indentation = indentToken.repeat(depth)
  const indentationWithFile = indentToken.repeat(depth + 1)
  for (const node of nodes) {
    if (
      node.type === 'directory' &&
      (!node.children || node.children.length === 0)
    ) {
      // Skip empty directories
      continue
    }
    result += `${indentation}${node.name}${node.type === 'directory' ? '/' : ''}`
    path.push(node.name)
    const filePath = path.join('/')
    const tokenScores = fileTokenScores[filePath]
    if (node.type === 'file' && tokenScores) {
      const tokens = Object.keys(tokenScores)
      if (tokens.length > 0) {
        result += `\n${indentationWithFile}${tokens.join(' ')}`
      }
    }
    result += '\n'
    if (node.type === 'directory' && node.children) {
      result += printFileTreeWithTokens(node.children, fileTokenScores, path)
    }
    path.pop()
  }
  return result
}

/**
 * Ensures the given file contents ends with a newline character.
 * @param contents - The file contents
 * @returns the file contents with a newline character.
 */
export const ensureEndsWithNewline = (
  contents: string | null,
): string | null => {
  if (contents === null || contents === '') {
    // Leave empty file as is
    return contents
  }
  if (contents.endsWith('\n')) {
    return contents
  }
  return contents + '\n'
}

export const ensureDirectoryExists = (params: {
  baseDir: string
  fs: CodebuffFileSystem
}) => {
  const { baseDir, fs } = params

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true })
  }
}

/**
 * Removes markdown code block syntax if present, including any language tag
 */
export const cleanMarkdownCodeBlock = (content: string): string => {
  const cleanResponse = content.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*)\n```$/)
    ? content.replace(/^```(?:[a-zA-Z]+)?\n/, '').replace(/\n```$/, '')
    : content
  return cleanResponse
}

export function isValidFilePath(path: string) {
  if (!path) return false

  // Check for whitespace
  if (/\s/.test(path)) return false

  // Check for invalid characters
  const invalidChars = /[<>:"|?*\x00-\x1F]/g
  if (invalidChars.test(path)) return false

  return true
}

export function isDir(params: {
  path: string
  fs: CodebuffFileSystem
}): boolean {
  const { path, fs } = params

  try {
    return fs.statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Returns true if the `toPath` is a subdirectory of `fromPath`.
 */
export function isSubdir(fromPath: string, toPath: string) {
  const resolvedFrom = path.resolve(fromPath)
  const resolvedTo = path.resolve(toPath)

  if (process.platform === 'win32') {
    const fromDrive = path.parse(resolvedFrom).root.toLowerCase()
    const toDrive = path.parse(resolvedTo).root.toLowerCase()
    if (fromDrive !== toDrive) {
      return false
    }
  }

  return !path.relative(resolvedFrom, resolvedTo).startsWith('..')
}

export function isValidProjectRoot(dir: string): boolean {
  return !isSubdir(dir, os.homedir())
}
