import type { GameId } from "./gacha-store";

type IconSourceItem = {
  id?: number | string;
  name?: string;
  icon?: string;
};

type IconCatalog = {
  byId: Map<string, string>;
  byName: Map<string, string>;
};

type RecordRow = Record<string, string | number | null>;

const EMPTY_CATALOG: IconCatalog = {
  byId: new Map(),
  byName: new Map(),
};
const GENSHIN_AVATAR_API =
  "https://api-takumi.mihoyo.com/event/e20200928calculate/v1/avatar/list";
const GENSHIN_WEAPON_API =
  "https://api-takumi.mihoyo.com/event/e20200928calculate/v1/weapon/list";
const WUWA_AVATAR_API = "https://mc.appfeng.com/json/avatar.json";
const WUWA_WEAPON_API = "https://mc.appfeng.com/json/weapon.json";
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

let genshinCache: { expiresAt: number; value: Promise<IconCatalog> } | null = null;
let wuwaCache: { expiresAt: number; value: Promise<IconCatalog> } | null = null;

function addItem(catalog: IconCatalog, item: IconSourceItem, iconUrl?: string) {
  if (!iconUrl || !/^https:\/\//i.test(iconUrl)) return;
  const id = String(item.id ?? "").trim();
  const name = String(item.name ?? "").trim();
  if (id) catalog.byId.set(id, iconUrl);
  if (name) catalog.byName.set(name, iconUrl);
}

async function fetchGenshinList(url: string, payload: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://act.mihoyo.com",
      "Referer": "https://act.mihoyo.com/ys/event/calculator/index.html",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Genshin icon metadata returned ${response.status}`);
  const body = await response.json() as {
    retcode?: number;
    data?: { list?: IconSourceItem[] };
  };
  if (body.retcode !== 0 || !Array.isArray(body.data?.list)) return [];
  return body.data.list;
}

async function loadGenshinCatalog(): Promise<IconCatalog> {
  try {
    const [avatars, weapons] = await Promise.all([
      fetchGenshinList(GENSHIN_AVATAR_API, { page: 1, size: 1000, is_all: true }),
      fetchGenshinList(GENSHIN_WEAPON_API, {
        page: 1,
        size: 1000,
        weapon_levels: [1, 2, 3, 4, 5],
      }),
    ]);
    const catalog: IconCatalog = { byId: new Map(), byName: new Map() };
    for (const item of [...avatars, ...weapons]) addItem(catalog, item, item.icon);
    return catalog;
  } catch (error) {
    console.warn("Unable to refresh Genshin item icons", error);
    return EMPTY_CATALOG;
  }
}

async function fetchWuwaList(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Wuthering Waves icon metadata returned ${response.status}`);
  const body = await response.json();
  return Array.isArray(body) ? body as IconSourceItem[] : [];
}

async function loadWuwaCatalog(): Promise<IconCatalog> {
  try {
    const [avatars, weapons] = await Promise.all([
      fetchWuwaList(WUWA_AVATAR_API),
      fetchWuwaList(WUWA_WEAPON_API),
    ]);
    const catalog: IconCatalog = { byId: new Map(), byName: new Map() };
    for (const item of avatars) {
      const icon = String(item.icon ?? "");
      if (/^[A-Za-z0-9_]+$/.test(icon)) {
        addItem(catalog, item, `https://mc.appfeng.com/ui/avatar/${icon}.png`);
      }
    }
    for (const item of weapons) {
      const icon = String(item.icon ?? "");
      if (/^[A-Za-z0-9_]+$/.test(icon)) {
        addItem(catalog, item, `https://mc.appfeng.com/ui/weapon/${icon}.png`);
      }
    }
    return catalog;
  } catch (error) {
    console.warn("Unable to refresh Wuthering Waves item icons", error);
    return EMPTY_CATALOG;
  }
}

function catalogFor(game: GameId) {
  const now = Date.now();
  if (game === "genshin") {
    if (!genshinCache || genshinCache.expiresAt <= now) {
      genshinCache = { expiresAt: now + CATALOG_TTL_MS, value: loadGenshinCatalog() };
    }
    return genshinCache.value;
  }
  if (!wuwaCache || wuwaCache.expiresAt <= now) {
    wuwaCache = { expiresAt: now + CATALOG_TTL_MS, value: loadWuwaCatalog() };
  }
  return wuwaCache.value;
}

export async function addIconUrls(game: GameId, records: RecordRow[]) {
  const catalog = await catalogFor(game);
  return records.map((record) => {
    const itemId = String(record.item_id ?? "").trim();
    const itemName = String(record.item_name ?? "").trim();
    const iconUrl = (itemId ? catalog.byId.get(itemId) : undefined)
      ?? (itemName ? catalog.byName.get(itemName) : undefined)
      ?? null;
    return { ...record, icon_url: iconUrl };
  });
}
