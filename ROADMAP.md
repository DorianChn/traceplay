# traceplay — Roadmap

> 目标：两周内做到 M5，发布一个能冲 GitHub Trending 的 v0.1。
> 节奏假设：每天约 2 小时，周末可多投入。时间不同就整体平移，里程碑顺序不变。

## 定位（一句话）

**VCR + pytest for AI agents**：在 HTTP 边界录制一次真实的 LLM/工具轨迹，之后离线、零 token、确定性回放，并用 YAML 断言多步行为，直接进 CI。

差异化：skillkit/skilllint 只做技能 markdown 静态检查 + 子进程输出字符串匹配；Langfuse/Phoenix 是线上可观测平台。**我们做的是语言无关的多步轨迹离线回归测试**，正好打在两者的能力盲区。

---

## M0 — 骨架 + 离线 test（已完成 ✅，2026-09-01）

- [x] 冻结核心数据模型 `src/types.ts`（TraceEvent / Cassette / Assertion）
- [x] JSONL 录像读写 `src/cassette/store.ts`（首行 meta，之后每行一个事件）
- [x] 回放匹配基础 `src/replay/matcher.ts`（规范化 + sha256 + 精确匹配）
- [x] 断言引擎 `src/assert/engine.ts`（M0 实现 7 类，2 类标 todo）
- [x] 控制台报告 + 退出码 `src/report/console.ts`
- [x] CLI 路由 `src/cli.ts`（record 骨架可启动、test 可离线跑、replay/init 占位）
- [x] 示例录像 + 测试套件 `examples/demo/`
- [x] vitest 单元测试（store / engine / matcher）
- [x] GitHub Actions CI（build + test + dogfood 跑 example）
- [x] README + 本路线图

**验收**：`npm install && npm run build && npm test` 全绿，`node dist/cli.js test examples/demo/suite.example.yaml` 输出 PASS。

---

## M1 — 录制代理（Day 2–3，2026-09-02 ~ 09-03）

把 `src/recorder/proxy.ts` 从 501 骨架做成真代理：

- [ ] 请求体缓冲 + 头部脱敏（`Authorization`、`api-key` 落盘前替换为 `[REDACTED]`）
- [ ] 规范化 OpenAI 兼容 `/chat/completions` 请求 → `llm.request` 事件（含 `requestHash`）
- [ ] 用 `node:https` 转发到 upstream，流式透传响应回客户端，同时缓冲副本
- [ ] 响应结束 → `llm.response` 事件（status / usage / latencyMs）
- [ ] 启动时写 cassette header，每个事件 `appendEvent` 追加
- [ ] 用 `curl` 打一次假请求验证：生成合法 cassette，`traceplay test` 能读

**难点**：流式响应（SSE）的 usage 字段只在最后一个 chunk；非流式直接读 body。两种都要支持。

---

## M2 — 回放服务（Day 4–6，2026-09-04 ~ 09-06，含周末）

- [ ] `traceplay replay --cassette x.jsonl --port 8124` 启动本地服务
- [ ] 收到请求 → `matchRequest` 精确命中 → 返回录像里的 `llm.response.output`，状态码一致
- [ ] 未命中：返回 404 + 清晰错误（"no cassette match for hash …, re-run with `traceplay record`"），**绝不猜测**
- [ ] 支持 Anthropic `/v1/messages` 格式归一化（在 recorder 侧统一，replay 只认规范化事件）
- [ ] 端到端验证：用 M1 录一次真实 agent，断网后 replay 跑通，输出与录像一致

---

## M3 — 断言补全 + 报告（第二周前半，2026-09-07 ~ 09-09）

- [ ] `tool.args`：JSONPath 匹配工具参数（用 `jsonpath` 或自写简易 `$.a.b`）
- [ ] `answer.judge`：LLM 判定 rubric，**判定结果按 (cassetteHash, rubricHash) 缓存到本地**，保证测试稳定不烧钱
- [ ] JSON reporter（`--format json`）
- [ ] Markdown reporter（`--format md`），可直接贴 PR 评论
- [ ] 9 类断言全覆盖，文档化到 README 表格

---

## M4 — CI 化 + 脚手架（第二周中，2026-09-10 ~ 09-11）

- [ ] 发布 GitHub Action：`uses: <handle>/traceplay@v0.1`，输入 `suite`、`cassettes-dir`，输出 summary
- [ ] `traceplay init [dir]`：生成示例 suite + 空 cassettes 目录 + `.gitignore` 片段
- [ ] **dogfood**：本仓库 CI 里用自己测 `examples/demo`（已在 ci.yml 里，确认稳定）
- [ ] 写一篇 5 分钟上手教程（docs/quickstart.md）

---

## M5 — 借风口发布（第二周末，2026-09-12 ~ 09-13）

- [ ] **Agent Skills 适配**：把一个 `SKILL.md` 放进最小 mock agent（本地起一个假 LLM 端点），跑出 trace → 用同一套断言测试技能。这是蹭 Skills 风口的关键场景，也是对 skillkit 的正面差异化
- [ ] 录 30 秒终端 GIF（`vhs` 或 `asciinema`），放 README 顶部
- [ ] 对比页：与 skillkit / Langfuse 的差异表（README 已有，发布前再打磨）
- [ ] 占坑确认：npm 包名、GitHub 仓库名、Twitter/X handle
- [ ] 发布 `npm publish`，打 tag `v0.1.0`

### 冷启动发布清单（按顺序）

1. **Show HN**（标题："Show HN: traceplay – VCR + pytest for AI agents, offline replay"）
2. **Reddit**：r/LocalLLaMA、r/ClaudeAI、r/MachineLearning（各一篇，文案微调）
3. **X/Twitter**：配 30s GIF，@ 相关项目作者（Langfuse、skillkit 维护者）
4. **中文**：掘金、V2EX、少数派（一篇长文，讲"为什么 agent 需要回归测试"）
5. **Product Hunt**（提前一周预约，发布当天置顶）
6. **借力**：给 `awesome-claude-code`、agent-skills 类 awesome 清单提 PR；去 mattpocock/skills、superpowers 等高星技能仓提 issue："发布前可用 traceplay 做技能回归测试"
7. **蹭 trending**：发布当周保持每天一个小 commit + release note，GitHub Trending 看的是近期活跃度

---

## 成功指标（M5 后两周内看）

- GitHub stars：首周 500+，一个月 2k+（参考同类工具首月曲线）
- npm 周下载：首周 1k+
- 外部仓库接入：至少 3 个高星 agent/skills 项目在 README 或 CI 里引用
- Issue 质量：出现"支持 XX 框架/XX provider"类需求 = 定位被认可

---

## 风险与对策

| 风险 | 对策 |
|---|---|
| skillkit 也加了轨迹测试 | 我们的壁垒是"HTTP 边界录制 + 语言无关 + 离线确定性回放"，skillkit 走子进程路线很难快速追上；持续强化 replay 体验 |
| 录制代理对非 OpenAI 格式支持不全 | M1 只做 OpenAI 兼容（覆盖 80% 场景），Anthropic 放 M2；其他 provider 靠社区 adapter |
| answer.judge 不稳定 | 强制缓存判定结果，测试只看缓存；无缓存时默认 todo 而非 fail |
| 名字被抢 | 明天第一件事 `npm view <name>` 核验 + 立刻发占位包 |
