import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

/**
 * Get the path to the bundled ripgrep binary based on the current platform
 * @param importMetaUrl - import.meta.url from the calling module
 * @returns Path to the ripgrep binary
 */
export function getBundledRgPath(importMetaUrl?: string): string {
  // Allow override via environment variable
  if (process.env.CODEBUFF_RG_PATH) {
    return process.env.CODEBUFF_RG_PATH
  }

  // Determine platform-specific directory name
  const platform = process.platform
  const arch = process.arch

  let platformDir: string
  if (platform === 'win32' && arch === 'x64') {
    platformDir = 'x64-win32'
  } else if (platform === 'darwin' && arch === 'arm64') {
    platformDir = 'arm64-darwin'
  } else if (platform === 'darwin' && arch === 'x64') {
    platformDir = 'x64-darwin'
  } else if (platform === 'linux' && arch === 'arm64') {
    platformDir = 'arm64-linux'
  } else if (platform === 'linux' && arch === 'x64') {
    platformDir = 'x64-linux'
  } else {
    throw new Error(`Unsupported platform: ${platform}-${arch}`)
  }

  const binaryName = platform === 'win32' ? 'rg.exe' : 'rg'

  // Try to find the bundled binary relative to this module
  let vendorPath: string | undefined

  if (importMetaUrl) {
    // ESM context - use import.meta.url to find relative path
    const currentFile = fileURLToPath(importMetaUrl)
    const currentDir = dirname(currentFile)

    // Try relative to current file (development - from src/native/ripgrep.ts to vendor/)
    const devPath = join(
      currentDir,
      '..',
      '..',
      'vendor',
      'ripgrep',
      platformDir,
      binaryName,
    )
    if (existsSync(devPath)) {
      vendorPath = devPath
    }
  }

  // If not found via importMetaUrl, try CJS approach or other methods
  if (!vendorPath) {
    // Try from __dirname if available (CJS context)
    const dirname = new Function(
      `try { return __dirname; } catch (e) { return undefined; }`,
    )()

    if (typeof dirname !== 'undefined') {
      const cjsPath = join(
        dirname,
        '..',
        '..',
        'vendor',
        'ripgrep',
        platformDir,
        binaryName,
      )
      if (existsSync(cjsPath)) {
        vendorPath = cjsPath
      }
      const cjsPath2 = join(
        dirname,
        'vendor',
        'ripgrep',
        platformDir,
        binaryName,
      )
      if (existsSync(cjsPath2)) {
        vendorPath = cjsPath2
      }
    }
  }

  if (vendorPath && existsSync(vendorPath)) {
    return vendorPath
  }

  // Fallback: try to find in dist/vendor (for published package)
  const distVendorPath = join(
    process.cwd(),
    'node_modules',
    '@codebuff',
    'sdk',
    'dist',
    'vendor',
    'ripgrep',
    platformDir,
    binaryName,
  )
  if (existsSync(distVendorPath)) {
    return distVendorPath
  }

  // No fallback available - bundled binaries are required
  throw new Error(
    `Ripgrep binary not found for ${platform}-${arch}. ` +
      `Expected at: ${vendorPath} or ${distVendorPath}. ` +
      `Please run 'npm run fetch-ripgrep' or set CODEBUFF_RG_PATH environment variable.`,
  )
}
