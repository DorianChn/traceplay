import type { AssertResult, TestReport, TimelineItem } from '../types.js';
import { VERSION } from '../version.js';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TYPE_CHIP: Record<string, string> = {
  'user.message': 'user',
  'llm.request': 'req',
  'llm.response': 'resp',
  'tool.call': 'tool',
  'tool.result': 'tool',
  'agent.error': 'err',
};

function timelineItemHtml(item: TimelineItem): string {
  const chip = TYPE_CHIP[item.type] ?? 'evt';
  const meta: string[] = [];
  if (typeof item.turn === 'number') meta.push(`turn ${item.turn + 1}`);
  if (typeof item.status === 'number') meta.push(`HTTP ${item.status}`);
  if (typeof item.tokens === 'number') meta.push(`${item.tokens} tok`);
  const errorClass = item.isError ? ' tl-err' : '';
  return `
      <li class="tl-item${errorClass}">
        <span class="tl-chip chip-${chip}">${esc(item.type)}</span>
        <span class="tl-label">${esc(item.label)}</span>${
          meta.length > 0 ? `<span class="tl-meta">${esc(meta.join(' · '))}</span>` : ''
        }
      </li>`;
}

function assertionHtml(result: AssertResult): string {
  return `
        <li class="as as-${result.status}">
          <span class="as-badge">${result.status.toUpperCase()}</span>
          <span class="as-kind">${esc(result.assertion.kind)}</span>
          <span class="as-msg">${esc(result.message)}</span>
        </li>`;
}

function caseHtml(report: TestReport['cases'][number]): string {
  const caseClass = report.passed ? 'case pass' : 'case fail';
  const badge = report.passed ? '<span class="case-badge ok">PASS</span>' : '<span class="case-badge bad">FAIL</span>';
  const timeline = report.timeline ?? [];
  return `
    <section class="${caseClass}">
      <header class="case-head">
        <h2>${esc(report.name)}</h2>${badge}
      </header>
      <div class="case-body">
        <div class="col-timeline">
          <h3>Trajectory</h3>
          <ul class="timeline">${timeline.map(timelineItemHtml).join('') || '<li class="tl-empty">no events</li>'}</ul>
        </div>
        <div class="col-assert">
          <h3>Assertions</h3>
          <ul class="asserts">${report.results.map(assertionHtml).join('')}</ul>
        </div>
      </div>
    </section>`;
}

/**
 * Self-contained HTML report (v0.7): one file, inline CSS, no external
 * requests — safe to attach to a PR or share as a static artifact.
 */
export function formatHtml(report: TestReport): string {
  const { pass, fail, todo } = report.summary;
  const total = pass + fail + todo;
  const rate = total > 0 ? Math.round((pass / total) * 100) : 0;
  const overall = fail > 0 ? 'FAIL' : 'PASS';
  const overallClass = fail > 0 ? 'summary bad' : 'summary good';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>traceplay · ${esc(report.suite)}</title>
<style>
  :root{
    --fg:#1f2328; --muted:#656d76; --line:#d0d7de; --bg:#f6f8fa; --card:#ffffff;
    --green:#1a7f37; --green-bg:#dafbe1; --red:#cf222e; --red-bg:#ffebe9;
    --blue:#0969da; --amber:#9a6700; --amber-bg:#fff8c5; --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg);line-height:1.5}
  .wrap{max-width:1080px;margin:0 auto;padding:32px 20px 64px}
  h1{font-size:24px;margin:0 0 4px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:20px}
  .summary{display:flex;gap:16px;align-items:center;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 22px;margin-bottom:24px}
  .verdict{font-size:20px;font-weight:700;padding:4px 14px;border-radius:999px}
  .summary.good .verdict{color:var(--green);background:var(--green-bg)}
  .summary.bad .verdict{color:var(--red);background:var(--red-bg)}
  .stat{font-size:14px}.stat b{font-size:18px}
  .stat.pass b{color:var(--green)}.stat.fail b{color:var(--red)}.stat.todo b{color:var(--amber)}
  .bar{flex-basis:100%;height:8px;border-radius:99px;background:var(--line);overflow:hidden}
  .bar > i{display:block;height:100%;background:var(--green)}
  .case{background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:18px;overflow:hidden}
  .case.fail{border-color:#ffc1c4}
  .case-head{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line);background:#fbfcfd}
  .case-head h2{font-size:16px;margin:0}
  .case-badge{font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;font-family:var(--mono)}
  .case-badge.ok{color:var(--green);background:var(--green-bg)}
  .case-badge.bad{color:var(--red);background:var(--red-bg)}
  .case-body{display:grid;grid-template-columns:1fr 1fr;gap:0}
  .col-timeline,.col-assert{padding:14px 20px}
  .col-timeline{border-right:1px solid var(--line)}
  .case-body h3{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 10px}
  .timeline,.asserts{list-style:none;margin:0;padding:0}
  .tl-item{position:relative;padding:6px 0 6px 0;border-bottom:1px dashed #eaeef2;font-size:13px}
  .tl-item:last-child{border-bottom:none}
  .tl-chip{display:inline-block;font-family:var(--mono);font-size:10px;padding:1px 6px;border-radius:4px;margin-right:8px;background:#eaeef2;color:var(--muted)}
  .chip-user{background:#ddf4ff;color:var(--blue)}
  .chip-req{background:#f6f8fa;color:var(--muted)}
  .chip-resp{background:var(--green-bg);color:var(--green)}
  .chip-tool{background:var(--amber-bg);color:var(--amber)}
  .chip-err,.tl-err .tl-chip{background:var(--red-bg);color:var(--red)}
  .tl-label{word-break:break-word}
  .tl-meta{display:block;margin-left:46px;color:var(--muted);font-size:11px;font-family:var(--mono)}
  .tl-empty,.tl-err{color:var(--muted);font-size:13px}
  .as{display:flex;gap:10px;align-items:baseline;padding:7px 0;border-bottom:1px dashed #eaeef2;font-size:13px}
  .as:last-child{border-bottom:none}
  .as-badge{font-family:var(--mono);font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;flex:0 0 auto}
  .as-pass .as-badge{color:var(--green);background:var(--green-bg)}
  .as-fail .as-badge{color:var(--red);background:var(--red-bg)}
  .as-todo .as-badge{color:var(--amber);background:var(--amber-bg)}
  .as-kind{font-family:var(--mono);font-size:11px;color:var(--blue);flex:0 0 auto}
  .as-msg{color:var(--fg);word-break:break-word}
  .as-fail .as-msg{color:var(--red)}
  footer{color:var(--muted);font-size:12px;text-align:center;margin-top:28px}
  @media (max-width:760px){.case-body{grid-template-columns:1fr}.col-timeline{border-right:none;border-bottom:1px solid var(--line)}}
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(report.suite)}</h1>
  <div class="sub">traceplay v${esc(VERSION)} · generated ${esc(report.generatedAt)}</div>
  <div class="${overallClass}">
    <span class="verdict">${overall}</span>
    <span class="stat pass"><b>${pass}</b> passed</span>
    <span class="stat fail"><b>${fail}</b> failed</span>
    <span class="stat todo"><b>${todo}</b> scaffolded</span>
    <span class="stat">${rate}% of ${total}</span>
    <span class="bar"><i style="width:${rate}%"></i></span>
  </div>
  ${report.cases.map(caseHtml).join('\n')}
  <footer>Replay agents offline · assert the whole trajectory · generated by traceplay</footer>
</div>
</body>
</html>
`;
}
