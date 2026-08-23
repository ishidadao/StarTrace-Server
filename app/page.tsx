"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  calculateCurrentPity,
  calculateFiveStarPities,
  canonicalPool,
  pityLimitFor,
  summarizeLuck,
  summarizePities,
} from "../lib/gacha-stats";

type GameId = "genshin" | "wuwa";
type RecordItem = {
  uid: string;
  recordId: string;
  poolType: string;
  itemId: string;
  itemName: string;
  itemType: string;
  rarity: number;
  pulledAt: string;
  iconUrl: string;
  upStatus: "featured" | "capturing_radiance" | "guaranteed" | "off_banner" | "always_featured" | "not_applicable" | "unknown" | "inconsistent";
  upLabel: string;
  upDetail: string;
};

type Account = { game: GameId; uid: string; total: number; updatedAt: string };
type AuthUser = { id: string; username: string };
type TrendMode = "day" | "week" | "month";

const gameCopy: Record<GameId, { label: string; kicker: string; accent: string }> = {
  genshin: { label: "原神", kicker: "提瓦特祈愿", accent: "#8c7cf6" },
  wuwa: { label: "鸣潮", kicker: "索拉里斯唤取", accent: "#56d6c9" },
};

const poolOptions: Record<GameId, { id: string; label: string }[]> = {
  genshin: [
    { id: "all", label: "全部卡池" },
    { id: "301", label: "角色活动" },
    { id: "302", label: "武器活动" },
    { id: "200", label: "常驻祈愿" },
    { id: "100", label: "新手祈愿" },
    { id: "500", label: "集录祈愿" },
  ],
  wuwa: [
    { id: "all", label: "全部卡池" },
    { id: "1", label: "角色活动" },
    { id: "2", label: "武器活动" },
    { id: "3", label: "角色常驻" },
    { id: "4", label: "武器常驻" },
    { id: "5", label: "新手唤取" },
    { id: "6", label: "新手自选" },
    { id: "7", label: "感恩定向" },
    { id: "8", label: "角色新旅" },
    { id: "9", label: "武器新旅" },
    { id: "10", label: "角色联动" },
    { id: "11", label: "武器联动" },
  ],
};

const wuwaPoolNames: Record<string, string> = {
  "1": "角色活动", "2": "武器活动", "3": "角色常驻", "4": "武器常驻",
  "5": "新手唤取", "6": "新手自选", "7": "感恩定向", "8": "角色新旅",
  "9": "武器新旅", "10": "角色联动", "11": "武器联动",
};

function poolLabel(game: GameId, poolType: string) {
  const normalized = canonicalPool(game, poolType);
  if (game === "wuwa") return wuwaPoolNames[normalized] ?? normalized;
  return ({ "100": "新手祈愿", "200": "常驻祈愿", "301": "角色活动", "302": "武器活动", "500": "集录祈愿" } as Record<string, string>)[normalized] ?? normalized;
}

function prettyUid(uid: string) {
  return uid.replace(/\s/g, "").replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

function normalizeApiRecord(row: Record<string, unknown>, uid: string, game: GameId): RecordItem {
  const poolType = String(row.pool_type ?? row.poolType ?? row.gacha_type ?? "unknown");
  return {
    uid,
    recordId: String(row.record_id ?? row.recordId ?? row.id ?? ""),
    poolType: canonicalPool(game, poolType),
    itemId: String(row.item_id ?? row.itemId ?? row.resourceId ?? ""),
    itemName: String(row.item_name ?? row.itemName ?? row.name ?? "未知物品"),
    itemType: String(row.item_type ?? row.itemType ?? row.resourceType ?? "未知"),
    rarity: Number(row.rarity ?? row.rank_type ?? row.qualityLevel ?? 3),
    pulledAt: String(row.pulled_at ?? row.pulledAt ?? row.time ?? ""),
    iconUrl: String(row.icon_url ?? row.iconUrl ?? ""),
    upStatus: String(row.up_status ?? row.upStatus ?? "unknown") as RecordItem["upStatus"],
    upLabel: String(row.up_label ?? row.upLabel ?? "待判定"),
    upDetail: String(row.up_detail ?? row.upDetail ?? "缺少判定信息"),
  };
}

function currentGuaranteeCopy(game: GameId, poolType: string, records: RecordItem[]) {
  const pool = canonicalPool(game, poolType);
  if (game === "wuwa" && (pool === "2" || pool === "11")) {
    return { tag: "五星必中", detail: "限定武器五星必为当期UP武器，不存在歪出" };
  }

  const isLimitedCharacter = game === "genshin" ? pool === "301" : pool === "1" || pool === "10";
  const isGenshinWeapon = game === "genshin" && pool === "302";
  if (!isLimitedCharacter && !isGenshinWeapon) {
    if (game === "genshin" && pool === "500") {
      return { tag: "无法判定", detail: "集录祈愿记录不包含你选择的定轨目标" };
    }
    return { tag: "独立卡池", detail: "该卡池不使用限定UP歪与大保底判定" };
  }

  const latestFiveStar = records.find((record) =>
    record.rarity === 5 && canonicalPool(game, record.poolType) === pool,
  );
  if (!latestFiveStar) return { tag: "等待五星", detail: "现有记录中还没有可用于判断保底状态的五星" };
  if (latestFiveStar.upStatus === "off_banner") {
    return {
      tag: "大保底",
      detail: isGenshinWeapon ? "下一位五星必为当期两把UP武器之一" : "下一位五星必为当期UP角色",
    };
  }
  if (latestFiveStar.upStatus === "unknown" || latestFiveStar.upStatus === "inconsistent") {
    return { tag: "待核验", detail: "最近五星缺少卡池信息或记录存在断档，无法可靠继承状态" };
  }
  if (isGenshinWeapon) {
    return { tag: "常规概率", detail: "下一位五星有75%概率为当期UP；定轨命定值无法从记录还原" };
  }
  return {
    tag: "小保底",
    detail: game === "genshin"
      ? "下一位五星按角色池基础规则判定；满足连续三轮先歪后大保底时可推断必触发捕获明光"
      : "下一位五星有50%概率为当期UP角色",
  };
}

function parseImport(input: unknown, selectedGame: GameId, typedUid: string) {
  const root = input as Record<string, unknown>;
  const groups: { game: GameId; uid: string; records: Record<string, unknown>[] }[] = [];

  if (Array.isArray(root?.hk4e)) {
    for (const account of root.hk4e as Record<string, unknown>[]) {
      groups.push({
        game: "genshin",
        uid: String(account.uid ?? ""),
        records: (account.list as Record<string, unknown>[]) ?? [],
      });
    }
  } else if (Array.isArray(root?.list)) {
    const info = (root.info ?? {}) as Record<string, unknown>;
    const list = root.list as Record<string, unknown>[];
    groups.push({
      game: "genshin",
      uid: String(info.uid ?? list[0]?.uid ?? typedUid),
      records: list,
    });
  } else {
    const poolMap = [
      ["roleActivityItems", "1"], ["weaponsActivityItems", "2"],
      ["roleResidentItems", "3"], ["weaponsResidentItems", "4"],
      ["beginnerItems", "5"], ["beginnerChoiceItems", "6"],
      ["gratitudeOrientationItems", "7"], ["roleJourneyItems", "8"],
      ["weaponJourneyItems", "9"],
    ] as const;
    const haiyuRows = poolMap.flatMap(([key, pool]) =>
      Array.isArray(root?.[key])
        ? (root[key] as Record<string, unknown>[]).map((item, index) => ({
            ...item,
            uid: typedUid,
            cardPoolType: item.cardPoolType ?? pool,
            id: item.id ?? `${pool}-${item.resourceId}-${item.time}-${index}`,
          }))
        : [],
    );
    const rawRows = Array.isArray(root?.records)
      ? (root.records as Record<string, unknown>[])
      : Array.isArray(input) ? (input as Record<string, unknown>[]) : haiyuRows;
    groups.push({ game: selectedGame, uid: typedUid, records: rawRows });
  }

  return groups.filter((group) => group.uid && group.records.length);
}

export default function Home() {
  const [game, setGame] = useState<GameId>("genshin");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeUid, setActiveUid] = useState("");
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [pool, setPool] = useState("all");
  const [rarityPool, setRarityPool] = useState("all");
  const [trendMode, setTrendMode] = useState<TrendMode>("day");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [dialog, setDialog] = useState<"upload" | "auth" | "migrate" | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [legacyKey, setLegacyKey] = useState("");
  const [uploadUid, setUploadUid] = useState("");
  const [uploadGame, setUploadGame] = useState<GameId>("genshin");
  const [fileData, setFileData] = useState<unknown>(null);
  const [notice, setNotice] = useState("尚未登录或导入记录");
  const [busy, setBusy] = useState(false);

  const visible = useMemo(
    () => records.filter((record) => pool === "all" || record.poolType === pool),
    [records, pool],
  );
  const fiveStars = visible.filter((record) => record.rarity === 5);
  const fourStars = visible.filter((record) => record.rarity === 4);
  const rarityRecords = records.filter((record) => rarityPool === "all" || record.poolType === rarityPool);
  const rarityFiveStars = rarityRecords.filter((record) => record.rarity === 5);
  const rarityFourStars = rarityRecords.filter((record) => record.rarity === 4);
  const rarity = {
    five: rarityRecords.length ? Math.round((rarityFiveStars.length / rarityRecords.length) * 1000) / 10 : 0,
    four: rarityRecords.length ? Math.round((rarityFourStars.length / rarityRecords.length) * 1000) / 10 : 0,
    three: rarityRecords.length ? Math.round(((rarityRecords.length - rarityFiveStars.length - rarityFourStars.length) / rarityRecords.length) * 1000) / 10 : 0,
  };
  const primaryPool = game === "genshin" ? "301" : "1";
  const pityPool = pool === "all" ? primaryPool : pool;
  const pityLimit = pityLimitFor(game, pityPool);
  const currentPity = calculateCurrentPity(records, game, pityPool);
  const currentPityInvalid = currentPity !== null && currentPity > pityLimit;
  const guaranteeCopy = currentPityInvalid
    ? { tag: "有缺口", detail: "连续抽数超过卡池上限，请重新同步完整记录" }
    : currentGuaranteeCopy(game, pityPool, records);
  const allFiveWithPity = calculateFiveStarPities(visible, game);
  const fiveWithPity = historyExpanded ? allFiveWithPity : allFiveWithPity.slice(0, 5);
  const filteredAccounts = accounts.filter((account) => account.game === game);
  const { averagePity } = summarizePities(allFiveWithPity);
  const luck = summarizeLuck(allFiveWithPity, game);
  const luckScore = luck.luckScore;
  const luckTitle = luckScore === null
    ? "等待真实数据"
    : luckScore >= 75 ? "星光相随" : luckScore >= 45 ? "旅途平稳" : "厚积薄发";
  const trend = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const record of visible) {
      const rawDate = record.pulledAt.slice(0, 10);
      if (!rawDate) continue;
      let key = rawDate;
      if (trendMode === "month") key = rawDate.slice(0, 7);
      if (trendMode === "week") {
        const date = new Date(rawDate + "T00:00:00");
        const day = (date.getDay() + 6) % 7;
        date.setDate(date.getDate() - day);
        key = date.toISOString().slice(0, 10);
      }
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    const points = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-30);
    const maximum = Math.max(1, ...points.map(([, count]) => count));
    return points.map(([date, count]) => ({ date, count, height: Math.max(8, Math.round((count / maximum) * 100)) }));
  }, [visible, trendMode]);

  function formatTrendDate(date: string) {
    if (trendMode === "month") {
      const [year, month] = date.split("-");
      return year && month ? year + "年" + Number(month) + "月" : date;
    }
    const [, month, day] = date.split("-");
    const suffix = trendMode === "week" ? "日当周" : "日";
    return month && day ? Number(month) + "月" + Number(day) + suffix : date;
  }

  const loadAccount = useCallback(async (nextGame: GameId, uid: string) => {
    setBusy(true);
    try {
      const compactUid = uid.replace(/\s/g, "");
      const response = await fetch(`/api/records?game=${nextGame}&uid=${compactUid}`);
      const data = await response.json() as { error?: string; records?: Record<string, unknown>[]; accounts?: Record<string, unknown>[] };
      if (!response.ok) throw new Error(data.error ?? "读取失败");
      setRecords((data.records ?? []).map((row) => normalizeApiRecord(row, compactUid, nextGame)));
      setAccounts((data.accounts ?? []).map((row) => ({
        game: String(row.game) as GameId,
        uid: prettyUid(String(row.uid)),
        total: Number(row.total),
        updatedAt: "已同步",
      })));
      setGame(nextGame);
      setActiveUid(prettyUid(compactUid));
      setNotice(`已载入 UID ${prettyUid(compactUid)} 的云端记录`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "读取失败");
    } finally {
      setBusy(false);
    }
  }, []);

  const loadAccounts = useCallback(async (preferredGame?: GameId) => {
    const response = await fetch("/api/records");
    const data = await response.json() as { error?: string; accounts?: Record<string, unknown>[] };
    if (!response.ok) throw new Error(data.error ?? "读取账号失败");
    const remoteAccounts = (data.accounts ?? []).map((row) => ({
      game: String(row.game) as GameId,
      uid: prettyUid(String(row.uid)),
      total: Number(row.total),
      updatedAt: "已同步",
    }));
    setAccounts(remoteAccounts);
    const first = remoteAccounts.find((account) => account.game === preferredGame) ?? remoteAccounts[0];
    if (first) await loadAccount(first.game, first.uid);
    else {
      setActiveUid("");
      setRecords([]);
      setNotice("账号已登录，等待第一批数据");
    }
  }, [loadAccount]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/auth/session");
        if (!response.ok) return;
        const data = await response.json() as { user?: AuthUser };
        if (!data.user) return;
        setAuthUser(data.user);
        await loadAccounts();
      } catch {
        setNotice("暂时无法连接服务器，稍后可重新登录");
      }
    })();
  }, [loadAccounts]);

  async function authenticate() {
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username.trim()) || password.length < 10) {
      setNotice("用户名需为 3–24 位字母、数字或下划线，密码至少 10 位");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/" + authMode, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await response.json() as { error?: string; user?: AuthUser };
      if (!response.ok || !data.user) throw new Error(data.error ?? "登录失败");
      setAuthUser(data.user);
      setPassword("");
      setDialog(null);
      setNotice(authMode === "register" ? "账号创建成功" : "登录成功");
      await loadAccounts();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  async function migrateLegacyData() {
    if (legacyKey.trim().length < 12) {
      setNotice("请输入原先使用的完整同步密钥");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legacyKey }),
      });
      const data = await response.json() as { error?: string; migrated?: number };
      if (!response.ok) throw new Error(data.error ?? "迁移失败");
      setLegacyKey("");
      setDialog(null);
      setNotice("旧同步空间已迁移，共保留 " + (data.migrated ?? 0) + " 条记录");
      await loadAccounts(game);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "迁移失败");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthUser(null);
    setAccounts([]);
    setActiveUid("");
    setRecords([]);
    setNotice("已退出登录，本页不再显示云端记录");
  }

  async function upload() {
    if (!authUser) {
      setDialog("auth");
      setNotice("请先登录账号再导入记录");
      return;
    }
    if (!fileData) {
      setNotice("请选择抽卡记录 JSON 文件");
      return;
    }
    const groups = parseImport(fileData, uploadGame, uploadUid.replace(/\s/g, ""));
    if (!groups.length) {
      setNotice("没有识别到有效记录；鸣潮导入请同时填写对应 UID");
      return;
    }
    setBusy(true);
    try {
      let count = 0;
      for (const group of groups) {
        const response = await fetch("/api/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...group, source: "web-import" }),
        });
        const data = await response.json() as { error?: string; written?: number };
        if (!response.ok) throw new Error(data.error ?? "上传失败");
        count += data.written ?? 0;
      }
      setDialog(null);
      setNotice(`已按 UID 分组写入 ${count} 条记录`);
      await loadAccount(groups[0].game, groups[0].uid);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setFileData(JSON.parse(String(reader.result)));
        setNotice(`已读取 ${file.name}`);
      } catch {
        setFileData(null);
        setNotice("文件不是有效的 JSON");
      }
    };
    reader.readAsText(file);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="星迹首页">
          <span className="brand-mark">✦</span>
          <span><b>星迹</b><small>STARTRACE</small></span>
        </a>
        <nav aria-label="主要导航">
          <a className="active" href="#overview">总览</a>
          <a href="#history">抽卡记录</a>
          <a href="#insights">趋势洞察</a>
        </nav>
        <div className="top-actions">
          {authUser ? <>
            <button className="ghost-button" onClick={() => setDialog("migrate")}>迁移旧数据</button>
            <button className="user-button" onClick={() => void logout()} title="点击退出登录">
              <span className="avatar">{authUser.username.slice(0, 1).toUpperCase()}</span>
              <span><b>{authUser.username}</b><small>退出登录</small></span>
            </button>
          </> : <>
            <button className="ghost-button" onClick={() => { setAuthMode("login"); setDialog("auth"); }}>登录 / 注册</button>
            <button className="avatar" aria-label="尚未登录">旅</button>
          </>}
        </div>
      </header>

      <section className="workspace" id="top">
        <aside className="account-rail">
          <div className="rail-heading"><span>账号空间</span><button aria-label="导入账号记录" onClick={() => setDialog(authUser ? "upload" : "auth")}>＋</button></div>
          <div className="game-switch" role="tablist" aria-label="选择游戏">
            {(Object.keys(gameCopy) as GameId[]).map((id) => (
              <button key={id} className={game === id ? "selected" : ""} onClick={() => {
                setGame(id);
                setPool("all");
                setRarityPool("all");
                setHistoryExpanded(false);
                const first = accounts.find((account) => account.game === id);
                if (first) { setActiveUid(first.uid); void loadAccount(id, first.uid); }
                else { setActiveUid(""); setRecords([]); }
              }}>
                <span>{id === "genshin" ? "◇" : "◈"}</span>{gameCopy[id].label}
              </button>
            ))}
          </div>
          <div className="account-list">
            {filteredAccounts.map((account, index) => (
              <button key={`${account.game}-${account.uid}`} className={activeUid === account.uid ? "account-card selected" : "account-card"} onClick={() => {
                setActiveUid(account.uid);
                void loadAccount(account.game, account.uid);
              }}>
                <span className={`account-gem gem-${index + 1}`}>{index === 0 ? "✦" : "✧"}</span>
                <span><b>UID {account.uid}</b><small>{account.total} 抽 · {account.updatedAt}</small></span>
                <i>›</i>
              </button>
            ))}
            {!filteredAccounts.length && <p className="empty-copy rail-empty">暂无账号<br /><span>导入记录后会显示在这里</span></p>}
          </div>
          <div className="privacy-note"><span>♢</span><p><b>UID 独立存放</b><br />每批数据都经过账号一致性校验。</p></div>
        </aside>

        <div className="content" id="overview">
          <div className="page-heading">
            <div><p className="eyebrow">{gameCopy[game].kicker} · UID {activeUid || "未选择账号"}</p><h1>愿每一次相遇，都有迹可循。</h1><p className="subtitle">记录你的旅途，读懂每一次心动的概率。</p></div>
            <div className="heading-actions"><span className="status-pill"><i />{notice}</span><button className="primary-button" onClick={() => { setUploadGame(game); setUploadUid(activeUid.replace(/\s/g, "")); setDialog(authUser ? "upload" : "auth"); }}>↑ 导入记录</button></div>
          </div>

          <section className="hero-grid">
            <article className="pity-card panel">
              <div className="card-top"><span>{poolOptions[game].find((option) => option.id === pityPool)?.label ?? "当前卡池"}</span><span className="soft-tag">统计进行中</span></div>
              <div className="pity-body">
                <div className="orb-wrap">
                  <div className={`orb ${currentPity === null || currentPityInvalid ? "empty" : ""}`} style={{ "--progress": `${currentPity === null || currentPityInvalid ? 0 : Math.min(currentPity / pityLimit * 100, 100)}%` } as React.CSSProperties}>
                    <div><strong>{currentPityInvalid ? "!" : (currentPity ?? "—")}</strong><small>{currentPity === null ? "暂无记录" : currentPityInvalid ? "记录异常" : "/ " + pityLimit + " 抽"}</small></div>
                  </div>
                </div>
                <div className="pity-copy"><p>{currentPity === null ? "保底进度" : currentPityInvalid ? "记录完整性" : "距离下一次五星"}</p><h2>{currentPity === null ? <>等待 <em>导入</em></> : currentPityInvalid ? <>需要 <em>补全记录</em></> : <>还差 <em>{Math.max(0, pityLimit - currentPity)}</em> 抽</>}</h2><div className="guarantee"><span>{currentPity === null ? "未载入" : guaranteeCopy.tag}</span><b>{currentPity === null ? "导入真实记录后自动计算" : guaranteeCopy.detail}</b></div></div>
              </div>
              <div className="pool-tabs">
                {poolOptions[game].map(({ id, label }) => <button key={id} className={pool === id ? "active" : ""} onClick={() => { setPool(id); setHistoryExpanded(false); }}>{label.replace("卡池", "").replace("祈愿", "")}</button>)}
              </div>
            </article>

            <article className="luck-card panel">
              <div className="card-top"><span>幸运画像</span><span className="tiny-help">?</span></div>
              <div className="luck-score"><span className="spark">✦</span><strong>{luckScore ?? "—"}</strong><small>/ 100</small></div>
              <h3>「{luckTitle}」</h3><p title="综合分为65%出金效率与35%非保底UP结果；规则必触发的捕获明光按中性救济计算">{luckScore === null ? "导入记录后自动计算" : `出金效率 ${luck.pityScore} · UP运气 ${luck.upLuckScore}${luck.captureCount ? ` · 明光 ${luck.captureCount} 次` : ""}`}</p>
              <div className="score-line"><i style={{ width: `${luckScore ?? 0}%` }} />{luckScore !== null && <span style={{ left: `${luckScore}%` }} />}</div>
              <div className="score-labels"><span>沉稳</span><span>幸运</span><span>天选</span></div>
            </article>
          </section>

          <section className="metric-grid" aria-label="核心统计">
            <article className="metric panel"><span className="metric-icon purple">◌</span><div><p>总抽数</p><strong>{visible.length}</strong><small>云端当前筛选</small></div></article>
            <article className="metric panel"><span className="metric-icon gold">✦</span><div><p>五星数量</p><strong>{fiveStars.length}</strong><small>{visible.length ? Math.round(fiveStars.length / visible.length * 1000) / 10 : 0}% 出金率</small></div></article>
            <article className="metric panel"><span className="metric-icon blue">⌁</span><div><p>四星数量</p><strong>{fourStars.length}</strong><small>{visible.length ? Math.round(fourStars.length / visible.length * 1000) / 10 : 0}% 出紫率</small></div></article>
            <article className="metric panel"><span className="metric-icon mint">↗</span><div><p>平均出金</p><strong>{averagePity ?? "—"}</strong><small>抽 / 五星</small></div></article>
          </section>

          <section className="analysis-grid" id="insights">
            <article className="timeline-card panel">
              <div className="card-top"><div><span>抽卡活跃趋势</span><small>最近 30 个统计周期</small></div><select className="inline-select" value={trendMode} onChange={(event) => setTrendMode(event.target.value as TrendMode)} aria-label="趋势统计周期"><option value="day">按日</option><option value="week">按周</option><option value="month">按月</option></select></div>
              {trend.length ? <>
                <div className="chart-wrap">
                  <div className="y-axis"><span>{Math.max(...trend.map((point) => point.count))}</span><span>0</span></div>
                  <div className="bars">{trend.map((point) => <i key={point.date} style={{ height: `${point.height}%` }}><span>{point.count} 抽</span></i>)}</div>
                </div>
                <div className="x-axis"><span>{formatTrendDate(trend[0].date)}</span>{trend.length > 1 && <span>{formatTrendDate(trend[trend.length - 1].date)}</span>}</div>
              </> : <div className="chart-empty"><span>⌁</span><b>暂无趋势数据</b><small>导入记录后，这里会按真实日期生成图表</small></div>}
            </article>

            <article className="rarity-card panel">
              <div className="card-top"><span>稀有度分布</span><select className="inline-select" value={rarityPool} onChange={(event) => setRarityPool(event.target.value)} aria-label="稀有度卡池筛选">{poolOptions[game].map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
              <div className="donut-row">
                <div className="donut" style={{ "--five": `${rarity.five * 3.6}deg`, "--four": `${(rarity.five + rarity.four) * 3.6}deg` } as React.CSSProperties}><div><strong>{rarityRecords.length}</strong><small>总抽数</small></div></div>
                <div className="legend">
                  <div><i className="dot five"/><span>五星</span><b>{rarityFiveStars.length}</b><small>{rarity.five}%</small></div>
                  <div><i className="dot four"/><span>四星</span><b>{rarityFourStars.length}</b><small>{rarity.four}%</small></div>
                  <div><i className="dot three"/><span>三星</span><b>{rarityRecords.length - rarityFiveStars.length - rarityFourStars.length}</b><small>{rarity.three}%</small></div>
                </div>
              </div>
            </article>
          </section>

          <section className="history-card panel" id="history">
            <div className="card-top"><div><span>{historyExpanded ? "全部五星记录" : "最近五星记录"}</span><small>按时间从新到旧</small></div><button className="link-button" disabled={allFiveWithPity.length <= 5} onClick={() => setHistoryExpanded((value) => !value)}>{historyExpanded ? "收起记录 ↑" : "查看全部记录 →"}</button></div>
            <div className={historyExpanded ? "five-list expanded" : "five-list"}>
              {fiveWithPity.map((star, index) => (
                <div className="five-row" key={star.recordId}>
                  <span className={`portrait portrait-${index + 1} rarity-${star.rarity}`}>
                    <span aria-hidden="true">{star.itemName.slice(0, 1)}</span>
                    {star.iconUrl && <img // eslint-disable-line @next/next/no-img-element
                      src={star.iconUrl}
                      alt={`${star.itemName}图标`}
                      loading="lazy"
                      className={star.itemType.includes("武器") ? "weapon-icon" : "character-icon"}
                      onError={(event) => event.currentTarget.remove()}
                    />}
                  </span>
                  <div className="item-name"><b>{star.itemName}</b><small>{star.itemType} · {poolLabel(game, star.poolType)}</small></div>
                  <div className="stars">★★★★★</div>
                  <div className={`up-badge status-${star.upStatus}`} title={star.upDetail}><strong>{star.upLabel}</strong><small>{star.upStatus === "off_banner" ? "下次大保底" : star.upStatus === "guaranteed" ? "继承命中" : star.upStatus === "capturing_radiance" ? "规则必触发" : "UP判定"}</small></div>
                  <div className={`pity-badge ${star.isValid && star.pity <= 30 ? "lucky" : ""} ${star.isValid ? "" : "invalid"}`} title={star.isValid ? (star.completeCycle ? `第 ${star.pity} 抽出金` : `现有记录内第 ${star.pity} 抽，较早记录可能不完整`) : `记录内连续 ${star.pity} 抽超过该卡池 ${star.pityLimit} 抽上限`}><strong>{star.isValid ? star.pity : "—"}</strong><small>{star.isValid ? (star.completeCycle ? "抽出金" : "记录内抽数") : "记录异常"}</small></div>
                  <time>{star.pulledAt.slice(0, 10)}</time>
                </div>
              ))}
              {!fiveWithPity.length && <p className="empty-copy">当前筛选范围内还没有五星记录</p>}
            </div>
          </section>

          <footer><span>✦ 星迹 StarTrace</span><p>每个登录账号分别保存原神与鸣潮数据，并继续按游戏与 UID 独立存放。</p></footer>
        </div>
      </section>

      {dialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-label={dialog === "upload" ? "导入抽卡记录" : dialog === "migrate" ? "迁移旧同步空间" : "登录星迹"}>
          <button className="modal-close" onClick={() => setDialog(null)} aria-label="关闭">×</button>
          <span className="modal-glyph">{dialog === "upload" ? "↑" : dialog === "migrate" ? "↗" : "✦"}</span>
          <p className="eyebrow">STARTRACE CLOUD</p>
          {dialog === "auth" && <>
            <h2>{authMode === "login" ? "登录你的账号" : "创建星迹账号"}</h2>
            <p className="modal-intro">登录后，原神与鸣潮会归入同一账号下的两个独立游戏空间，不再互相覆盖。</p>
            <div className="modal-tabs">
              <button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>登录</button>
              <button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>注册</button>
            </div>
            <label><span>用户名</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3–24 位字母、数字或下划线" /></label>
            <label><span>密码</span><input type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 10 位" onKeyDown={(event) => { if (event.key === "Enter") void authenticate(); }} /></label>
            <button className="primary-button modal-submit" disabled={busy} onClick={() => void authenticate()}>{busy ? "处理中…" : authMode === "login" ? "登录账号" : "创建并登录"}</button>
            <p className="secure-copy">◇ 密码使用单向强哈希保存，登录会话仅存于安全 Cookie</p>
          </>}
          {dialog === "migrate" && <>
            <h2>迁移旧同步空间</h2>
            <p className="modal-intro">只需输入一次旧同步密钥。服务器会把该空间内的原神和鸣潮记录一起迁入当前账号，并保留游戏与 UID 分组。</p>
            <div className="migration-callout"><b>不会合并成同一份数据</b><span>重复记录会自动跳过，迁移完成后旧空间将停用。</span></div>
            <label><span>旧同步密钥</span><input type="password" value={legacyKey} onChange={(event) => setLegacyKey(event.target.value)} placeholder="输入此前使用的完整密钥" /></label>
            <button className="primary-button modal-submit" disabled={busy} onClick={() => void migrateLegacyData()}>{busy ? "迁移中…" : "迁移并保留全部记录"}</button>
            <p className="secure-copy">◇ 密钥仅用于本次迁移，不会保存原文</p>
          </>}
          {dialog === "upload" && <>
            <h2>导入抽卡记录</h2>
            <p className="modal-intro">支持 FufuLauncher / UIGF JSON 与 Haiyu JSON；上传前会校验每条记录的数据源 UID。</p>
            <div className="form-row">
              <label><span>游戏</span><select value={uploadGame} onChange={(event) => setUploadGame(event.target.value as GameId)}><option value="genshin">原神</option><option value="wuwa">鸣潮</option></select></label>
              <label><span>数据源 UID</span><input inputMode="numeric" value={uploadUid} onChange={(event) => setUploadUid(event.target.value.replace(/\D/g, ""))} placeholder="鸣潮导入时必填" /></label>
            </div>
            <label className="dropzone"><input type="file" accept=".json,application/json" onChange={readFile}/><span>＋</span><b>{fileData ? "记录文件已就绪" : "选择 JSON 记录文件"}</b><small>单次最多 10,000 条；不同 UID 将分别写入</small></label>
            <button className="primary-button modal-submit" disabled={busy} onClick={() => void upload()}>{busy ? "处理中…" : "校验并上传"}</button>
            <p className="secure-copy">◇ 当前登录：{authUser?.username} · 游戏与 UID 独立写入</p>
          </>}
        </section>
      </div>}
    </main>
  );
}
