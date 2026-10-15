// When Clauditor is started from inside a Claude Code session (a Claude desktop terminal, a CLI
// session…), it inherits that session's private variables. Passing them on would make every
// Claude Code that Clauditor starts — runner, terminals, `auth status` — believe it is a child of that
// session: wrong entrypoint, a borrowed API proxy, and "cannot be launched inside another session".
const SESSION_VAR = /^(CLAUDECODE|CLAUDE_CODE_.+|CLAUDE_AGENT_SDK_.+|CLAUDE_PID|CLAUDE_PREVIEW_.+|MCP_CONNECTION_NONBLOCKING|MCP_SERVER_CONNECTION_BATCH_SIZE|ANTHROPIC_BASE_URL)$/i

export function dropInheritedClaudeSession(env: NodeJS.ProcessEnv = process.env): string[] {
  // a normal launch (Start menu, shortcut, file association) has neither marker: keep user config
  if (env.CLAUDECODE !== '1' && !env.CLAUDE_CODE_ENTRYPOINT) return []
  const dropped: string[] = []
  for (const key of Object.keys(env)) {
    if (!SESSION_VAR.test(key)) continue
    delete env[key]
    dropped.push(key)
  }
  return dropped
}
