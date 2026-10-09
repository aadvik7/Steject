# Publishing STEJECT (for the repo owner)

Follow these steps once. After that, every new version is one click.

## 1. Put the code on GitHub

**Option A: GitHub website (no Git needed)**
1. Go to [github.com/new](https://github.com/new). Name it `steject`, make it **Public**, and leave every "Initialize" box unticked. Click **Create repository**.
2. On the empty repo page, click **uploading an existing file**.
3. Unzip `steject.zip` on your computer, open the `steject` folder, select **everything inside it** (including the `.github` folder and `.gitignore`), and drag it into the browser.
   - Hidden files: on Mac press **Cmd+Shift+.** in Finder. On Windows: File Explorer → View → Show → Hidden items.
   - If the browser skips the `.github` folder, use Option B.
4. Commit message: `STEJECT v1.0.0`. Click **Commit changes**.

**Option B: Git (most reliable)**
```bash
cd steject
git init -b main
git add .
git commit -m "STEJECT v1.0.0"
git remote add origin https://github.com/YOUR-USERNAME/steject.git
git push -u origin main
```

**Option C: use STEJECT itself.** Not yet, because it doesn't support binary files (icons and fonts). Use A or B.

## 2. Fix the two links in package.json

In `package.json`, replace `YOUR-GITHUB-USERNAME` in `homepage` and `repository.url` with your username. You can edit the file on github.com with the pencil icon. The app's update checker gets the repo name automatically, so this is only for the installer's metadata.

## 3. Build the desktop app

1. Open your repo → **Actions** tab. If asked, click **I understand my workflows, go ahead and enable them**.
2. Click **Release desktop app** on the left → **Run workflow** → version `1.0.0` → **Run workflow**.
3. Wait about 10 to 15 minutes. Windows, Mac and Linux build in parallel.
4. Open the **Releases** section on the repo's front page. **STEJECT v1.0.0** is there with all the installers.

Alternative: push a tag (`git tag v1.0.0 && git push origin v1.0.0`) and the same workflow runs automatically.

## 4. Turn on the web version (optional)

Settings → **Pages** → Source: **GitHub Actions**. The next push to `main` publishes the web version at `https://YOUR-USERNAME.github.io/steject/`.

## 5. Release a new version later

1. Make your changes and push them to `main`. The **Tests** workflow checks them.
2. Actions → **Release desktop app** → Run workflow → the new version (like `1.1.0`).
3. Everyone running the desktop app sees an "update available" bar within a few seconds of opening it.

## If a workflow fails

Open the failed run in the Actions tab, click the red step, and copy the error. The most common causes are:
- **Workflows not enabled:** see step 3.1.
- **Release can't be created ("Resource not accessible"):** Settings → Actions → General → Workflow permissions → **Read and write permissions** → Save. Then run it again.
