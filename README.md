# spotify-mcp

MCP-server waarmee Claude Spotify bedient: afspelen, pauzeren, volgende/vorige, volume, shuffle, wachtrij, toestellen en zoeken.

## Vereisten

- Spotify Premium
- Een app op [developer.spotify.com](https://developer.spotify.com/dashboard) met redirect URI `http://127.0.0.1:8888/callback`
- Node 22.13+

## Setup

```bash
pnpm install
cp .env.example .env   # vul SPOTIFY_CLIENT_ID en SPOTIFY_CLIENT_SECRET in
pnpm auth              # open de URL, log in, zet de geprinte SPOTIFY_REFRESH_TOKEN in .env
pnpm build
```

Testen met de MCP Inspector: `pnpm inspect`

## Koppelen aan Claude Code

```bash
claude mcp add spotify -- node --env-file=/pad/naar/spotify-mcp/.env /pad/naar/spotify-mcp/build/server.js
```

## Remote (Claude-app op gsm, claude.ai)

`build/http.js` serveert MCP via Streamable HTTP op `/mcp`, beveiligd met OAuth via de SDK-router. Aanmelden gebeurt met je Spotify-account: alleen het account achter `SPOTIFY_REFRESH_TOKEN` krijgt toegang.

1. Voeg in de Spotify-app de redirect URI `https://<domein>/oauth/spotify/callback` toe.
2. CI (`.github/workflows/ci.yml`, via `vernaillen/workflows`) bouwt de image, pusht ze naar `registry.apps.vernaillen.dev/spotify-mcp` en laat Coolify herdeployen. De Coolify-app (Docker Image) krijgt env `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, `PUBLIC_URL=https://<domein>` en een volume op `/data` (OAuth-clients en tokens, SQLite).
3. Voeg in claude.ai een custom connector toe met URL `https://<domein>/mcp` en meld aan met Spotify.

Lokaal: `pnpm build && pnpm start:http` (standaard `http://localhost:3000/mcp`).

## Tools

| Tool | Wat |
|---|---|
| `spotify_devices` | Beschikbare toestellen met id |
| `spotify_now_playing` | Huidig nummer, voortgang en URI |
| `spotify_play` | Afspelen/hervatten, optioneel URI en toestel |
| `spotify_pause`, `spotify_next`, `spotify_previous` | Basisbediening |
| `spotify_volume` | Volume 0-100 |
| `spotify_shuffle` | Shuffle aan/uit |
| `spotify_queue` | Nummer aan wachtrij toevoegen |
| `spotify_transfer` | Afspelen naar ander toestel verplaatsen |
| `spotify_search` | Zoek nummers, artiesten, albums, playlists |
| `spotify_search_and_play` | Zoek en speel meteen het beste resultaat |
| `spotify_playlists` | Mijn playlists |
| `spotify_playlist_tracks` | Nummers in een eigen playlist |
| `spotify_liked_tracks`, `spotify_saved_albums` | Gelikete nummers, opgeslagen albums |
| `spotify_save`, `spotify_unsave` | Liken/bewaren of verwijderen in de bibliotheek |
| `spotify_playlist_create`, `spotify_playlist_add` | Playlist maken, nummers toevoegen |

## Aandachtspunten

- Fout 404 "No active device": open Spotify ergens, of gebruik `spotify_devices` en dan `spotify_transfer`.
- Spotify negeert momenteel (november 2026) `PUT /me/player/play` met een specifiek nummer: het antwoordt 204 maar maakt de speler leeg. Daarom zetten `spotify_play` en `spotify_search_and_play` een nummer in de wachtrij en springen ernaartoe. Albums, playlists en artiesten starten nog via `spotify_play` en kunnen genegeerd worden.
- Sinds februari 2026 toont Spotify alleen de nummers van playlists die je zelf maakte of waaraan je meewerkt.
- Na een uitbreiding van de scopes in `src/auth.ts`: `pnpm auth` opnieuw draaien en het nieuwe refresh token in `.env` en in Coolify zetten.
- Het refresh token is gevoelig: alleen in `.env` (staat in `.gitignore`), nooit in de repo.
