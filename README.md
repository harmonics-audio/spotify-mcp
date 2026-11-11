# spotify-mcp

MCP-server waarmee Claude Spotify bedient: afspelen, pauzeren, volgende/vorige, volume, shuffle, wachtrij, toestellen en zoeken.

## Vereisten

- Spotify Premium
- Een app op [developer.spotify.com](https://developer.spotify.com/dashboard) met redirect URI `http://127.0.0.1:8888/callback`
- Node 22+

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

## Tools

| Tool | Wat |
|---|---|
| `devices` | Beschikbare toestellen met id |
| `now_playing` | Huidig nummer, voortgang en URI |
| `play` | Afspelen/hervatten, optioneel URI en toestel |
| `pause`, `next`, `previous` | Basisbediening |
| `volume` | Volume 0-100 |
| `shuffle` | Shuffle aan/uit |
| `queue` | Nummer aan wachtrij toevoegen |
| `transfer` | Afspelen naar ander toestel verplaatsen |
| `search` | Zoek nummers, artiesten, albums, playlists |
| `search_and_play` | Zoek en speel meteen het beste resultaat |

## Aandachtspunten

- Fout 404 "No active device": open Spotify ergens, of gebruik `devices` en dan `transfer`.
- Spotify negeert momenteel (november 2026) `PUT /me/player/play` met een specifiek nummer: het antwoordt 204 maar maakt de speler leeg. Daarom zetten `play` en `search_and_play` een nummer in de wachtrij en springen ernaartoe. Albums, playlists en artiesten starten nog via `play` en kunnen genegeerd worden.
- Het refresh token is gevoelig: alleen in `.env` (staat in `.gitignore`), nooit in de repo.
