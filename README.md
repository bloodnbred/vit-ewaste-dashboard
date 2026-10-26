# E-Waste Management — Live Student Dashboards

A single-page showcase of deployed e-waste dashboards built by TE Semester V Computer Engineering students at **Vidyalankar Institute of Technology, Mumbai** (Academic Year 2026–27, subject faculty **Dr. Aniket Kundu**).

Plain **HTML + CSS + vanilla JavaScript**. No framework, package install, or build step is required.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and content |
| `style.css` | Light/dark responsive theme |
| `script.js` | Tabs, search, quick jump, viewer, hash routing |
| `students.js` | Generated student data + editable `DIVISIONS` map |
| `scripts/generate-students.mjs` | One-time CSV → `students.js` generator |
| `ewaste_students_all.csv` | Source sheet (roll number, name, division, link) |

Marks are not present in `ewaste_students_all.csv` or `students.js`, and the site never reads or displays marks.

## Run locally

Because the site loads local JS files directly, serve the folder instead of double-clicking `index.html`:

```bash
npx serve .
```

Or use Python:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## 1. Update student links

There are two ways to do it.

**Edit the generated file (quickest for one or two links):**

- Open `students.js`.
- Find the student by roll number in `STUDENTS`.
- Change the `link` value to a full `https://…` URL, or use `""` for a student who has not uploaded a dashboard.
- Blank links show **“Link not uploaded”** on the card and inside the viewer.

**Update the CSV and regenerate (best for several changes):**

```bash
node scripts/generate-students.mjs
```

The source CSV must keep this header:

```csv
Roll No,Name,Div,Link
```

`Div` must be `A`, `B`, or `C`. Links are kept exactly as submitted; duplicate links are allowed. The generator never reads or writes marks.

## 2. Add divisions B and C (or more sheets)

The current sheet already contains all three divisions. For future sheets:

1. Save each CSV in the project root with the same header: `Roll No,Name,Div,Link`.
2. Add the filename(s) to the `SOURCES` array at the top of `scripts/generate-students.mjs`.
3. Run:

   ```bash
   node scripts/generate-students.mjs
   ```

The generator merges the files in source order. It will stop with a clear error on a duplicate roll number or invalid division/link.

### Division mapping

`students.js` starts with a generated `DIVISIONS` map:

```js
const DIVISIONS = {
  "24102A0006": "B",
  "24102A0013": "A",
  // …
};
```

`script.js` reads this map at runtime, so changing a student’s `A` / `B` / `C` value immediately moves them to that tab on reload. Rerunning the generator rebuilds the map from the `Div` column.

### Source corrections applied

- `24102C052` was one digit short; it is normalised to `24102C0052`.
- The joined names `Adityavibhute` and `Omshelke` are shown as `Aditya Vibhute` and `Om Shelke`.
- All other values come directly from the CSV (trimmed and name-cased).
- All submitted links are kept as-is, even when a host blocks embedding or requires a login:
  - `http://project.seucra.tech/` uses Cloudflare Access and refuses framing.
  - Some `app.thebricks.com` links are assignment-platform links and may require a session.

If a dashboard cannot load in the iframe, the viewer still shows its full link and an **Open in new tab** button. The preview falls back after about 8 seconds.

## 3. Deploy to Vercel

### Option A — import the GitHub repository

1. Push this project to GitHub (the repository used for this build is `bloodnbred/vit-ewaste-dashboard`).
2. In Vercel, choose **Add New → Project** and import the repository.
3. Use these settings:
   - **Framework preset:** Other
   - **Build command:** leave empty
   - **Output directory:** leave the default (the project root)
   - **Root directory:** project root
4. Click **Deploy**. No environment variables or serverless functions are needed.

### Option B — deploy from the CLI

```bash
npx vercel login
npx vercel --prod
```

`vercel --prod` will ask to link a project the first time; accept the defaults for a static site. Future deployments can use the same command.

The included `.vercelignore` keeps the source CSV, prompt, generator script and README out of the public deployment. Hash deep links such as `#cmpn-a/24102A0014` work automatically on Vercel.

### Netlify alternative

The site is also Netlify-ready: drag the project folder into Netlify Drop, or connect the repository and leave the build command empty with the publish directory set to `.`.

## Repository and hosting

- GitHub: <https://github.com/bloodnbred/vit-ewaste-dashboard>
- Vercel production URL: added after the first deployment.


## Deep links

Each selected student is written to the URL, for example:

```text
#cmpn-b/24102A0006
#cmpn-c/24102C0052
```

Opening that URL loads the right division, selects the student, and opens the viewer. A division-only hash such as `#cmpn-b` opens the division tab directly.
