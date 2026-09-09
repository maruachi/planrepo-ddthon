# Build Instructions — PlanRepo mockup (U1)

## Prerequisites
- **Build Tool**: None. This is a self-contained static HTML file — there is NO build/compile/bundle step (NFR-SELF-1).
- **Dependencies**: None (zero external runtime deps — no npm/pip/CDN/fonts).
- **Environment Variables**: None.
- **System Requirements**: Any modern evergreen browser (Chrome/Edge/Firefox/Safari). For the optional local server: Python 3 (already present) — no packages needed.

## Build Steps

### 1. Install Dependencies
```bash
# Nothing to install — no dependencies.
```

### 2. Configure Environment
```bash
# Nothing to configure.
```

### 3. "Build" (no-op) / Run
Two equivalent ways to run the single artifact `index.html` (workspace root):

```bash
# Option A — open directly (no server):
#   Double-click index.html, or open it in a browser via file://

# Option B — local static server (clean http origin), from the workspace root:
python3 -m http.server 8080 --bind 127.0.0.1
# then open:  http://127.0.0.1:8080/index.html
```
> Note on "서버까지 띄워줘": §3 places any application backend (server/auth/persistence/real AI/Git) out of scope. The command above is a plain STATIC file server that only serves the HTML — it is not application infrastructure. This satisfies "serve it" without violating scope.

### 4. Verify Build Success
- **Expected Output**: The page renders the PlanRepo shell (sidebar + Board/Inbox/SR-상세). No console errors. No network requests to external hosts (verify in DevTools → Network: only the local document).
- **Build Artifacts**: `index.html` (the entire app).
- **Common Warnings**: None expected.

## Troubleshooting
### Page is blank / JS error
- **Cause**: Editing the inline `<script>` introduced a syntax error.
- **Solution**: Open DevTools → Console; the line is reported. The generated file passed a structural check (balanced braces/backticks, all dispatched actions handled).

### Korean text shows as boxes
- **Cause**: OS lacks a Korean system font.
- **Solution**: The font stack includes `Malgun Gothic`/`Apple SD Gothic Neo`/`Noto Sans KR` fallbacks; install any Korean system font. (No web fonts are fetched by design — NFR-SELF-1.)

### Port 8080 in use
- **Solution**: Use another port, e.g. `python3 -m http.server 8090 --bind 127.0.0.1`.
