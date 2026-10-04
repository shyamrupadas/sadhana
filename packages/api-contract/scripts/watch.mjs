import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../', import.meta.url))
let running = false
let pending = false
let timer
async function build() {
  if (running) { pending = true; return }
  running = true
  const child = spawn('pnpm', ['build'], { cwd, stdio: 'inherit' })
  await new Promise((resolve) => child.once('exit', resolve))
  running = false
  if (pending) { pending = false; void build() }
}
watch(fileURLToPath(new URL('../main.tsp', import.meta.url)), () => {
  clearTimeout(timer)
  timer = setTimeout(() => void build(), 200)
})
await build()
