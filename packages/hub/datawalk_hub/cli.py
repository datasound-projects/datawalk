"""datawalk-hub serve | create-user | token"""

from __future__ import annotations

import argparse
import getpass
import sys

from .config import Config


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(
        prog="datawalk-hub", description="Self-hosted sharing for DataWalk reports"
    )
    sub = p.add_subparsers(dest="command", required=True)
    s = sub.add_parser("serve", help="run the hub (put HTTPS in front of it)")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8800)
    u = sub.add_parser("create-user", help="add a local account")
    u.add_argument("email")
    u.add_argument("--name", default="")
    u.add_argument("--admin", action="store_true")
    u.add_argument("--sso-only", action="store_true", help="no password: sign-in through SSO only")
    t = sub.add_parser("token", help="create an API token for `datawalk publish`")
    t.add_argument("email")
    t.add_argument("--name", default="publish")
    args = p.parse_args(argv)

    cfg = Config.from_env()
    for note in cfg.notes:
        print(f"note: {note}", file=sys.stderr)
    if args.command == "serve":
        import uvicorn

        from .app import create_app

        uvicorn.run(
            create_app(cfg),
            host=args.host,
            port=args.port,
            proxy_headers=True,
            forwarded_allow_ips="*",
        )
        return
    from . import auth
    from .store import Store

    store = Store(cfg.data_dir, cfg.encryption_key)
    if args.command == "create-user":
        password = None if args.sso_only else getpass.getpass("Password (12+ characters): ")
        uid = auth.create_user(store, args.email, args.name, password, args.admin)
        store.audit("user.created", None, via="cli", new_user=uid)
        print(f"Created user {args.email}")
    elif args.command == "token":
        row = store.one("SELECT id FROM users WHERE email = ?", args.email.lower())
        if row is None:
            sys.exit(f"No user {args.email}")
        print(auth.new_api_token(store, row["id"], args.name))
