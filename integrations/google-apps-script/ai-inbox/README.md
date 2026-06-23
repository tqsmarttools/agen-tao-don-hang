# Sapo phone-order AI inbox

Google Apps Script web app that receives phone-order queue payloads from the mobile dashboard and stores them in a private Google Sheet.

## Setup

1. Create a private Google Sheet.
2. Open `Extensions > Apps Script`.
3. Paste `Code.gs` into the project.
4. In `Project Settings > Script properties`, add:
   - `INBOX_KEY`
   - `SPREADSHEET_ID`
5. Run `setupAiInbox` once and approve permissions.
6. Deploy as Web App:
   - Execute as: `Me`
   - Access: `Anyone with the link`

## Dashboard usage

Enter the `inbox URL` and `inbox key` in the dashboard queue panel. The dashboard stores that config in local browser storage and uses it for `Gửi inbox`.

## Security

- Do not store Sapo tokens in Apps Script.
- Keep the Google Sheet private.
- The inbox key only protects queue writes; it is not a Sapo credential.
