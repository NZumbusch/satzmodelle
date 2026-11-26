// Layout check: screenshots of every screen at several tablet sizes, using the SYNTHETIC demo library.
// Usage: (cd app && npx vite build && npx vite preview --port 4173 &)
//        python3 -I tools/make_demo_library.py /tmp/demo --zip /tmp/demo.zip
//        node tools/layout_screenshots.cjs /tmp /tmp/shots   (expects /tmp/demo.zip and /tmp/demo/...; needs Playwright)
// Never run this against a real library: screenshots must contain synthetic demo data only.
const { chromium } = require('playwright');
const S = process.argv[2], OUT = process.argv[3];
const sizes = (process.argv[4] || '1280x800,800x1280,962x601,601x962,1180x820,820x1180,1366x1024,1024x1366').split(',');
(async () => {
  const b = await chromium.launch();
  for (const sz of sizes) {
    const [w, h] = sz.split('x').map(Number);
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    p.on('dialog', d => d.accept());
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:4173/');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: 'Bibliothek importieren' }).click()]);
    await fc.setFiles(S + '/demo.zip');
    await p.getByRole('button', { name: 'OK' }).click();
    const shot = (n) => p.screenshot({ path: `${OUT}/${n}-${sz}.png`, fullPage: true });
    await shot('1start');
    // practice: model with everything, all hints revealed, one marker
    await p.getByRole('button', { name: 'Bibliothek' }).first().click();
    await p.getByRole('button', { name: 'Trotzdem anzeigen' }).click();
    await shot('3library');
    await p.getByText('Kleine Kadenz').click();
    await p.waitForTimeout(800);
    await shot('4detail');
    await p.getByRole('button', { name: 'Dieses Modell üben' }).click();
    await p.locator('.task .icon.big:not([disabled])').waitFor();
    await p.locator('.task').getByRole('button', { name: /Marker setzen/ }).click();
    const box = await p.locator('.task canvas').boundingBox();
    await p.mouse.click(box.x + box.width * 0.4, box.y + 30);
    await p.mouse.click(box.x + box.width * 0.7, box.y + 30);
    await p.locator('.task').getByRole('button', { name: /Marker setzen/ }).click();
    await shot('2practice-top');
    for (let i = 0; i < 8; i++) {
      const hint = p.locator('.btn.hint'); if (!(await hint.count())) break;
      await hint.click(); const yes = p.getByRole('button', { name: 'Ja' }); if (await yes.count()) await yes.click();
      await p.waitForTimeout(200);
    }
    await p.waitForTimeout(800);
    await shot('2practice-all');
    await p.getByRole('button', { name: 'Bibliothek' }).first().click();
    await p.getByRole('button', { name: 'Eigene Übung erstellen' }).click();
    await shot('5editor');
    await p.getByRole('button', { name: 'Einstellungen' }).click();
    await shot('6settings');
    if (errs.length) console.log(sz, errs);
    await ctx.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
