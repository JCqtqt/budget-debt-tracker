# Budget & Debt Tracker

A personal budget, accounts and debt (utang) tracker that runs in your browser.
It's the website version of `Budget_Debt_Tracker.xlsx`.

**Your data never goes into this repo.** Everything you enter is saved only in the
browser you use (localStorage). The files here are just the app.

## Tabs

| Tab | What it does |
|---|---|
| **Summary** | Total money, what you owe, what others owe you, net worth, this month at a glance, overdue alerts |
| **Budget** | Monthly budget per category vs. actual, plus your income/expense log for the month |
| **Accounts** | Banks, e-wallets and cash, with balances that update on their own. Transfers between accounts |
| **Debts** | Each utang ("I owe") or pautang ("Owed to me"), with paid, balance and status |
| **Payments** | One entry per debt payment. It lowers the debt, counts as *Debt Payments* in the budget and updates the account |
| **Settings** | Import Excel, backup/restore, CSV export, budget categories, light/dark mode |

## Put it on GitHub Pages

1. Upload these files to your repo, keeping the `vendor` folder:
   ```
   index.html
   app.js
   styles.css
   vendor/jszip.min.js
   README.md
   .gitignore
   ```
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute your site is live at `https://<your-username>.github.io/<repo-name>/`.

If the repo is for other things too, put the files in a `docs/` folder and choose **/docs** in step 3.

## First time you open it

1. Click **Import Excel file** and pick `Budget_Debt_Tracker.xlsx`.
   It copies your accounts, debts, payments, budget categories and transactions.
2. From then on, add things on the website.

## Using it on your phone and computer

Each browser keeps its own copy. To move your data:

1. On the device with your latest data: **Settings → Download backup**.
2. On the other device: **Settings → Restore backup** and pick that file.

Download a backup now and then anyway. Clearing your browser data erases what's saved.

> ⚠️ Don't upload your `.xlsx` file or backup `.json` files to a public repo.
> The included `.gitignore` blocks them if you use git from your computer.

## Cloud sync (optional)

With cloud sync on, you sign in with Google and your data is saved in Firebase,
so your phone and computer show the same numbers.

1. Put your web app settings in `firebase-config.js`.
2. In Firebase → **Authentication → Settings → Authorized domains**, add `<your-username>.github.io`.
3. In Firebase → **Firestore Database → Rules**, paste this and **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /trackers/{userId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

Each person's data is one private document that only their own Google login can read or write.
Leave `apiKey` empty in `firebase-config.js` to run without cloud sync.

## Credits

`vendor/jszip.min.js` is [JSZip](https://stuk.github.io/jszip/) 3.10.1 (MIT license), used to read the Excel file.
