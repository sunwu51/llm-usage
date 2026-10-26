# LLM Usage Chrome extension

An experimental Manifest V3 extension for Codex and Claude subscription quota. It displays all returned quota windows in the popup, the first two accounts' 5h remaining percentages in the toolbar badge, a 5h/7d toolbar tooltip, and a local history report. The badge shows the first account for three seconds, the second for three seconds, then returns to the first for 30 seconds before repeating. Codex badges are blue and Claude badges are orange. Chrome alarms can be delayed, so the cycle is best effort rather than an exact clock.

## Install

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this directory. Click the toolbar icon to connect Codex or Claude. Login starts in a browser tab. Codex and Claude use localhost callbacks; the extension watches the exact callback URL and reads the authorization code without running an HTTP server. After the account is saved, the login tab becomes a success page with a link to the quota view.

**OAuth compatibility is experimental.** Claude uses the Claude.ai authorization URL, scopes, and `code=true` parameter used by cc-haha, with a localhost callback. Its public OAuth client rejects Chrome's extension callback URL. The extension sets `User-Agent: node` on its own POST requests to Claude's token endpoint through a narrowly scoped Manifest V3 network rule, then exchanges the code in its service worker. If that exchange still returns HTTP 429, the popup offers PowerShell commands for `curl.exe` and Node `fetch`, plus a field for the returned token JSON. The commands use the same one-time authorization code: run only one of them for each login attempt. The commands and JSON contain credentials; do not share them.

## Data and refresh

Tokens, snapshots and history stay in `chrome.storage.local` and are restricted to trusted extension contexts. They are not encrypted like macOS Keychain or Windows DPAPI. Protect the Chrome profile and remove the extension to erase its local storage. History retains up to 30 days of samples, records changes or a heartbeat every 15 minutes, and never fabricates samples while Chrome is closed. The chart breaks gaps over 30 minutes and quota resets. Chrome alarms run once a minute while available; opening the popup also checks for stale data. The popup shows the timestamp of the last successful fetch.

Accounts appear in the order they were added. Removing an account deletes its stored tokens, snapshot, errors, and history; the shared refresh alarm remains available for other accounts. Removing an account does not revoke its token on the provider's server.

## Cross-device sync (optional)

Instead of signing in on every computer, sign in on one always-on device and let the others display its data. Expand **Cross-device sync** in the popup and choose a role:

- **Standalone** (default): nothing is synced.
- **Primary**: signs in, queries Codex/Claude, and uploads snapshots and the 30-day history to a private GitHub Gist after each successful refresh. Leave **Gist ID** empty and the extension creates the Gist and fills in the ID. Copy that ID to your other devices.
- **Viewer**: holds no credentials and never contacts OpenAI or Anthropic. It downloads the Gist once a minute and shows the same popup, badge, and history. Sign-in and account removal are disabled. Switching a device to Viewer deletes any accounts and tokens stored on it.

Both Primary and Viewer need a GitHub token with the `gist` scope. That token can write all of your Gists, so use a dedicated GitHub account if that concerns you. It is stored in `chrome.storage.local` like the other secrets. OAuth tokens of Codex and Claude are never uploaded, so the provider sees requests from the primary device only. The Gist contains account labels (which may include an email), usage percentages, reset times, and history. It is gzip-compressed, not encrypted, and a secret Gist is accessible to anyone who has its URL. Run only one Primary per Gist: a second Primary refuses to overwrite data written by another device in the last 15 minutes and shows a sync error.

The toolbar hover text is a plain Chrome action tooltip. The popup contains the full interactive details.

## Development

Run `npm test` for parser and history unit tests. No build step or dependency install is required.

## Releases

Run `python scripts/package.py` to build a Chrome Web Store ZIP under `dist/`. On `master`, a change to `manifest.json` triggers the GitHub Actions release workflow. The workflow compares its `version` with the previous commit, runs tests, builds the ZIP, and publishes a GitHub release tagged `v<version>` only when the version changed. Bump the manifest version for every store update.

Store listing copy is in [STORE_LISTING.md](STORE_LISTING.md). The bilingual [privacy policy](PRIVACY.md) can be linked from the Chrome Web Store listing.
