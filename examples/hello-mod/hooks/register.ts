import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    $.ui.log(`hello-mod loaded in ${e.cwd}`)
    return r
  })
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (typeof e.command === 'string' && e.command.includes('rm -rf /')) return { deny: 'hello-mod refused it' }
    return next(e)
  })
}
