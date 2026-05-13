import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

// `pnpm test:e2e` runs `pnpm build` first.
const repoRoot = process.cwd();
const desktop = path.join(repoRoot, 'apps', 'desktop');
const mainEntry = path.join(desktop, 'out', 'main', 'index.js');
const electronDir = path.join(desktop, 'node_modules', 'electron');
const electronExecutable = path.join(
  electronDir,
  'dist',
  readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim(),
);
// The stateful in-memory mock — same script the M2 read spec exercises; it
// seeds from the recorded envelopes so this spec's reads work without a
// separate fixture.
const niagaraMock = path.join(repoRoot, 'tests', 'fixtures', 'niagara-mock', 'server.mjs');

let app: ElectronApplication;
let win: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'mcp-studio-e2e-niagara-write-'));
  app = await electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry],
    env: { ...process.env, MCPSTUDIO_USER_DATA: userDataDir, NODE_ENV: 'production' },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  if (app) await app.close().catch(() => undefined);
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

test('niagaramcp write flow: queue → diff → Apply → reads reflect mutations → audit', async () => {
  // Add an stdio profile pointing at the mock.
  await win.keyboard.press('Control+k');
  const palette = win.getByPlaceholder(/Type a command/i);
  await expect(palette).toBeVisible();
  await palette.fill('Servers');
  await palette.press('Enter');
  await expect(win.getByRole('heading', { name: 'Saved servers' })).toBeVisible();
  await win.getByRole('button', { name: 'Add server', exact: true }).click();
  await win.locator('#wiz-name').fill('e2e-niagara-write');
  await win.getByRole('radio', { name: 'stdio' }).check();
  await win.locator('#wiz-command').fill(process.execPath);
  await win.locator('#wiz-args').fill(niagaraMock);
  await win.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(win.getByText('e2e-niagara-write')).toBeVisible();

  await win.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(win.getByText(/\d+ tools · \d+ resources · \d+ prompts/i)).toBeVisible({ timeout: 20_000 });
  await expect(win.getByText(/Specialized by Niagara station/i)).toBeVisible({ timeout: 10_000 });

  // === 1) Right-click Drivers → New child → queue a CreateComponent ===
  await win.getByRole('button', { name: 'Explorer', exact: true }).click();
  const tree = win.getByRole('tree');
  const driversRow = tree.getByRole('treeitem').filter({ hasText: 'Drivers' }).first();
  await expect(driversRow).toBeVisible({ timeout: 15_000 });
  await driversRow.locator('div').first().click({ button: 'right' });
  await win.getByRole('button', { name: /^New child…$/ }).click();
  const createDialog = win.getByRole('dialog');
  await expect(createDialog.getByText(/New child under Drivers/i)).toBeVisible();
  // Type field defaults to baja:Folder; just fill the name.
  await createDialog.locator('input').nth(1).fill('AuditTestFolder');
  await createDialog.getByRole('button', { name: 'Queue create' }).click();

  // === 2) Navigate to UserService → edit a BSimple integer slot ===
  // Expand Services → click UserService.
  const servicesRow = tree.getByRole('treeitem').filter({ hasText: 'Services' }).first();
  await servicesRow.getByRole('button', { name: /Expand/i }).first().click();
  await expect(tree.getByText('UserService', { exact: true })).toBeVisible({ timeout: 10_000 });
  await tree.getByText('UserService', { exact: true }).first().click();
  await win.getByRole('button', { name: 'Properties', exact: true }).click();
  // The integer slot `maxBadLoginsBeforeLockOut` (BSimple — editable).
  const row = win.locator('tr', { hasText: 'maxBadLoginsBeforeLockOut' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  const slotInput = row.locator('input').first();
  await slotInput.fill('7');
  await slotInput.press('Enter');
  // The cell should now show the pending overlay (an amber "modified" badge).
  await expect(row.getByText('modified')).toBeVisible();

  // === 3) Changes view: see two ops, with reversibility badges ===
  await win.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(win.getByText(/2 pending changes/i)).toBeVisible();
  // Both ops are reversible (CreateComponent + SetSlot per the §D2 table).
  await expect(win.getByText('Reversible')).toHaveCount(2);
  // Apply → confirm → all-reversible path of the dialog.
  await win.getByRole('button', { name: 'Apply all', exact: true }).click();
  const confirm = win.getByRole('dialog');
  await expect(confirm.getByText(/Apply 2 operations\?/i)).toBeVisible();
  await expect(confirm.getByText(/reversible/i)).toBeVisible();
  await confirm.getByRole('button', { name: 'Apply', exact: true }).click();
  // Both rows should now read "done".
  await expect(win.getByText('done')).toHaveCount(2, { timeout: 15_000 });

  // === 4) Reads reflect the mutations ===
  // Back to Explorer → expand Drivers → AuditTestFolder appears.
  await win.getByRole('button', { name: 'Explorer', exact: true }).click();
  await driversRow.getByRole('button', { name: /Expand|Collapse/i }).first().click();
  // The mock's listChildren now includes the new folder; in case the tree was
  // already expanded, collapse + re-expand to force a re-render of children.
  if (!(await tree.getByText('AuditTestFolder', { exact: true }).isVisible())) {
    await driversRow.getByRole('button', { name: /Expand|Collapse/i }).first().click();
    await driversRow.getByRole('button', { name: /Expand|Collapse/i }).first().click();
  }
  await expect(tree.getByText('AuditTestFolder', { exact: true })).toBeVisible({ timeout: 15_000 });
  // Click UserService again → Properties → the slot value reflects the new 7.
  await tree.getByText('UserService', { exact: true }).first().click();
  await win.getByRole('button', { name: 'Properties', exact: true }).click();
  const updatedRow = win.locator('tr', { hasText: 'maxBadLoginsBeforeLockOut' });
  await expect(updatedRow.locator('input').first()).toHaveValue('7', { timeout: 15_000 });

  // === 5) Audit trail: History panel "Writes only" filter ===
  await win.keyboard.press('Control+k');
  await palette.fill('History');
  await palette.press('Enter');
  await expect(win.getByRole('heading', { name: 'Tool-call history' })).toBeVisible();
  await win.getByRole('button', { name: 'Writes only', exact: true }).click();
  // setSlot + createComponent + commitStation — three writes, each flagged
  // with the lowercase "write" badge on the row.
  await expect(win.getByText('write', { exact: true })).toHaveCount(3, { timeout: 10_000 });
  await expect(win.getByText('setSlot', { exact: true })).toBeVisible();
  await expect(win.getByText('createComponent', { exact: true })).toBeVisible();
  await expect(win.getByText('commitStation', { exact: true })).toBeVisible();
});
