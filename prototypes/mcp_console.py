#!/usr/bin/env python3
"""
niagaramcp interactive console — ad-hoc exploration and manual smoke.

Menu-driven companion to niagaramcp_smoke.py. Lets you create/remove
folders, create points, set values, read values, inspect components,
add extensions, commit station — all over the same Streamable HTTP
protocol the smoke test uses. Stdlib only.

Run:
  cd C:\\MCP
  py mcp_console.py --host=STATION_IP --port=PORT --scheme=http ^
                    --token=a1b2c3d4-e5f6-7890-abcd-ef1234567890 ^
                    [--smoke-user=mcpSmokeUser] ^
                    [--smoke-parent="station:|slot:/Drivers"] ^
                    [--insecure]

The --token can be either apiToken (service identity, read-only access)
or a user-Bearer obtained via setupTestUser (full write access).
Menu option [b] mints a fresh user-Bearer from the current apiToken
and switches the session to it.

Pre-flight for writes:
  1. Workbench: BMcpPlatformService.enableTestSetup = true, restart.
  2. Workbench: BUser <smoke-user> exists with add-permission on
     <smoke-parent>.
  3. Run [b] once per console session.
  4. Optional: flip enableTestSetup back to false (token stays valid).
"""
import argparse
import json
import secrets
import ssl
import sys
import urllib.error
import urllib.request


# ─── ANSI ─────────────────────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
GREY   = "\033[90m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

def ok(msg):    print(f"  {GREEN}✓{RESET} {msg}")
def err(msg):   print(f"  {RED}✗{RESET} {msg}")
def info(msg):  print(f"  {GREY}{msg}{RESET}")


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
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


# ─── MCP client ───────────────────────────────────────────────────────────────
class McpClient:
    def __init__(self, base, token, insecure=False):
        self.base = base.rstrip("/")
        self.token = token
        self.insecure = insecure
        self.session_id = None
        self._id = 0

    def _hdrs(self):
        h = {"Authorization": f"Bearer {self.token}",
             "Accept": "application/json, text/event-stream"}
        if self.session_id:
            h["Mcp-Session-Id"] = self.session_id
        return h

    def _rpc(self, method, params=None):
        self._id += 1
        body = {"jsonrpc": "2.0", "id": self._id, "method": method}
        if params is not None:
            body["params"] = params
        status, hdrs, raw = http_request(f"{self.base}/mcp", "POST",
                                         self._hdrs(), body, insecure=self.insecure)
        if not self.session_id:
            self.session_id = hdrs.get("Mcp-Session-Id") or hdrs.get("mcp-session-id")
        if status != 200:
            return {"_http_status": status,
                    "_raw": raw[:500].decode("utf-8", errors="replace")}
        return parse_json(raw) or {"_parse_error": True}

    def initialize(self):
        return self._rpc("initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "mcp-console", "version": "0.1"},
        })

    def tools_call(self, name, args):
        return self._rpc("tools/call", {"name": name, "arguments": args})

    def delete(self):
        return http_request(f"{self.base}/mcp", "DELETE",
                            self._hdrs(), insecure=self.insecure)


# ─── result extraction ────────────────────────────────────────────────────────
def extract_result(resp):
    """Returns (success, payload, error_dict_or_none)."""
    if not isinstance(resp, dict):
        return False, None, {"code": -1, "message": "no response"}
    if "_http_status" in resp:
        return False, None, {"code": resp["_http_status"],
                             "message": f"HTTP {resp['_http_status']}: {resp.get('_raw','')}"}
    if "error" in resp:
        return False, None, resp["error"]
    result = resp.get("result", {})
    if "structuredContent" in result:
        return True, result["structuredContent"], None
    content = result.get("content", [])
    if content and content[0].get("type") == "text":
        try:
            return True, json.loads(content[0]["text"]), None
        except json.JSONDecodeError:
            return True, content[0]["text"], None
    return True, result, None


def show_error(error):
    err(f"code {error.get('code')}: {error.get('message')}")
    data = error.get("data")
    if data:
        info(f"data: {json.dumps(data, ensure_ascii=False, indent=2)}")


def show_payload(payload, label="result"):
    info(f"{label}:")
    if isinstance(payload, (dict, list)):
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(payload)


# ─── state ────────────────────────────────────────────────────────────────────
class State:
    def __init__(self, client, smoke_user, smoke_parent):
        self.client = client
        self.api_token = client.token
        self.user_token = None
        self.using_user_bearer = False
        self.cwd = smoke_parent
        self.smoke_user = smoke_user
        self.last_response = None

    def switch_to_user_bearer(self, token):
        self.user_token = token
        self.client.token = token
        self.client.session_id = None
        self.using_user_bearer = True

    def switch_to_api_token(self):
        self.client.token = self.api_token
        self.client.session_id = None
        self.using_user_bearer = False


def need_user_bearer(state):
    if state.using_user_bearer:
        return True
    err("write tools need user-Bearer. Use [b] to bootstrap first.")
    return False


# ─── commands ─────────────────────────────────────────────────────────────────
def cmd_info(state):
    state.client.session_id = None
    r = state.client.initialize()
    state.last_response = r
    si = r.get("result", {}).get("serverInfo", {}) if isinstance(r, dict) else {}
    print(f"  server:        {si.get('name')} {si.get('version')}")
    print(f"  protocol:      {r.get('result', {}).get('protocolVersion') if isinstance(r, dict) else '?'}")
    print(f"  transports:    {si.get('transports')}")
    print(f"  session id:    {state.client.session_id}")
    print(f"  identity:      {'user-Bearer ('+state.smoke_user+')' if state.using_user_bearer else 'apiToken (service)'}")
    print(f"  cwd:           {state.cwd}")


def cmd_ls(state):
    target = input(f"  ord [{state.cwd}]: ").strip() or state.cwd
    r = state.client.tools_call("listChildren", {"ord": target})
    state.last_response = r
    success, payload, error = extract_result(r)
    if not success:
        show_error(error); return
    children = payload.get("children") if isinstance(payload, dict) and "children" in payload else payload
    if isinstance(children, list):
        for c in children:
            print(f"  {c.get('name','?'):<30} [{c.get('type','?')}]")
        info(f"{len(children)} child(ren)")
    else:
        show_payload(payload)


def cmd_cd(state):
    new = input(f"  new cwd [{state.cwd}]: ").strip()
    if new:
        state.cwd = new
    print(f"  cwd: {state.cwd}")


def cmd_mkfolder(state):
    if not need_user_bearer(state): return
    name = input("  folder name: ").strip()
    if not name: err("name required"); return
    r = state.client.tools_call("createComponent", {
        "parentOrd": state.cwd, "type": "baja:Folder", "name": name,
    })
    state.last_response = r
    success, payload, error = extract_result(r)
    if not success: show_error(error); return
    new_ord = payload.get("ord")
    ok(f"created: {new_ord}")
    if input("  cd into it? [y/N]: ").strip().lower() == "y":
        state.cwd = new_ord


def cmd_mkpoint(state):
    if not need_user_bearer(state): return
    print("  type:")
    print("    1) control:NumericWritable")
    print("    2) control:BooleanWritable")
    print("    3) control:StringWritable")
    print("    4) control:EnumWritable")
    print("    5) custom typeSpec")
    pick = (input("  pick [1]: ").strip() or "1")
    types = {"1": "control:NumericWritable",
             "2": "control:BooleanWritable",
             "3": "control:StringWritable",
             "4": "control:EnumWritable"}
    type_spec = input("  typeSpec: ").strip() if pick == "5" else types.get(pick)
    if not type_spec: err("invalid type"); return
    name = input("  point name: ").strip()
    if not name: err("name required"); return
    facets_raw = input('  facets JSON or empty (e.g. {"units":"celsius"}): ').strip()
    args = {"parentOrd": state.cwd, "type": type_spec, "name": name}
    if facets_raw:
        try: args["facets"] = json.loads(facets_raw)
        except json.JSONDecodeError as e: err(f"invalid JSON: {e}"); return
    r = state.client.tools_call("createComponent", args)
    state.last_response = r
    success, payload, error = extract_result(r)
    if not success: show_error(error); return
    ok(f"created: {payload.get('ord')}")


def cmd_setval(state):
    if not need_user_bearer(state): return
    ord_ = input("  writable point ord: ").strip()
    if not ord_: err("ord required"); return
    raw = input("  value: ").strip()
    pri = input("  priority [16]: ").strip() or "16"
    val = raw
    try:
        val = float(raw) if "." in raw else int(raw)
    except ValueError:
        if raw.lower() in ("true", "false"):
            val = (raw.lower() == "true")
    r = state.client.tools_call("writePoint",
                                {"ord": ord_, "value": val, "priority": int(pri)})
    state.last_response = r
    success, payload, error = extract_result(r)
    if not success: show_error(error); return
    ok("written"); show_payload(payload)


def cmd_readval(state):
    ord_ = input("  point ord: ").strip()
    if not ord_: err("ord required"); return
    r = state.client.tools_call("readPoint", {"ord": ord_})
    state.last_response = r
    success, payload, error = extract_result(r)
    if not success: show_error(error); return
    show_payload(payload, label="value")


def cmd_inspect(state):
    ord_ = input(f"  ord [{state.cwd}]: ").strip() or state.cwd
    r = state.client.tools_call("inspectComponent", {"ord": ord_})
    state.last_response = r
    success, payload, error = extract_result(r)
    if not success: show_error(error); return
    show_payload(payload, label="component")


def cmd_addext(state):
    if not need_user_bearer(state): return
    ord_ = input("  parent ord (typically a point): ").strip()
    if not ord_: err("ord required"); return
    ext_type = input("  extensionType [history:NumericInterval]: ").strip() or "history:NumericInterval"
    name = input("  extension name [historyExt]: ").strip() or "historyExt"
    cfg_raw = input("  config JSON or empty: ").strip()
    args = {"ord": ord_, "extensionType": ext_type, "name": name}
    if cfg_raw:
        try: args["config"] = json.loads(cfg_raw)
        except json.JSONDecodeError as e: err(f"invalid JSON: {e}"); return
    r = state.client.tools_call("addExtension", args)
    state.last_response = r
    success, payload, error = extract_result(r)
    if not success: show_error(error); return
    ok("added"); show_payload(payload)


def cmd_remove(state):
    if not need_user_bearer(state): return
    ord_ = input("  ord to remove: ").strip()
    if not ord_: err("ord required"); return
    # dryRun first
    r = state.client.tools_call("removeComponent", {"ord": ord_})
    state.last_response = r
    success, payload, error = extract_result(r)
    if not success: show_error(error); return
    info(f"dryRun preview: {json.dumps(payload, ensure_ascii=False)}")
    if input("  confirm actual removal? [y/N]: ").strip().lower() != "y":
        info("aborted"); return
    r = state.client.tools_call("removeComponent",
                                {"ord": ord_, "dryRun": False})
    state.last_response = r
    success, payload, error = extract_result(r)
    if not success: show_error(error); return
    ok(f"removed: {payload}")


def cmd_commit(state):
    if not need_user_bearer(state): return
    r = state.client.tools_call("commitStation", {})
    state.last_response = r
    success, payload, error = extract_result(r)
    if not success: show_error(error); return
    ok("saved"); show_payload(payload)


def cmd_bql(state):
    q = input("  BQL: ").strip()
    if not q: err("query required"); return
    lim = input("  limit [50]: ").strip() or "50"
    r = state.client.tools_call("bqlQuery", {"query": q, "limit": int(lim)})
    state.last_response = r
    success, payload, error = extract_result(r)
    if not success: show_error(error); return
    show_payload(payload)


def cmd_bootstrap(state):
    """Mint user-Bearer via setupTestUser and switch session to it."""
    state.switch_to_api_token()
    state.client.initialize()
    new_token = secrets.token_urlsafe(32)
    r = state.client.tools_call("setupTestUser",
                                {"username": state.smoke_user, "token": new_token})
    state.last_response = r
    success, payload, error = extract_result(r)
    if not success: show_error(error); return
    state.switch_to_user_bearer(new_token)
    state.client.initialize()
    ok(f"bound token to BUser '{state.smoke_user}'")
    info(f"new identity: user-Bearer ({state.smoke_user})")
    info(f"token (save it if you want reuse): {new_token}")


def cmd_lastresp(state):
    if state.last_response is None:
        info("no response yet"); return
    print(json.dumps(state.last_response, ensure_ascii=False, indent=2))


# ─── menu ─────────────────────────────────────────────────────────────────────
MENU = """
{bold}=== niagaramcp console ==={reset}  cwd: {cyan}{cwd}{reset}  id: {ident}

  i   Server info / status
  ls  List children of cwd
  cd  Change cwd
  --- writes (need user-Bearer, mint via [b]) ---
  mf  Make folder under cwd
  mp  Make point under cwd
  sv  Set value on writable point
  ax  Add extension
  rm  Remove component (dryRun + confirm)
  cm  Commit station
  --- introspection ---
  rv  Read point value
  in  Inspect component
  bq  BQL query
  --- session ---
  b   Bootstrap user-Bearer via setupTestUser
  r   Show last raw response
  q   Quit
"""

COMMANDS = {
    "i":  cmd_info,    "ls": cmd_ls,        "cd": cmd_cd,
    "mf": cmd_mkfolder,"mp": cmd_mkpoint,   "sv": cmd_setval,
    "ax": cmd_addext,  "rm": cmd_remove,    "cm": cmd_commit,
    "rv": cmd_readval, "in": cmd_inspect,   "bq": cmd_bql,
    "b":  cmd_bootstrap,"r":  cmd_lastresp,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--scheme", default="http", choices=["http", "https"])
    ap.add_argument("--module", default="niagaramcp")
    ap.add_argument("--token", required=True, help="apiToken from BMcpPlatformService")
    ap.add_argument("--insecure", action="store_true")
    ap.add_argument("--smoke-user", default="mcpSmokeUser")
    ap.add_argument("--smoke-parent", default="station:|slot:/Drivers")
    a = ap.parse_args()

    base = f"{a.scheme}://{a.host}:{a.port}/{a.module}"
    client = McpClient(base, a.token, insecure=a.insecure)

    print(f"{BOLD}niagaramcp interactive console{RESET}")
    print(f"  base:   {base}")
    print(f"  user:   {a.smoke_user}")
    print(f"  parent: {a.smoke_parent}")

    state = State(client, a.smoke_user, a.smoke_parent)

    r = client.initialize()
    state.last_response = r
    if "_http_status" in r:
        err(f"initialize failed: HTTP {r['_http_status']} — {r.get('_raw')}")
        sys.exit(1)
    info(f"connected. session = {client.session_id}")

    while True:
        ident = (f"{GREEN}user-Bearer ({state.smoke_user}){RESET}"
                 if state.using_user_bearer
                 else f"{YELLOW}apiToken (read-only){RESET}")
        print(MENU.format(bold=BOLD, reset=RESET, cyan=CYAN,
                          cwd=state.cwd, ident=ident))
        choice = input("> ").strip().lower()
        if choice == "q":
            try: client.delete()
            except Exception: pass
            print("bye"); break
        cmd = COMMANDS.get(choice)
        if cmd is None:
            err(f"unknown: {choice!r}"); continue
        try:
            cmd(state)
        except KeyboardInterrupt:
            info("(interrupted)")
        except Exception as e:
            err(f"command failed: {e}")


if __name__ == "__main__":
    main()