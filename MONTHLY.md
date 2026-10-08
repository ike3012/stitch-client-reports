# Monthly report run

How each client's report is produced every month. Written for whoever runs it, human or Claude.

The template for each client is **their own previous month's report** in `reports/<client>/YYYY-MM/index.html`. Each one was designed for that client (platforms, sections, terminology), so next month is the same file with new data, not a generic layout.

## Clients

Every folder in `reports/` with a `client.json` is a client. `client.json` holds the display name and the Windsor.ai accounts the report pulls from:

```json
{
  "name": "Matamata Country Club",
  "sources": { "windsor": { "facebook": "270462695392409", "google_ads": "161-937-7791" } }
}
```

Connector keys are Windsor connector slugs (`facebook` = Meta Ads, `google_ads`, `linkedin`, `googleanalytics4`, `tiktok`, `reddit`).

## Steps, per client

1. **Copy last month.** Copy `reports/<client>/<last month>/index.html` to `reports/<client>/<this month>/index.html`.
2. **Pull data.** For each account in `client.json`, pull the report month and the month before from Windsor (`get_data`, `date_from`/`date_to` for full calendar months). Call `get_fields` first; never guess field names. Pull the same breakdowns the report already shows (campaigns, ad sets, ads, ad groups, channels).
3. **Swap the data.** Replace the values in the report's JavaScript data block (`const D`, `META`, `GOOGLE`, `R` and so on, depending on the client).
4. **Update everything hardcoded.** Most reports also have month names, dates and figures typed directly into notes, headings, table headers and summary bullets. Search the file for the old month name ("September", "Sep", "August", "Aug"), the old year and any figure that appears in prose, and update or rewrite each one. Commentary must describe the new month's data.
5. **Check the numbers.** Total spend, clicks and impressions per platform in the page must match Windsor for the month. Totals rendered by JS: open the page and read them.
6. **Check the copy.** It goes to the client, so:
   - No internal notes ("needs checking", "TBC", QA remarks about thumbnails or data quirks)
   - No Stitch fees, margins or profitability
   - No em dashes; use a colon, comma or regular dash
   - Ad platform conversions are "Leads" with "Cost/Lead"; GA4 conversions stay "Key Events"
   - Never invent a figure. If data is missing, say so and leave it for a person.
7. **Noindex.** Keep `<meta name="robots" content="noindex, nofollow, noarchive">` in the `<head>`.

## Publishing

All new months go in **one pull request** for review. Nothing reaches a client until a person at Stitch has read the PR and merged it. Merging to `main` redeploys Railway and the new month becomes the default view on each client's existing link.

## New client

1. Create `reports/<client>/client.json` (name and Windsor accounts) and the first month's report.
2. Run `npm run token` and set `CLIENT_<CLIENT>_TOKEN` on the Railway `reports-web` service.
3. Merge. Their link is `https://<domain>/r/<token>/`.
