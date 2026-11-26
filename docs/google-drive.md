# Google Drive sync and backups

Everything goes into the **hidden app folder** (`appDataFolder`) of your own Google Drive. The scope
`drive.appdata` lets the app see nothing else in your Drive, and the files do not show up in the Drive UI
(Drive → Settings → Manage apps lists the app, with "Delete hidden app data"). Nothing is shared.

| what | when | file(s) |
|---|---|---|
| progress (ratings, history, piece id/title/composer/category) | always, once connected | `progress.json` |
| library packs, own exercises, edits | only with **Alles synchronisieren** | `unit-pack:<id>.zip`, `unit-own:<id>.zip`, `unit-ovr:<id>.zip` |
| recordings | only with **Aufnahmen mitsynchronisieren** | `unit-rec:<id>.zip` |
| backups | when you press **Sicherung in Google Drive** (last 3 kept) | `backup-<date>.zip` |

Full sync works per unit: only changed units are transferred, deletions on one device are passed on as
tombstones (an empty file marked deleted), a replaced library arrives before the old one is removed, and a
change beats a deletion. "Grosse Übertragungen nur im WLAN" (default on) skips unit transfers on mobile data.
Library packs are stored as ordinary library zips. Uses Drive storage: about the size of the library.

**Backup files** ("Sicherung als Datei speichern") contain everything: library, own exercises, edits,
recordings, progress and settings. Restore with "Aus Datei wiederherstellen" (or just pick the file under
"Bibliothek importieren"): *zusammenführen* keeps what is on the device, *alles ersetzen* wipes it first.
A backup contains the library. If the material belongs to someone else, keep the backup to yourself.

## One-time setup

Google only hands out a token to an app it knows. You create that once (free, about 10 minutes):

1. Open <https://console.cloud.google.com/>, create a project, e.g. "Satzmodelle".
2. *APIs & Services → Library*: enable **Google Drive API**.
3. *Google Auth Platform* (OAuth consent screen): choose **External**, app name "Satzmodelle", your e-mail as
   support and developer contact. Under *Data access* add the scope
   `https://www.googleapis.com/auth/drive.appdata` (it is a non-sensitive scope).
   Under *Audience* either add yourself as **test user**, or press **Publish app**: with only non-sensitive
   scopes no Google review is needed. (In "Testing" mode Google may ask for consent again every 7 days.)
4. *Clients → Create client → Android*:
   * package name `ch.zumbusch.satzmodelle`
   * SHA-1 of the signing key: `keytool -list -v -keystore <file.jks>`, copy the SHA1 line. The app also
     shows package name and SHA-1 in the settings when Google rejects the sign-in.
5. Done. No client ID has to be put into the app: Google matches package name + signature.
   In the app: *Einstellungen → Google Drive → Mit Google verbinden*.

Sync runs when the app starts or comes back to the foreground, a few seconds after each rating, and with
*Jetzt synchronisieren*. Merging is conflict-free (attempts are united), so two devices can be used.
"Fortschritt zurücksetzen" also clears the synced copy (attempts before the reset are dropped everywhere).
