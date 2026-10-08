# Stitch client reports

Private monthly report site for Stitch clients. Each client gets one unguessable link that opens their latest report, with a month switcher for older ones. Every page is hidden from search engines (noindex meta tag, `X-Robots-Tag` header and a `robots.txt` that blocks everything).

Plain Node, no dependencies. Needs Node 20 or newer.

## How it works

```
reports/
  xtracta/
    client.json        display name, e.g. { "name": "Xtracta" }
    2026-09/
      index.html       self-contained report for September 2026
```

- Each folder in `reports/` is a client. Each `YYYY-MM` folder inside it is a month.
- The client's link is `https://<domain>/r/<token>/`. It shows the newest month. Older months are at `/r/<token>/YYYY-MM`.
- The token and optional password are never in the code or the repo. They come from Railway variables, or from `clients.local.json` when running locally.
- A client with no token set is not served at all. Tokens shorter than 24 characters are refused.

Variable names use the folder name in capitals, with anything that isn't a letter or number turned into `_`:

| Variable | Purpose |
| --- | --- |
| `CLIENT_XTRACTA_TOKEN` | Required. The secret part of the client's link. |
| `CLIENT_XTRACTA_PASSWORD` | Optional. If set, the client must enter it once (remembered for 30 days). |
| `SESSION_SECRET` | Required in production. Signs login cookies. Any long random string. |

## Run locally

```sh
cp clients.local.example.json clients.local.json   # gitignored
npm run token                                       # paste the output into clients.local.json
npm start                                           # http://localhost:3000/r/<token>/
```

## Add a client

1. Create `reports/<client-slug>/client.json` with the client's name and Windsor accounts (see MONTHLY.md). Use lowercase letters, numbers and dashes for the slug.
2. Add their first month (see below).
3. Run `npm run token` and set `CLIENT_<SLUG>_TOKEN` in Railway. Optionally set `CLIENT_<SLUG>_PASSWORD`.
4. Commit, push and let Railway redeploy. Send the client `https://<domain>/r/<token>/`.

## Add a month

See [MONTHLY.md](MONTHLY.md) for the full monthly run (data pull, checks, review). The short version:


1. Create `reports/<client-slug>/YYYY-MM/index.html`. It must be fully self-contained: inline CSS, inline or CDN scripts, images embedded as data URIs or hosted publicly.
2. Include `<meta name="robots" content="noindex, nofollow">` in the head. The server adds it if missing, but keep it in the file.
3. Commit and push. The new month becomes the default view and appears at the top of the switcher.

## Deploy to Railway

1. In Railway, create a new project from this GitHub repo. `railway.json` sets the start command (`npm start`) and a health check at `/healthz`.
2. Under Variables, set `SESSION_SECRET` and each client's `CLIENT_<SLUG>_TOKEN` (and password if wanted).
3. Under Settings > Networking, generate a domain (or attach a custom one).
4. Railway redeploys on every push to the connected branch.

## Changing access

- **Revoke or rotate a link:** set a new token in Railway. The old link stops working on redeploy.
- **Change a password:** update the variable. Existing logins for that client are signed out.
