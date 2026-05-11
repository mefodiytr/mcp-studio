#!/usr/bin/env python3
"""
niagaramcp web explorer — interactive remote browser for the station.

Single-file Flask app. Run, browser opens. UI is a "remote file explorer"
of the station's slot tree: breadcrumb path, table of children of cwd,
per-row Inspect/Read/Write/+Ext/Delete buttons, inline forms for create.

Install:
    py -m pip install flask

Run:
    py mcp_app.py --host=localhost --port=86 --scheme=http ^
                  --token=YOUR_API_TOKEN

Pre-flight (one-time, in Workbench):
  1. BMcpPlatformService.enableTestSetup = true, save, restart service.
  2. BUser <smoke-user> exists in UserService with a write-permission role.
  3. Click "Bootstrap user-Bearer" once per session — identity switches
     from apiToken (read-only) to user-Bearer (full writes).
"""
import argparse
import json
import secrets
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser

from flask import Flask, jsonify, render_template_string, request


# ─── HTTP ─────────────────────────────────────────────────────────────────────
def http_request(url, method="GET", headers=None, body=None, timeout=30, insecure=False):
    req = urllib.request.Request(url, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        if "Content-Type" not in (headers or {}):
            req.add_header("Content-Type", "application/json")
    ctx = ssl._create_unverified_context() if insecure else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout, context=ctx) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def parse_json(raw):
    try:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        return json.loads(raw or "{}")
    except Exception:
        return None


# ─── MCP client ───────────────────────────────────────────────────────────────
class McpClient:
    def __init__(self, base, token, insecure=False):
        self.base = base.rstrip("/")
        self.token = token
        self.insecure = insecure
        self.session_id = None
        self._id = 0
        self.lock = threading.Lock()

    def _hdrs(self):
        h = {"Authorization": f"Bearer {self.token}",
             "Accept": "application/json, text/event-stream"}
        if self.session_id:
            h["Mcp-Session-Id"] = self.session_id
        return h

    def _rpc(self, method, params=None):
        with self.lock:
            self._id += 1
            req_id = self._id
        body = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            body["params"] = params
        status, hdrs, raw = http_request(f"{self.base}/mcp", "POST",
                                         self._hdrs(), body, insecure=self.insecure)
        if not self.session_id:
            self.session_id = hdrs.get("Mcp-Session-Id") or hdrs.get("mcp-session-id")
        if status != 200:
            return {"_http_status": status,
                    "_raw": raw[:2000].decode("utf-8", errors="replace")}
        return parse_json(raw) or {"_parse_error": True}

    def initialize(self):
        return self._rpc("initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "mcp-web-explorer", "version": "0.2"},
        })

    def tools_call(self, name, args):
        return self._rpc("tools/call", {"name": name, "arguments": args})


# ─── State ────────────────────────────────────────────────────────────────────
class State:
    def __init__(self, base, api_token, insecure, smoke_user, smoke_parent):
        self.base = base
        self.api_token = api_token
        self.insecure = insecure
        self.smoke_user = smoke_user
        self.home_cwd = smoke_parent
        self.cwd = smoke_parent
        self.user_token = None
        self.using_user_bearer = False
        self.client = McpClient(base, api_token, insecure=insecure)
        self.last_response = None
        self.server_info = {}

    def initialize(self):
        r = self.client.initialize()
        self.last_response = r
        si = (r or {}).get("result", {}).get("serverInfo", {})
        self.server_info = si
        return r

    def switch_to_user(self, token):
        self.user_token = token
        self.client = McpClient(self.base, token, insecure=self.insecure)
        self.using_user_bearer = True
        return self.initialize()

    def switch_to_api(self):
        self.client = McpClient(self.base, self.api_token, insecure=self.insecure)
        self.using_user_bearer = False
        return self.initialize()

    def call(self, name, args):
        r = self.client.tools_call(name, args)
        self.last_response = r
        return r


STATE: State = None


# ─── Ord helpers ──────────────────────────────────────────────────────────────
def looks_like_ord(s):
    if not s or not isinstance(s, str):
        return False
    s = s.strip()
    if "|" in s and ":" in s:
        return True
    if s.startswith(("slot:", "station:", "local:")):
        return True
    return False


def parent_ord(ord_str):
    if not ord_str or not looks_like_ord(ord_str):
        return None
    if "slot:" not in ord_str:
        return None
    idx = ord_str.index("slot:")
    head = ord_str[:idx + len("slot:")]
    tail = ord_str[idx + len("slot:"):]
    tail = tail.rstrip("/")
    if not tail:
        return None
    last = tail.rfind("/")
    if last <= 0:
        return head + "/"
    return head + tail[:last]


def split_breadcrumb(ord_str):
    if not ord_str or "slot:" not in ord_str:
        return [(ord_str or '?', ord_str or '')]
    idx = ord_str.index("slot:")
    head = ord_str[:idx + len("slot:")]
    tail = ord_str[idx + len("slot:"):].strip("/")
    crumbs = [("/", head + "/")]
    if tail:
        parts = tail.split("/")
        acc = head + "/"
        for p in parts:
            acc = acc.rstrip("/") + "/" + p
            crumbs.append((p, acc))
    return crumbs


# ─── Result extraction ────────────────────────────────────────────────────────
def extract(resp):
    if not isinstance(resp, dict):
        return {"ok": False, "error": {"code": -1, "message": "no response"}}
    if "_http_status" in resp:
        return {"ok": False, "error": {
            "code": resp["_http_status"],
            "message": f"HTTP {resp['_http_status']}",
            "data": {"body": resp.get("_raw", "")}
        }}
    if "error" in resp:
        return {"ok": False, "error": resp["error"]}
    result = resp.get("result", {})
    if result.get("isError"):
        content = result.get("content", [])
        text = content[0].get("text") if content else None
        return {"ok": False, "error": {
            "code": -1,
            "message": text or "tool reported isError=true",
            "data": result.get("structuredContent") or {}
        }}
    if "structuredContent" in result:
        return {"ok": True, "payload": result["structuredContent"]}
    content = result.get("content", [])
    if content and content[0].get("type") == "text":
        text = content[0]["text"]
        try:
            return {"ok": True, "payload": json.loads(text)}
        except Exception:
            return {"ok": True, "payload": text}
    return {"ok": True, "payload": result}


def coerce_value(raw):
    if isinstance(raw, (int, float, bool)) or raw is None:
        return raw
    s = str(raw).strip()
    if s.lower() == "true":  return True
    if s.lower() == "false": return False
    try:
        return float(s) if "." in s else int(s)
    except ValueError:
        return s


def require_user_bearer():
    if STATE.using_user_bearer:
        return None
    return jsonify({"ok": False, "error": {"code": -32010,
        "message": "write tool requires user-Bearer — click Bootstrap user-Bearer first"}})


# ─── Flask app ────────────────────────────────────────────────────────────────
app = Flask(__name__)


INDEX_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Niagara MCP Explorer</title>
<style>
  :root {
    --bg: #0f1115; --bg-elev: #1a1e26; --bg-input: #232831; --bg-hover: #2a313c;
    --fg: #e6e9ef; --fg-dim: #888d97;
    --accent: #5ec3ff; --accent-warn: #ffba5e;
    --accent-error: #ff7070; --accent-ok: #7ed68f;
    --border: #2a313c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 14px/1.45 'Inter','Segoe UI',system-ui,sans-serif;
    height: 100vh; display: flex; flex-direction: column; overflow: hidden;
  }
  .mono { font-family: 'JetBrains Mono',Consolas,monospace; font-size: 12px; }

  header {
    padding: 10px 16px; background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  }
  .title { font-weight: 600; font-size: 15px; }
  .pill {
    padding: 3px 10px; border-radius: 12px;
    background: var(--bg-input); font-size: 12px;
    font-family: 'JetBrains Mono',Consolas,monospace;
  }
  .pill.ok { color: var(--accent-ok); }
  .pill.warn { color: var(--accent-warn); }
  .pill.err { color: var(--accent-error); }
  .spacer { margin-left: auto; }

  button {
    background: var(--accent); color: #0a0d12; border: none; border-radius: 4px;
    padding: 6px 12px; cursor: pointer; font: inherit; font-weight: 600;
    font-size: 13px;
  }
  button:hover { filter: brightness(1.1); }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  button.ghost { background: transparent; color: var(--fg); border: 1px solid var(--border); font-weight: normal; }
  button.danger { background: var(--accent-error); color: #0a0d12; }
  button.icon {
    background: transparent; color: var(--fg-dim); border: none;
    padding: 4px 6px; font-size: 14px; font-weight: normal;
  }
  button.icon:hover { color: var(--fg); background: var(--bg-hover); border-radius: 3px; }
  button.icon.danger:hover { background: var(--accent-error); color: #0a0d12; }

  nav.pathbar {
    padding: 8px 16px; background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  }
  .crumb {
    background: var(--bg-input); padding: 4px 10px; border-radius: 3px;
    cursor: pointer; font-family: 'JetBrains Mono',Consolas,monospace; font-size: 12px;
    color: var(--accent); border: 1px solid transparent;
  }
  .crumb:hover { border-color: var(--accent); }
  .crumb.current { color: var(--fg); cursor: default; background: var(--bg); }
  .crumb-sep { color: var(--fg-dim); }
  #cwd-edit {
    margin-left: auto; flex: 1; min-width: 200px;
    background: var(--bg-input); border: 1px solid var(--border);
    color: var(--fg); padding: 5px 10px; border-radius: 3px;
    font-family: 'JetBrains Mono',Consolas,monospace; font-size: 12px;
  }
  #cwd-edit:focus { outline: none; border-color: var(--accent); }

  section.toolbar {
    padding: 8px 16px; background: var(--bg);
    border-bottom: 1px solid var(--border);
    display: flex; gap: 8px; flex-wrap: wrap;
  }

  section.inline-form {
    padding: 12px 16px; background: var(--bg-input);
    border-bottom: 1px solid var(--border);
    display: none;
  }
  section.inline-form.show { display: block; }
  .inline-form h4 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
  .inline-form .field { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
  .inline-form label { font-size: 12px; color: var(--fg-dim); min-width: 110px; }
  .inline-form input, .inline-form select, .inline-form textarea {
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 3px; padding: 5px 8px; color: var(--fg);
    font-family: 'JetBrains Mono',Consolas,monospace; font-size: 12px;
    flex: 1;
  }
  .inline-form input:focus, .inline-form select:focus, .inline-form textarea:focus {
    outline: none; border-color: var(--accent);
  }
  .inline-form .actions { display: flex; gap: 8px; margin-top: 10px; }

  main { flex: 1; overflow-y: auto; }
  table.explorer { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.explorer th, table.explorer td {
    text-align: left; padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  table.explorer th {
    background: var(--bg-elev); color: var(--fg-dim); font-weight: normal;
    text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em;
    position: sticky; top: 0;
  }
  table.explorer tr.row:hover { background: var(--bg-hover); }
  table.explorer td.actions { text-align: right; white-space: nowrap; }
  table.explorer td.name a {
    color: var(--fg); text-decoration: none; font-weight: 500;
  }
  table.explorer td.name a:hover { color: var(--accent); }
  table.explorer td.name.folder a { color: var(--accent); }
  table.explorer td.type { color: var(--fg-dim); font-family: 'JetBrains Mono',Consolas,monospace; font-size: 12px; }
  table.explorer td.ord { font-family: 'JetBrains Mono',Consolas,monospace; font-size: 11px; color: var(--fg-dim); }
  .muted { color: var(--fg-dim); text-align: center; padding: 30px; }
  .row-confirm {
    background: var(--bg-input); color: var(--accent-warn);
    font-size: 12px; padding: 8px 12px;
  }
  .row-confirm button { margin-left: 8px; }

  section.result {
    background: var(--bg-elev); border-top: 1px solid var(--border);
    padding: 10px 16px; max-height: 30vh; overflow: auto;
  }
  .result-box {
    background: #0a0d12; border: 1px solid var(--border);
    border-radius: 4px; padding: 10px 12px;
    font-family: 'JetBrains Mono',Consolas,monospace; font-size: 11px;
    white-space: pre-wrap; word-break: break-word; line-height: 1.5;
  }
  .result-box.ok { border-color: var(--accent-ok); }
  .result-box.err { border-color: var(--accent-error); }
  .badge {
    display: inline-block; padding: 1px 8px; border-radius: 10px;
    font-size: 11px; font-weight: 600; margin-right: 8px;
  }
  .badge.ok { background: var(--accent-ok); color: #0a0d12; }
  .badge.err { background: var(--accent-error); color: #0a0d12; }

  footer {
    padding: 6px 16px; background: var(--bg-elev);
    border-top: 1px solid var(--border);
    font-size: 11px; color: var(--fg-dim);
    display: flex; justify-content: space-between;
  }
  footer a { color: var(--accent); cursor: pointer; }

  dialog {
    background: var(--bg-elev); color: var(--fg);
    border: 1px solid var(--border); border-radius: 6px;
    padding: 20px; min-width: 400px; max-width: 80vw;
    box-shadow: 0 8px 40px rgba(0,0,0,0.5);
  }
  dialog::backdrop { background: rgba(0,0,0,0.5); }
  dialog h3 { margin: 0 0 14px; font-size: 14px; }
  dialog .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  dialog label { font-size: 12px; color: var(--fg-dim); }
  dialog input, dialog select, dialog textarea {
    background: var(--bg-input); border: 1px solid var(--border);
    border-radius: 4px; padding: 7px 10px; color: var(--fg);
    font-family: 'JetBrains Mono',Consolas,monospace; font-size: 13px;
  }
  dialog input:focus, dialog select:focus, dialog textarea:focus {
    outline: none; border-color: var(--accent);
  }
  dialog .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }
  dialog pre.preview {
    background: #0a0d12; border: 1px solid var(--border);
    border-radius: 4px; padding: 10px; max-height: 50vh; overflow: auto;
    font-family: 'JetBrains Mono',Consolas,monospace; font-size: 11px;
    white-space: pre-wrap; word-break: break-word;
  }
  .err-text { color: var(--accent-error); font-size: 12px; margin-top: 6px; }
</style>
</head>
<body>

<header>
  <span class="title">⚡ Niagara MCP</span>
  <span class="pill" id="server-pill">connecting…</span>
  <span class="pill" id="identity-pill">—</span>
  <button class="ghost" onclick="bootstrap()" id="boot-btn">Bootstrap user-Bearer</button>
  <button class="ghost spacer" onclick="commitStation()">💾 Commit Station</button>
  <button class="icon" onclick="refresh()" title="Refresh">↻</button>
</header>

<nav class="pathbar">
  <button class="icon" onclick="goUp()" title="Up one level">⬆</button>
  <button class="icon" onclick="goHome()" title="Home">⌂</button>
  <span id="crumbs-host"></span>
  <input id="cwd-edit" placeholder="paste ord here and press Enter" />
</nav>

<section class="toolbar">
  <button onclick="showForm('mkfolder')">+ Folder</button>
  <button onclick="showForm('mkpoint')">+ Point</button>
  <button class="ghost" onclick="showForm('bql')">⌕ BQL</button>
  <button class="ghost" onclick="inspectOrd(state.cwd)">👁 Inspect this</button>
</section>

<section class="inline-form" id="form-mkfolder">
  <h4>+ Folder under cwd</h4>
  <div class="field"><label>name</label><input id="f-name" placeholder="MCP_Test"></div>
  <div class="field"><label><input type="checkbox" id="f-cd" checked> cd into it after creation</label></div>
  <div class="actions"><button onclick="doMkFolder()">Create</button><button class="ghost" onclick="hideForms()">Cancel</button></div>
</section>

<section class="inline-form" id="form-mkpoint">
  <h4>+ Point under cwd</h4>
  <div class="field"><label>type</label><select id="p-type">
    <option>control:NumericWritable</option>
    <option>control:BooleanWritable</option>
    <option>control:StringWritable</option>
    <option>control:EnumWritable</option>
    <option value="__custom__">(custom typeSpec…)</option>
  </select></div>
  <div class="field" id="p-custom-row" style="display:none">
    <label>custom typeSpec</label><input id="p-custom" placeholder="control:NumericPoint">
  </div>
  <div class="field"><label>name</label><input id="p-name" placeholder="oat"></div>
  <div class="field"><label>facets JSON</label><input id="p-facets" placeholder='{"units":"celsius","precision":1}'></div>
  <div class="actions"><button onclick="doMkPoint()">Create</button><button class="ghost" onclick="hideForms()">Cancel</button></div>
</section>

<section class="inline-form" id="form-bql">
  <h4>⌕ BQL Query</h4>
  <div class="field"><label>query</label><textarea id="bql-q" rows="2" placeholder="station:|slot:/Drivers|bql:select displayName,type from control:ControlPoint"></textarea></div>
  <div class="field"><label>limit</label><input id="bql-lim" type="number" value="50"></div>
  <div class="actions"><button onclick="doBql()">Run</button><button class="ghost" onclick="hideForms()">Cancel</button></div>
</section>

<main>
  <table class="explorer">
    <thead><tr><th>Name</th><th>Type</th><th>ORD</th><th style="text-align:right">Actions</th></tr></thead>
    <tbody id="children-body">
      <tr><td colspan="4" class="muted">loading…</td></tr>
    </tbody>
  </table>
</main>

<section class="result" id="result-host" style="display:none">
  <div id="result-content"></div>
</section>

<footer>
  <span><a onclick="showRaw()">▶ Last raw response</a></span>
  <span id="footer-status">—</span>
</footer>

<dialog id="dlg-write">
  <h3>Write Point Value</h3>
  <div class="field"><label>ord</label><input id="w-ord" readonly></div>
  <div class="field"><label>value</label><input id="w-val" placeholder="22.5"></div>
  <div class="field"><label>priority</label><input id="w-pri" type="number" value="16"></div>
  <div id="w-err" class="err-text"></div>
  <div class="actions">
    <button class="ghost" onclick="document.getElementById('dlg-write').close()">Cancel</button>
    <button onclick="doWritePoint()">Write</button>
  </div>
</dialog>

<dialog id="dlg-addext">
  <h3>Add Extension</h3>
  <div class="field"><label>parent ord</label><input id="x-ord" readonly></div>
  <div class="field"><label>extensionType</label><input id="x-type" value="history:NumericInterval"></div>
  <div class="field"><label>extension name</label><input id="x-name" value="historyExt"></div>
  <div class="field"><label>config JSON</label><input id="x-cfg" placeholder='{"interval":"+00:01:00.000"}'></div>
  <div id="x-err" class="err-text"></div>
  <div class="actions">
    <button class="ghost" onclick="document.getElementById('dlg-addext').close()">Cancel</button>
    <button onclick="doAddExt()">Add</button>
  </div>
</dialog>

<dialog id="dlg-inspect">
  <h3>Inspect Component</h3>
  <pre class="preview" id="i-content"></pre>
  <div class="actions">
    <button onclick="document.getElementById('dlg-inspect').close()">Close</button>
  </div>
</dialog>

<dialog id="dlg-raw">
  <h3>Last Raw Response</h3>
  <pre class="preview" id="raw-content"></pre>
  <div class="actions">
    <button onclick="document.getElementById('dlg-raw').close()">Close</button>
  </div>
</dialog>

<script>
let state = {};
let children = [];
let pendingRemove = null;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, "&#39;"); }

async function api(url, body) {
  const opts = body !== undefined
    ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}
    : {};
  const r = await fetch(url, opts);
  return r.json();
}

async function refresh() {
  state = await api('/api/state');
  document.getElementById('server-pill').textContent =
    state.serverName ? `${state.serverName} ${state.serverVersion || ''}` : 'no connection';
  document.getElementById('server-pill').className =
    'pill ' + (state.serverName ? 'ok' : 'err');

  const idEl = document.getElementById('identity-pill');
  if (state.usingUserBearer) {
    idEl.textContent = `user-Bearer · ${state.smokeUser}`;
    idEl.className = 'pill ok';
    document.getElementById('boot-btn').textContent = '↻ Re-bootstrap';
  } else {
    idEl.textContent = 'apiToken · service (read-only)';
    idEl.className = 'pill warn';
    document.getElementById('boot-btn').textContent = 'Bootstrap user-Bearer';
  }
  document.getElementById('cwd-edit').value = state.cwd || '';
  renderCrumbs(state.crumbs || []);
  await loadChildren();
}

function renderCrumbs(crumbs) {
  const host = document.getElementById('crumbs-host');
  if (!crumbs.length) { host.innerHTML = ''; return; }
  host.innerHTML = crumbs.map((c, i) => {
    const last = i === crumbs.length - 1;
    const cls = last ? 'current' : '';
    const click = last ? '' : `onclick="cdTo('${escapeAttr(c[1])}')"`;
    return `<span class="crumb ${cls}" ${click}>${escapeHtml(c[0])}</span>` +
           (last ? '' : '<span class="crumb-sep">›</span>');
  }).join(' ');
}

async function loadChildren() {
  const body = document.getElementById('children-body');
  body.innerHTML = '<tr><td colspan="4" class="muted">loading…</td></tr>';
  const result = await api('/api/ls', {});
  if (result.ok && result.payload && Array.isArray(result.payload.children)) {
    children = result.payload.children;
    renderChildren();
    document.getElementById('footer-status').textContent = `${children.length} item(s)`;
  } else {
    body.innerHTML = `<tr><td colspan="4" class="muted">
      <span class="badge err">ERROR</span> ${escapeHtml(result.error?.message || 'failed')}
    </td></tr>`;
    children = [];
    showResult(result);
  }
}

function isFolder(c) {
  const t = (c.type || '').toLowerCase();
  return t.includes('folder') || (c.childCount || 0) > 0;
}
function isWritable(c) {
  return (c.type || '').includes('Writable');
}

function renderChildren() {
  const body = document.getElementById('children-body');
  if (!children.length) {
    body.innerHTML = '<tr><td colspan="4" class="muted">empty</td></tr>';
    return;
  }
  body.innerHTML = children.map(c => {
    const ord = escapeAttr(c.ord || '');
    const name = escapeHtml(c.name || '?');
    const type = escapeHtml(c.type || '?');
    const folder = isFolder(c);
    const writable = isWritable(c);
    const icon = folder ? '📁' : (writable ? '📊' : '◯');
    let actions = `<button class="icon" onclick="inspectOrd('${ord}')" title="Inspect">👁</button>`;
    if (writable) {
      actions += `<button class="icon" onclick="readOrd('${ord}')" title="Read">📖</button>`;
      actions += `<button class="icon" onclick="openWrite('${ord}')" title="Write">✏️</button>`;
      actions += `<button class="icon" onclick="openAddExt('${ord}')" title="Add extension">⊕</button>`;
    }
    actions += `<button class="icon danger" onclick="removeRow('${ord}')" title="Remove">🗑</button>`;
    return `<tr class="row">
      <td class="name ${folder ? 'folder' : ''}">${icon} <a href="#" onclick="cdTo('${ord}'); return false">${name}</a></td>
      <td class="type">${type}</td>
      <td class="ord">${escapeHtml(c.ord || '')}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join('');
}

// nav
async function cdTo(ord) {
  const r = await api('/api/setcwd', {cwd: ord});
  if (!r.ok) { showResult(r); return; }
  await refresh();
}
async function goUp() {
  const r = await api('/api/up', {});
  if (!r.ok) { showResult(r); return; }
  await refresh();
}
async function goHome() {
  await api('/api/home', {});
  await refresh();
}
document.getElementById('cwd-edit').addEventListener('keydown', e => {
  if (e.key === 'Enter') cdTo(e.target.value.trim());
});

// forms
function hideForms() {
  document.querySelectorAll('.inline-form').forEach(f => f.classList.remove('show'));
}
function showForm(name) {
  hideForms();
  document.getElementById('form-' + name).classList.add('show');
  const first = document.querySelector(`#form-${name} input, #form-${name} select, #form-${name} textarea`);
  if (first) first.focus();
}
document.getElementById('p-type').addEventListener('change', e => {
  document.getElementById('p-custom-row').style.display =
    e.target.value === '__custom__' ? '' : 'none';
});

async function doMkFolder() {
  const name = document.getElementById('f-name').value.trim();
  const cdAfter = document.getElementById('f-cd').checked;
  if (!name) { alert('name required'); return; }
  const r = await api('/api/mkfolder', {name, cdAfter});
  showResult(r);
  if (r.ok) { hideForms(); document.getElementById('f-name').value = ''; await refresh(); }
}
async function doMkPoint() {
  let type = document.getElementById('p-type').value;
  if (type === '__custom__') type = document.getElementById('p-custom').value.trim();
  const name = document.getElementById('p-name').value.trim();
  const facets = document.getElementById('p-facets').value.trim();
  if (!type) { alert('type required'); return; }
  if (!name) { alert('name required'); return; }
  const r = await api('/api/mkpoint', {type, name, facets});
  showResult(r);
  if (r.ok) { hideForms(); document.getElementById('p-name').value = ''; await loadChildren(); }
}
async function doBql() {
  const query = document.getElementById('bql-q').value.trim();
  const limit = parseInt(document.getElementById('bql-lim').value) || 50;
  if (!query) { alert('query required'); return; }
  const r = await api('/api/bql', {query, limit});
  showResult(r);
}

// row actions
async function inspectOrd(ord) {
  const r = await api('/api/inspect', {ord});
  document.getElementById('i-content').textContent = r.ok
    ? JSON.stringify(r.payload, null, 2)
    : JSON.stringify(r.error, null, 2);
  document.getElementById('dlg-inspect').showModal();
}
async function readOrd(ord) {
  const r = await api('/api/readval', {ord});
  showResult(r);
}
function openWrite(ord) {
  document.getElementById('w-ord').value = ord;
  document.getElementById('w-val').value = '';
  document.getElementById('w-pri').value = '16';
  document.getElementById('w-err').textContent = '';
  document.getElementById('dlg-write').showModal();
  setTimeout(() => document.getElementById('w-val').focus(), 50);
}
async function doWritePoint() {
  const ord = document.getElementById('w-ord').value;
  const value = document.getElementById('w-val').value;
  const priority = parseInt(document.getElementById('w-pri').value) || 16;
  const r = await api('/api/setval', {ord, value, priority});
  if (r.ok) {
    document.getElementById('dlg-write').close();
    showResult(r);
  } else {
    document.getElementById('w-err').textContent = r.error.message;
  }
}
function openAddExt(ord) {
  document.getElementById('x-ord').value = ord;
  document.getElementById('x-err').textContent = '';
  document.getElementById('dlg-addext').showModal();
}
async function doAddExt() {
  const ord = document.getElementById('x-ord').value;
  const extensionType = document.getElementById('x-type').value.trim();
  const extName = document.getElementById('x-name').value.trim();
  const config = document.getElementById('x-cfg').value.trim();
  const r = await api('/api/addext', {ord, extensionType, extName, config});
  if (r.ok) {
    document.getElementById('dlg-addext').close();
    showResult(r);
    await loadChildren();
  } else {
    document.getElementById('x-err').textContent = r.error.message;
  }
}

async function removeRow(ord) {
  if (pendingRemove !== ord) {
    const r = await api('/api/remove', {ord});
    if (!r.ok) { showResult(r); return; }
    pendingRemove = ord;
    const rows = [...document.querySelectorAll('#children-body tr.row')];
    const target = rows.find(tr => tr.querySelector('.ord')?.textContent === ord);
    if (target) {
      const summary = JSON.stringify(r.payload || {});
      const cf = document.createElement('tr');
      cf.id = 'confirm-row';
      cf.innerHTML = `<td colspan="4" class="row-confirm">
        Dry-run: ${escapeHtml(summary.substring(0, 200))}
        <button class="danger" onclick="confirmRemove('${escapeAttr(ord)}')">Confirm remove</button>
        <button class="ghost" onclick="cancelRemove()">Cancel</button>
      </td>`;
      document.getElementById('confirm-row')?.remove();
      target.after(cf);
    }
  } else {
    confirmRemove(ord);
  }
}
async function confirmRemove(ord) {
  const r = await api('/api/remove', {ord, dryRun: false});
  showResult(r);
  pendingRemove = null;
  document.getElementById('confirm-row')?.remove();
  if (r.ok) await refresh();
}
function cancelRemove() {
  pendingRemove = null;
  document.getElementById('confirm-row')?.remove();
}

// identity / commit
async function bootstrap() {
  const btn = document.getElementById('boot-btn');
  btn.disabled = true; btn.textContent = '…';
  const r = await api('/api/bootstrap', {});
  showResult(r);
  btn.disabled = false;
  await refresh();
}
async function commitStation() {
  if (!confirm('Commit Station — persist all in-memory changes to .bog. Continue?')) return;
  const r = await api('/api/commit', {});
  showResult(r);
}

function showResult(r) {
  const host = document.getElementById('result-host');
  const content = document.getElementById('result-content');
  const payload = r.ok ? r.payload : r.error;
  const cls = r.ok ? 'ok' : 'err';
  const badge = r.ok ? '<span class="badge ok">OK</span>' : '<span class="badge err">ERROR</span>';
  const note = r.note ? `<div style="margin-bottom:6px">${escapeHtml(r.note)}</div>` : '';
  content.innerHTML = `${badge}${note}<div class="result-box ${cls}">${escapeHtml(JSON.stringify(payload, null, 2))}</div>`;
  host.style.display = 'block';
}

async function showRaw() {
  const r = await api('/api/last');
  document.getElementById('raw-content').textContent = JSON.stringify(r, null, 2);
  document.getElementById('dlg-raw').showModal();
}

refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>
"""


# ─── Routes ───────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template_string(INDEX_HTML)


@app.route("/api/state")
def api_state():
    return jsonify({
        "serverName": STATE.server_info.get("name"),
        "serverVersion": STATE.server_info.get("version"),
        "sessionId": STATE.client.session_id,
        "usingUserBearer": STATE.using_user_bearer,
        "smokeUser": STATE.smoke_user,
        "cwd": STATE.cwd,
        "homeCwd": STATE.home_cwd,
        "crumbs": split_breadcrumb(STATE.cwd),
    })


@app.route("/api/last")
def api_last():
    return jsonify(STATE.last_response or {})


@app.route("/api/ls", methods=["POST"])
def api_ls():
    data = request.get_json() or {}
    target = (data.get("ord") or "").strip() or STATE.cwd
    r = STATE.call("listChildren", {"ord": target})
    return jsonify(extract(r))


@app.route("/api/inspect", methods=["POST"])
def api_inspect():
    data = request.get_json() or {}
    ord_ = (data.get("ord") or "").strip() or STATE.cwd
    r = STATE.call("inspectComponent", {"ord": ord_})
    return jsonify(extract(r))


@app.route("/api/bql", methods=["POST"])
def api_bql():
    data = request.get_json() or {}
    q = (data.get("query") or "").strip()
    if not q:
        return jsonify({"ok": False, "error": {"code": -1, "message": "query required"}})
    lim = int(data.get("limit") or 50)
    r = STATE.call("bqlQuery", {"query": q, "limit": lim})
    return jsonify(extract(r))


@app.route("/api/readval", methods=["POST"])
def api_readval():
    data = request.get_json() or {}
    ord_ = (data.get("ord") or "").strip()
    if not ord_:
        return jsonify({"ok": False, "error": {"code": -1, "message": "ord required"}})
    r = STATE.call("readPoint", {"ord": ord_})
    return jsonify(extract(r))


@app.route("/api/setcwd", methods=["POST"])
def api_setcwd():
    data = request.get_json() or {}
    cwd = (data.get("cwd") or "").strip()
    if not cwd:
        return jsonify({"ok": False, "error": {"code": -1, "message": "cwd required"}})
    if not looks_like_ord(cwd):
        return jsonify({"ok": False, "error": {
            "code": -1,
            "message": f"not a valid ord (expected 'station:|slot:/...'): {cwd}"
        }})
    probe = STATE.client.tools_call("listChildren", {"ord": cwd})
    out = extract(probe)
    if not out["ok"]:
        return jsonify({"ok": False, "error": {
            "code": -1,
            "message": f"cwd not reachable: {out['error'].get('message')}",
            "data": out["error"]
        }})
    STATE.cwd = cwd
    return jsonify({"ok": True, "payload": {"cwd": cwd}})


@app.route("/api/up", methods=["POST"])
def api_up():
    p = parent_ord(STATE.cwd)
    if not p:
        return jsonify({"ok": False, "error": {"code": -1, "message": "already at root"}})
    STATE.cwd = p
    return jsonify({"ok": True, "payload": {"cwd": p}})


@app.route("/api/home", methods=["POST"])
def api_home():
    STATE.cwd = STATE.home_cwd
    return jsonify({"ok": True, "payload": {"cwd": STATE.cwd}})


@app.route("/api/mkfolder", methods=["POST"])
def api_mkfolder():
    bad = require_user_bearer()
    if bad: return bad
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": {"code": -1, "message": "name required"}})
    r = STATE.call("createComponent", {
        "parentOrd": STATE.cwd, "type": "baja:Folder", "name": name})
    out = extract(r)
    if out["ok"] and data.get("cdAfter") and isinstance(out["payload"], dict):
        new_ord = out["payload"].get("ord")
        if new_ord and looks_like_ord(new_ord):
            STATE.cwd = new_ord
            out["note"] = f"created and cwd → {new_ord}"
    return jsonify(out)


@app.route("/api/mkpoint", methods=["POST"])
def api_mkpoint():
    bad = require_user_bearer()
    if bad: return bad
    data = request.get_json() or {}
    type_spec = (data.get("type") or "").strip()
    if not type_spec:
        return jsonify({"ok": False, "error": {"code": -1, "message": "type required"}})
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": {"code": -1, "message": "name required"}})
    args = {"parentOrd": STATE.cwd, "type": type_spec, "name": name}
    facets_raw = (data.get("facets") or "").strip()
    if facets_raw:
        try: args["facets"] = json.loads(facets_raw)
        except json.JSONDecodeError as e:
            return jsonify({"ok": False, "error": {"code": -1, "message": f"invalid facets JSON: {e}"}})
    r = STATE.call("createComponent", args)
    return jsonify(extract(r))


@app.route("/api/setval", methods=["POST"])
def api_setval():
    bad = require_user_bearer()
    if bad: return bad
    data = request.get_json() or {}
    ord_ = (data.get("ord") or "").strip()
    if not ord_:
        return jsonify({"ok": False, "error": {"code": -1, "message": "ord required"}})
    val = coerce_value(data.get("value"))
    pri = int(data.get("priority") or 16)
    r = STATE.call("writePoint", {"ord": ord_, "value": val, "priority": pri})
    return jsonify(extract(r))


@app.route("/api/addext", methods=["POST"])
def api_addext():
    bad = require_user_bearer()
    if bad: return bad
    data = request.get_json() or {}
    ord_ = (data.get("ord") or "").strip()
    if not ord_:
        return jsonify({"ok": False, "error": {"code": -1, "message": "ord required"}})
    args = {
        "ord": ord_,
        "extensionType": (data.get("extensionType") or "history:NumericInterval").strip(),
        "name": (data.get("extName") or "historyExt").strip(),
    }
    cfg_raw = (data.get("config") or "").strip()
    if cfg_raw:
        try: args["config"] = json.loads(cfg_raw)
        except json.JSONDecodeError as e:
            return jsonify({"ok": False, "error": {"code": -1, "message": f"invalid config JSON: {e}"}})
    r = STATE.call("addExtension", args)
    return jsonify(extract(r))


@app.route("/api/remove", methods=["POST"])
def api_remove():
    bad = require_user_bearer()
    if bad: return bad
    data = request.get_json() or {}
    ord_ = (data.get("ord") or "").strip()
    if not ord_:
        return jsonify({"ok": False, "error": {"code": -1, "message": "ord required"}})
    dry = data.get("dryRun", True)
    if dry:
        r = STATE.call("removeComponent", {"ord": ord_})
        out = extract(r)
        if out["ok"]:
            out["note"] = "Dry-run preview."
        return jsonify(out)
    r = STATE.call("removeComponent", {"ord": ord_, "dryRun": False})
    out = extract(r)
    if out["ok"] and (STATE.cwd == ord_ or STATE.cwd.startswith(ord_ + "/")):
        STATE.cwd = STATE.home_cwd
        out["note"] = f"removed; cwd reset to {STATE.home_cwd}"
    return jsonify(out)


@app.route("/api/commit", methods=["POST"])
def api_commit():
    bad = require_user_bearer()
    if bad: return bad
    r = STATE.call("commitStation", {})
    return jsonify(extract(r))


@app.route("/api/bootstrap", methods=["POST"])
def api_bootstrap():
    STATE.switch_to_api()
    new_token = secrets.token_urlsafe(32)
    r = STATE.client.tools_call("setupTestUser",
        {"username": STATE.smoke_user, "token": new_token})
    out = extract(r)
    if not out["ok"]:
        return jsonify(out)
    probe = McpClient(STATE.base, new_token, insecure=STATE.insecure)
    probe_resp = probe.initialize()
    if "_http_status" in probe_resp:
        return jsonify({"ok": False, "error": {
            "code": probe_resp["_http_status"],
            "message": (f"setupTestUser OK but new token rejected "
                        f"(HTTP {probe_resp['_http_status']}). Identity NOT switched."),
            "data": {
                "setupTestUserPayload": out.get("payload"),
                "probeBody": probe_resp.get("_raw", "")
            }
        }})
    STATE.switch_to_user(new_token)
    out["note"] = (f"Identity → user-Bearer for '{STATE.smoke_user}'. "
                   f"Token (save for reuse): {new_token}")
    return jsonify(out)


# ─── Runner ───────────────────────────────────────────────────────────────────
def open_browser(url, delay=1.0):
    def _open():
        time.sleep(delay)
        webbrowser.open(url)
    threading.Thread(target=_open, daemon=True).start()


def main():
    global STATE
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--scheme", default="http", choices=["http", "https"])
    ap.add_argument("--module", default="niagaramcp")
    ap.add_argument("--token", required=True)
    ap.add_argument("--insecure", action="store_true")
    ap.add_argument("--smoke-user", default="mcpSmokeUser")
    ap.add_argument("--smoke-parent", default="station:|slot:/Drivers")
    ap.add_argument("--app-port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()

    base = f"{a.scheme}://{a.host}:{a.port}/{a.module}"
    STATE = State(base, a.token, a.insecure, a.smoke_user, a.smoke_parent)

    print(f"Connecting to {base} ...")
    r = STATE.initialize()
    if "_http_status" in r:
        print(f"ERROR: HTTP {r['_http_status']} — {r.get('_raw')}", file=sys.stderr)
        sys.exit(1)
    si = STATE.server_info
    print(f"Connected: {si.get('name')} {si.get('version')}")

    url = f"http://127.0.0.1:{a.app_port}/"
    if not a.no_browser:
        open_browser(url)
    print(f"\nWeb explorer: {url}")
    print("Ctrl+C to stop.\n")
    app.run(host="127.0.0.1", port=a.app_port, debug=False)


if __name__ == "__main__":
    main()