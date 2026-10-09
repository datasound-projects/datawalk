"""A DataWalk Hub for browser tests: hub_serve.py PORT. Users ana@example.org (owner of the
demo report) and ben@example.org (viewer), password "<name>-password-123"."""

import runpy
import sys
import tempfile
from pathlib import Path

import uvicorn
from datawalk_hub import auth
from datawalk_hub.app import create_app
from datawalk_hub.config import Config
from fastapi.testclient import TestClient

port = int(sys.argv[1])
base = f"http://127.0.0.1:{port}"
data = Path(tempfile.mkdtemp())
cfg = Config(
    data_dir=data,
    base_url=base,
    secret_key="e2e" * 11,
    encryption_key=b"k" * 32,
    secure_cookies=False,
)
app = create_app(cfg)
store = app.state.store
ana = auth.create_user(store, "ana@example.org", "Ana", "ana-password-123")
auth.create_user(store, "ben@example.org", "Ben", "ben-password-123")
examples = Path(__file__).resolve().parents[3] / "examples"
report = runpy.run_path(str(examples / "financial_research.py"))["report"]
path = report.save(data / "demo.dwk")
token = auth.new_api_token(store, ana, "e2e")
client = TestClient(app, base_url=base)
rid = client.post(
    "/api/publish", content=path.read_bytes(), headers={"Authorization": f"Bearer {token}"}
).json()["report_id"]
client.cookies.set("dw_session", auth.new_session(store, ana))
client.post(
    f"/reports/{rid}/share",
    data={"who": "ben@example.org", "role": "viewer"},
    headers={"Origin": base},
)
(data / "report-id").write_text(rid)
print(f"report {rid} at {base}/r/{rid}/", flush=True)
uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
