# EcoBite

EcoBite connects commercial food donors, verified relief organizations, and volunteer drivers to move safe surplus food quickly and transparently.

## Requirements

- Node.js 18 or later
- MongoDB running locally or a MongoDB Atlas connection string
- A replica set for food claims: MongoDB transactions are required. A local standalone MongoDB instance does not support the claim transaction; use Atlas or a local single-node replica set.

## Start the application

1. Copy `server/.env.example` to `server/.env` and set `MONGODB_URI` and a random `JWT_SECRET` of at least 32 characters.
2. Copy `client/.env.example` to `client/.env` if the API is not at `http://localhost:4000/api`.
3. From the repository root, install root tools with `npm install`, then install each app's dependencies:

   ```powershell
   npm install
   npm install --prefix server
   npm install --prefix client
   ```

4. Load the demo data (this **drops the configured database** before inserting seed data):

   ```powershell
   npm run seed
   ```

5. Start both apps from the repository root:

   ```powershell
   npm run dev
   ```

   The React app is at `http://localhost:5173` and the API is at `http://localhost:4000`. You can also start them separately with `npm run dev --prefix server` and `npm run dev --prefix client`.

## Demo accounts

All seeded accounts use password `EcoBite123!`.

| Portal | Account |
| --- | --- |
| Donor | `donor1@ecobite.org` |
| NGO receiver | `ngo1@ecobite.org` |
| Volunteer | `volunteer1@ecobite.org` |
| Admin | `admin@ecobite.org` |

The seed creates 5 donors, 5 verified Bengaluru NGOs, 3 volunteers, one admin, and 10 active listings.

## Core workflows

- Donors publish food with preparation and expiry timestamps, temperature status, allergen labels, coordinates, and an accepted liability waiver.
- Receivers see capacity-matched listings within 10 km. Claims reserve NGO capacity and lock the listing and match in one MongoDB transaction.
- Volunteers can take an unassigned claimed route, view its pickup/drop-off map, and update pickup and delivery status.
- Admins can verify NGOs and pause/resume new listings and claims.
- Donor impact totals and a downloadable PDF report are available in the portal.
- If Twilio credentials are absent, claim notifications are logged as simulated SMS events; set the Twilio variables in `server/.env` to enable delivery.

## API overview

`/api/auth/*` handles registration, login, session lookup, and logout. `/api/listings` creates donor listings; `/api/listings/nearby` gives receivers their nearest eligible food. `/api/matches/claim` runs the transactional claim. `/api/volunteer/*` handles route assignment, and `/api/admin/*` handles verification and the emergency pause. `/api/health` reports server and database readiness.
