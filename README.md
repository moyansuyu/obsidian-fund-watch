# Fund Watch

An Obsidian plugin that shows live fund / ETF quotes and mini trend charts in the right sidebar. It works like a phone fund widget: a card list showing fund name, code, a mini sparkline and the change percentage (Chinese market convention: red for up, green for down).

## Features

- A panel docked in the right sidebar. Open it via the chart icon in the ribbon or the command "Open Fund Watch panel".
- Live quotes for exchange-traded ETFs (Eastmoney push2), auto-polled at the configured interval.
- Daily net asset value (NAV) for off-exchange funds (Eastmoney fund API), with the last 30 days of NAV trend.
- One card per fund: name / code, mini SVG sparkline, change percentage, latest price (or NAV).
- Adapts to Obsidian light and dark themes automatically.

## Installation (developer mode)

1. Clone the repository:

   ```bash
   git clone https://github.com/moyansuyu/obsidian-fund-watch.git
   cd obsidian-fund-watch
   ```

2. Install dependencies and build:

   ```bash
   npm install
   npm run build   # generates main.js
   ```

3. Copy the files (`main.js`, `manifest.json`, `styles.css`) into your vault:

   ```
   <your-vault>/.obsidian/plugins/fund-watch/
   ```

4. Enable "Fund Watch" in Obsidian Settings -> Community plugins.

## Configuration

In the plugin settings tab:

- **Fund list**: one fund per line, format `code [etf|fund]`. Example:

  ```
  022458 fund
  588080 etf
  510310 etf
  513300 etf
  159696 etf
  ```

  If the type is omitted, it is inferred from the code prefix (codes starting with 5 or 1 are treated as exchange-traded ETFs, everything else as off-exchange funds).
- **Refresh interval (minutes)**: polling interval for ETF quotes, 1 minute by default. Off-exchange fund NAV updates only once per day, so the interval has no effect on them.

## Data sources

- Exchange-traded ETF quotes and daily candles: `push2.eastmoney.com` / `push2his.eastmoney.com`
- Off-exchange fund NAV history: `fundmobapi.eastmoney.com`

All requests go through Obsidian's built-in `requestUrl`, which bypasses browser CORS, so no proxy is required. These third-party endpoints come with no official guarantee and their fields may change; the data layer is isolated so it can be swapped for your own NAV API later.

## Project structure

```
obsidian-fund-watch/
├── main.ts            # Plugin logic (panel / data fetching / rendering)
├── manifest.json      # Plugin manifest
├── styles.css         # Panel styles
├── esbuild.config.mjs # Build config
├── tsconfig.json
├── package.json
└── versions.json
```

## License

MIT

---

## 中文说明

在 Obsidian 右侧边栏实时查看基金 / ETF 行情与迷你走势图的小插件。效果类似手机上的基金小组件：卡片列表展示基金名称、代码、迷你走势线和涨跌幅（A 股习惯：涨红跌绿）。

- 右侧边栏常驻面板，点击左侧栏「折线图」图标或命令面板「打开基金动态面板」即可打开
- 场内 ETF 实时行情（东财 push2），按刷新间隔自动轮询
- 场外基金每日净值（东财基金接口），含近 30 日净值走势
- 每只基金一张卡片：名称 / 代码、迷你 SVG 走势图、涨跌幅、最新价（或净值）
- 自动适配 Obsidian 明暗主题

**配置**：设置页「基金动态 设置」中，基金列表每行一只，格式 `代码 [etf|fund]`；刷新间隔为场内 ETF 轮询分钟数（默认 1 分钟）。

**数据源**：场内 ETF 走 `push2.eastmoney.com`，场外基金净值走 `fundmobapi.eastmoney.com`，均通过 Obsidian 内置 `requestUrl` 请求，无需自建代理。
