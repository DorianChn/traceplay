import http from 'node:http';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { readCassette } from '../cassette/store.js';

export interface UIOptions {
  port: number;
  cassettesDir: string;
}

export interface UIHandle {
  port: number;
  close(): Promise<void>;
}

const PAGE = [
  '<!doctype html>',
  '<html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>traceplay — cassette explorer</title>',
  '<style>',
  ':root{--bg:#fafbfc;--panel:#fff;--ink:#1c2733;--muted:#6b7684;--line:#e4e8ee;',
  '--req:#1f6feb;--res:#2da44e;--tool:#9a6700;--user:#8250df;--err:#cf222e;--ok:#1a7f37}',
  '*{box-sizing:border-box}body{margin:0;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}',
  'header{padding:16px 24px;background:var(--panel);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px}',
  'header h1{font-size:18px;margin:0}header .tag{font-size:12px;color:var(--muted)}',
  'main{display:grid;grid-template-columns:260px 1fr;gap:0;min-height:calc(100vh - 57px)}',
  '#list{border-right:1px solid var(--line);padding:12px;overflow:auto;background:var(--panel)}',
  '#list h3{font-size:12px;text-transform:uppercase;color:var(--muted);margin:4px 0 8px}',
  '.cass{display:block;width:100%;text-align:left;padding:8px 10px;border:1px solid var(--line);border-radius:6px;margin-bottom:6px;cursor:pointer;background:#fff}',
  '.cass:hover{border-color:#9ecbff}.cass.active{border-color:#1f6feb;background:#f0f7ff}',
  '.cass b{display:block;font-size:13px}.cass small{color:var(--muted);font-size:11px}',
  '#detail{padding:20px 24px;overflow:auto}',
  '.ev{border:1px solid var(--line);border-radius:8px;margin-bottom:10px;background:var(--panel);overflow:hidden}',
  '.ev-head{display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:13px;border-bottom:1px solid var(--line);cursor:pointer}',
  '.ev-head .seq{color:var(--muted);font-variant-numeric:tabular-nums}',
  '.badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;color:#fff}',
  '.b-user{background:var(--user)}.b-req{background:var(--req)}.b-res{background:var(--res)}.b-tool{background:var(--tool)}.b-err{background:var(--err)}',
  '.ev-head .sum{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.ev-body{display:none;padding:12px;background:#f6f8fa;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-all;margin:0}',
  '.ev.open .ev-body{display:block}',
  '.empty{padding:60px;text-align:center;color:var(--muted)}',
  '@media(max-width:720px){main{grid-template-columns:1fr}}',
  '</style></head><body>',
  '<header><h1>traceplay</h1><span class="tag">cassette explorer</span></header>',
  '<main>',
  '<div id="list"><h3>cassettes</h3></div>',
  '<div id="detail"><div class="empty">Select a cassette to inspect its trace timeline.</div></div>',
  '</main>',
  '<script>',
  'const $=s=>document.querySelector(s);',
  'async function loadList(){const r=await fetch("/api/cassettes");const list=await r.json();',
  'const box=$("#list");box.innerHTML="<h3>cassettes</h3>";',
  'for(const c of list){const b=document.createElement("button");b.className="cass";',
  'b.innerHTML=`<b>${escapeHtml(c.name)}</b><small>${c.eventCount} events · ${escapeHtml(c.project||"")}</small>`;',
  'b.onclick=()=>openCassette(c.name,b);box.appendChild(b);}}',
  'async function openCassette(name,btn){document.querySelectorAll(".cass").forEach(x=>x.classList.remove("active"));btn.classList.add("active");',
  'const r=await fetch(`/api/cassettes/${encodeURIComponent(name)}`);const c=await r.json();',
  'const d=$("#detail");d.innerHTML="";',
  'for(const e of c.events){const cls={["user.message"]:"b-user",["llm.request"]:"b-req",["llm.response"]:"b-res",["tool.call"]:"b-tool",["tool.result"]:"b-tool",["agent.error"]:"b-err"}[e.type]||"b-req";',
  'const sum=summary(e);const div=document.createElement("div");div.className="ev";',
  'div.innerHTML=`<div class="ev-head"><span class="seq">#${e.seq}</span><span class="badge ${cls}">${e.type}</span><span class="sum">${escapeHtml(sum)}</span></div><pre class="ev-body">${escapeHtml(JSON.stringify(e,null,2))}</pre>`;',
  'div.querySelector(".ev-head").onclick=()=>div.classList.toggle("open");d.appendChild(div);}}',
  'function summary(e){if(e.type==="user.message")return e.content;',
  'if(e.type==="llm.request")return `${e.provider} · ${e.model}${e.stream?" · stream":""}`;',
  'if(e.type==="llm.response"){const u=e.usage?` · ${u2(e.usage)} tok`:"";return `${e.status}${u}`;}',
  'if(e.type==="tool.call")return `${e.name}(${JSON.stringify(e.arguments??"")})`;',
  'if(e.type==="tool.result"){const o=typeof e.output==="string"?e.output:JSON.stringify(e.output);return o.slice(0,80);}',
  'if(e.type==="agent.error")return e.message;return "";}',
  'const u2=u=>(u.promptTokens??0)+(u.completionTokens??0);',
  'function escapeHtml(s){return String(s).replace(/[&<>"]/g,function(c){if(c==="&")return "&amp;";if(c==="<")return "&lt;";if(c===">")return "&gt;";return "&quot;";});}',
  'loadList();',
  '</script></body></html>',
].join('\n');

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
}

/**
 * Local web dashboard for browsing cassettes.
 *
 * Serves a single-page HTML explorer plus a tiny JSON API:
 *   GET /api/cassettes            -> [{ name, project, eventCount, recordedAt }]
 *   GET /api/cassettes/<name>     -> { name, meta, events }
 */
export async function startUI(options: UIOptions): Promise<UIHandle> {
  await fs.mkdir(options.cassettesDir, { recursive: true });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');

      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(PAGE);
        return;
      }

      if (url.pathname === '/api/cassettes') {
        const entries = await fs.readdir(options.cassettesDir, { withFileTypes: true });
        const names = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name);
        const summaries = [];
        for (const name of names) {
          try {
            const cassette = await readCassette(join(options.cassettesDir, name));
            summaries.push({
              name,
              project: cassette.meta.project ?? null,
              recordedAt: cassette.meta.recordedAt,
              eventCount: cassette.events.length,
            });
          } catch {
            // skip unreadable
          }
        }
        sendJson(res, 200, summaries);
        return;
      }

      const match = url.pathname.match(/^\/api\/cassettes\/(.+)$/);
      if (match) {
        const name = decodeURIComponent(match[1]);
        try {
          const cassette = await readCassette(join(options.cassettesDir, name));
          sendJson(res, 200, { name, meta: cassette.meta, events: cassette.events });
        } catch {
          sendJson(res, 404, { error: 'cassette not found' });
        }
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, () => {
      const actual = (server.address() as { port: number }).port;
      resolve({
        port: actual,
        close: () =>
          new Promise<void>((res2, rej) => {
            server.close((err) => (err ? rej(err) : res2()));
          }),
      });
    });
  });
}
