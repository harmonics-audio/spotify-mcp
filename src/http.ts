import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from './spotify.js'
import { createProvider, spotifyCallback } from './oauth.js'

const base = new URL(process.env.PUBLIC_URL ?? 'http://localhost:3000')
const mcpUrl = new URL('/mcp', base)
const provider = createProvider(base)

const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts: [base.hostname] })
app.set('trust proxy', 1)

app.use(mcpAuthRouter({ provider, issuerUrl: base, resourceServerUrl: mcpUrl, resourceName: 'Spotify' }))
app.get('/oauth/spotify/callback', spotifyCallback(base))

const auth = requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) })

app.post('/mcp', auth, async (req, res) => {
  const server = createServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => {
    transport.close()
    server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
})

app.all('/mcp', (_req, res) => {
  res.status(405).set('Allow', 'POST').end()
})

const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => console.log(`Spotify MCP op ${mcpUrl.href} (poort ${port})`))
