import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')
const dockerfile = path.join(root, 'agent', 'Dockerfile')
const context = path.join(root, 'agent')
const image = 'chatbox-agent:local'

const hasDocker = spawnSync('docker', ['--version'], { stdio: 'ignore' })
if (hasDocker.status !== 0) {
  console.warn('[agent:build] Docker is not available; skipping agent image rebuild.')
  process.exit(0)
}

console.log(`[agent:build] Building ${image} from ${dockerfile}`)
const result = spawnSync('docker', ['build', '-t', image, '-f', dockerfile, context], {
  stdio: 'inherit'
})

if (result.status !== 0) {
  process.exit(result.status || 1)
}
