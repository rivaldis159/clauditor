import { describe, expect, it } from 'vitest'
import { dropInheritedClaudeSession } from '../../src/main/env'

describe('dropInheritedClaudeSession', () => {
  it('keeps the environment of a normal launch untouched', () => {
    const env = { PATH: 'C:\\bin', ANTHROPIC_BASE_URL: 'https://gateway.example', CLAUDE_CODE_USE_BEDROCK: '1' }
    expect(dropInheritedClaudeSession(env)).toEqual([])
    expect(env).toEqual({ PATH: 'C:\\bin', ANTHROPIC_BASE_URL: 'https://gateway.example', CLAUDE_CODE_USE_BEDROCK: '1' })
  })

  it('strips a parent Claude Code session but keeps everything else', () => {
    const env: Record<string, string> = {
      PATH: 'C:\\bin',
      HOME: 'C:\\Users\\x',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_AGENT_SDK_VERSION: '0.3',
      CLAUDE_PID: '42',
      MCP_CONNECTION_NONBLOCKING: '1',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999'
    }
    const dropped = dropInheritedClaudeSession(env)
    expect(dropped.sort()).toEqual(['ANTHROPIC_BASE_URL', 'CLAUDECODE', 'CLAUDE_AGENT_SDK_VERSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID', 'MCP_CONNECTION_NONBLOCKING'])
    expect(env).toEqual({ PATH: 'C:\\bin', HOME: 'C:\\Users\\x' })
  })
})
