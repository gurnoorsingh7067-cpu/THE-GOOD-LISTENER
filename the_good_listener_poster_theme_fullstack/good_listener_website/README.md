# The Good Listener — Website Starter

A responsive red/yellow/cream open-mic website, with SQLite registrations and a password-protected admin dashboard.

## Requirements
- Node.js 20 or newer
- npm

## Run locally
1. Unzip this folder.
2. Open a terminal in this folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Set admin credentials and session secret **before starting**.

   macOS/Linux:
   ```bash
   export ADMIN_USERNAME="your-admin-name"
   export ADMIN_PASSWORD="use-a-long-unique-password"
   export SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
   npm start
   ```

   Windows PowerShell:
   ```powershell
   $env:ADMIN_USERNAME="your-admin-name"
   $env:ADMIN_PASSWORD="use-a-long-unique-password"
   $env:SESSION_SECRET="replace-with-a-long-random-secret"
   npm start
   ```

5. Open `http://localhost:3000`. Admin dashboard: `http://localhost:3000/admin.html`.

The first startup creates the admin user if that username doesn't already exist. The SQLite database and session database are stored in this folder by default.

## What works
- Responsive landing page and upcoming-event cards
- Event registration with required name/email and optional phone/note
- Duplicate email prevention per event
- Seat capacity enforced on the server; full events stop accepting registrations
- Admin login and session-based access control
- Admin dashboard: create/edit/delete events, view registration list and performer counts
- Rate limits on login and registration endpoints
- SQLite database persistence

## Important before going public
- Replace the sample phone number and email in `public/index.html` with the owner's real contact details.
- Set strong unique credentials and a random `SESSION_SECRET`; never commit `.env` files or passwords.
- Deploy behind HTTPS and set `NODE_ENV=production`; use a persistent disk for the SQLite database.
- Configure a restrictive Content Security Policy (the prototype currently disables CSP because the page uses inline scripts/styles).
- Add a consent/privacy notice and define data retention/deletion practices for registrant details.
- Test database backups, restore, registration capacity and admin access before launch.
- For production use with multiple server instances, use a shared session store and consider PostgreSQL rather than SQLite.
- This starter does not send confirmation emails or SMS. Add an email provider if those notifications are needed.

## Notes
If the backend is not running, the homepage shows sample event cards as a visual preview. Registrations in preview mode are not saved.
