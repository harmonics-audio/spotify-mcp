import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { Request, Response } from 'express'
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import { spotify } from './spotify.js'

const ACCESS_TTL = 3600
const REFRESH_TTL = 90 * 24 * 3600
const PENDING_TTL = 5 * 60 * 1000

const dir = process.env.DATA_DIR ?? 'data'
mkdirSync(dir, { recursive: true })
const db = new DatabaseSync(`${dir}/oauth.db`)
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS tokens (
    hash TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT NOT NULL,
    scopes TEXT NOT NULL, resource TEXT, expires_at INTEGER NOT NULL
  );
`)

type Pending = { client: OAuthClientInformationFull, params: AuthorizationParams, expires: number }
const pending = new Map<string, Pending>()
const codes = new Map<string, Pending>()

const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const now = () => Math.floor(Date.now() / 1000)

function take(map: Map<string, Pending>, key: string) {
  const entry = map.get(key)
  map.delete(key)
  return entry && entry.expires > Date.now() ? entry : undefined
}

function issue(clientId: string, scopes: string[], resource?: URL) {
  const access = randomBytes(32).toString('base64url')
  const refresh = randomBytes(32).toString('base64url')
  db.prepare('DELETE FROM tokens WHERE expires_at < ?').run(now())
  const insert = db.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?, ?, ?)')
  insert.run(hash(access), 'access', clientId, scopes.join(' '), resource?.href ?? null, now() + ACCESS_TTL)
  insert.run(hash(refresh), 'refresh', clientId, scopes.join(' '), resource?.href ?? null, now() + REFRESH_TTL)
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: scopes.join(' ') }
}

type TokenRow = { client_id: string, scopes: string, resource: string | null, expires_at: number }

function findToken(token: string, kind: 'access' | 'refresh') {
  const row = db.prepare('SELECT client_id, scopes, resource, expires_at FROM tokens WHERE hash = ? AND kind = ?')
    .get(hash(token), kind) as TokenRow | undefined
  return row && row.expires_at > now() ? row : undefined
}

const scopesOf = (row: TokenRow) => row.scopes ? row.scopes.split(' ') : []

const callbackUrl = (base: URL) => new URL('/oauth/spotify/callback', base).href

export function createProvider(base: URL): OAuthServerProvider {
  return {
    clientsStore: {
      getClient: (id) => {
        const row = db.prepare('SELECT data FROM clients WHERE id = ?').get(id) as { data: string } | undefined
        return row ? JSON.parse(row.data) : undefined
      },
      // The SDK's register handler has already generated client_id; its type just doesn't say so
      registerClient: (input) => {
        const client = input as OAuthClientInformationFull
        db.prepare('INSERT INTO clients VALUES (?, ?)').run(client.client_id, JSON.stringify(client))
        return client
      },
    },

    // Login happens at Spotify; spotifyCallback checks it's the account this server controls
    async authorize(client, params, res) {
      const key = randomUUID()
      pending.set(key, { client, params, expires: Date.now() + PENDING_TTL })
      const url = new URL('https://accounts.spotify.com/authorize')
      url.search = new URLSearchParams({
        client_id: process.env.SPOTIFY_CLIENT_ID!,
        response_type: 'code',
        redirect_uri: callbackUrl(base),
        state: key,
      }).toString()
      res.redirect(url.href)
    },

    async challengeForAuthorizationCode(client, code) {
      const entry = codes.get(code)
      if (!entry || entry.client.client_id !== client.client_id) throw new InvalidGrantError('Ongeldige code')
      return entry.params.codeChallenge
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
      const entry = take(codes, code)
      if (!entry || entry.client.client_id !== client.client_id) throw new InvalidGrantError('Ongeldige of verlopen code')
      if (redirectUri && redirectUri !== entry.params.redirectUri) throw new InvalidGrantError('redirect_uri komt niet overeen')
      return issue(client.client_id, entry.params.scopes ?? [], entry.params.resource)
    },

    async exchangeRefreshToken(client, refreshToken, scopes) {
      const row = findToken(refreshToken, 'refresh')
      if (!row || row.client_id !== client.client_id) throw new InvalidGrantError('Ongeldig refresh token')
      db.prepare('DELETE FROM tokens WHERE hash = ?').run(hash(refreshToken))
      return issue(client.client_id, scopes ?? scopesOf(row), row.resource ? new URL(row.resource) : undefined)
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      const row = findToken(token, 'access')
      if (!row) throw new InvalidTokenError('Ongeldig of verlopen token')
      return {
        token,
        clientId: row.client_id,
        scopes: scopesOf(row),
        expiresAt: row.expires_at,
        resource: row.resource ? new URL(row.resource) : undefined,
      }
    },

    async revokeToken(_client, { token }) {
      db.prepare('DELETE FROM tokens WHERE hash = ?').run(hash(token))
    },
  }
}

let ownerId: string | undefined
const owner = async () => ownerId ??= (await spotify('GET', '/me')).id as string

async function spotifyUserId(code: string, redirectUri: string) {
  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  })
  if (!r.ok) throw new Error(`Spotify token ${r.status}: ${await r.text()}`)
  const { access_token } = await r.json()
  const me = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${access_token}` } })
  if (!me.ok) throw new Error(`Spotify /me ${me.status}: ${await me.text()}`)
  return (await me.json()).id as string
}

export function spotifyCallback(base: URL) {
  return async (req: Request, res: Response) => {
    const entry = take(pending, String(req.query.state))
    if (!entry) {
      res.status(400).send('Aanmelding verlopen of ongeldig, probeer opnieuw.')
      return
    }
    const back = new URL(entry.params.redirectUri)
    if (entry.params.state) back.searchParams.set('state', entry.params.state)

    const code = typeof req.query.code === 'string' ? req.query.code : undefined
    if (!code || await spotifyUserId(code, callbackUrl(base)) !== await owner()) {
      back.searchParams.set('error', 'access_denied')
      res.redirect(back.href)
      return
    }

    const authCode = randomBytes(32).toString('base64url')
    codes.set(authCode, { ...entry, expires: Date.now() + PENDING_TTL })
    back.searchParams.set('code', authCode)
    res.redirect(back.href)
  }
}
