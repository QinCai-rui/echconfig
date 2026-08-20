import re
from urllib.parse import urlparse, parse_qs

from workers import Response, WorkerEntrypoint, fetch

RESOLVERS = [
    "https://cloudflare-dns.com/dns-query",
    "https://dns.google/resolve",
]

HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z0-9-]{1,63}$", re.I)

CACHE_TTL = 300


def normalize_b64(value: str) -> str:
    value = value.strip().rstrip("=")
    value = value.replace("-", "+").replace("_", "/")
    return value + "=" * (-len(value) % 4)


def extract_ech(payload: dict) -> str | None:
    for answer in payload.get("Answer", []) or []:
        if answer.get("type") == 65 and answer.get("data"):
            match = re.search(r"ech=([A-Za-z0-9+/=_-]+)", answer["data"])
            if match:
                return normalize_b64(match.group(1))
    return None


async def query_ech(host: str) -> str | None:
    for base in RESOLVERS:
        try:
            resp = await fetch(
                f"{base}?name={host}&type=HTTPS",
                headers={"accept": "application/dns-json"},
                cf={"cacheEverything": True, "cacheTtl": CACHE_TTL},
            )
            if not resp.ok:
                continue
            payload = await resp.json()
            if payload.get("Status") != 0:
                continue
            ech = extract_ech(payload)
            if ech:
                return ech
        except Exception:
            continue
    return None


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        url = urlparse(request.url)
        host = url.path.strip("/")
        if not host:
            qs = parse_qs(url.query)
            if qs.get("host"):
                host = qs["host"][0].strip().strip("/")

        if not host:
            return Response(
                "Usage: GET /<hostname>  or  GET /?host=<hostname>",
                status=400,
                headers={"content-type": "text/plain; charset=utf-8"},
            )

        if not HOST_RE.match(host):
            return Response(
                "Invalid hostname",
                status=400,
                headers={"content-type": "text/plain; charset=utf-8"},
            )

        ech = await query_ech(host)
        if not ech:
            return Response(
                f"No ECH config found for {host}",
                status=404,
                headers={"content-type": "text/plain; charset=utf-8"},
            )

        return Response(
            ech + "\n",
            headers={
                "content-type": "text/plain; charset=utf-8",
                "cache-control": f"public, max-age={CACHE_TTL}",
            },
        )
