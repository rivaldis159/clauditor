// Diagnostic: run one tiny query through the Agent SDK with the Claude desktop claude.exe.
// usage: node scripts/sdk-probe.mjs <cwd> <claude.exe>
import { query } from '@anthropic-ai/claude-agent-sdk'

const [cwd, exe] = process.argv.slice(2)
const t0 = Date.now()
const q = query({
  prompt: 'Balas hanya dengan kata: siap',
  options: {
    cwd,
    pathToClaudeCodeExecutable: exe,
    model: 'haiku',
    maxTurns: 1,
    tools: [],
    persistSession: false,
    includePartialMessages: true,
    stderr: (d) => process.stderr.write(`[stderr] ${d}`)
  }
})
const timer = setTimeout(() => {
  console.log('TIMEOUT after 90s')
  process.exit(2)
}, 90000)
for await (const m of q) {
  const extra = m.type === 'stream_event' ? m.event?.type : m.type === 'result' ? JSON.stringify({ is_error: m.is_error, result: m.result, subtype: m.subtype }) : m.subtype ?? ''
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${m.type} ${extra}`)
}
clearTimeout(timer)
console.log('done')
