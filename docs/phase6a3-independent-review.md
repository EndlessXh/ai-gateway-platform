# Phase 6A.3 — Independent Code Review and Merge Readiness

## 结论

本轮独立审查覆盖 `product/main` 的 `5e4010f31efe595289f705c82060ae356af10cd2`
至 Phase 6A.2 候选 `259103a0287989292c87ca21699253b5c1239960` 的完整差异，并逐个阅读：

- `5dd2f6f7 feat(providers): integrate openrouter upstream`
- `640a065b chore(providers): prepare openrouter release readiness`
- `259103a0 fix(providers): complete claude code gateway compatibility`

审查发现 1 个 P0、6 个 P1、4 个 P2，没有 P3。P0/P1 均已在
`feature/phase6a3-review-fixes` 以失败回归测试和最小修改修复；当前开放 P0/P1 为 0。
在全部质量门槛通过、修复提交落盘且工作区干净的前提下，建议合并到
`product/main`。不建议生产发布，也未进入 Phase 6B。

## Findings

### P0（发现 1，开放 0）

#### P0-1 — 退款先赢后仍可结算同一计费会话（确定缺陷，已修复）

- 位置：`service/billing_session.go:41-45`；回归测试：
  `service/billing_session_lifecycle_test.go:79`、`:106`。
- 触发：失败/取消路径先调用 `Refund` 并把 `refunded` 置为 true，上游完成路径随后调用
  `Settle`。旧实现的 `Settle` 只检查 `settled`，不检查 `refunded`。
- 影响：同一预扣可能同时执行 refund 与 settle，属于确定的错误计费竞态。
- 原测试缺口：名为 retry/refund 的测试均为顺序重复调用，没有 refund-vs-settle 的相反终态
  或真实并发调度。
- 修复：`Settle` 在 `refunded` 后幂等返回；增加退款先赢的确定性用例和 64 轮同时启动的
  并发终态用例。修复前用例观测到 `settleCalls=1`，修复后每轮恰有一个终态。

### P1（发现 6，开放 0）

#### P1-1 — OpenRouter 错误日志向普通用户泄露渠道与原始上游信息（确定缺陷，已修复）

- 位置：`controller/relay.go:373-420`、`model/log.go:116-143`；回归测试：
  `controller/openrouter_error_log_test.go`、`model/log_format_test.go`。
- 触发：OpenRouter 请求失败且错误日志开启，普通用户读取自己的日志。
- 影响：旧实现把 `channel_id/name/type` 写入 `Other` 顶层，并把原始上游错误写入
  `Content`；用户格式化只移除了结构体字段和 `admin_info`，会泄露渠道拓扑、Provider
  文本或真实 slug。
- 原测试缺口：仅覆盖成功消费日志和结构体渠道字段，没有经过 Relay 的 OpenRouter 失败日志。
- 修复：渠道字段与原始错误仅放入 `admin_info`；普通 `Content` 使用稳定公共错误；用户日志
  同时清理旧记录中的顶层渠道键。管理员诊断仍保留。

#### P1-2 — assistant 文本与 tool_use 同块时文本丢失（确定缺陷，已修复）

- 位置：`service/relayconvert/internal/claude_messages/to_oai_chat_req.go:183-261`。
- 触发：Claude assistant history 同时包含 text 和一个或多个 tool_use block。
- 影响：旧实现仅在没有 tool calls 时写入 content，导致模型历史语义被静默截断。
- 原测试缺口：fixture 中 assistant 只有 tool_use，没有混合文本。
- 修复：OpenAI-compatible message 同时保留 content 与 tool_calls，并验证 tool call ID 不变。

#### P1-3 — signed/encrypted reasoning_details 在 Claude 往返中丢失（确定缺陷，已修复）

- 位置：`dto/claude.go:18-39`、
  `service/relayconvert/internal/claude_messages/to_oai_chat_req.go:27-34,183-261`、
  `service/relayconvert/internal/oai_chat/to_claude_messages_resp.go:127-188,540-586`。
- 触发：Claude 多轮 history 含 `thinking`/`redacted_thinking`，或 OpenRouter buffered/SSE
  返回 `reasoning_details`。
- 影响：旧请求转换忽略这些 block；旧 buffered 转换把数组折叠为一个 thinking block 并丢弃
  encrypted data；旧 SSE 仅读取 legacy reasoning string，签名不能返回 Claude Code。
- 原测试缺口：只验证 thinking 配置和单个 text detail，没有 continuation、encrypted 或 SSE。
- 修复：按序映射 `reasoning.text`、`reasoning.summary`、`reasoning.encrypted`，保留 Claude
  可表达的 text/signature/data；SSE 输出合法 thinking/signature/redacted block 事件；reasoning-only
  assistant message 不再被丢弃。
- 依据：[OpenRouter Reasoning Tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.md)
  明确要求在多轮中保留完整 `reasoning_details` 序列，并定义三类 detail 及流式字段位置。

#### P1-4 — Responses SSE error 被丢字段并作为成功返回（确定缺陷，已修复）

- 位置：`relay/channel/openai/relay_responses.go:83-211`；回归测试：
  `relay/channel/openai/openrouter_security_test.go`。
- 触发：OpenRouter `/v1/responses` SSE 返回 `{type:"error", error:{...}}`。
- 影响：旧代码反序列化到不含 error 的 DTO 后重新序列化，只可能输出 `{type:"error"}`，并继续
  生成零 usage 成功结果，影响错误语义、退款和日志。
- 原测试缺口：Responses SSE 仅覆盖 completed event 的 model/id 重写。
- 修复：在任何输出前识别错误 envelope，发出不含 Provider 私有信息的标准 error event，返回带
  原状态码的 `NewAPIError` 并跳过成功 usage。

#### P1-5 — SOURCE_CODE_URL 门禁接受无效 https 形式（确定缺陷，已修复）

- 位置：`setting/platform/compliance.go:76-105`、`scripts/preflight-release.ps1:63-78`。
- 触发：`SOURCE_CODE_URL=https://`、userinfo 伪装或编码非法 host。
- 影响：旧门禁仅检查字符串前缀，可错误放行并不存在的 AGPL source offer。
- 原测试缺口：只测空值、placeholder、http 和正常 https。
- 修复：Go 与 PowerShell 均要求可解析的 absolute HTTPS URL、非空 host、无嵌入凭据；脚本级
  strict preflight 已证明 `https://` fail closed。没有填写 SOURCE_CODE_URL。

#### P1-6 — launcher 中断可遗留携带 Token 的子进程，且子进程回显未二次脱敏（确定风险，已修复）

- 位置：`scripts/run-claude-code-hyc.ps1:115-148`。
- 触发：`WaitForExit` 期间 Ctrl+C/异常，或 Claude 子进程意外把 token 写入 stdout/stderr。
- 影响：旧 finally 只 Dispose handle，不终止仍运行的进程树；子进程环境中的 HYC token 可继续
  存活，输出也会原样透传。
- 原测试缺口：只覆盖正常退出和 timeout kill，没有自动化 Ctrl+C 注入。
- 修复：finally 对已启动且未退出的进程执行 tree kill/wait；输出在写终端前替换精确 token。
  PowerShell 解析、官方 native Claude loopback smoke 和 token 隐藏均通过；timeout 与 finally
  分支均由代码审查确认调用 `Kill(true)`。

### P2（4）

1. `service/relayconvert/internal/claude_messages/testdata/claude-code-request.json` 是有代表性的
   协议回归 fixture，但不是 Claude Code 2.1.220 实录的完整结构（实录为多个 system block、约
   26 个 tools、metadata/context_management）。真实最小客户端链路证据弥补了核心结论，但
   fixture 真实性仍应在后续单独增强。
2. release preflight 要求 `PRICING_STATUS=approved`，而订阅 purchase/renewal 代码要求
   `published`，且 prod Compose 没有把该变量传给应用。当前均 fail closed，不会误售；正式
   商业发布前需统一状态契约。本轮按约束未改价格或 Wallet/Subscription 产品逻辑。
3. Windows Go 工具链当前 `CGO_ENABLED=0`，`go test -race` 明确拒绝运行；普通真实并发回归已
   通过，但 CI 仍应在支持 race detector 的 runner 上执行该用例。
4. 所谓完整 mock Playwright 仍包含对已运行 `127.0.0.1:3001` 产品后端的硬依赖，且启动前
   不会给出前置条件诊断；本轮首次运行因此产生 11 个连锁失败。启动 host backend 后，按规则
   `--last-failed --workers=1` 的 11 项全部通过。建议后续显式化该前置条件。

### P3（0）

未发现需要单列的 P3。

## Claude Code 500 修复审查

根因修复范围正确：`relay/helper/valid_request.go` 只对 OpenRouter 渠道、Claude Messages 格式
放行顶层 Anthropic `metadata`，而 Chat/Responses 的同名字段继续拒绝；随后 Claude→OpenAI
转换层不转发 `metadata` 与 `context_management`。普通 Anthropic 和其他 OpenAI-compatible
渠道不会经过该 OpenRouter guard。禁止字段使用大小写不敏感的顶层键比较，禁止 header 使用
Go canonical header lookup，未发现大小写、重复值、逗号合并、嵌套或别名可把用户路由控制送至
OpenRouter 的确定绕过。

`context_management` 当前不属于 OpenRouter Chat Completions 出站 schema，因此在特定协议转换
层丢弃是正确的 fail-closed 行为；它没有在全局请求对象上做破坏性 mutation。未来上游若正式
支持对应语义，应以显式字段映射和测试扩展，而不是原样透传。

## Header 与认证审查

客户端 `Authorization`/`x-api-key` 用于 HYC 认证，不被请求 header passthrough 复制；OpenRouter
Authorization 由服务器渠道生成。OpenRouter 出站最终再移除 `x-openrouter-*` metadata/session、
HTTP-Referer、X-Title 等路由 header。Cookie、hop-by-hop、Host、Content-Length、Accept-Encoding
及未知 header 不会盲目透传。Claude beta/version 可在 HYC 入站正常工作，但不会无条件污染
OpenRouter 出站。响应普通与 SSE 路径共用上游 header 过滤，未发现凭据或 CRLF 绕过。

## 协议转换审查

- system 字符串/blocks、text/image、tool_use/tool_result、tool choice、stop sequences、max tokens、
  stream 和 cache_control 的已实现映射与测试一致。
- tool call ID 原样保留；多工具通过独立 index/ID 关联，空内容不会 panic。
- 本轮补齐混合 assistant content 和 reasoning detail 序列。
- SSE block 状态机在 text/thinking/tools 转换时先 stop 再 advance；上游中途错误使用合法 Claude
  error event，Responses error 也不再走成功结算。
- usage 中 Claude cache read/write 拆分与 OpenAI cache-write 字段没有发现重复计费；reasoning
  只进入输出文本统计一次。

## OpenRouter 隐私、路由与信息隐藏审查

Chat、Messages-via-Chat 和 Responses 均强制：

```json
{"provider":{"data_collection":"deny","zdr":true,"require_parameters":true}}
```

没有 `provider.order`。用户 provider/route/models/fallbacks/plugins/transforms/debug/trace、OpenAI
metadata 和 OpenRouter metadata headers 均被拒绝，adapter 在最终出站层覆盖 provider policy。
真实 slug 不在 `/v1/models`、Chat/Messages/Responses buffered/SSE、普通用户日志或公共错误中返回；
公开 `response.model`/id 使用 HYC alias/request id。管理员信息保留于 admin-only 字段和服务器日志。

## 计费审查

成功、失败、retry、SSE 部分 usage、cache usage、tool surcharge、refund 与 settle 的调用链均阅读并
执行测试。`BillingSession` 的 mutex 保护 reserve/settle/refund；本轮修复 refund-winning race。
失败 Responses SSE 现在返回 API error，因此控制器走 refund 而不是零 usage settle。本地 smoke
验证 401/429/5xx 不扣费、timeout 不扣费、断流仅结算部分 usage。没有修改核心价格、Wallet 或
Subscription 产品逻辑；`PRICING_STATUS` 仍为 provisional。

## Relay stub 审查

stub 只接受 loopback listen 地址；smoke 使用 run-scoped 随机 loopback 端口和独立 SQLite，清理
前校验路径，并按精确 PID 停止进程。Provider key/proxy 被清空，验证 12 个请求全为 loopback，
没有访问 OpenRouter、旧上游或 new-api-infra。401、429/Retry-After、5xx、timeout、取消、中断与
部分 usage 均可重复，测试结束后临时数据库与 Session 已删除。

## Launcher 审查

launcher 不写 PowerShell Profile、永久环境变量、CC Switch 或 Claude 全局配置；只读取三项本地
env，拒绝 OpenRouter base URL 和错误公开 alias。它通过 global npm package 解析固定的官方
`node_modules/@anthropic-ai/claude-code/bin/claude.exe`，不执行 PATH 中任意 `claude` wrapper；
token 仅进入子进程环境，不进入参数、Git 或快照。timeout 与 finally 均终止完整进程树，正常
smoke 后全局环境不变。

## Release Gate 审查

空/空白/placeholder/非 HTTPS/不可解析/缺 host/userinfo SOURCE_CODE_URL 均 fail closed；prod
Compose 在空 source offer 时拒绝 config。当前没有 source URL，也没有虚假链接。Footer/About/
Legal 归属固定常量保留。`PRICING_STATUS=provisional` 继续阻止商业发布，开发验证不受影响。
仍需解决 P2 的 approved/published 契约差异后才能商业发布。

## 测试真实性与 reverse-failure

- metadata reverse-failure：临时把 Claude metadata 例外改为恒 false；
  `TestOpenRouterAllowsClaudeMessagesMetadataButStillRejectsSessionRouting` 按预期失败并报告
  `routing control field "metadata" is not allowed`。立即反向补丁恢复，测试重新通过，源文件无差异。
- model alias reverse-failure：临时把 Responses SSE `response.model` 改写为 upstream model；
  `TestOpenRouterResponsesStreamUsesPublicIdentity` 同时因公开 alias 缺失和真实 slug 出现而失败。
  立即反向补丁恢复，测试重新通过，源文件无差异。
- 新增回归在旧行为上分别暴露 settle-after-refund、URL fail-open、mixed content/reasoning 丢失、
  用户日志渠道键泄露和 Responses SSE error 缺陷。
- 没有 live-only 测试伪装成 pass；Playwright live cases 保持 skip。没有付费 OpenRouter 请求。

## 实际运行命令与结果

- `git diff --check product/main...HEAD`：通过（审查开始）。
- `pwsh -NoProfile -File ./scripts/lint-guard.ps1`：通过，447 violations，未高于基线。
- `bun run typecheck`（`web`）：通过。
- `bun run test`（`web`）：118 passed，0 failed。
- `bun run build`（`web`）：通过；`web/dist` 未提交。
- `go test ./...`：通过。
- `go build ./...`：通过。
- `go vet ./controller ./dto ./model ./relay/channel/openai ./service ./service/relayconvert/internal/claude_messages ./service/relayconvert/internal/oai_chat ./setting/platform`：通过。
- `go test -race ./service ...`：未执行成功，环境报告 `-race requires cgo`；见 P2-3。
- dev Compose config：通过。
- prod Compose config with template：在必需生产变量为空时 fail closed；补足前置 trusted URL 后明确
  在空 `SOURCE_CODE_URL` 处拒绝。未填入 fake source URL。
- strict preflight with temporary `SOURCE_CODE_URL=https://`：exit 1，AGPL-13 blocker；临时文件已删除。
- `pwsh -NoProfile -File ./scripts/dev-relay-smoke-local.ps1`：全部通过，12 个 loopback 上游请求，
  零 Provider 消费。
- 完整 Playwright 首轮：147 tests / 11 workers；因 3001 未启动，11 failed，124 passed，12 skipped。
  保留原始失败；启动 loopback host backend 后仅运行 `--last-failed --workers=1`，11 passed。
  后端与 4173 均已停止，测试改写的 27 个 tracked artifact 已恢复。
- Docker Compose app 启动尝试：因 Docker Desktop 无 registry HTTPS route 无法解析固定基础镜像；
  未创建 app 容器。随后使用仓库 host backend 完成失败项验证。

## 当前 Launch Blockers

1. 尚未发布并验证当前修改版真实 `SOURCE_CODE_URL` / AGPL source offer。
2. `PRICING_STATUS` 仍为 provisional，且 approved/published 状态契约需统一。
3. production secrets、DNS、TLS、nginx、trusted proxy、cookie origin 与 egress 尚未在目标服务器验证。
4. nginx verification stamp/CI 证据未在本机产生。
5. Docker Desktop 当前无法访问 registry；不影响本地 host smoke，但阻塞本机镜像重建验证。
6. Cursor 客户端本体仍未验证；这不否定 Claude Code 已验证结论。

## 合并与发布建议

- 合并 `product/main`：建议。条件是本审查修复提交存在、最终质量复核通过且工作区严格干净。
- 生产发布：不建议；上述 launch blockers 必须先关闭。
- Phase 6A 后续代码：没有剩余 P0/P1；P2 按后续独立任务处理。
- Phase 6B：本轮未进入，也不授权开始。

new-api-infra 存在审查开始前的独立变更；本轮未修改、未清理、未提交该目录。
