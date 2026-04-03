/**
 * Example 08 — Gemma 4 Local Agent Team (100% Local, Zero API Cost)
 *
 * Demonstrates a fully local multi-agent team using Google's Gemma 4 via
 * Ollama. No cloud API keys needed — everything runs on your machine.
 *
 * Two agents collaborate through a task pipeline:
 * - researcher: uses bash + file_write to gather system info and write a report
 * - summarizer: uses file_read to read the report and produce a concise summary
 *
 * This pattern works with any Ollama model that supports tool-calling.
 * Gemma 4 (released 2026-04-02) has native tool-calling support.
 *
 * Run:
 *   no_proxy=localhost npx tsx examples/08-gemma4-local.ts
 *
 * Prerequisites:
 *   1. Ollama >= 0.20.0 installed and running: https://ollama.com
 *   2. Pull the model: ollama pull gemma4:e2b
 *      (or gemma4:e4b for better quality on machines with more RAM)
 *   3. No API keys needed!
 *
 * Note: The no_proxy=localhost prefix is needed if you have an HTTP proxy
 * configured, since the OpenAI SDK would otherwise route Ollama requests
 * through the proxy.
 */

import { OpenMultiAgent } from '../src/index.js'
import type { AgentConfig, OrchestratorEvent, Task } from '../src/types.js'

// ---------------------------------------------------------------------------
// Configuration — change this to match your Ollama setup
// ---------------------------------------------------------------------------

// See available tags at https://ollama.com/library/gemma4
const OLLAMA_MODEL = 'gemma4:e2b'      // or 'gemma4:e4b', 'gemma4:26b'
const OLLAMA_BASE_URL = 'http://localhost:11434/v1'
const OUTPUT_DIR = '/tmp/gemma4-demo'

// ---------------------------------------------------------------------------
// Agents — both use Gemma 4 locally
// ---------------------------------------------------------------------------

/**
 * Researcher — gathers system information using shell commands.
 */
const researcher: AgentConfig = {
  name: 'researcher',
  model: OLLAMA_MODEL,
  provider: 'openai',
  baseURL: OLLAMA_BASE_URL,
  apiKey: 'ollama', // placeholder — Ollama ignores this, but the OpenAI SDK requires a non-empty value
  systemPrompt: `You are a system researcher. Your job is to gather information
about the current machine using shell commands and write a structured report.

Use the bash tool to run commands like: uname -a, df -h, uptime, and similar
non-destructive read-only commands.
On macOS you can also use: sw_vers, sysctl -n hw.memsize.
On Linux you can also use: cat /etc/os-release, free -h.

Then use file_write to save a Markdown report to ${OUTPUT_DIR}/system-report.md.
The report should have sections: OS, Hardware, Disk, and Uptime.
Be concise — one or two lines per section is enough.`,
  tools: ['bash', 'file_write'],
  maxTurns: 8,
}

/**
 * Summarizer — reads the report and writes a one-paragraph executive summary.
 */
const summarizer: AgentConfig = {
  name: 'summarizer',
  model: OLLAMA_MODEL,
  provider: 'openai',
  baseURL: OLLAMA_BASE_URL,
  apiKey: 'ollama',
  systemPrompt: `You are a technical writer. Read the system report file provided,
then produce a concise one-paragraph executive summary (3-5 sentences).
Focus on the key highlights: what OS, how much RAM, disk status, and uptime.`,
  tools: ['file_read'],
  maxTurns: 4,
}

// ---------------------------------------------------------------------------
// Progress handler
// ---------------------------------------------------------------------------

const taskTimes = new Map<string, number>()

function handleProgress(event: OrchestratorEvent): void {
  const ts = new Date().toISOString().slice(11, 23)

  switch (event.type) {
    case 'task_start': {
      taskTimes.set(event.task ?? '', Date.now())
      const task = event.data as Task | undefined
      console.log(`[${ts}] TASK START    "${task?.title ?? event.task}" → ${task?.assignee ?? '?'}`)
      break
    }
    case 'task_complete': {
      const elapsed = Date.now() - (taskTimes.get(event.task ?? '') ?? Date.now())
      console.log(`[${ts}] TASK DONE     "${event.task}" in ${(elapsed / 1000).toFixed(1)}s`)
      break
    }
    case 'agent_start':
      console.log(`[${ts}] AGENT START   ${event.agent}`)
      break
    case 'agent_complete':
      console.log(`[${ts}] AGENT DONE    ${event.agent}`)
      break
    case 'error':
      console.error(`[${ts}] ERROR         ${event.agent ?? ''}  task=${event.task ?? '?'}`)
      break
  }
}

// ---------------------------------------------------------------------------
// Orchestrator + Team
// ---------------------------------------------------------------------------

const orchestrator = new OpenMultiAgent({
  defaultModel: OLLAMA_MODEL,
  maxConcurrency: 1, // run agents sequentially — local model can only serve one at a time
  onProgress: handleProgress,
})

const team = orchestrator.createTeam('gemma4-team', {
  name: 'gemma4-team',
  agents: [researcher, summarizer],
  sharedMemory: true,
})

// ---------------------------------------------------------------------------
// Task pipeline: research → summarize
// ---------------------------------------------------------------------------

const tasks: Array<{
  title: string
  description: string
  assignee?: string
  dependsOn?: string[]
}> = [
  {
    title: 'Gather system information',
    description: `Use bash to run system info commands (uname -a, sw_vers, sysctl, df -h, uptime).
Then write a structured Markdown report to ${OUTPUT_DIR}/system-report.md with sections:
OS, Hardware, Disk, and Uptime.`,
    assignee: 'researcher',
  },
  {
    title: 'Summarize the report',
    description: `Read the file at ${OUTPUT_DIR}/system-report.md.
Produce a concise one-paragraph executive summary of the system information.`,
    assignee: 'summarizer',
    dependsOn: ['Gather system information'],
  },
]

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log('Gemma 4 Local Agent Team — Zero API Cost')
console.log('='.repeat(60))
console.log(`  model       → ${OLLAMA_MODEL} via Ollama`)
console.log(`  researcher  → bash + file_write`)
console.log(`  summarizer  → file_read`)
console.log(`  output dir  → ${OUTPUT_DIR}`)
console.log()
console.log('Pipeline: researcher gathers info → summarizer writes summary')
console.log('='.repeat(60))

const start = Date.now()
const result = await orchestrator.runTasks(team, tasks)
const totalTime = Date.now() - start

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(60))
console.log('Pipeline complete.\n')
console.log(`Overall success: ${result.success}`)
console.log(`Total time: ${(totalTime / 1000).toFixed(1)}s`)
console.log(`Tokens — input: ${result.totalTokenUsage.input_tokens}, output: ${result.totalTokenUsage.output_tokens}`)

console.log('\nPer-agent results:')
for (const [name, r] of result.agentResults) {
  const icon = r.success ? 'OK  ' : 'FAIL'
  const tools = r.toolCalls.map(c => c.toolName).join(', ')
  console.log(`  [${icon}] ${name.padEnd(12)} tools: ${tools || '(none)'}`)
}

// Print the summarizer's output
const summary = result.agentResults.get('summarizer')
if (summary?.success) {
  console.log('\nExecutive Summary (from local Gemma 4):')
  console.log('-'.repeat(60))
  console.log(summary.output)
  console.log('-'.repeat(60))
}

console.log('\nAll processing done locally. $0 API cost.')
