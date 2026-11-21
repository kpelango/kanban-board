"""Admin commands. Hosted databases have no default accounts, so the first admin is made here:

    DATABASE_URL=<url> uv run python -m app.manage create-admin <username>
"""

import argparse
import getpass
from pathlib import Path

from dotenv import load_dotenv
from pydantic import ValidationError

from app import db
from app.schemas import RegisterRequest


def create_admin(username: str, password: str) -> str:
    """Creates an admin account, or promotes the existing account with that name."""
    existing = db.get_user(username)
    if existing is not None:
        db.set_admin(existing.id, True)
        return f"{username} already exists and is now an admin"
    RegisterRequest(username=username, password=password)  # same rules as sign-up
    if db.create_user(username, password, is_admin=True) is None:
        raise SystemExit(f"{username} is taken (usernames ignore case)")
    return f"Created admin {username}"


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[2]
    load_dotenv(root / ".env")
    parser = argparse.ArgumentParser(prog="python -m app.manage")
    commands = parser.add_subparsers(dest="command", required=True)
    admin = commands.add_parser("create-admin", help="create or promote an admin account")
    admin.add_argument("username")
    admin.add_argument("--password", help="prompted for when omitted")
    args = parser.parse_args(argv)

    password = args.password
    if password is None and db.get_user(args.username) is None:
        password = getpass.getpass("Password: ")
        if getpass.getpass("Repeat password: ") != password:
            print("Passwords do not match")
            return 1
    try:
        print(create_admin(args.username, password or ""))
    except ValidationError as exc:
        print(exc.errors()[0]["msg"])
        return 1
    finally:
        db.close_pool()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
