import os, base64, json, urllib.request, urllib.error

TOKEN = os.environ.get("GH_TOKEN")
if not TOKEN:
    raise SystemExit("GH_TOKEN not set")

OWNER = "YY97"
REPO = "wagas-ai-data-query"
BRANCH = "main"
API = f"https://api.github.com/repos/{OWNER}/{REPO}/contents"

STAGE = os.path.dirname(os.path.abspath(__file__))

# (local_path_relative_to_stage, repo_path)
FILES = [
    ("README.md", "README.md"),
    ("store-network/index.html", "store-network/index.html"),
    ("store-network/gen_coverage_v2.py", "store-network/gen_coverage_v2.py"),
    ("store-network/README.md", "store-network/README.md"),
    ("store-network/delivery_points_compact.json", "store-network/delivery_points_compact.json"),
]

def api_request(method, url, data=None):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "workbuddy-publish")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.getcode(), json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return e.code, json.loads(body) if body else {}

def get_sha(path):
    code, data = api_request("GET", f"{API}/{path}")
    if code == 200 and isinstance(data, dict):
        return data.get("sha")
    return None

for local_rel, repo_path in FILES:
    local_path = os.path.join(STAGE, local_rel)
    with open(local_path, "rb") as f:
        content_b64 = base64.b64encode(f.read()).decode("ascii")

    payload = {
        "message": f"Add {repo_path} (store network efficiency map)",
        "content": content_b64,
        "branch": BRANCH,
    }
    sha = get_sha(repo_path)
    if sha:
        payload["sha"] = sha
        print(f"[UPDATE] {repo_path}")
    else:
        print(f"[CREATE] {repo_path}")

    code, resp = api_request("PUT", f"{API}/{repo_path}", json.dumps(payload).encode("utf-8"))
    if 200 <= code <= 201:
        print(f"  OK  -> {resp.get('content', {}).get('html_url', '')}")
    else:
        print(f"  FAIL ({code}): {resp.get('message', '')}")
        if isinstance(resp, dict) and "errors" in resp:
            print("   ", resp["errors"])

print("\nDone.")
