import { app, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import OpenAI from 'openai'
import mime from 'mime-types'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { dbOperations } from './database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const execFileAsync = promisify(execFile)
const WORKSPACE_DIR = 'agent-workspaces'
const CONTAINER_WORKDIR = '/workspace'
const AGENT_IMAGE = 'chatbox-agent:local'
const MAX_TOOL_ITERATIONS = 64
const MAX_TOOL_OUTPUT_CHARS = 24000
const MAX_READ_FILE_BYTES = 512 * 1024
const MAX_WRITE_FILE_BYTES = 1024 * 1024
const MAX_FULL_IMAGE_VIEW_BYTES = 8 * 1024 * 1024
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
const MAX_PREVIEW_TEXT_CHARS = 60000
const BASH_TIMEOUT_MS = 30000

let activeStream = null
let streamCancelled = false
let agentImageBuildKey = null
const mcpSessions = new Map()

function bundledPath(relativePath) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', relativePath)
  }
  return path.join(__dirname, relativePath)
}

function agentDir() {
  return bundledPath('agent')
}

function loadAgentPrompt() {
  const promptPath = path.join(agentDir(), 'system-prompt.md')
  try {
    return fs.readFileSync(promptPath, 'utf8').trim()
  } catch {
    return ''
  }
}

function workspaceRoot() {
  const root = path.join(app.getPath('userData'), WORKSPACE_DIR)
  fs.mkdirSync(root, { recursive: true })
  return root
}

function safeName(name, fallback = 'attachment') {
  const base = path.basename(name || fallback).replace(/[^a-zA-Z0-9._ -]/g, '_').trim()
  return base || fallback
}

function uniquePath(dir, name) {
  const parsed = path.parse(safeName(name))
  let candidate = path.join(dir, `${parsed.name}${parsed.ext}`)
  let index = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${parsed.name}-${index}${parsed.ext}`)
    index += 1
  }
  return candidate
}

function relPath(workspacePath, targetPath) {
  return path.relative(workspacePath, targetPath).split(path.sep).join('/')
}

function resolveWorkspacePath(workspacePath, requestedPath = '.') {
  let normalizedPath = requestedPath || '.'
  if (typeof normalizedPath === 'string') {
    if (normalizedPath === CONTAINER_WORKDIR) {
      normalizedPath = '.'
    } else if (normalizedPath.startsWith(`${CONTAINER_WORKDIR}/`)) {
      normalizedPath = normalizedPath.slice(CONTAINER_WORKDIR.length + 1)
    }
  }
  const target = path.resolve(workspacePath, normalizedPath)
  const root = path.resolve(workspacePath)
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Path escapes the thread workspace')
  }
  return target
}

async function docker(args, options = {}) {
  return await execFileAsync('docker', args, {
    timeout: options.timeout || 15000,
    maxBuffer: options.maxBuffer || 1024 * 1024 * 8
  })
}

async function ensureAgentImage() {
  const dockerfilePath = path.join(agentDir(), 'Dockerfile')
  const dockerfileStat = fs.statSync(dockerfilePath)
  const buildKey = `${dockerfilePath}:${dockerfileStat.mtimeMs}`
  if (agentImageBuildKey === buildKey) return

  await docker([
    'build',
    '-t',
    AGENT_IMAGE,
    '-f',
    dockerfilePath,
    agentDir()
  ], { timeout: 300000, maxBuffer: 1024 * 1024 * 16 })

  agentImageBuildKey = buildKey
}

async function isContainerRunning(containerId) {
  if (!containerId) return false
  try {
    const { stdout } = await docker(['inspect', '-f', '{{.State.Running}}', containerId])
    return stdout.trim() === 'true'
  } catch {
    return false
  }
}

async function startContainer(threadId, workspacePath) {
  await ensureAgentImage()
  const name = `chatbox-agent-${threadId}-${Date.now()}`
  const { stdout } = await docker([
    'run',
    '-d',
    '--rm',
    '--name', name,
    '--network', 'none',
    '-v', `${workspacePath}:${CONTAINER_WORKDIR}`,
    '-w', CONTAINER_WORKDIR,
    AGENT_IMAGE
  ], { timeout: 60000 })
  return stdout.trim()
}

export async function ensureThreadWorkspace(threadId) {
  const thread = dbOperations.getThreadById(threadId)
  if (!thread) throw new Error('Thread not found')

  const dir = thread.workspace_path || path.join(workspaceRoot(), `thread-${threadId}`)
  fs.mkdirSync(dir, { recursive: true })

  if (!thread.workspace_path) {
    dbOperations.updateThreadWorkspace(threadId, dir, null, 'initializing')
  }

  if (await isContainerRunning(thread.container_id)) {
    if (thread.container_status !== 'running') {
      dbOperations.updateThreadContainer(threadId, thread.container_id, 'running')
    }
    return { workspacePath: dir, containerId: thread.container_id }
  }

  try {
    const containerId = await startContainer(threadId, dir)
    dbOperations.updateThreadContainer(threadId, containerId, 'running')
    return { workspacePath: dir, containerId }
  } catch (err) {
    dbOperations.updateThreadContainer(threadId, null, `error: ${err.message}`)
    throw new Error(`Failed to start agent Docker container: ${err.message}`)
  }
}

export async function stopThreadContainer(threadOrId) {
  const thread = typeof threadOrId === 'object' ? threadOrId : dbOperations.getThreadById(threadOrId)
  if (!thread?.container_id) return
  try {
    await docker(['rm', '-f', thread.container_id], { timeout: 15000 })
  } catch {}
  try {
    dbOperations.updateThreadContainer(thread.id, null, 'stopped')
  } catch {}
}

export async function deleteThreadWorkspace(thread) {
  await stopThreadContainer(thread)
  if (thread?.workspace_path) {
    try {
      fs.rmSync(thread.workspace_path, { recursive: true, force: true })
    } catch {}
  }
}

export async function stopAllContainers() {
  for (const session of mcpSessions.values()) {
    try { await session.client.close() } catch {}
  }
  mcpSessions.clear()

  for (const thread of dbOperations.getAllThreads()) {
    if (thread.container_id) {
      await stopThreadContainer(thread)
    }
  }
}

export async function copyAttachmentToWorkspace(threadId, attachment) {
  const { workspacePath } = await ensureThreadWorkspace(threadId)
  const attachmentsDir = path.join(workspacePath, 'attachments')
  fs.mkdirSync(attachmentsDir, { recursive: true })

  const target = uniquePath(attachmentsDir, attachment.name || 'attachment')
  const content = attachment.content || attachment.data || ''
  let buffer
  let mimeType = attachment.mimeType || attachment.mime_type || null

  if (typeof content === 'string' && content.startsWith('data:')) {
    const match = content.match(/^data:([^;]+);base64,(.*)$/s)
    if (!match) throw new Error('Invalid data URL attachment')
    mimeType = mimeType || match[1]
    buffer = Buffer.from(match[2], 'base64')
  } else if (typeof content === 'string') {
    mimeType = mimeType || mime.lookup(target) || 'text/plain'
    buffer = Buffer.from(content, 'utf8')
  } else {
    buffer = Buffer.from(content)
  }

  fs.writeFileSync(target, buffer)
  return {
    workspaceRelativePath: relPath(workspacePath, target),
    mimeType: mimeType || mime.lookup(target) || 'application/octet-stream',
    sizeBytes: buffer.byteLength
  }
}

function base64DataUrl(mimeType, data) {
  return `data:${mimeType || 'application/octet-stream'};base64,${data}`
}

function truncate(text, max = MAX_TOOL_OUTPUT_CHARS) {
  if (!text || text.length <= max) return text || ''
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} characters]`
}

function previewKind(mimeType, filePath) {
  if (String(mimeType).startsWith('image/')) return 'image'
  if (String(mimeType).startsWith('video/')) return 'video'
  if (String(mimeType).startsWith('audio/')) return 'audio'
  if (String(mimeType).startsWith('text/')) return 'text'
  const ext = path.extname(filePath).toLowerCase()
  if (['.md', '.markdown'].includes(ext)) return 'markdown'
  if (['.json', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.svg', '.log'].includes(ext)) return 'text'
  if (mimeType === 'application/json') return 'text'
  if (mimeType === 'application/pdf') return 'embed'
  return 'download'
}

function languageForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  const aliases = { md: 'markdown', yml: 'yaml', js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', py: 'python' }
  return aliases[ext] || ext || 'text'
}

function isTextMimeOrExtension(mimeType, filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (String(mimeType).startsWith('text/')) return true
  if (mimeType === 'application/json') return true
  return ['.md', '.markdown', '.json', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.svg', '.log', '.txt', '.sql', '.sh', '.env'].includes(ext)
}

function assertReadableTextFile(filePath, stat) {
  const mimeType = mime.lookup(filePath) || 'application/octet-stream'
  if (stat.size > MAX_READ_FILE_BYTES) {
    throw new Error(`File is too large to read directly (${stat.size} bytes). Use workspace_bash with head, sed, tail, rg, file, or format-specific tools to inspect a small slice.`)
  }

  const sample = fs.readFileSync(filePath).subarray(0, Math.min(stat.size, 8192))
  if (sample.includes(0)) {
    throw new Error(`Refusing to read binary file as text (${mimeType}). Use file-specific tools or convert/extract a small text representation first.`)
  }

  if (!isTextMimeOrExtension(mimeType, filePath)) {
    const decoded = sample.toString('utf8')
    const replacementChars = (decoded.match(/\uFFFD/g) || []).length
    if (replacementChars > Math.max(4, decoded.length * 0.01)) {
      throw new Error(`Refusing to read non-text file as UTF-8 (${mimeType}). Use file-specific tools or convert/extract a small text representation first.`)
    }
  }

  return mimeType
}

function cropRectFromArgs(crop, imageSize) {
  if (!crop) return null
  const rawValues = [crop.x, crop.y, crop.width, crop.height].map(Number)
  const looksLikePercent = rawValues.every(value => Number.isFinite(value) && value >= 0 && value <= 100)
  const mode = crop.mode || crop.units || (looksLikePercent ? 'percent' : 'pixels')

  const clampPixelRect = (rect) => {
    const original = { ...rect }
    const x = Math.min(Math.max(Math.floor(rect.x), 0), Math.max(imageSize.width - 1, 0))
    const y = Math.min(Math.max(Math.floor(rect.y), 0), Math.max(imageSize.height - 1, 0))
    const maxWidth = Math.max(imageSize.width - x, 1)
    const maxHeight = Math.max(imageSize.height - y, 1)
    const width = Math.min(Math.max(Math.round(rect.width), 1), maxWidth)
    const height = Math.min(Math.max(Math.round(rect.height), 1), maxHeight)
    return {
      x,
      y,
      width,
      height,
      adjusted: x !== original.x || y !== original.y || width !== original.width || height !== original.height,
      original
    }
  }

  if (mode === 'percent') {
    const percent = {
      x: Number(crop.x),
      y: Number(crop.y),
      width: Number(crop.width),
      height: Number(crop.height)
    }
    if (![percent.x, percent.y, percent.width, percent.height].every(Number.isFinite)) {
      throw new Error('Percent crop must contain numeric x, y, width, and height values')
    }
    const clampedPercent = {
      x: Math.min(Math.max(percent.x, 0), 100),
      y: Math.min(Math.max(percent.y, 0), 100),
      width: Math.max(percent.width, 0.1),
      height: Math.max(percent.height, 0.1)
    }
    clampedPercent.width = Math.min(clampedPercent.width, Math.max(100 - clampedPercent.x, 0.1))
    clampedPercent.height = Math.min(clampedPercent.height, Math.max(100 - clampedPercent.y, 0.1))

    return {
      ...clampPixelRect({
        x: (clampedPercent.x / 100) * imageSize.width,
        y: (clampedPercent.y / 100) * imageSize.height,
        width: (clampedPercent.width / 100) * imageSize.width,
        height: (clampedPercent.height / 100) * imageSize.height
      }),
      percent: clampedPercent,
      originalPercent: percent,
      percentAdjusted: percent.x !== clampedPercent.x ||
        percent.y !== clampedPercent.y ||
        percent.width !== clampedPercent.width ||
        percent.height !== clampedPercent.height,
      mode: 'percent'
    }
  }

  const rawRect = {
    x: Number(crop.x),
    y: Number(crop.y),
    width: Number(crop.width),
    height: Number(crop.height)
  }
  if (![rawRect.x, rawRect.y, rawRect.width, rawRect.height].every(Number.isFinite)) {
    throw new Error('Crop must contain numeric x, y, width, and height values')
  }
  if (rawRect.width <= 0 || rawRect.height <= 0) {
    throw new Error('Crop width and height must be positive')
  }
  return {
    ...clampPixelRect(rawRect),
    mode: 'pixels'
  }
}

function cropDescription(cropRect) {
  if (!cropRect) return null
  const adjusted = cropRect.adjusted || cropRect.percentAdjusted
    ? `; clamped from ${cropRect.mode === 'percent'
      ? `${cropRect.originalPercent.x}%,${cropRect.originalPercent.y}%,${cropRect.originalPercent.width}%x${cropRect.originalPercent.height}%`
      : `${cropRect.original.x},${cropRect.original.y},${cropRect.original.width}x${cropRect.original.height}px`}`
    : ''
  if (cropRect.mode === 'percent') {
    return `${cropRect.percent.x}%,${cropRect.percent.y}%,${cropRect.percent.width}%x${cropRect.percent.height}% => ${cropRect.x},${cropRect.y},${cropRect.width}x${cropRect.height}px${adjusted}`
  }
  return `${cropRect.x},${cropRect.y},${cropRect.width}x${cropRect.height}px${adjusted}`
}

function defaultCropPath(imagePath) {
  const parsed = path.parse(imagePath)
  return path.join('.chatbox', 'crops', `${parsed.name}-crop-${Date.now()}.png`)
}

function imageInfo(filePath) {
  const mimeType = mime.lookup(filePath) || 'application/octet-stream'
  if (!String(mimeType).startsWith('image/')) return null
  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) return null
  return image.getSize()
}

function attachmentManifest(threadId, workspacePath) {
  if (!threadId || !workspacePath) return ''
  const attachments = []
  for (const message of dbOperations.getMessagesByThread(threadId)) {
    if (message.role !== 'user') continue
    for (const attachment of dbOperations.getAttachmentsByMessage(message.timestamp)) {
      if (!attachment.workspace_path) continue
      const target = resolveWorkspacePath(workspacePath, attachment.workspace_path)
      const exists = fs.existsSync(target)
      const stat = exists ? fs.statSync(target) : null
      const dimensions = exists ? imageInfo(target) : null
      attachments.push({
        name: attachment.name || path.basename(attachment.workspace_path),
        path: attachment.workspace_path,
        absolutePath: `${CONTAINER_WORKDIR}/${attachment.workspace_path}`,
        type: attachment.type,
        mimeType: attachment.mime_type || mime.lookup(target) || 'application/octet-stream',
        sizeBytes: stat?.size || attachment.size_bytes || null,
        dimensions,
        messageId: message.timestamp
      })
    }
  }

  if (attachments.length === 0) return ''

  const lines = [
    '# Current Workspace Attachments',
    'The user-provided files already copied into this chat workspace are listed below. Use these paths directly; do not list the attachments directory just to discover filenames.',
    '',
    ...attachments.map((attachment, index) => {
      const dimensions = attachment.dimensions
        ? `, dimensions: ${attachment.dimensions.width}x${attachment.dimensions.height}px`
        : ''
      const size = attachment.sizeBytes != null ? `, size: ${attachment.sizeBytes} bytes` : ''
      return `${index + 1}. ${attachment.name} - path: ${attachment.path} (${attachment.absolutePath}), type: ${attachment.type || 'file'}, MIME: ${attachment.mimeType}${size}${dimensions}`
    })
  ]

  return lines.join('\n')
}

function buildFilePreview(workspacePath, requestedPath, title) {
  const target = resolveWorkspacePath(workspacePath, requestedPath)
  const stat = fs.statSync(target)
  if (!stat.isFile()) throw new Error('Preview target is not a file')
  if (stat.size > MAX_PREVIEW_BYTES) {
    throw new Error(`File is too large to preview (${stat.size} bytes)`)
  }

  const mimeType = mime.lookup(target) || 'application/octet-stream'
  const kind = previewKind(mimeType, target)
  const name = path.basename(target)
  const base = {
    path: relPath(workspacePath, target),
    name,
    title: title || name,
    mimeType,
    kind,
    sizeBytes: stat.size
  }

  if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'embed' || kind === 'download') {
    return {
      ...base,
      dataUrl: base64DataUrl(mimeType, fs.readFileSync(target).toString('base64'))
    }
  }

  const text = fs.readFileSync(target, 'utf8')
  return {
    ...base,
    language: languageForPath(target),
    text: text.length > MAX_PREVIEW_TEXT_CHARS
      ? `${text.slice(0, MAX_PREVIEW_TEXT_CHARS)}\n\n[preview truncated ${text.length - MAX_PREVIEW_TEXT_CHARS} characters]`
      : text
  }
}

export function previewThreadFile(threadId, requestedPath, title) {
  const thread = dbOperations.getThreadById(threadId)
  if (!thread) throw new Error('Thread not found')
  const workspacePath = thread.workspace_path || path.join(workspaceRoot(), `thread-${threadId}`)
  return buildFilePreview(workspacePath, requestedPath, title)
}

export function resolveThreadFilePath(threadId, requestedPath) {
  const thread = dbOperations.getThreadById(threadId)
  if (!thread) throw new Error('Thread not found')
  const workspacePath = thread.workspace_path || path.join(workspaceRoot(), `thread-${threadId}`)
  const filePath = resolveWorkspacePath(workspacePath, requestedPath)
  return { filePath, workspacePath }
}

function builtinTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'workspace_list_files',
        description: 'List files and directories in the chat workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Workspace-relative path to list. Defaults to ".".' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'workspace_read_file',
        description: 'Read a small UTF-8 text file from the chat workspace. Refuses large or binary files.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Workspace-relative file path.' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'workspace_write_file',
        description: 'Write UTF-8 text content to a workspace file, creating parent directories as needed.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Workspace-relative file path to write.' },
            content: { type: 'string', description: 'Text content to write as UTF-8.' },
            overwrite: { type: 'boolean', description: 'Whether to replace an existing file. Defaults to true.' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'workspace_bash',
        description: 'Run a shell command inside the chat workspace container at /workspace.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute.' }
          },
          required: ['command']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'workspace_view_image',
        description: 'View an image from the chat workspace. Supports pixel crop regions and saving the crop as a PNG preview artifact.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Workspace-relative image path.' },
            crop: {
              type: 'object',
              description: 'Optional crop rectangle for focusing on small text or unclear image regions. Prefer mode "percent" with x/y/width/height in 0-100 percentages. Use mode "pixels" only when exact image dimensions are known.',
              properties: {
                mode: { type: 'string', enum: ['percent', 'pixels'], description: 'Coordinate system. Defaults to pixels for backward compatibility; prefer percent.' },
                x: { type: 'number', description: 'Left coordinate, as percent or pixels depending on mode.' },
                y: { type: 'number', description: 'Top coordinate, as percent or pixels depending on mode.' },
                width: { type: 'number', description: 'Crop width, as percent or pixels depending on mode.' },
                height: { type: 'number', description: 'Crop height, as percent or pixels depending on mode.' }
              },
              required: ['x', 'y', 'width', 'height']
            },
            save_crop_to: { type: 'string', description: 'Optional workspace-relative PNG path for saving the crop. If omitted and crop is provided, a path under .chatbox/crops is used.' }
          },
          required: ['path']
        }
      }
    }
  ]
}

async function executeBuiltinTool(name, args, workspacePath, containerId) {
  if (name === 'workspace_list_files') {
    const target = resolveWorkspacePath(workspacePath, args.path || '.')
    const entries = fs.readdirSync(target, { withFileTypes: true }).map(entry => {
      const kind = entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other'
      return `${kind}\t${entry.name}`
    })
    return { content: [{ type: 'text', text: entries.join('\n') || '(empty)' }] }
  }

  if (name === 'workspace_read_file') {
    const target = resolveWorkspacePath(workspacePath, args.path)
    const stat = fs.statSync(target)
    if (!stat.isFile()) throw new Error('Path is not a file')
    assertReadableTextFile(target, stat)
    return { content: [{ type: 'text', text: fs.readFileSync(target, 'utf8') }] }
  }

  if (name === 'workspace_write_file') {
    const target = resolveWorkspacePath(workspacePath, args.path)
    const content = String(args.content ?? '')
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_FILE_BYTES) {
      throw new Error(`Content is too large to write with workspace_write_file (${Buffer.byteLength(content, 'utf8')} bytes)`)
    }
    if (args.overwrite === false && fs.existsSync(target)) {
      throw new Error('File already exists and overwrite is false')
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content, 'utf8')
    return {
      content: [{ type: 'text', text: `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${relPath(workspacePath, target)}.` }]
    }
  }

  if (name === 'workspace_bash') {
    if (!containerId || !(await isContainerRunning(containerId))) {
      throw new Error('Thread container is not running')
    }
    const { stdout, stderr } = await docker(['exec', containerId, 'bash', '-lc', args.command], {
      timeout: BASH_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 4
    })
    return {
      content: [{
        type: 'text',
        text: truncate([
          stdout ? `stdout:\n${stdout}` : '',
          stderr ? `stderr:\n${stderr}` : ''
        ].filter(Boolean).join('\n\n') || '(command completed with no output)')
      }]
    }
  }

  if (name === 'workspace_open_image' || name === 'workspace_view_image') {
    const target = resolveWorkspacePath(workspacePath, args.path)
    const stat = fs.statSync(target)
    if (!stat.isFile()) throw new Error('Path is not a file')
    const mimeType = mime.lookup(target) || 'application/octet-stream'
    if (!String(mimeType).startsWith('image/')) {
      throw new Error(`Not an image MIME type: ${mimeType}`)
    }
    if (!args.crop && stat.size > MAX_FULL_IMAGE_VIEW_BYTES) {
      throw new Error(`Image is too large to view whole (${stat.size} bytes). Provide a crop rectangle to inspect a focused region.`)
    }

    const image = nativeImage.createFromPath(target)
    if (image.isEmpty()) throw new Error('Failed to load image')

    const size = image.getSize()
    const cropRect = cropRectFromArgs(args.crop, size)
    const viewedImage = cropRect ? image.crop(cropRect) : image
    const data = viewedImage.toPNG().toString('base64')
    const viewedMimeType = 'image/png'
    const previews = []
    let savedCropPath = null

    if (cropRect) {
      savedCropPath = args.save_crop_to || defaultCropPath(target)
      if (!String(savedCropPath).toLowerCase().endsWith('.png')) {
        savedCropPath = `${savedCropPath}.png`
      }
      const savedTarget = resolveWorkspacePath(workspacePath, savedCropPath)
      fs.mkdirSync(path.dirname(savedTarget), { recursive: true })
      fs.writeFileSync(savedTarget, viewedImage.toPNG())
      previews.push(buildFilePreview(workspacePath, relPath(workspacePath, savedTarget), `Crop of ${path.basename(target)}`))
    }

    const description = cropDescription(cropRect)
    const summary = cropRect
      ? `Viewed crop ${description} from ${args.path} (${size.width}x${size.height}px)${savedCropPath ? ` and saved it to ${relPath(workspacePath, resolveWorkspacePath(workspacePath, savedCropPath))}` : ''}.`
      : `Viewed image ${args.path} (${size.width}x${size.height}px).`

    return {
      content: [
        { type: 'text', text: summary },
        { type: 'image', data, mimeType: viewedMimeType }
      ],
      structuredContent: previews.length ? { previews } : undefined
    }
  }

  if (name === 'workspace_preview_file') {
    const preview = buildFilePreview(workspacePath, args.path, args.title)
    return {
      content: [{ type: 'text', text: `Displayed ${preview.path} inline in the chat.` }],
      structuredContent: { previews: [preview] }
    }
  }

  throw new Error(`Unknown built-in tool: ${name}`)
}

function parseMaybeJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value
  if (!value) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

function sanitizeToolName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)
}

async function getMcpSession(server, workspacePath) {
  const key = `${server.id}:${server.updated_at || ''}`
  const existing = mcpSessions.get(key)
  if (existing) return existing

  for (const [sessionKey, session] of mcpSessions.entries()) {
    if (session.serverId === server.id && sessionKey !== key) {
      try { await session.client.close() } catch {}
      mcpSessions.delete(sessionKey)
    }
  }

  const client = new Client(
    { name: 'chatbox', version: '1.0.0' },
    { capabilities: { roots: { listChanged: false } } }
  )

  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: [{ uri: `file://${workspacePath}`, name: 'Chat workspace' }]
  }))

  let transport
  if (server.transport === 'stdio') {
    const env = parseMaybeJson(server.env, {})
    transport = new StdioClientTransport({
      command: server.command,
      args: parseMaybeJson(server.args, []),
      env: Object.keys(env).length > 0 ? env : undefined,
      cwd: workspacePath,
      stderr: 'pipe'
    })
  } else {
    const headers = parseMaybeJson(server.headers, {})
    transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers }
    })
  }

  await client.connect(transport)
  const session = { serverId: server.id, client }
  mcpSessions.set(key, session)
  return session
}

async function mcpTools(workspacePath) {
  const tools = []
  const dispatch = new Map()
  for (const server of dbOperations.getEnabledMcpServers()) {
    try {
      const session = await getMcpSession(server, workspacePath)
      const listed = await session.client.listTools()
      for (const tool of listed.tools || []) {
        const name = `mcp_${server.id}_${sanitizeToolName(tool.name)}`
        tools.push({
          type: 'function',
          function: {
            name,
            description: `[MCP: ${server.name}] ${tool.description || tool.name}`,
            parameters: tool.inputSchema || { type: 'object', properties: {} }
          }
        })
        dispatch.set(name, { session, originalName: tool.name, serverName: server.name })
      }
    } catch (err) {
      console.warn(`Failed to load MCP server ${server.name}:`, err.message)
    }
  }
  return { tools, dispatch }
}

async function executeMcpTool(entry, args) {
  const result = await entry.session.client.callTool({
    name: entry.originalName,
    arguments: args || {}
  })
  return result
}

function toolResultToText(result) {
  const parts = []
  for (const item of result.content || []) {
    if (item.type === 'text') parts.push(item.text)
    else if (item.type === 'image') parts.push(`[image: ${item.mimeType || 'image'}]`)
    else if (item.type === 'audio') parts.push(`[audio: ${item.mimeType || 'audio'}]`)
    else if (item.type === 'resource_link') parts.push(`[resource: ${item.uri}]`)
    else if (item.type === 'resource') parts.push(`[resource: ${item.resource?.uri || 'embedded'}]`)
    else parts.push(JSON.stringify(item))
  }
  if (result.structuredContent) {
    if (Array.isArray(result.structuredContent.previews)) {
      parts.push(`Displayed inline previews:\n${result.structuredContent.previews.map(preview => `- ${preview.path} (${preview.mimeType}, ${preview.sizeBytes} bytes)`).join('\n')}`)
    } else {
      parts.push(JSON.stringify(result.structuredContent, null, 2))
    }
  }
  if (result.isError) {
    parts.unshift('[tool reported error]')
  }
  return truncate(parts.join('\n\n') || '(no tool output)')
}

function toolResultImageMessages(result, toolName) {
  const images = []
  for (const item of result.content || []) {
    if (item.type === 'image' && item.data) {
      images.push({
        type: 'image_url',
        image_url: { url: base64DataUrl(item.mimeType || 'image/png', item.data) }
      })
    }
  }
  if (images.length === 0) return []
  return [{
    role: 'user',
    content: [
      { type: 'text', text: `Image output from tool ${toolName}:` },
      ...images
    ]
  }]
}

function collectToolCallsFromStreamDelta(toolCalls, deltaToolCalls) {
  for (const delta of deltaToolCalls || []) {
    const index = delta.index || 0
    if (!toolCalls[index]) {
      toolCalls[index] = {
        id: delta.id || '',
        type: 'function',
        function: { name: '', arguments: '' }
      }
    }
    if (delta.id) toolCalls[index].id = delta.id
    if (delta.type) toolCalls[index].type = delta.type
    if (delta.function?.name) toolCalls[index].function.name += delta.function.name
    if (delta.function?.arguments) toolCalls[index].function.arguments += delta.function.arguments
  }
}

function mergeUsage(current, next) {
  if (!next) return current
  if (!current) return { ...next }
  return {
    ...current,
    ...next,
    prompt_tokens: (current.prompt_tokens || 0) + (next.prompt_tokens || 0),
    completion_tokens: (current.completion_tokens || 0) + (next.completion_tokens || 0),
    total_tokens: (current.total_tokens || 0) + (next.total_tokens || 0),
    cost: (current.cost || 0) + (next.cost || 0)
  }
}

function buildOpenAiParams({ modelId, messages, tools, samplingParams, stream }) {
  const extraParams = {}
  if (samplingParams.temperature != null) extraParams.temperature = samplingParams.temperature
  if (samplingParams.max_tokens != null) extraParams.max_tokens = samplingParams.max_tokens
  if (samplingParams.top_p != null) extraParams.top_p = samplingParams.top_p
  if (samplingParams.top_k != null) extraParams.top_k = samplingParams.top_k

  const reasoningMode = samplingParams.reasoning_mode
  let extraBody = undefined
  if (reasoningMode === 'effort' && samplingParams.reasoning_effort) {
    const reasoningObj = { effort: samplingParams.reasoning_effort }
    if (samplingParams.reasoning_exclude) reasoningObj.exclude = true
    extraBody = { reasoning: reasoningObj }
  } else if (reasoningMode === 'tokens' && samplingParams.reasoning_max_tokens != null) {
    const reasoningObj = { max_tokens: samplingParams.reasoning_max_tokens }
    if (samplingParams.reasoning_exclude) reasoningObj.exclude = true
    extraBody = { reasoning: reasoningObj }
  } else if (reasoningMode === 'off') {
    extraBody = { reasoning: { effort: 'none' } }
  }

  return {
    model: modelId,
    messages,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    ...extraParams,
    ...(extraBody ? extraBody : {})
  }
}

async function createStream(openai, params) {
  try {
    return await openai.chat.completions.create(params)
  } catch (err) {
    if (params.stream_options) {
      const { stream_options, ...fallback } = params
      try {
        return await openai.chat.completions.create(fallback)
      } catch (fallbackErr) {
        if (fallback.tools && /tool|function|schema/i.test(fallbackErr.message || '')) {
          const { tools, tool_choice, ...withoutTools } = fallback
          return await openai.chat.completions.create(withoutTools)
        }
        throw fallbackErr
      }
    }
    if (params.tools && /tool|function|schema/i.test(err.message || '')) {
      const { tools, tool_choice, ...withoutTools } = params
      return await openai.chat.completions.create(withoutTools)
    }
    throw err
  }
}

export async function runAgentChatStream(providerIdNum, modelId, inputMessages, win, samplingParams = {}, threadId = null) {
  const provider = dbOperations.getProviderById(providerIdNum)
  if (!provider) throw new Error('Provider not found')

  const openai = new OpenAI({ apiKey: provider.api_key, baseURL: provider.api_base })
  const workspace = threadId ? await ensureThreadWorkspace(threadId) : null
  const workspacePath = workspace?.workspacePath
  const containerId = workspace?.containerId
  const mcp = workspacePath ? await mcpTools(workspacePath) : { tools: [], dispatch: new Map() }
  const tools = [...builtinTools(), ...mcp.tools]
  const systemPrompt = loadAgentPrompt()
  const manifest = attachmentManifest(threadId, workspacePath)
  const systemContent = [systemPrompt, manifest].filter(Boolean).join('\n\n')
  const messages = systemContent
    ? [{ role: 'system', content: systemContent }, ...inputMessages]
    : [...inputMessages]

  let fullContent = ''
  let fullReasoning = ''
  let usage = null
  let sequenceIndex = 0
  const traceSegments = []
  let forceNewTraceSegment = false
  const streamStartTime = Date.now()

  const appendTraceSegment = (eventType, text) => {
    if (!text) return null
    let segment = traceSegments[traceSegments.length - 1]
    if (forceNewTraceSegment || !segment || segment.eventType !== eventType) {
      segment = {
        eventType,
        sequenceIndex: sequenceIndex++,
        text: ''
      }
      traceSegments.push(segment)
      forceNewTraceSegment = false
    }
    segment.text += text
    return segment
  }

  const persistTraceSegments = () => {
    if (!threadId) return
    for (const segment of traceSegments) {
      if (segment.persisted || !segment.text) continue
      dbOperations.addToolEvent({
        threadId,
        eventType: segment.eventType,
        sequenceIndex: segment.sequenceIndex,
        toolName: segment.eventType === 'content' ? '__content__' : '__reasoning__',
        text: segment.text,
        status: 'success'
      })
      segment.persisted = true
    }
  }

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      const stream = await createStream(openai, buildOpenAiParams({
        modelId,
        messages,
        tools,
        samplingParams,
        stream: true
      }))
      activeStream = stream

      let assistantContent = ''
      let assistantReasoning = ''
      const toolCalls = []

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta || {}
        const contentDelta = delta.content || ''
        assistantContent += contentDelta
        fullContent += contentDelta

        let reasoningDelta = ''
        if (delta.reasoning_content) reasoningDelta = delta.reasoning_content
        else if (delta.reasoning) reasoningDelta = delta.reasoning
        else if (delta.reasoning_details && Array.isArray(delta.reasoning_details)) {
          for (const detail of delta.reasoning_details) {
            if (detail.type === 'reasoning.text' && detail.text) reasoningDelta += detail.text
            else if (detail.type === 'reasoning.summary' && detail.summary) reasoningDelta += detail.summary
          }
        }
        if (reasoningDelta) {
          assistantReasoning += reasoningDelta
          fullReasoning += reasoningDelta
          const segment = appendTraceSegment('reasoning', reasoningDelta)
          win.webContents.send('chat:stream-reasoning-chunk', reasoningDelta, segment?.sequenceIndex)
        }

        collectToolCallsFromStreamDelta(toolCalls, delta.tool_calls)

        if (chunk.usage) usage = mergeUsage(usage, chunk.usage)
        if (contentDelta) {
          const segment = appendTraceSegment('content', contentDelta)
          win.webContents.send('chat:stream-chunk', contentDelta, segment?.sequenceIndex)
        }
      }

      activeStream = null

      const calls = toolCalls.filter(call => call?.function?.name)
      if (calls.length === 0) {
        persistTraceSegments()
        const durationMs = Date.now() - streamStartTime
        win.webContents.send('chat:stream-done', fullContent, usage, fullReasoning || null, durationMs)
        return { content: fullContent, usage, reasoning: fullReasoning || null, durationMs }
      }

      messages.push({
        role: 'assistant',
        content: assistantContent || null,
        tool_calls: calls
      })

      for (const call of calls) {
        const toolName = call.function.name
        let args = {}
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
        } catch {
          args = {}
        }

        const start = Date.now()
        const currentSequenceIndex = sequenceIndex++
        win.webContents.send('chat:tool-event', { eventType: 'tool', status: 'running', toolName, arguments: args, sequenceIndex: currentSequenceIndex })

        try {
          const result = mcp.dispatch.has(toolName)
            ? await executeMcpTool(mcp.dispatch.get(toolName), args)
            : await executeBuiltinTool(toolName, args, workspacePath, containerId)

          const resultText = toolResultToText(result)
          messages.push({ role: 'tool', tool_call_id: call.id, content: resultText })
          messages.push(...toolResultImageMessages(result, toolName))

          const durationMs = Date.now() - start
          if (threadId) {
            dbOperations.addToolEvent({
              threadId,
              toolCallId: call.id,
              toolName,
              eventType: 'tool',
              sequenceIndex: currentSequenceIndex,
              arguments: args,
              result,
              status: result.isError ? 'error' : 'success',
              durationMs
            })
          }
          win.webContents.send('chat:tool-event', { eventType: 'tool', status: result.isError ? 'error' : 'success', toolName, durationMs, sequenceIndex: currentSequenceIndex, result })
          forceNewTraceSegment = true
        } catch (err) {
          const durationMs = Date.now() - start
          const resultText = `Tool execution failed: ${err.message}`
          messages.push({ role: 'tool', tool_call_id: call.id, content: resultText })
          if (threadId) {
            dbOperations.addToolEvent({
              threadId,
              toolCallId: call.id,
              toolName,
              eventType: 'tool',
              sequenceIndex: currentSequenceIndex,
              arguments: args,
              result: { content: [{ type: 'text', text: resultText }], isError: true },
              status: 'error',
              durationMs
            })
          }
          win.webContents.send('chat:tool-event', { eventType: 'tool', status: 'error', toolName, error: err.message, durationMs, sequenceIndex: currentSequenceIndex })
          forceNewTraceSegment = true
        }
      }
    }

    throw new Error(`Stopped after ${MAX_TOOL_ITERATIONS} tool iterations`)
  } catch (err) {
    if (streamCancelled) {
      streamCancelled = false
      activeStream = null
      persistTraceSegments()
      const durationMs = Date.now() - streamStartTime
      win.webContents.send('chat:stream-cancelled', fullContent, fullReasoning || null, durationMs)
      return { content: fullContent, usage, reasoning: fullReasoning || null, durationMs, cancelled: true }
    }
    activeStream = null
    throw err
  }
}

export function cancelAgentStream() {
  if (activeStream) {
    streamCancelled = true
    activeStream.controller?.abort()
    activeStream = null
  }
}

export async function testMcpServer(server, workspacePath = null) {
  const tmpWorkspace = workspacePath || path.join(workspaceRoot(), 'mcp-test')
  fs.mkdirSync(tmpWorkspace, { recursive: true })
  const serverId = `test-${Date.now()}`
  const session = await getMcpSession({ ...server, id: serverId, updated_at: Date.now() }, tmpWorkspace)
  const listed = await session.client.listTools()
  await session.client.close()
  for (const [key, value] of mcpSessions.entries()) {
    if (value.serverId === serverId) mcpSessions.delete(key)
  }
  return { success: true, tools: (listed.tools || []).map(tool => tool.name) }
}
