# Fund Watch 基金动态（Obsidian 插件）

在 Obsidian 右侧边栏实时查看基金 / ETF 行情与迷你走势图的小插件。效果类似手机上的基金小组件：卡片列表展示基金名称、代码、迷你走势线和涨跌幅（A 股习惯：涨红跌绿）。

## 功能

- 右侧边栏常驻面板，点击左侧栏「折线图」图标或命令面板「打开基金动态面板」即可打开
- 场内 ETF 实时行情（东财 push2），按刷新间隔自动轮询
- 场外基金每日净值（东财基金接口），含近 30 日净值走势
- 每只基金一张卡片：名称 / 代码、迷你 SVG 走势图、涨跌幅、最新价（或净值）
- 自动适配 Obsidian 明暗主题

## 安装（开发者模式）

1. 克隆仓库到本地：

   ```bash
   git clone https://github.com/moyansuyu/obsidian-fund-watch.git
   cd obsidian-fund-watch
   ```

2. 安装依赖并构建：

   ```bash
   npm install
   npm run build   # 生成 main.js
   ```

3. 把文件夹内容（`main.js`、`manifest.json`、`styles.css`）复制到你的 vault：

   ```
   <你的仓库>/.obsidian/plugins/fund-watch/
   ```

4. 在 Obsidian 设置 → 第三方插件中启用「Fund Watch 基金动态」。

## 配置

设置页「基金动态 设置」：

- **基金列表**：每行一只，格式 `代码 [etf|fund]`。例如：
  ```
  022458 fund
  588080 etf
  510310 etf
  513300 etf
  159696 etf
  ```
  不写类型时按代码前缀自动判断（5/1 开头视为场内 ETF，其余视为场外基金）。
- **刷新间隔（分钟）**：场内 ETF 行情轮询间隔，默认 1 分钟。场外基金净值每天只更新一次，刷新间隔对它无意义。

## 数据源

- 场内 ETF 实时价 + 日 K：`push2.eastmoney.com` / `push2his.eastmoney.com`
- 场外基金净值历史：`fundmobapi.eastmoney.com`

均通过 Obsidian 自带的 `requestUrl` 请求，绕开浏览器 CORS，无需自建代理。第三方接口无官方保证，字段可能变动，数据源层已做隔离，后续可替换为自己的净值 API（如你正在开发的 ETF 爬虫接口）。

## 目录结构

```
obsidian-fund-watch/
├── main.ts            # 插件主逻辑（面板 / 数据抓取 / 渲染）
├── manifest.json      # 插件清单
├── styles.css         # 面板样式
├── esbuild.config.mjs # 构建配置
├── tsconfig.json
├── package.json
└── versions.json
```

## License

MIT
