const RESOLVERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
];

const CACHE_TTL = 300;

const HOST_RE = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z0-9-]{1,63}$/i;

function normalizeB64(value) {
  value = value.trim().replace(/=+$/, "");
  value = value.replace(/-/g, "+").replace(/_/g, "/");
  return value + "=".repeat((4 - (value.length % 4)) % 4);
}

function extractEch(payload) {
  for (const answer of payload.Answer || []) {
    if (answer.type === 65 && answer.data) {
      const match = answer.data.match(/ech=([A-Za-z0-9+/=_-]+)/);
      if (match) return normalizeB64(match[1]);
    }
  }
  return null;
}

async function queryEch(host) {
  for (const base of RESOLVERS) {
    try {
      const resp = await fetch(
        `${base}?name=${encodeURIComponent(host)}&type=HTTPS`,
        {
          headers: { accept: "application/dns-json" },
          cf: { cacheEverything: true, cacheTtl: CACHE_TTL },
        },
      );
      if (!resp.ok) continue;
      const payload = await resp.json();
      if (payload.Status !== 0) continue;
      const ech = extractEch(payload);
      if (ech) return ech;
    } catch (e) {
      continue;
    }
  }
  return null;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    let host = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!host) {
      const q = url.searchParams.get("host");
      if (q) host = q.trim();
    }

    if (!host) {
      return new Response(
        "Usage: GET /<hostname>  or  GET /?host=<hostname>",
        { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }

    if (!HOST_RE.test(host)) {
      return new Response("Invalid hostname", {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const ech = await queryEch(host);
    if (!ech) {
      return new Response(`No ECH config found for ${host}`, {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response(ech + "\n", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": `public, max-age=${CACHE_TTL}`,
      },
    });
  },
};
