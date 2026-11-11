import http from 'node:http'
import { randomUUID } from 'node:crypto'

const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env
if (!id || !secret) throw new Error('SPOTIFY_CLIENT_ID en SPOTIFY_CLIENT_SECRET zijn vereist')

const redirect = 'http://127.0.0.1:8888/callback'
const scopes = 'user-modify-playback-state user-read-playback-state user-read-currently-playing'
const state = randomUUID()

console.log('Open deze URL en log in:\n')
console.log('https://accounts.spotify.com/authorize?' + new URLSearchParams({
  client_id: id, response_type: 'code', redirect_uri: redirect, scope: scopes, state,
}))

http.createServer(async (req, res) => {
  const params = new URL(req.url!, redirect).searchParams
  const code = params.get('code')
  if (!code || params.get('state') !== state) return res.end('Geen geldige code')

  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect }),
  })
  const json = await r.json()
  if (!r.ok) {
    console.error('Token-aanvraag mislukt:', json)
    res.end('Mislukt, kijk in je terminal.')
    process.exit(1)
  }
  console.log('\nSPOTIFY_REFRESH_TOKEN=' + json.refresh_token)
  res.end('Klaar, kijk in je terminal.')
  process.exit(0)
}).listen(8888, '127.0.0.1')
