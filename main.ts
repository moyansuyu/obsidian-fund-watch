import {
  Plugin,
  PluginSettingTab,
  Setting,
  ItemView,
  WorkspaceLeaf,
  requestUrl,
  Notice,
  App,
  apiVersion,
} from "obsidian";
import type { SettingDefinitionItem } from "obsidian";

export const VIEW_TYPE_FUND_WATCH = "fund-watch-view";

interface FundConfig {
  code: string;
  type: "etf" | "fund";
}

interface FundSnapshot {
  code: string;
  type: "etf" | "fund";
  name: string;
  price: number;
  changePercent: number;
  series: number[]; // oldest -> newest，用于迷你走势图
  updatedAt: string;
}

interface FundWatchSettings {
  // 每行一只：代码 [etf|fund]，留空则按代码前缀自动判断
  funds: string;
  refreshMinutes: number;
}

const DEFAULT_SETTINGS: FundWatchSettings = {
  funds: ["022458 fund", "588080 etf", "510310 etf", "513300 etf", "159696 etf"].join(
    "\n",
  ),
  refreshMinutes: 1,
};

// 解析设置里的基金列表
function parseFunds(raw: string): FundConfig[] {
  const out: FundConfig[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) continue;
    const code = parts[0];
    const explicit = parts[1];
    let type: "etf" | "fund";
    if (explicit === "fund" || explicit === "etf") {
      type = explicit;
    } else if (code.startsWith("5") || code.startsWith("1")) {
      type = "etf";
    } else {
      type = "fund";
    }
    out.push({ code, type });
  }
  return out;
}

// 东财 secid：沪市 1.xxxxxx，深市 0.xxxxxx
function secid(code: string): string {
  const first = code[0];
  const sh = first === "6" || first === "9" || first === "5";
  return `${sh ? "1" : "0"}.${code}`;
}

// 东财接口返回的 JSON 形状（仅声明用到的字段，规避 any）
interface EmQuote {
  data?: { f2?: string; f3?: string; f14?: string };
}
interface EmKline {
  data?: { klines?: string[] };
}

// 把 requestUrl 的未知 JSON 结果安全收窄为指定类型，避免 any 扩散
function asJson<T>(value: unknown): T {
  return value as T;
}

// 场内 ETF：实时行情 + 日 K 走势
async function fetchEtf(code: string): Promise<FundSnapshot> {
  const id = secid(code);
  const quoteUrl = `https://push2.eastmoney.com/api/qt/stock/get?secid=${id}&fields=f12,f14,f2,f3,f4`;
  const klineUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${id}&fields1=f1,f2,f3&fields2=f51,f52&klt=101&fqt=1&end=20500101&lmt=30`;
  const qResp = await requestUrl({ url: quoteUrl });
  const kResp = await requestUrl({ url: klineUrl });
  const q = asJson<EmQuote>(qResp.json() as unknown);
  const k = asJson<EmKline>(kResp.json() as unknown);
  const d = q.data ?? {};
  const price = parseFloat(d.f2 ?? "");
  const changePercent = parseFloat(d.f3 ?? "");
  const klines: string[] = k.data?.klines ?? [];
  const series = klines
    .map((s) => parseFloat(s.split(",")[1]))
    .filter((n) => !isNaN(n));
  return {
    code,
    type: "etf",
    name: d.f14 ?? code,
    price: isNaN(price) ? 0 : price,
    changePercent: isNaN(changePercent) ? 0 : changePercent,
    series,
    updatedAt: new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

// 场外基金：每日净值历史（同时充当走势与涨跌幅）
interface FundNavItem {
  FSRQ: string;
  DWJZ: string;
}
interface FundNavResp {
  Datas?: FundNavItem[];
  Expansion?: Array<{ FUND_NAME?: string }>;
}

async function fetchFund(code: string): Promise<FundSnapshot> {
  const url = `https://fundmobapi.eastmoney.com/f10/fund/DWJZ?fundCode=${code}&pageIndex=1&pageSize=30`;
  const res = await requestUrl({
    url,
    headers: { Referer: "https://m.fund.eastmoney.com/" },
  });
  const data = asJson<FundNavResp>(res.json() as unknown);
  const datas: FundNavItem[] = data.Datas ?? [];
  if (datas.length === 0) {
    return {
      code,
      type: "fund",
      name: code,
      price: 0,
      changePercent: 0,
      series: [],
      updatedAt: "",
    };
  }
  const navs = datas.map((d) => parseFloat(d.DWJZ)).filter((n) => !isNaN(n));
  const series = [...navs].reverse(); // 旧 -> 新
  const latest = navs[0];
  const prev = navs[1] ?? latest;
  const changePercent = prev ? ((latest - prev) / prev) * 100 : 0;
  return {
    code,
    type: "fund",
    name: data.Expansion?.[0]?.FUND_NAME ?? code,
    price: latest,
    changePercent,
    series,
    updatedAt: datas[0]?.FSRQ ?? "",
  };
}

// 给请求加超时保护，避免接口卡死导致面板一直空白
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("请求超时")), ms);
    p.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function fetchSnapshot(cfg: FundConfig): Promise<FundSnapshot> {
  try {
    return cfg.type === "etf"
      ? await withTimeout(fetchEtf(cfg.code), 15000)
      : await withTimeout(fetchFund(cfg.code), 15000);
  } catch {
    return {
      code: cfg.code,
      type: cfg.type,
      name: cfg.code,
      price: 0,
      changePercent: 0,
      series: [],
      updatedAt: "获取失败",
    };
  }
}

// 迷你走势图（用 DOM 创建 SVG，避免 innerHTML）
function sparkline(series: number[], color: string): SVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const w = 90;
  const h = 30;
  const pad = 3;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  if (series.length >= 2) {
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;
    const n = series.length;
    const pts = series
      .map((v, i) => {
        const x = pad + (i / (n - 1)) * (w - pad * 2);
        const y = h - pad - ((v - min) / span) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const pl = document.createElementNS(NS, "polyline");
    pl.setAttribute("points", pts);
    pl.setAttribute("fill", "none");
    pl.setAttribute("stroke", color);
    pl.setAttribute("stroke-width", "1.5");
    pl.setAttribute("stroke-linecap", "round");
    pl.setAttribute("stroke-linejoin", "round");
    svg.appendChild(pl);
  }
  return svg;
}

// A 股习惯：涨红跌绿
function pctColor(p: number): string {
  return p > 0 ? "#A32D2D" : p < 0 ? "#3B6D11" : "#888780";
}

function pctClass(p: number): string {
  return p > 0 ? "fw-up" : p < 0 ? "fw-down" : "fw-flat";
}

function nowHM(): string {
  return new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

class FundWatchView extends ItemView {
  plugin: FundWatchPlugin;
  private timer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: FundWatchPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_FUND_WATCH;
  }
  getDisplayText() {
    return "基金动态";
  }
  getIcon() {
    return "line-chart";
  }

  async onOpen() {
    await this.render();
    this.startTimer();
  }

  async onClose() {
    this.stopTimer();
    this.contentEl.empty();
  }

  private startTimer() {
    this.stopTimer();
    const ms = Math.max(1, this.plugin.settings.refreshMinutes) * 60 * 1000;
    this.timer = window.setInterval(() => {
      void this.render();
    }, ms);
  }

  private stopTimer() {
    if (this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("fund-watch-root");

    const header = root.createDiv({ cls: "fw-header" });
    header.createDiv({ cls: "fw-title", text: "基金动态" });
    const meta = header.createDiv({ cls: "fw-meta", text: "更新中…" });
    const btn = header.createEl("button", { cls: "fw-refresh", text: "↻" });
    btn.addEventListener("click", () => {
      btn.classList.add("fw-spin");
      void this.render().finally(() =>
        window.setTimeout(() => btn.classList.remove("fw-spin"), 500),
      );
    });

    // 先画出骨架，再异步填数据，避免网络慢时面板空白
    const list = root.createDiv({ cls: "fw-list" });
    const loading = list.createDiv({ cls: "fw-meta", text: "加载中…" });

    try {
      const funds = parseFunds(this.plugin.settings.funds);
      const snapshots = await Promise.all(funds.map(fetchSnapshot));
      // 期间用户可能点了刷新，重画前列表若已 detach 则放弃本次
      if (!list.isConnected) return;

      list.empty();
      meta.textContent = `共 ${snapshots.length} 只 · ${nowHM()}`;

      for (const s of snapshots) {
        const card = list.createDiv({ cls: "fw-card" });

        const info = card.createDiv({ cls: "fw-info" });
        info.createDiv({ cls: "fw-name", text: s.name || s.code });
        const sub =
          s.type === "fund" && s.updatedAt
            ? `${s.code} · 净值 ${s.updatedAt}`
            : s.updatedAt === "获取失败"
              ? `${s.code} · 获取失败`
              : s.code;
        info.createDiv({ cls: "fw-code", text: sub });

        const chart = card.createDiv({ cls: "fw-chart" });
        chart.appendChild(sparkline(s.series, pctColor(s.changePercent)));

        const right = card.createDiv({ cls: "fw-right" });
        const pct = right.createDiv({
          cls: "fw-pct " + pctClass(s.changePercent),
        });
        pct.textContent =
          (s.changePercent > 0 ? "+" : "") + s.changePercent.toFixed(2) + "%";
        right.createDiv({
          cls: "fw-price",
          text: s.price ? s.price.toFixed(4) : "—",
        });
      }
    } catch (err) {
      if (!list.isConnected) return;
      list.empty();
      list.createDiv({
        cls: "fw-meta",
        text: `加载失败：${err instanceof Error ? err.message : String(err)}，请点击 ↻ 重试`,
      });
      meta.textContent = "加载失败";
    }
  }
}

// 声明式设置 API（Obsidian 1.13.0+）的版本阈值
const DECLARATIVE_SETTINGS_VERSION = "1.13.0";

function supportsDeclarativeSettings(): boolean {
  const parse = (v: string): number[] =>
    v.split(".").map((s) => parseInt(s, 10) || 0);
  const cur = parse(apiVersion);
  const min = parse(DECLARATIVE_SETTINGS_VERSION);
  for (let i = 0; i < 3; i++) {
    if ((cur[i] ?? 0) > (min[i] ?? 0)) return true;
    if ((cur[i] ?? 0) < (min[i] ?? 0)) return false;
  }
  return true;
}

class FundWatchSettingTab extends PluginSettingTab {
  plugin: FundWatchPlugin;

  constructor(app: App, plugin: FundWatchPlugin) {
    super(app, plugin);
  }

  // 1.13.0+ 的声明式设置定义：让设置项进入全局设置搜索，并用于渲染。
  // 旧版本不识别此方法，会回落到下面的 display()。
  getSettingDefinitions(): SettingDefinitionItem[] {
    if (!supportsDeclarativeSettings()) return [];
    return [
      {
        name: "基金列表",
        desc: "每行一只，格式：代码 [etf|fund]。etf 为场内实时行情，fund 为场外净值（每日更新）。不写类型会按代码前缀自动判断。",
        aliases: ["fund", "etf", "代码"],
        control: { type: "textarea", key: "funds", rows: 8 },
      },
      {
        name: "刷新间隔（分钟）",
        desc: "场内 ETF 行情轮询间隔，建议 1-5 分钟。",
        control: { type: "number", key: "refreshMinutes", defaultValue: 1 },
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (key === "funds") return this.plugin.settings.funds;
    if (key === "refreshMinutes") return this.plugin.settings.refreshMinutes;
    return undefined;
  }

  setControlValue(key: string, value: unknown): void | Promise<void> {
    if (key === "funds" && typeof value === "string") {
      this.plugin.settings.funds = value;
      return this.plugin.saveSettings();
    }
    if (key === "refreshMinutes") {
      const n = Math.max(1, parseInt(String(value), 10) || 1);
      this.plugin.settings.refreshMinutes = n;
      return this.plugin.saveSettings();
    }
    return undefined;
  }

  // 兜底：旧版 Obsidian（< 1.13.0）走命令式渲染
  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("基金动态 设置").setHeading();

    new Setting(containerEl)
      .setName("基金列表")
      .setDesc(
        "每行一只，格式：代码 [etf|fund]。etf 为场内实时行情，fund 为场外净值（每日更新）。不写类型会按代码前缀自动判断。",
      )
      .addTextArea((t) => {
        t.inputEl.addClass("fw-textarea");
        t.inputEl.setAttr("rows", 8);
        t.setValue(this.plugin.settings.funds).onChange((v) => {
          this.plugin.settings.funds = v;
          return this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("刷新间隔（分钟）")
      .setDesc("场内 ETF 行情轮询间隔，建议 1-5 分钟。")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.refreshMinutes))
          .onChange((v) => {
            this.plugin.settings.refreshMinutes = Math.max(
              1,
              parseInt(v) || 1,
            );
            return this.plugin.saveSettings();
          }),
      );
  }
}

export default class FundWatchPlugin extends Plugin {
  settings: FundWatchSettings;

  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_FUND_WATCH, (leaf) => new FundWatchView(leaf, this));
    this.addRibbonIcon("line-chart", "打开基金动态", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-panel",
      name: "打开基金动态面板",
      callback: () => {
        void this.activateView();
      },
    });
    this.addSettingTab(new FundWatchSettingTab(this.app, this));
  }

  onunload() {
    // 视图由 Obsidian 在卸载时自动关闭，无需手动处理
  }

  async activateView() {
    const { workspace } = this.app;
    try {
      // 已有该视图的 leaf：重新激活使其可见
      const existing = workspace.getLeavesOfType(VIEW_TYPE_FUND_WATCH);
      if (existing.length > 0) {
        await existing[0].setViewState({
          type: VIEW_TYPE_FUND_WATCH,
          active: true,
        });
        return;
      }
      // 依次尝试右侧栏 -> 左侧栏 -> 新分屏，确保一定能拿到 leaf
      let leaf: WorkspaceLeaf | null = workspace.getRightLeaf(false);
      if (!leaf) leaf = workspace.getLeftLeaf(false);
      if (!leaf) leaf = workspace.getLeaf(true);
      if (!leaf) {
        new Notice("基金动态：无法创建视图，请重启 Obsidian 后重试");
        return;
      }
      await leaf.setViewState({ type: VIEW_TYPE_FUND_WATCH, active: true });
    } catch (err) {
      console.error("[fund-watch] activateView failed:", err);
      new Notice(
        `基金动态打开失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async loadSettings() {
    const data = asJson<Partial<FundWatchSettings> | null>(
      (await this.loadData()) as unknown,
    );
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
