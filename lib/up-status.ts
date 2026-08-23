import type { GameId } from "./gacha-store";
import { canonicalPool } from "./gacha-stats.ts";

export type UpStatus =
  | "featured"
  | "capturing_radiance"
  | "guaranteed"
  | "off_banner"
  | "always_featured"
  | "not_applicable"
  | "unknown"
  | "inconsistent";

type RecordRow = Record<string, string | number | null>;

type GenshinBannerWindow = {
  poolType: "301" | "302" | "500";
  start: string;
  end: string;
  featuredNames: Set<string>;
};

export type UpCatalog = {
  genshinWindows: GenshinBannerWindow[];
  wuwaUpRoleIds: Set<string>;
  wuwaUpWeaponIds: Set<string>;
  wuwaKnownRoleIds: Set<string>;
};

type AnnotatedStatus = {
  up_status: UpStatus;
  up_label: string;
  up_detail: string;
};

const GENSHIN_HISTORY_API = "https://api.yshelper.com/ys/getWishHistory.php?lang=zh-Hans";
const WUWA_HISTORY_API = "https://api3.sanyueqi.cn/api/v1/pool/draw_config_infos";
const WUWA_AVATAR_API = "https://mc.appfeng.com/json/avatar.json";
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000;

const GENSHIN_STANDARD_CHARACTERS = new Set([
  "琴", "迪卢克", "莫娜", "刻晴", "七七", "提纳里", "迪希雅", "梦见月瑞希",
]);

const GENSHIN_STANDARD_WEAPONS = new Set([
  "天空之刃", "天空之傲", "天空之脊", "天空之翼", "天空之卷",
  "阿莫斯之弓", "和璞鸢", "四风原典", "狼的末路", "风鹰剑",
]);

const EMPTY_CATALOG: UpCatalog = {
  genshinWindows: [],
  wuwaUpRoleIds: new Set(),
  wuwaUpWeaponIds: new Set(),
  wuwaKnownRoleIds: new Set(),
};

let genshinCache: { expiresAt: number; value: Promise<UpCatalog> } | null = null;
let wuwaCache: { expiresAt: number; value: Promise<UpCatalog> } | null = null;

function text(value: unknown, maximum = 80) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`metadata returned ${response.status}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizedDate(value: string) {
  const parts = value.replaceAll("/", "-").split("-");
  if (parts.length !== 3) return value;
  return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
}

function parseGenshinWindow(value: unknown, requestedPool: "301" | "302") {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const version = text(row.version);
  const range = text(row.time);
  const dates = range.match(/(\d{4}[/-]\d{1,2}[/-]\d{1,2})\s*-\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2})/);
  if (!dates) return null;

  const isChronicled = version.includes("混池");
  const poolType = isChronicled ? "500" : requestedPool;
  const isFirstHalf = version.includes("上半");
  const start = `${normalizedDate(dates[1])} ${isFirstHalf ? "07:00:00" : "18:00:00"}`;
  const end = `${normalizedDate(dates[2])} ${isFirstHalf ? "17:59:59" : "14:59:59"}`;
  const names = Array.isArray(row.star5_role)
    ? row.star5_role.map((name) => text(name)).filter(Boolean)
    : [];
  return { poolType, start, end, featuredNames: new Set(names) } satisfies GenshinBannerWindow;
}

async function loadGenshinCatalog(): Promise<UpCatalog> {
  try {
    const body = await fetchJson(GENSHIN_HISTORY_API) as Record<string, unknown>;
    const windows: GenshinBannerWindow[] = [];
    for (const row of Array.isArray(body.result) ? body.result : []) {
      const window = parseGenshinWindow(row, "301");
      if (window) windows.push(window);
    }
    for (const row of Array.isArray(body.weapon) ? body.weapon : []) {
      const window = parseGenshinWindow(row, "302");
      if (window) windows.push(window);
    }
    return { ...EMPTY_CATALOG, genshinWindows: windows };
  } catch (error) {
    console.warn("Unable to refresh Genshin banner history", error);
    return EMPTY_CATALOG;
  }
}

async function loadWuwaCatalog(): Promise<UpCatalog> {
  try {
    const [historyValue, avatarsValue] = await Promise.all([
      fetchJson(WUWA_HISTORY_API),
      fetchJson(WUWA_AVATAR_API),
    ]);
    const history = historyValue as {
      data?: {
        version_pools?: Array<Record<string, unknown>>;
        pool_list?: Array<Record<string, unknown>>;
      };
    };
    const upRoleIds = new Set<string>();
    const upWeaponIds = new Set<string>();
    for (const pool of Array.isArray(history.data?.version_pools) ? history.data.version_pools : []) {
      for (const id of Array.isArray(pool.up_five_role_ids) ? pool.up_five_role_ids : []) {
        const value = String(id).trim();
        if (/^\d{3,12}$/.test(value)) upRoleIds.add(value);
      }
      for (const id of Array.isArray(pool.up_five_weapon_ids) ? pool.up_five_weapon_ids : []) {
        const value = String(id).trim();
        if (/^\d{3,12}$/.test(value)) upWeaponIds.add(value);
      }
    }
    for (const pool of Array.isArray(history.data?.pool_list) ? history.data.pool_list : []) {
      const ids = text(pool.up_five_ids, 240).split(",").map((id) => id.trim()).filter(Boolean);
      const target = text(pool.type) === "weapon" ? upWeaponIds : upRoleIds;
      for (const id of ids) {
        if (/^\d{3,12}$/.test(id)) target.add(id);
      }
    }

    const knownRoleIds = new Set<string>();
    if (Array.isArray(avatarsValue)) {
      for (const avatar of avatarsValue) {
        if (!avatar || typeof avatar !== "object") continue;
        const id = String((avatar as Record<string, unknown>).id ?? "").trim();
        if (/^\d{3,12}$/.test(id)) knownRoleIds.add(id);
      }
    }
    return {
      ...EMPTY_CATALOG,
      wuwaUpRoleIds: upRoleIds,
      wuwaUpWeaponIds: upWeaponIds,
      wuwaKnownRoleIds: knownRoleIds,
    };
  } catch (error) {
    console.warn("Unable to refresh Wuthering Waves banner history", error);
    return EMPTY_CATALOG;
  }
}

async function catalogFor(game: GameId) {
  const now = Date.now();
  if (game === "genshin") {
    if (!genshinCache || genshinCache.expiresAt <= now) {
      genshinCache = { expiresAt: now + HISTORY_TTL_MS, value: loadGenshinCatalog() };
    }
    return genshinCache.value;
  }
  if (!wuwaCache || wuwaCache.expiresAt <= now) {
    wuwaCache = { expiresAt: now + HISTORY_TTL_MS, value: loadWuwaCatalog() };
  }
  return wuwaCache.value;
}

function baseStatus(game: GameId, record: RecordRow, catalog: UpCatalog): UpStatus {
  const pool = canonicalPool(game, String(record.pool_type ?? ""));
  const itemId = String(record.item_id ?? "").trim();
  const itemName = String(record.item_name ?? "").trim();
  const pulledAt = String(record.pulled_at ?? "").trim();

  if (game === "genshin") {
    if (pool !== "301" && pool !== "302") return "not_applicable";
    const windows = catalog.genshinWindows.filter((window) =>
      window.poolType === pool && pulledAt >= window.start && pulledAt <= window.end,
    );
    if (!windows.length) return "unknown";
    if (windows.some((window) => window.featuredNames.has(itemName))) return "featured";
    if (pool === "301" && GENSHIN_STANDARD_CHARACTERS.has(itemName)) return "off_banner";
    if (pool === "302" && GENSHIN_STANDARD_WEAPONS.has(itemName)) return "off_banner";
    return "unknown";
  }

  if (pool === "1" || pool === "10") {
    if (catalog.wuwaUpRoleIds.has(itemId)) return "featured";
    if (catalog.wuwaKnownRoleIds.has(itemId)) return "off_banner";
    return "unknown";
  }
  if (pool === "2" || pool === "11") {
    return catalog.wuwaUpWeaponIds.has(itemId) ? "always_featured" : "unknown";
  }
  return "not_applicable";
}

function copyFor(status: UpStatus, game: GameId, pool: string): AnnotatedStatus {
  switch (status) {
    case "featured":
      return {
        up_status: status,
        up_label: "UP",
        up_detail: game === "genshin" && pool === "301"
          ? "当期UP；抽卡记录无法区分普通命中与捕获明光"
          : "当期UP",
      };
    case "capturing_radiance":
      return {
        up_status: status,
        up_label: "捕获明光",
        up_detail: "连续三轮均在第二个五星获得UP，本次按规则必定触发捕获明光",
      };
    case "guaranteed":
      return { up_status: status, up_label: "大保底", up_detail: "上一次五星歪出，本次为继承的大保底UP" };
    case "off_banner":
      return { up_status: status, up_label: "歪", up_detail: "非当期UP；该卡池下一位五星进入大保底" };
    case "always_featured":
      return { up_status: status, up_label: "必中", up_detail: "鸣潮限定武器五星必为当期UP武器" };
    case "inconsistent":
      return { up_status: status, up_label: "异常", up_detail: "连续出现非UP五星，与大保底规则冲突，记录可能不完整" };
    case "not_applicable":
      return { up_status: status, up_label: "独立", up_detail: "该卡池不使用限定UP歪/大保底判定" };
    default:
      return { up_status: "unknown", up_label: "待判定", up_detail: "缺少对应历史卡池或物品信息" };
  }
}

export function annotateUpStatuses(
  game: GameId,
  records: RecordRow[],
  catalog: UpCatalog,
) {
  const results: AnnotatedStatus[] = records.map(() => copyFor("not_applicable", game, ""));
  const guaranteeByPool = new Map<string, boolean | null>();
  const secondHitStreakByPool = new Map<string, number>();

  // Records are returned newest first. Guarantee state must be replayed from
  // oldest to newest and remains independent for every canonical pool.
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (Number(record.rarity) !== 5) continue;
    const pool = canonicalPool(game, String(record.pool_type ?? ""));
    const base = baseStatus(game, record, catalog);
    const previousGuarantee = guaranteeByPool.get(pool) ?? false;
    const secondHitStreak = secondHitStreakByPool.get(pool) ?? 0;
    const usesCapturingRadiance = game === "genshin" && pool === "301";
    let resolved = base;

    if (base === "featured") {
      if (previousGuarantee === true) {
        resolved = "guaranteed";
        if (usesCapturingRadiance) secondHitStreakByPool.set(pool, secondHitStreak + 1);
      } else if (usesCapturingRadiance && secondHitStreak >= 3) {
        resolved = "capturing_radiance";
        secondHitStreakByPool.set(pool, 0);
      } else {
        resolved = "featured";
        if (usesCapturingRadiance) secondHitStreakByPool.set(pool, 0);
      }
      guaranteeByPool.set(pool, false);
    } else if (base === "off_banner") {
      if (previousGuarantee === true) {
        resolved = "inconsistent";
        guaranteeByPool.set(pool, null);
        if (usesCapturingRadiance) secondHitStreakByPool.set(pool, 0);
      } else if (usesCapturingRadiance && secondHitStreak >= 3) {
        resolved = "inconsistent";
        guaranteeByPool.set(pool, null);
        secondHitStreakByPool.set(pool, 0);
      } else {
        guaranteeByPool.set(pool, true);
      }
    } else if (base === "unknown") {
      guaranteeByPool.set(pool, null);
      if (usesCapturingRadiance) secondHitStreakByPool.set(pool, 0);
    } else if (base === "always_featured") {
      guaranteeByPool.set(pool, false);
    }

    results[index] = copyFor(resolved, game, pool);
  }

  return records.map((record, index) => ({ ...record, ...results[index] }));
}

export async function addUpStatuses(game: GameId, records: RecordRow[]) {
  return annotateUpStatuses(game, records, await catalogFor(game));
}
