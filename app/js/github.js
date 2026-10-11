/*
 * STEJECT GitHub client: creates repos and pushes commits through the
 * GitHub REST API (Git Data endpoints). No local Git needed.
 */
(function (root) {
  "use strict";
  const API = "https://api.github.com";

  class GhError extends Error {
    constructor(status, msg) { super(msg); this.status = status; }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const b64 = s => { const bytes = new TextEncoder().encode(s); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };
  const unb64 = s => { const bin = atob(s.replace(/\s/g, "")); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); };
  const fileMode = path => /\.(sh|bash)$/.test(path) || /^bin\//.test(path) ? "100755" : "100644";

  function client(token) {
    async function req(path, { method = "GET", body } = {}) {
      let res;
      try {
        res = await fetch(path.startsWith("http") ? path : API + path, {
          method,
          headers: {
            "Accept": "application/vnd.github+json",
            ...(token ? { "Authorization": "Bearer " + token } : {}),   // public repos can be read without one
            "X-GitHub-Api-Version": "2022-11-28",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          cache: "no-store",
        });
      } catch (e) {
        throw new GhError(0, "Can't reach GitHub. Check your internet connection.");
      }
      if (res.status === 204) return null;
      let data = null;
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        const msg = (data && data.message) || res.statusText || "Request failed";
        if (res.status === 401) throw new GhError(401, "GitHub rejected the token. It may be wrong, expired or revoked.");
        if (/workflow/i.test(msg) && /scope|permission|refusing|allow/i.test(msg)) throw new GhError(res.status, "Your token can't add or change GitHub Actions files (.github/workflows). Create a token with the repo and workflow scopes, or leave out the CI file.");
        if ((res.status === 403 || res.status === 429) && /rate limit/i.test(msg)) throw new GhError(429, "GitHub rate limit reached. Wait a few minutes and try again.");
        if (res.status === 403) throw new GhError(403, "Your token doesn't have permission for this. Use a classic token with the repo scope.");
        throw new GhError(res.status, msg);
      }
      return data;
    }
    // fresh repos can answer 404/409 for a few seconds
    async function retry(fn, tries = 6) {
      for (let i = 0; ; i++) {
        try { return await fn(); }
        catch (e) {
          if (i < tries - 1 && (e.status === 404 || e.status === 409 || e.status >= 500)) { await sleep(700 * (i + 1)); continue; }
          throw e;
        }
      }
    }
    return { req, retry };
  }

  async function me(token) { return client(token).req("/user"); }

  async function listRepos(token) {
    const { req } = client(token);
    const out = [];
    for (let page = 1; page <= 3; page++) {
      const batch = await req(`/user/repos?per_page=100&sort=pushed&affiliation=owner&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out.map(r => ({ name: r.name, full: r.full_name, private: r.private, branch: r.default_branch, pushed: r.pushed_at, url: r.html_url }));
  }

  /** Current state of a repo: head sha, tree sha, set of paths. null if missing; head null if empty. */
  async function repoState(token, full) {
    const { req } = client(token);
    let repo;
    try { repo = await req(`/repos/${full}`); }
    catch (e) { if (e.status === 404) return null; throw e; }
    const branch = repo.default_branch || "main";
    let head = null, tree = null, paths = new Set(), count = 0, firstMessage = null;
    try {
      const ref = await req(`/repos/${full}/git/ref/heads/${encodeURIComponent(branch)}`);
      head = ref.object.sha;
      const commit = await req(`/repos/${full}/git/commits/${head}`);
      tree = commit.tree.sha;
      firstMessage = commit.message.split("\n")[0];
      const t = await req(`/repos/${full}/git/trees/${tree}?recursive=1`);
      t.tree.forEach(e => { if (e.type === "blob") paths.add(e.path); });
      const commits = await req(`/repos/${full}/commits?per_page=2&sha=${head}`);
      count = commits.length;
    } catch (e) {
      if (e.status !== 409 && e.status !== 404) throw e; // 409 = empty repository
    }
    return { repo, full: repo.full_name, owner: repo.owner.login, name: repo.name, branch, head, tree, paths, count, firstMessage, url: repo.html_url };
  }

  /** Read one file's text from a repo; null if it doesn't exist or isn't text. */
  async function readFile(token, full, path, ref) {
    const { req } = client(token);
    try {
      const enc = path.split("/").map(encodeURIComponent).join("/");
      const r = await req(`/repos/${full}/contents/${enc}${ref ? "?ref=" + encodeURIComponent(ref) : ""}`);
      if (Array.isArray(r) || r.type !== "file") return null;
      if (r.encoding === "base64" && r.content) return unb64(r.content);
      if (r.download_url) { const res = await fetch(r.download_url); return await res.text(); }
      return "";
    } catch (e) { if (e.status === 404) return null; throw e; }
  }

  /**
   * Ship a manifest.
   * job = {token, login, mode: "new"|"update", name, full?, description, isPrivate, manifest, allowReplace, log, ctx?}
   * ctx carries progress so a failed push can resume where it stopped.
   * Returns {status: "done", url, full, commits, skipped} or {status: "confirm", ...}.
   */
  async function ship(job) {
    const { token, manifest, log } = job;
    const { req, retry } = client(token);
    let ctx = job.ctx;

    if (!ctx) {
      ctx = { next: 0, parent: null, prevTree: null, paths: new Set(), made: [] };
      if (job.mode === "update") {
        log.run("check", `Reading ${job.full}`);
        const st = await repoState(token, job.full);
        if (!st) throw new GhError(404, `${job.full} doesn't exist, or your token can't see it.`);
        Object.assign(ctx, { full: st.full, branch: st.branch, url: st.url, paths: st.paths });
        if (st.head) { ctx.parent = st.head; ctx.prevTree = st.tree; ctx.fastForward = true; }
        else { await initEmpty(req, st.full); ctx.fastForward = false; }
        log.update("check", "ok", st.head ? `${st.full} on ${st.branch} (${st.paths.size} files)` : `${st.full} is empty`);
      } else {
        const full = `${job.login}/${job.name}`;
        log.run("check", `Looking for ${full}`);
        let st = await repoState(token, full);
        let created = false;
        if (!st) {
          log.update("check", "ok", `${full} doesn't exist yet`);
          log.run("create", `Creating ${job.isPrivate ? "private" : "public"} repo ${full}`);
          await req("/user/repos", { method: "POST", body: { name: job.name, description: job.description || undefined, private: !!job.isPrivate, auto_init: true } });
          created = true;
          st = await retry(async () => { const s = await repoState(token, full); if (!s || !s.head) throw new GhError(409, "not ready"); return s; });
          log.update("create", "ok", `Created ${st.full}`);
        } else {
          if (st.count > 1) throw new GhError(409, `${st.full} already has history. Switch to "Update existing repo" to add commits on top, or pick a new name.`);
          if (st.count === 1 && !job.allowReplace) {
            log.update("check", "skip", `${st.full} has 1 commit: "${st.firstMessage}"`);
            return { status: "confirm", full: st.full, existing: st.firstMessage };
          }
          log.update("check", "ok", `Using ${st.full}`);
          if (!st.head) await initEmpty(req, st.full);
        }
        // fresh history: the first commit has no parent
        Object.assign(ctx, { full: st.full, branch: st.branch, url: st.url, fastForward: false, created });
      }
    } else {
      log.run("resume", `Resuming ${ctx.full} at commit ${ctx.next + 1}`);
      log.update("resume", "ok", `Resuming ${ctx.full} at commit ${ctx.next + 1}`);
    }
    job.onCtx && job.onCtx(ctx);

    const base = `/repos/${ctx.full}`;
    const total = manifest.commits.length;
    for (let i = ctx.next; i < total; i++) {
      const c = manifest.commits[i];
      const id = "c" + i;
      log.run(id, `Commit ${i + 1}/${total}: ${c.message}`);
      const entries = [];
      for (const [path, content] of c.files) {
        if (content === null) {
          if (ctx.paths.has(path)) entries.push({ path, mode: "100644", type: "blob", sha: null });
        } else if (content === "") {
          const blob = await retry(() => req(`${base}/git/blobs`, { method: "POST", body: { content: "", encoding: "utf-8" } }));
          entries.push({ path, mode: fileMode(path), type: "blob", sha: blob.sha });
        } else {
          entries.push({ path, mode: fileMode(path), type: "blob", content });
        }
      }
      if (!entries.length) { log.update(id, "skip", `Commit ${i + 1}/${total}: ${c.message} (nothing to change, skipped)`); ctx.next = i + 1; continue; }
      const tree = await retry(() => req(`${base}/git/trees`, { method: "POST", body: ctx.prevTree ? { base_tree: ctx.prevTree, tree: entries } : { tree: entries } }));
      if (tree.sha === ctx.prevTree) { log.update(id, "skip", `Commit ${i + 1}/${total}: ${c.message} (files already match, skipped)`); ctx.next = i + 1; continue; }
      const commit = await retry(() => req(`${base}/git/commits`, { method: "POST", body: { message: c.message, tree: tree.sha, parents: ctx.parent ? [ctx.parent] : [] } }));
      ctx.parent = commit.sha; ctx.prevTree = tree.sha; ctx.next = i + 1; ctx.made.push(commit.sha);
      c.files.forEach((v, p) => { if (v === null) ctx.paths.delete(p); else ctx.paths.add(p); });
      log.update(id, "ok", `Commit ${i + 1}/${total}: ${c.message}  ${commit.sha.slice(0, 7)}`);
    }

    if (!ctx.made.length) {
      return { status: "done", url: ctx.url, full: ctx.full, commits: 0, nothing: true };
    }
    // pull request mode: the commits go to a new branch, and main is left alone
    if (job.pr && job.mode === "update") {
      const head = job.pr.branch;
      log.run("ref", `Creating branch ${head}`);
      try {
        await req(`${base}/git/refs`, { method: "POST", body: { ref: "refs/heads/" + head, sha: ctx.parent } });
      } catch (e) {
        if (e.status === 422) throw new GhError(422, `A branch called ${head} already exists on ${ctx.full}. Pick another branch name.`);
        throw e;
      }
      log.update("ref", "ok", `${head} → ${ctx.parent.slice(0, 7)}`);
      log.run("pr", `Opening a pull request into ${ctx.branch}`);
      const pr = await req(`${base}/pulls`, { method: "POST", body: { title: job.pr.title || manifest.commits[manifest.commits.length - 1].message, head, base: ctx.branch, body: job.pr.body || "", maintainer_can_modify: true } });
      log.update("pr", "ok", `Pull request #${pr.number} opened`);
      return { status: "done", url: pr.html_url, full: ctx.full, commits: ctx.made.length, pr: { number: pr.number, url: pr.html_url, branch: head } };
    }
    log.run("ref", `Updating ${ctx.branch}`);
    try {
      await req(`${base}/git/refs/heads/${encodeURIComponent(ctx.branch)}`, { method: "PATCH", body: { sha: ctx.parent, force: !ctx.fastForward } });
    } catch (e) {
      if (e.status === 422 && ctx.fastForward) throw new GhError(422, `${ctx.full} changed on GitHub while STEJECT was pushing. Nothing was overwritten. Try the update again.`);
      throw e;
    }
    log.update("ref", "ok", `${ctx.branch} → ${ctx.parent.slice(0, 7)}`);
    return { status: "done", url: ctx.url, full: ctx.full, commits: ctx.made.length };
  }

  // An empty repo has no branch, and Git Data endpoints refuse to work on it. Add one tiny commit to initialize.
  async function initEmpty(req, full) {
    await req(`/repos/${full}/contents/.steject`, { method: "PUT", body: { message: "Initialize", content: b64("") } });
  }

  /**
   * Read a repo's text files (to explain, improve or extend it).
   * Returns {files: Map(path -> text), skipped: {folder, binary, large, limit}, branch, head}.
   */
  async function importRepo(token, full, opts) {
    opts = opts || {};
    const C = root.SteCore, L = C.IMPORT_LIMITS;
    const { req, retry } = client(token);
    const repo = await req(`/repos/${full}`);
    const branch = repo.default_branch || "main";
    let ref;
    try { ref = await req(`/repos/${full}/git/ref/heads/${encodeURIComponent(branch)}`); }
    catch (e) { if (e.status === 409 || e.status === 404) return { files: new Map(), skipped: {}, branch, head: null, full: repo.full_name }; throw e; }
    const commit = await req(`/repos/${full}/git/commits/${ref.object.sha}`);
    const tree = await req(`/repos/${full}/git/trees/${commit.tree.sha}?recursive=1`);
    const skipped = { folder: 0, binary: 0, large: 0, path: 0, limit: 0 };
    const want = [];
    let bytes = 0;
    for (const e of tree.tree) {
      if (e.type !== "blob") continue;
      const why = C.skipReason(e.path, e.size || 0);
      if (why) { skipped[why]++; continue; }
      if (want.length >= L.files || bytes + (e.size || 0) > L.totalBytes) { skipped.limit++; continue; }
      want.push(e); bytes += e.size || 0;
    }
    const files = new Map(), queue = want.slice();
    let done = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const e = queue.shift();
        const b = await retry(() => req(`/repos/${full}/git/blobs/${e.sha}`));
        let text;
        try { text = unb64(b.content || ""); } catch { text = null; }
        if (text == null || text.includes("\u0000")) skipped.binary++;
        else files.set(e.path, text);
        opts.onProgress && opts.onProgress(++done, want.length);
      }
    }));
    const sorted = new Map([...files].sort((a, b) => a[0] < b[0] ? -1 : 1));
    return { files: sorted, skipped, branch, head: ref.object.sha, full: repo.full_name };
  }

  const api = { GhError, me, listRepos, repoState, readFile, ship, importRepo, b64, unb64 };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SteGitHub = api;
})(typeof self !== "undefined" ? self : this);
