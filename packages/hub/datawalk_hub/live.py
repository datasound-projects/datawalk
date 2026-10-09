"""Live follow: the presenter's tour position and camera travel to every attendee's browser,
which renders the room itself at full quality. Never video. Attendees can break away and
snap back; the presenter sees who follows."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket


@dataclass
class Member:
    ws: WebSocket
    user_id: int
    name: str
    following: bool = True


@dataclass
class Session:
    presenter: Member | None = None
    attendees: list[Member] = field(default_factory=list)
    state: dict[str, Any] | None = None  # last presenter state: tour stop or camera pose


class Live:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}
        self.lock = asyncio.Lock()

    def session(self, report_id: str) -> Session:
        return self.sessions.setdefault(report_id, Session())

    async def _send(self, m: Member, message: dict[str, Any]) -> None:
        try:
            await m.ws.send_json(message)
        except Exception:  # the socket closed; the receive loop removes the member
            pass

    async def followers(self, s: Session) -> None:
        if s.presenter:
            await self._send(
                s.presenter,
                {
                    "type": "followers",
                    "list": [{"name": a.name, "following": a.following} for a in s.attendees],
                },
            )

    async def join(self, report_id: str, member: Member, presenter: bool) -> Session:
        async with self.lock:
            s = self.session(report_id)
            if presenter:
                if s.presenter is not None:
                    await self._send(s.presenter, {"type": "replaced", "by": member.name})
                s.presenter = member
            else:
                s.attendees.append(member)
        if presenter:
            for a in s.attendees:
                await self._send(a, {"type": "presenter", "name": member.name, "state": s.state})
        else:
            await self._send(
                member,
                {
                    "type": "presenter",
                    "name": s.presenter.name if s.presenter else None,
                    "state": s.state,
                },
            )
        await self.followers(s)
        return s

    async def leave(self, report_id: str, member: Member) -> None:
        async with self.lock:
            s = self.session(report_id)
            if s.presenter is member:
                s.presenter, s.state = None, None
                ended = True
            else:
                s.attendees = [a for a in s.attendees if a is not member]
                ended = False
        if ended:
            for a in s.attendees:
                await self._send(a, {"type": "presenter", "name": None, "state": None})
        await self.followers(s)

    async def message(self, report_id: str, member: Member, data: dict[str, Any]) -> None:
        s = self.session(report_id)
        if data.get("type") == "state" and s.presenter is member:
            state = data.get("state")
            if not isinstance(state, dict) or len(str(state)) > 2000:
                return
            s.state = state
            for a in list(s.attendees):
                await self._send(a, {"type": "state", "state": state})
        elif data.get("type") == "follow" and member in s.attendees:
            member.following = bool(data.get("following"))
            await self.followers(s)
