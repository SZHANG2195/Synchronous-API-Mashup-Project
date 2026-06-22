# Synchronous API Mashup
Video game OST finder page that allows users to query parameters to the IGDB API for data to use in query to the Discogs API, using vanilla Node.js and HTTPS calls.

## Getting Started
1. Clone the repo
2. Run `npm install`
3. Create a `credentials.json` in the `auth` folder
4. Copy `auth/credentials.example.json` to `auth/credentials.json` and fill in your credentials:
   - **IGDB:** Register at [dev.twitch.tv](https://dev.twitch.tv) to get a Client ID and Secret
   - **Discogs:** Get a token at [discogs.com/settings/developers](https://www.discogs.com/settings/developers)
5. Run `node server.js`

## Screenshots
### Home Page
<img width="605" height="624" alt="Screenshot 2026-06-22 190008" src="https://github.com/user-attachments/assets/2517d474-4c20-4bc6-9b06-d8fdd95c0e72" />

### Results Page
<img width="1988" height="702" alt="image" src="https://github.com/user-attachments/assets/6eff27ad-abab-41e1-9d06-6e5952aaca3d" />

## Features
- Filter games by genre, platform, game mode, and rating range
- Fetches matching game from IGDB and searches Discogs for soundtrack releases
- File-based caching for both APIs to minimize redundant requests
- Automatic OAuth token refresh for IGDB

## Tech Stack
- **Runtime:** Node.js
- **APIs:** IGDB (Twitch OAuth 2.0), Discogs
- **Architecture:** Vanilla Node.js, no frameworks

## Architecture
Built entirely without frameworks — routing, request handling, and HTML streaming are done with Node's built-in `http` and `https` modules. API calls are chained so the IGDB result feeds directly into the Discogs query. Responses are streamed to the client as chunks rather than buffered, and both API responses are cached locally as JSON to avoid repeat calls.
