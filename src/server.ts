import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './spotify.js'

await createServer().connect(new StdioServerTransport())
