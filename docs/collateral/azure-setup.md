# Collateral sync: one-time Azure setup (Nathan or Jordan)

This connects Pulse to the SharePoint Sales Collateral library, read-only.
It takes about 15 minutes. You need a Microsoft 365 admin account for
steps 1 to 4 (Joe or IT can sit in for the two "admin consent" clicks if
needed). Nothing here can write to SharePoint: the permission we grant is
read-only, on one site only.

You will end up with three values to paste into Supabase:

- Tenant ID
- Client ID
- Client secret

The library's drive ID is already built into Pulse, so you do not need it.

---

## Step 1: Register the app

1. Go to portal.azure.com and sign in with the Medcurity admin account.
2. Search for "App registrations" in the top bar and open it.
3. Click "New registration".
4. Name: `Pulse Collateral Sync`
5. Supported account types: leave the default, "Accounts in this
   organizational directory only (single tenant)".
6. Redirect URI: leave empty.
7. Click "Register".
8. On the Overview page that opens, copy these two values into a note:
   - "Application (client) ID"  (this is the Client ID)
   - "Directory (tenant) ID"    (this is the Tenant ID)

## Step 2: Create the secret

1. In the same app, open "Certificates & secrets" in the left menu.
2. Click "New client secret".
3. Description: `pulse-sync`. Expires: 24 months. Click "Add".
4. Copy the VALUE column immediately (not the Secret ID). It is only
   shown once. This is the Client secret.

## Step 3: Give it the Sites.Selected permission

1. Open "API permissions" in the left menu.
2. Click "Add a permission" > "Microsoft Graph" > "Application
   permissions".
3. Search for `Sites.Selected`, tick it, click "Add permissions".
4. Click "Grant admin consent for Medcurity" and confirm. The Status
   column should show a green check.

Sites.Selected means the app can access NO sites at all until step 4
grants it one specific site. That is the point: even if the secret ever
leaked, it opens one site, read-only.

## Step 4: Grant read access to the MedcurityInc site only

This step uses Graph Explorer, Microsoft's own API tool.

1. Go to https://developer.microsoft.com/graph/graph-explorer and sign
   in with the same admin account (button top left).
2. First request. Set the method to GET and the URL to:

   `https://graph.microsoft.com/v1.0/sites/medcurityinc.sharepoint.com:/sites/MedcurityInc`

   Click "Run query". In the response, find the `"id"` field near the
   top. It looks like three values joined by commas. Copy the whole
   thing.

3. Second request. Set the method to POST and the URL to:

   `https://graph.microsoft.com/v1.0/sites/PASTE-THE-ID-HERE/permissions`

   In the "Request body" tab, paste this, with the Client ID from step 1
   filled in:

   ```json
   {
     "roles": ["read"],
     "grantedToIdentities": [
       {
         "application": {
           "id": "PASTE-CLIENT-ID-HERE",
           "displayName": "Pulse Collateral Sync"
         }
       }
     ]
   }
   ```

   Click "Run query". If it complains about permissions, open the
   "Modify permissions" tab, consent to `Sites.FullControl.All`
   (this consent is for YOUR one-time Graph Explorer session, not for
   the app), then run it again. A `201 Created` response means done.

## Step 5: Paste the three values into Supabase

Do staging first, then production after the test below passes.

1. Go to supabase.com/dashboard and open the project:
   - Staging project ref: `baekcgdyjedgxmejbytc`
   - Production project ref: `igmwomnkbbsytihtvhbp`
2. Project Settings (gear icon) > Edge Functions > Secrets.
3. Add three secrets, names exactly as written:
   - `GRAPH_TENANT_ID` = the Tenant ID
   - `GRAPH_CLIENT_ID` = the Client ID
   - `GRAPH_CLIENT_SECRET` = the secret value
4. Save.

## Step 6: The proof test (Jordan)

1. In the SharePoint Sales Collateral library, set ONE file's Status to
   `Current`.
2. In Pulse, open Collateral and click "Sync SharePoint".
3. Exactly that one card should appear, with its column values as chips.
   Nothing else appears, because everything else is still Draft.
4. Optional extra check: rename that file in SharePoint, sync again, and
   confirm a previously copied link still opens it. Links are tied to the
   file's permanent ID, not its name.

## Step 7: Tell Claude

Once the test passes, say so in a Pulse session and the hourly automatic
sync gets turned on. Until then the Sync button is the only trigger,
which is fine.
