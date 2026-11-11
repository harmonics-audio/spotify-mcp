import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret, SPOTIFY_REFRESH_TOKEN: refresh } = process.env
if (!id || !secret || !refresh) {
  throw new Error('SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET en SPOTIFY_REFRESH_TOKEN zijn vereist')
}

let token = ''
let expires = 0

async function getToken() {
  if (Date.now() < expires) return token
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh! }),
  })
  if (!r.ok) throw new Error(`Spotify token ${r.status}: ${await r.text()}`)
  const j = await r.json()
  token = j.access_token
  expires = Date.now() + (j.expires_in - 60) * 1000
  return token
}

export async function spotify(method: string, path: string, query: Record<string, string | undefined> = {}, body?: unknown) {
  const params = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined))
  const r = await fetch(`https://api.spotify.com/v1${path}${params.size ? `?${params}` : ''}`, {
    method,
    headers: { 'Authorization': `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`Spotify ${r.status}: ${text}`)
  return r.headers.get('content-type')?.includes('json') && text ? JSON.parse(text) : undefined
}

const player = (method: string, path: string, query?: Record<string, string | undefined>, body?: unknown) =>
  spotify(method, `/me/player${path}`, query, body)

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })

async function start(uri: string, device_id?: string) {
  if (!/:(?:track|episode):/.test(uri)) {
    await player('PUT', '/play', { device_id }, { context_uri: uri })
    return 'Let op: Spotify negeert momenteel vaak het starten van albums, playlists en artiesten via de API. Controleer met spotify_now_playing.'
  }
  // Spotify currently answers PUT /play with `uris` with 204 but clears the player instead; queue + skip still works
  if (device_id) await player('PUT', '', {}, { device_ids: [device_id], play: false })
  await player('POST', '/queue', { uri, device_id })
  await player('POST', '/next', { device_id })
  return ''
}

const time = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

const types = z.enum(['track', 'artist', 'album', 'playlist'])

const search = (q: string, type: string, limit: number) =>
  spotify('GET', '/search', { q, type, limit: String(limit) }).then(j => (j[`${type}s`]?.items ?? []).filter(Boolean))

export function createServer() {
  const server = new McpServer({ name: 'spotify-control', version: '0.1.0' })

  server.registerTool('spotify_devices', {
    description: 'Lijst beschikbare Spotify-toestellen met hun id',
    annotations: { readOnlyHint: true },
  }, async () => {
    const { devices } = await player('GET', '/devices')
    const lines = devices.map((d: any) =>
      `${d.name} (${d.type})${d.is_active ? ' [actief]' : ''} volume ${d.volume_percent ?? '?'}% | id ${d.id}`)
    return ok(lines.join('\n') || 'Geen toestellen gevonden. Open Spotify op een toestel.')
  })

  server.registerTool('spotify_now_playing', {
    description: 'Wat speelt er nu',
    annotations: { readOnlyHint: true },
  }, async () => {
    const j = await player('GET', '/currently-playing')
    const item = j?.item
    if (!item) return ok('Er speelt niets')
    const by = item.artists?.map((a: any) => a.name).join(', ') ?? item.show?.name
    const from = item.album?.name ? ` (${item.album.name})` : ''
    return ok(`${j.is_playing ? 'Speelt' : 'Gepauzeerd'}: ${item.name} – ${by}${from} | ${time(j.progress_ms ?? 0)}/${time(item.duration_ms)} | ${item.uri}`)
  })

  server.registerTool('spotify_play', {
    description: 'Afspelen of hervatten, optioneel met een Spotify-URI (nummer, album, playlist, artiest) en toestel',
    inputSchema: { uri: z.string().optional(), device_id: z.string().optional() },
  }, async ({ uri, device_id }) => {
    if (!uri) {
      await player('PUT', '/play', { device_id })
      return ok('Afspelen gestart')
    }
    return ok(`Afspelen gestart. ${await start(uri, device_id)}`.trim())
  })

  server.registerTool('spotify_pause', { description: 'Pauzeren' }, async () => {
    await player('PUT', '/pause')
    return ok('Gepauzeerd')
  })

  server.registerTool('spotify_next', { description: 'Volgende nummer' }, async () => {
    await player('POST', '/next')
    return ok('Volgende nummer')
  })

  server.registerTool('spotify_previous', { description: 'Vorige nummer' }, async () => {
    await player('POST', '/previous')
    return ok('Vorige nummer')
  })

  server.registerTool('spotify_volume', {
    description: 'Volume instellen (0-100)',
    inputSchema: { percent: z.number().int().min(0).max(100) },
  }, async ({ percent }) => {
    await player('PUT', '/volume', { volume_percent: String(percent) })
    return ok(`Volume ${percent}%`)
  })

  server.registerTool('spotify_shuffle', {
    description: 'Shuffle aan/uit',
    inputSchema: { on: z.boolean() },
  }, async ({ on }) => {
    await player('PUT', '/shuffle', { state: String(on) })
    return ok(`Shuffle ${on ? 'aan' : 'uit'}`)
  })

  server.registerTool('spotify_queue', {
    description: 'Nummer aan de wachtrij toevoegen (Spotify-URI van een nummer)',
    inputSchema: { uri: z.string() },
  }, async ({ uri }) => {
    await player('POST', '/queue', { uri })
    return ok('Toegevoegd aan wachtrij')
  })

  server.registerTool('spotify_transfer', {
    description: 'Afspelen naar een ander toestel verplaatsen (gebruik eerst spotify_devices voor de id)',
    inputSchema: { device_id: z.string(), play: z.boolean().default(true) },
  }, async ({ device_id, play }) => {
    await player('PUT', '', {}, { device_ids: [device_id], play })
    return ok('Afspelen verplaatst')
  })

  server.registerTool('spotify_search', {
    description: 'Zoek nummers, artiesten, albums of playlists; geeft namen en URI\'s terug',
    inputSchema: { query: z.string(), type: types.default('track') },
    annotations: { readOnlyHint: true },
  }, async ({ query, type }) => {
    const items = await search(query, type, 5)
    const lines = items.map((i: any) =>
      `${i.name}${i.artists ? ' – ' + i.artists.map((a: any) => a.name).join(', ') : ''} | ${i.uri}`)
    return ok(lines.join('\n') || 'Niets gevonden')
  })

  server.registerTool('spotify_search_and_play', {
    description: 'Zoek en speel meteen het beste resultaat af. Voor een artiest spelen diens populairste nummers; gebruik type track voor één specifiek nummer.',
    inputSchema: { query: z.string(), type: types.default('track'), device_id: z.string().optional() },
  }, async ({ query, type, device_id }) => {
    const [item] = await search(query, type, 1)
    if (!item) return ok('Niets gevonden')
    return ok(`Speelt nu: ${item.name}. ${await start(item.uri, device_id)}`.trim())
  })

  return server
}
