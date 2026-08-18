# Release Notes — dsh-doctor v1.0.0

**发布日期**：2026-08-18
**仓库**：https://github.com/jiel521125/dsh-doctor
**许可证**：随 DeepSeek Harness 发布

---

## 概述

`dsh-doctor` 是 DeepSeek Harness (DSH) 的环境诊断工具。它以单个零依赖的 `doctor-engine.js` 为核心，通过 **24 项检查** 覆盖 DSH 运行环境的 6 大维度，帮助开发者和运维人员快速定位安装包、配置、依赖和运行时问题。

- **零外部依赖**：仅使用 Node.js 内置模块（`fs`、`path`、`os`、`child_process`、`crypto`、`module`），内置极简 YAML 解析器
- **两种集成路径**：Path A（零构建，直接部署到安装包）/ Path B（原生子命令，改 TS 后重编）
- **跨平台**：Windows / macOS / Linux 均可运行
- **CI 友好**：`--json` 输出 + 语义化退出码（0/1/2）

---

## 诊断检查清单（24 项 / 6 大类）

### R — Runtime（运行时环境，5 项）

| 编号 | 检查项 | 说明 |
|------|--------|------|
| R1 | Node.js 版本 (>=22.19.0 或 24+) | 校验当前 Node 是否满足 DSH 最低版本要求 |
| R2 | pnpm 可用性 (corepack, ~11.7) | 检测 corepack/pnpm 是否可用及版本 |
| R3 | Git 版本 (>=2.26) | Git worktree hooks 需要最低版本 |
| R4 | DSH_HOME 可解析且可写 | 确认用户数据目录存在且有写权限 |
| R5 | TMP 目录可写 | 临时目录写入探针 |

### I — Installer（安装包完整性，4 项）

| 编号 | 检查项 | 说明 |
|------|--------|------|
| I1 | 捆绑 Node 二进制存在 | 检查 `node/node.exe` 是否存在及大小 |
| I2 | DSH CLI 入口存在 (lib/bin.js) | 检查 `app/lib/bin.js` 是否存在 |
| I3 | Electron shell 存在（可选） | 检查 `shell/main.js` + `electron/` 目录 |
| I4 | 启动器可执行文件存在（可选） | 检查 `DeepSeekHarness.exe` 是否存在 |

### P — Profile（配置文件完整性，6 项）

| 编号 | 检查项 | 说明 |
|------|--------|------|
| P1 | Profile 目录存在 | 检查 `$DSH_HOME/profiles/<name>/` 是否存在 |
| P2 | cordis.yml 解析为有效 YAML | 验证根配置文件的 YAML 语法及结构 |
| P3 | package.json + dsh.profile.bundles | 检查 profile 的 package.json 及 bundle 声明 |
| P4 | 每个 bundle 可解析 | 验证声明的 bundle 是否在 node_modules 中可找到 |
| P5 | cordis.patch.yml 解析为有效 YAML | 验证所有 patch 层文件的 YAML 语法 |
| P6 | Profile node_modules/ 存在 | 检查依赖是否已安装 |

### D — Dependencies（依赖健康，3 项）

| 编号 | 检查项 | 说明 |
|------|--------|------|
| D1 | 无重复 bundle 声明 | 检测 dsh.profile.bundles 中的重复项 |
| D2 | 无 tool-prepare 冲突 | 检测 @deepseek-ai/dsh-tools 的 prepare 冲突 |
| D3 | pnpm-workspace.yaml allowBuilds | 检查 git-sourced 插件的 prepare 构建权限 |

### S — Storage（存储健康，2 项）

| 编号 | 检查项 | 说明 |
|------|--------|------|
| S1 | storages 目录存在且可写 | 确认会话存储目录可用 |
| S2 | Session-log seq 无重叠/回退 | 检查日志序列号连续性 |

### M — Smoke Probes（冒烟探测，4 项）

| 编号 | 检查项 | 说明 |
|------|--------|------|
| M1 | Patch 栈合成为非空 row tree | 验证所有 patch 层叠加后是否产生有效的插件树 |
| M2 | Sandbox backend 可用 | 检测沙箱后端（Linux: bwrap; Windows: write-restricted-token） |
| M3 | Web 默认端口 3080 空闲 | 检查 3080 端口是否被占用 |
| M4 | DEEPSEEK_API_KEY 已配置（可选） | 检查 API key 环境变量 |

---

## 功能特性

### 核心能力

- **24 项检查**：覆盖运行时、安装包、配置、依赖、存储、冒烟探测全链路
- **极简 YAML 解析器**：内置实现，无需 `js-yaml` 等第三方依赖，支持 flow sequence `[]`、block sequence、block mapping、注释、引号字符串
- **自动修复**（`--fix`）：对常见问题自动修复（如创建缺失目录、运行 `pnpm install`），修复后重新扫描
- **JSON 输出**（`--json`）：输出结构化 JSON，适合 CI/CD 管道和仪表盘集成
- **语义化退出码**：

  | 退出码 | 含义 | CI 用法 |
  |--------|------|---------|
  | 0 | 全部 PASS | ✅ 放行 |
  | 1 | 有 FAIL | ❌ 阻断 |
  | 2 | 仅 WARN | ⚠️ 提醒 |
  | 97-99 | 引擎内部错误 | ❌ 部署异常 |

### 路径解析（零硬编码）

引擎通过以下顺序自动解析安装包根目录，**不依赖任何绝对路径**：

1. `DSH_INSTALLER_ROOT` 环境变量（用户显式指定）
2. 脚本自身位置上溯两级（`DeepSeekHarness/app/lib/` → `../../`）
3. 从脚本目录和 CWD 各上溯 10 层，寻找名为 `DeepSeekHarness` 且含 `app/package.json` 的目录
4. 脚本目录 / CWD 的兄弟 `DeepSeekHarness/` 目录
5. 未找到 → 优雅降级：Installer 类检查降级为 WARN，其余检查照常运行

### Path A — 零构建部署

无需修改 DSH 源码、无需 TypeScript 编译，直接将文件拷贝到安装包：

```
standalone/DeepSeekHarness/
├── dsh-doctor.cmd              ← 用户入口（双击或命令行）
└── app/lib/
    └── doctor-engine.js        ← 诊断引擎
```

部署工具：

| 工具 | 作用 |
|------|------|
| `deploy.cmd` / `deploy.sh` | 一键部署：验证目标 → 拷贝文件 → patch bin.js → 验证 |
| `patch-bin-dispatcher.ps1` | 在 bin.js 的 `parseDshArgs()` 前插入 ESM 兼容的 doctor dispatcher |
| `verify.cmd` | 部署后验证：用安装包的 Node 跑一次 doctor |

部署后用户可使用：

```bat
dsh-doctor.cmd web --fix
node app\lib\bin.js doctor web --json    REM 通过 dispatcher
```

### Path B — 原生子命令

通过修改 DSH TypeScript 源码，使 `dsh doctor` 成为与 `dsh web` / `dsh plugin` 平级的一等子命令：

- `args.ts`：新增 `DoctorInvocation` 类型 + commander `doctor` 子命令（`--profile` / `--patch` / `--json` / `--fix`）
- `bin.ts`：新增 `case 'doctor':` 分支
- `doctor.ts`：薄包装，`spawnSync` 调用同目录的 `doctor-engine.js`

提供三种应用方式：
1. `apply-patch.cmd` / `apply-patch.sh` 一键脚本（拷贝 + 备份 + 覆盖）
2. 手动覆盖（`reference/args.ts` + `reference/bin.ts`）
3. 手动 patch（`patches/args.ts.patch` + `patches/bin.ts.patch`）

---

## 文件清单

```
dsh-doctor/                            23 files
├── README.md                          仓库首页：快速运行 + 两条路径总览
├── doctor-engine.js                   ★ 核心诊断引擎（42KB，零依赖）
├── run-doctor.cmd                     Windows 一键运行器（自动定位 Node/安装包）
├── integration.md                     扩展说明（Cordis 插件形式 + CLI 接线细节）
├── .gitignore
│
├── standalone/                        ◀ Path A：零构建部署
│   ├── DEPLOY.md                      部署参考（英文）
│   ├── TUTORIAL.md                    完整教程（中文）：步骤 + FAQ + CI + 回滚
│   ├── deploy.cmd                     Windows 一键部署
│   ├── deploy.sh                      macOS/Linux 一键部署
│   ├── patch-bin-dispatcher.ps1       ESM 兼容的 bin.js patcher
│   ├── patch-bin-dispatcher.cmd       CMD 版 bin.js patcher
│   ├── verify.cmd                     部署后验证
│   └── DeepSeekHarness/              源文件树（xcopy 到安装包）
│       ├── dsh-doctor.cmd
│       └── app/lib/doctor-engine.js
│
└── dsh-cli-patch/                     ◀ Path B：原生子命令
    ├── README.md                      三种 patch 应用方式说明
    ├── apply-patch.cmd                Windows 一键 patch 脚本
    ├── apply-patch.sh                 macOS/Linux 一键 patch 脚本
    ├── patches/
    │   ├── args.ts.patch              chunked diff：DoctorInvocation + 子命令
    │   └── bin.ts.patch               chunked diff：switch case 分支
    ├── reference/
    │   ├── args.ts                    ★ 完整 patched args.ts
    │   └── bin.ts                     ★ 完整 patched bin.ts
    └── src/
        ├── doctor.ts                  薄包装：spawnSync → doctor-engine.js
        └── doctor-engine.js           引擎副本
```

---

## 使用方式

### 快速运行（无需安装到 DSH）

```bash
node doctor-engine.js --profile web                  # 终端报告
node doctor-engine.js --profile web --fix            # + 自动修复
node doctor-engine.js --profile headless --json      # JSON 输出
```

### 部署到 DSH 安装包后

```bat
REM Path A（零构建）
dsh-doctor.cmd web --fix

REM Path A + bin.js dispatcher
node app\lib\bin.js doctor web --json

REM Path B（原生子命令，需 rebuild）
dsh doctor --profile web --fix
```

### CI/CD 集成

```yaml
# GitHub Actions
- name: DSH environment check
  run: |
    cd DeepSeekHarness
    dsh-doctor.cmd web --json > doctor-report.json
    # exit 1 = FAIL, 阻断发布
```

---

## 环境变量

| 变量 | 作用 | 默认值 |
|------|------|--------|
| `DSH_INSTALLER_ROOT` | 安装包根目录（含 `node/`、`app/`、`shell/`） | 自动探测 |
| `DSH_HOME` | 用户数据根目录（含 `profiles/`、`storages/`） | 安装包旁的 `../dsh-home`，或 `~/.dsh` |
| `DSH_PROFILE` | 默认 profile 名 | `web` |
| `DEEPSEEK_API_KEY` | API key（M4 检查项读取） | 无 |

---

## 系统要求

| 项目 | 最低要求 | 推荐版本 |
|------|---------|---------|
| Node.js | 22.19.0 | 22.23+ 或 24+ |
| pnpm | 11.5 | 11.7+ |
| Git | 2.26 | 最新稳定版 |
| 操作系统 | Windows 10 / macOS 12 / Ubuntu 22.04 | — |

> **注意**：如果使用 DSH 安装包内捆绑的 Node（`DeepSeekHarness/node/node.exe`），则无需单独安装 Node.js。

---

## 已知限制

1. **YAML 解析器是极简实现**：仅覆盖 DSH 配置文件实际使用的子集（flow sequence、block sequence/mapping、注释、引号字符串），不支持 YAML 锚点、多文档、复杂折叠等高级特性
2. **自动修复（`--fix`）能力有限**：仅处理创建缺失目录、运行 `pnpm install` 等简单场景，不修改配置文件内容
3. **Path A 的 bin.js dispatcher 是 ESM 模块**：dispatcher 插入在 `parseDshArgs()` 调用之前（所有 `import` 语句之后），使用 top-level `await import()` 动态加载，不适用于 CommonJS 格式的 bin.js
4. **沙箱检测 M2**：Linux 检测 `bwrap` 可用性，Windows 检测 `whoami /groups` 的 write-restricted-token，macOS 目前不检测 seatbelt

---

## 技术实现要点

### ESM 兼容的 bin.js dispatcher

DSH 的 `bin.js` 是 ESM 模块（`import` 语句会被 hoist 到文件顶部）。dispatcher 不能简单 prepend 到文件开头——那样会在 `import` 之前执行 `require()` 导致报错。

解决方案：将 dispatcher 插入在 **所有 import 之后、`const invocation = parseDshArgs(...)` 之前**，使用 top-level `await import()` 动态加载 `node:child_process` 等模块。这样：

- `argv[2] === 'doctor'` → 短路到 `doctor-engine.js`
- 其他情况 → fall-through，DSH 原有 commander 逻辑正常执行

### 路径解析的优雅降级

`findInstallerRoot()` 返回 `null` 时不会崩溃。`Ctx` 类的所有 installer 依赖属性（`installerRoot`、`appRoot`、`bundledNode`）均为 nullable，Installer 组的 4 项检查（I1–I4）在 installer 未定位时自动降级为 WARN 并给出修复提示。

---

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai) — 深度求索开源的 Agent 框架
- [Commander.js](https://github.com/tj/commander.js) — DSH CLI 使用的命令行解析库
- 所有 DSH 社区贡献者

---

## 反馈与贡献

- **Issues**：https://github.com/jiel521125/dsh-doctor/issues
- **PR**：欢迎提交 Pull Request
- **讨论**：https://github.com/jiel521125/dsh-doctor/discussions

---

*dsh-doctor v1.0.0 — 让 DSH 环境诊断变得简单。*
