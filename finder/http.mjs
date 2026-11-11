import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

const MAX_BODY = 64 * 1024

export function serveHttp(handle, protocols) {
  const port = Number(process.env.MOD_FINDER_PORT ?? 18763)
  const key = process.env.MOD_FINDER_API_KEY
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('MOD_FINDER_PORT must be an integer from 0 to 65535')
  if (!key || key.length < 32) throw new Error('MOD_FINDER_API_KEY must contain at least 32 characters')
  const expected = Buffer.from(`Bearer ${key}`)
  const versions = protocols.filter(version => version !== '2024-11-05')
  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(body === undefined ? undefined : JSON.stringify(body))
    }
    const authorities = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`]
    if (!authorities.includes(req.headers.host) || (req.headers.origin !== undefined &&
        !authorities.some(host => req.headers.origin === `http://${host}`))) return reply(403)
    const supplied = Buffer.from(req.headers.authorization ?? '')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(401)
    if (req.url !== '/mcp') return reply(404)
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return reply(405)
    }
    if (req.headers['mcp-protocol-version'] && !versions.includes(req.headers['mcp-protocol-version'])) return reply(400)
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return reply(415)
    const accepts = (req.headers.accept ?? '').split(',').map(part => part.trim().split(';')[0])
    if (!accepts.includes('application/json') || !accepts.includes('text/event-stream')) return reply(406)
    let bytes = 0
    const chunks = []
    try {
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > MAX_BODY) {
          reply(413)
          return
        }
        chunks.push(chunk)
      }
    } catch {
      if (!res.destroyed) reply(400)
      return
    }
    let message
    try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
      return reply(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
    }
    const object = message && typeof message === 'object' && !Array.isArray(message)
    const hasId = object && Object.hasOwn(message, 'id')
    const validId = !hasId || typeof message.id === 'string' || (typeof message.id === 'number' && Number.isFinite(message.id))
    const response = object && hasId && !Object.hasOwn(message, 'method') &&
      (Object.hasOwn(message, 'result') !== Object.hasOwn(message, 'error'))
    if (!object || message.jsonrpc !== '2.0' || !validId || (!response && typeof message.method !== 'string')) {
      return reply(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } })
    }
    if (!hasId || response) return reply(202)
    if (message.method === 'initialize' && !versions.includes(message.params?.protocolVersion)) {
      message.params = { ...message.params, protocolVersion: versions[0] }
    }
    try {
      reply(200, { jsonrpc: '2.0', id: message.id, result: await handle(message) })
    } catch (error) {
      reply(200, { jsonrpc: '2.0', id: message.id, error: { code: error.code ?? -32603, message: error.message } })
    }
  })
  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(`Mod finder listening at http://127.0.0.1:${server.address().port}/mcp\n`)
  })
  return server
}
