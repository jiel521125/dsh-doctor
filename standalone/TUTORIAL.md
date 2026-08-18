# 部署教程：把 dsh-doctor 集成到 DSH 安装包（Path A — 零构建）

> **目标**：让你的 DSH 便携安装包支持 `dsh doctor` 诊断命令，**不需要
> 改 TypeScript 源码、不需要 pnpm build**，5 分钟内完成。

适用对象：已发布或即将发布的 DeepSeek Harness 便携安装包
（包含 `node/`、`app/lib/bin.js`、`shell/`、`electron/` 等的目录）。

---

## 前置条件

| 项目 | 要求 |
|------|------|
| DSH 安装包 | 已解压到本地，能找到 `<installer>/node/node.exe` 和 `<installer>/app/lib/bin.js` |
| dsh-doctor 仓库 | 已 clone 或下载到本地（就是你手上这个 `dsh-doctor/` 目录） |
| 操作系统 | Windows（macOS/Linux 用 `deploy.sh`，步骤相同） |

不需要单独安装 Node.js —— 工具会自动使用安装包里**已捆绑的 Node**。

---

## 方法一：一键自动部署（推荐，30 秒）

### Windows

```bat
cd dsh-doctor\standalone

REM 把下面的路径替换成你的 DSH 安装包路径
deploy.cmd  C:\path\to\DeepSeekHarness
```

### macOS / Linux

```bash
cd dsh-doctor/standalone
chmod +x deploy.sh
./deploy.sh  /path/to/DeepSeekHarness
```

### `deploy.cmd` 做了什么

```
[1/5] 验证目标安装包          ← 检查 node\node.exe + app\lib\bin.js 是否存在
[2/5] 拷贝 doctor-engine.js   ← → 安装包的 app\lib\
[3/5] 拷贝 dsh-doctor.cmd      ← → 安装包根目录
[4/5] 给 bin.js 插入 dispatcher ← 10 行小补丁，自动备份原 bin.js.bak
[5/5] 跑一次 verify 验证        ← 用安装包的 Node 跑 doctor-engine.js --profile web
```

全部完成后你会看到：

```
============================================================
 DEPLOYMENT SUCCESSFUL
============================================================
 dsh-doctor.cmd  : <你的安装包>\dsh-doctor.cmd
 doctor-engine   : <你的安装包>\app\lib\doctor-engine.js
 bin.js patched  : yes (dsh doctor ... works)

 Try it:
    cd C:\path\to\DeepSeekHarness
    dsh-doctor.cmd web
    dsh doctor web --fix         (via bin.js dispatcher)
    dsh doctor web --json
```

---

## 方法二：手动部署（如果自动脚本不方便用）

### Step 1 — 拷贝引擎到安装包

把这两个文件复制到你的 DSH 安装包：

| 从 | 到 |
|---|---|
| `dsh-doctor\standalone\DeepSeekHarness\app\lib\doctor-engine.js` | `<installer>\app\lib\doctor-engine.js` |
| `dsh-doctor\standalone\DeepSeekHarness\dsh-doctor.cmd` | `<installer>\dsh-doctor.cmd` |

用 `xcopy` 一行搞定：

```bat
xcopy /E /I /Y  dsh-doctor\standalone\DeepSeekHarness  D:\your\DeepSeekHarness
```

或 PowerShell：

```powershell
Copy-Item -Recurse -Force dsh-doctor\standalone\DeepSeekHarness\* D:\your\DeepSeekHarness\
```

### Step 2 — （可选）给 bin.js 插入 dispatcher

> **为什么做这步？** 不做这步只能用 `dsh-doctor.cmd web`，做了这步
> 之后可以直接用 `dsh doctor web`（和 `dsh web` / `dsh plugin` 完全一致的写法）。

用自动脚本：

```bat
patch-bin-dispatcher.cmd  D:\your\DeepSeekHarness
```

或手动：
1. 打开 `<installer>\app\lib\bin.js`
2. 在文件**最顶部**粘贴以下 10 行：

```js
;(function doctorDispatch () {
  var first = process.argv[2]
  if (first !== 'doctor') return
  var childArgv = process.argv.slice(3)
  var spawnSync = require('node:child_process').spawnSync
  var resolve   = require('node:path').resolve
  var engine = resolve(__dirname, 'doctor-engine.js')
  var fs = require('node:fs')
  if (!fs.existsSync(engine)) {
    process.stderr.write('[dsh doctor] FATAL: doctor-engine.js not found at ' + engine + '\n')
    process.exit(97)
  }
  var r = spawnSync(process.execPath, [engine].concat(childArgv), {
    stdio: 'inherit', env: process.env,
  })
  process.exit(r.status === null ? 99 : r.status)
})()
```

3. 保存文件。原文件会先自动备份到 `bin.js.bak`（用自动脚本时）。

### Step 3 — 验证

```bat
verify.cmd  D:\your\DeepSeekHarness
```

或手动：

```bat
cd D:\your\DeepSeekHarness
node\node.exe app\lib\doctor-engine.js --profile web
```

看到 24 项检查报告（末尾是 `Result: ISSUES · 20 pass · 4 warn · 0 fail` 或类似），部署成功。

---

## 部署后的文件结构

```
<你的安装包>/
├── dsh-doctor.cmd              ← 🆕 用户入口（双击或命令行）
├── DeepSeekHarness.exe         ← 已有的启动器
├── node/
│   └── node.exe                ← 已有的捆绑 Node
├── app/
│   └── lib/
│       ├── bin.js              ← 已有，顶部多了 10 行 dispatcher（🆕）
│       ├── bin.js.bak          ← 🆕 原始 bin.js 备份
│       ├── doctor-engine.js   ← 🆕 诊断引擎（42KB，零依赖）
│       └── ... 其他 DSH 模块
├── shell/
├── electron/
└── ...
```

---

## 部署后的使用方式

### 方式 1：通过 `dsh-doctor.cmd`（部署后立即可用）

```bat
cd <你的安装包>

REM 默认 profile=web
dsh-doctor.cmd

REM 指定 profile
dsh-doctor.cmd headless

REM 自动修复
dsh-doctor.cmd web --fix

REM JSON 输出（给 CI / 仪表盘用）
dsh-doctor.cmd web --json > report.json
```

### 方式 2：通过 `dsh doctor`（需要做了 Step 2 的 dispatcher 补丁）

```bat
REM 用安装包里的 Node 直接跑 bin.js
node\node.exe app\lib\bin.js doctor web
node\node.exe app\lib\bin.js doctor web --fix
node\node.exe app\lib\bin.js doctor web --json
```

如果你的 PATH 里已有 Node，更简单：

```bat
node app\lib\bin.js doctor web --fix
```

---

## 退出码约定

| Exit | 含义 | CI 用法 |
|------|------|--------|
| 0    | 24 项全 PASS | ✅ 放行 |
| 1    | 有 FAIL | ❌ 阻断构建/发布 |
| 2    | 只有 WARN，无 FAIL | ⚠️ 提醒，不阻断 |
| 97   | 引擎文件丢失 | ❌ 部署有误 |
| 98   | 找不到 Node | ❌ 环境问题 |
| 99   | 引擎内部异常 | ❌ 引擎 bug |

**CI 集成建议**：

```yaml
# GitHub Actions
- name: DSH environment check
  run: |
    cd DeepSeekHarness
    dsh-doctor.cmd web --json > doctor-report.json
    # 如果需要阻断：设 exit 1
```

```bat
:: .bat / cmd
dsh-doctor.cmd web
if %errorlevel%==1 (
  echo DSH environment has hard failures - aborting release
  exit /b 1
)
```

---

## 常见问题

### Q1：deploy.cmd 报 "FAIL: node\node.exe not found"

目标路径不对。`deploy.cmd` 后面接的参数应该是**安装包根目录**（包含
`node/`、`app/`、`shell/` 的那个目录），不是 dsh-doctor 仓库路径。

正确示例：
```bat
deploy.cmd  C:\path\to\DeepSeekHarness               ✅ (安装包根目录)
deploy.cmd  C:\path\to                               ❌ (这是上级目录，不是安装包根)
```

### Q2：部署后跑 `dsh doctor web` 报 "FATAL: doctor-engine.js not found"

`app/lib/doctor-engine.js` 没拷过去。重新跑一遍 Step 1，或检查路径。

### Q3：dispatcher 会不会影响 `dsh web` / `dsh plugin`？

**不会**。dispatcher 只在 `process.argv[2] === 'doctor'` 时短路，其他
情况立即 `return` 让 DSH 原有逻辑接管。可以验证：

```bat
node\node.exe app\lib\bin.js web --help      REM 还是 DSH 自己的 web 帮助
node\node.exe app\lib\bin.js plugin --profile web list   REM 还是 pnpm
node\node.exe app\lib\bin.js doctor web      REM 走 dispatcher
```

### Q4：怎么回滚？

```bat
cd <你的安装包>\app\lib
copy /Y bin.js.bak bin.js
del doctor-engine.js
cd ..\..
del dsh-doctor.cmd
```

完整移除 dsh-doctor，恢复原始 DSH 状态。

### Q5：deploy.cmd 能重复运行吗？

可以。`deploy.cmd` **幂等**：
- 文件拷贝会直接覆盖
- `bin.js` 已经有 dispatcher 标记时会 SKIP，不会重复插入
- 备份只在第一次创建

### Q6：Path A 和 Path B 能共存吗？

不能，**选一个**。如果以后你转用 Path B（原生子命令，改 TS 后 build），
需要先把 bin.js 的 dispatcher 删掉（或用 `bin.js.bak` 恢复），否则会有
两套 `dsh doctor` 逻辑冲突。删掉 dispatcher 是安全的——Path B 的 bin.js
自带原生的 `case 'doctor':` 分支。

---

## 工具清单

| 文件 | 作用 |
|---|---|
| [deploy.cmd](deploy.cmd) | Windows 一键部署（5 步全自动化） |
| [deploy.sh](deploy.sh) | macOS/Linux 一键部署 |
| [patch-bin-dispatcher.cmd](patch-bin-dispatcher.cmd) | 单独给 bin.js 插入 dispatcher |
| [verify.cmd](verify.cmd) | 部署后验证（跑一次 doctor） |
| [DeepSeekHarness/](DeepSeekHarness) | 源文件目录（被 deploy 拷贝的目标） |

---

## 下一步

部署完成后，建议：
1. 把 `dsh-doctor.cmd web` 加入你的发布前检查脚本
2. 把 `--json` 输出接入 CI 仪表盘，监控 DSH 环境健康
3. 如果未来想做**原生 `dsh doctor` 子命令**（出现在 `dsh -h` 里），
   参考 [`../dsh-cli-patch/README.md`](../dsh-cli-patch/README.md)
