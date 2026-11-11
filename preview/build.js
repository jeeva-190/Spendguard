const esbuild = require('/tmp/shot/node_modules/esbuild');
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const shim = (n) => path.join(__dirname, 'shims', n);
(async () => {
  const r = await esbuild.build({
    entryPoints: [path.join(__dirname, 'browser-api.js')], bundle: true, write: false, platform: 'browser', format: 'iife', minify: true, target: 'es2020',
    define: { 'process.env': '{}', __dirname: '"/"' },
    plugins: [{ name: 'shims', setup(b) {
      b.onResolve({ filter: /^(fs|path|crypto|async_hooks|@anthropic-ai\/sdk)$/ }, (a) => ({ path: shim({ fs: 'fs.js', path: 'path.js', crypto: 'crypto.js', async_hooks: 'async_hooks.js' }[a.path] || 'empty.js') }));
    } }],
  });
  const api = r.outputFiles[0].text;
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const esc = (js) => js.replace(/<\/script/gi, '<\\/script');
  let html = read('public/index.html');
  const icon = 'data:image/svg+xml;base64,' + Buffer.from(read('public/icon.svg')).toString('base64');
  html = html
    .replace('<link rel="manifest" href="/manifest.webmanifest" />\n', '')
    .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${icon}" />`)
    .replace(/src="\/icon.svg"/g, `src="${icon}"`)
    .replace('<link rel="stylesheet" href="/vendor/ag-grid/styles/ag-grid.css" />', () => `<style>${read('node_modules/ag-grid-community/styles/ag-grid.css')}</style>`)
    .replace('<link rel="stylesheet" href="/vendor/ag-grid/styles/ag-theme-quartz.css" />', () => `<style>${read('node_modules/ag-grid-community/styles/ag-theme-quartz.css')}</style>`)
    .replace('<link rel="stylesheet" href="/styles.css" />', () => `<style>${read('public/styles.css')}</style>`)
    .replace('<script src="/vendor/chart.js/chart.umd.min.js"></script>', () => `<script>${esc(read('node_modules/chart.js/dist/chart.umd.min.js'))}</script>`)
    .replace('<script src="/vendor/ag-grid/dist/ag-grid-community.min.noStyle.js"></script>', () => `<script>${esc(read('node_modules/ag-grid-community/dist/ag-grid-community.min.noStyle.js'))}</script>`)
    .replace('<script src="/app.js"></script>', () => `<script>${esc(api)}</script>\n<script>${esc(read('public/app.js').replace("if (!confirm('Reset sample data and budgets?')) return;", ''))}</script>`);
  html = html.replace(/(  <link rel="stylesheet" href="\/vendor\/fontsource\/[^"]+" \/>\n)+/, '  <link rel="preconnect" href="https://fonts.googleapis.com" />\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Stencil+Display:wght@800&family=Schibsted+Grotesk:wght@400;500;600;700;800&display=swap" />\n');
  html = html.replace('<title>SpendGuard — Ask your PayPal</title>', '<title>SpendGuard — Ask your PayPal (preview)</title>');
  fs.writeFileSync(path.join(__dirname, 'spendguard-preview.html'), html);
  console.log('built', (html.length / 1024).toFixed(0), 'KB');
})();
