export type StatsGameId = "genshin" | "wuwa";

export type PityRecord = {
  recordId: string;
  poolType: string;
  rarity: number;
};

type DrawOrderRecord = {
  poolType: string;
  pulledAt: string;
};

export type FiveStarPity = {
  pity: number;
  pityLimit: number;
  completeCycle: boolean;
  isValid: boolean;
};

const genshinPoolAliases: Record<string, string> = {
  "100": "100",
  "200": "200",
  "301": "301",
  "400": "301",
  "302": "302",
  "500": "500",
  "新手祈愿": "100",
  "常驻祈愿": "200",
  "角色活动": "301",
  "角色活动祈愿": "301",
  "角色活动祈愿-2": "301",
  "武器活动": "302",
  "武器活动祈愿": "302",
  "集录祈愿": "500",
};

const wuwaPoolAliases: Record<string, string> = {
  "1": "1", "角色活动": "1", "角色活动唤取": "1", "角色精准调谐": "1",
  "2": "2", "武器活动": "2", "武器活动唤取": "2", "武器精准调谐": "2",
  "3": "3", "角色常驻": "3", "角色常驻唤取": "3", "角色调谐（常驻池）": "3",
  "4": "4", "武器常驻": "4", "武器常驻唤取": "4", "武器调谐（常驻池）": "4",
  "5": "5", "新手唤取": "5", "新手调谐": "5",
  "6": "6", "新手自选": "6", "新手自选唤取": "6",
  "7": "7", "感恩定向": "7", "感恩定向唤取": "7",
  "8": "8", "角色新旅": "8", "角色新旅唤取": "8",
  "9": "9", "武器新旅": "9", "武器新旅唤取": "9",
  "10": "10", "角色联动": "10", "角色联动唤取": "10",
  "11": "11", "武器联动": "11", "武器联动唤取": "11",
};

export function canonicalPool(game: StatsGameId, poolType: string) {
  const value = poolType.trim();
  return game === "genshin"
    ? (genshinPoolAliases[value] ?? value)
    : (wuwaPoolAliases[value] ?? value);
}

export function pityLimitFor(game: StatsGameId, poolType: string) {
  const pool = canonicalPool(game, poolType);
  if (game === "genshin") {
    if (pool === "100") return 20;
    if (pool === "302") return 80;
    return 90;
  }
  return pool === "5" ? 50 : 80;
}

export function assignDrawOrders(
  records: readonly DrawOrderRecord[],
  game: StatsGameId,
) {
  if (game !== "wuwa") return records.map(() => 0);

  const counts = new Map<string, number>();
  return records.map((record) => {
    const key = `${canonicalPool(game, record.poolType)}\u0000${record.pulledAt}`;
    const order = (counts.get(key) ?? 0) + 1;
    counts.set(key, order);
    return order;
  });
}

export function calculateCurrentPity(
  records: readonly PityRecord[],
  game: StatsGameId,
  poolType: string,
) {
  const pool = canonicalPool(game, poolType);
  let count = 0;
  let foundPoolRecord = false;

  for (const record of records) {
    if (canonicalPool(game, record.poolType) !== pool) continue;
    foundPoolRecord = true;
    if (record.rarity === 5) break;
    count += 1;
  }

  return foundPoolRecord ? count : null;
}

export function calculateFiveStarPities<T extends PityRecord>(
  records: readonly T[],
  game: StatsGameId,
): Array<T & FiveStarPity> {
  const counters = new Map<string, number>();
  const poolsWithEarlierFiveStar = new Set<string>();
  const results: Array<FiveStarPity | undefined> = new Array(records.length);

  // The API returns newest records first. Walking from oldest to newest lets
  // each pool maintain its own independent pity counter.
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    const pool = canonicalPool(game, record.poolType);
    const pity = (counters.get(pool) ?? 0) + 1;
    counters.set(pool, pity);

    if (record.rarity !== 5) continue;
    const pityLimit = pityLimitFor(game, pool);
    results[index] = {
      pity,
      pityLimit,
      completeCycle: poolsWithEarlierFiveStar.has(pool),
      isValid: pity <= pityLimit,
    };
    counters.set(pool, 0);
    poolsWithEarlierFiveStar.add(pool);
  }

  return records.flatMap((record, index) => {
    const result = results[index];
    return result ? [{ ...record, ...result }] : [];
  });
}

export function summarizePities(stars: readonly FiveStarPity[]) {
  const valid = stars.filter((star) => star.isValid);
  if (!valid.length) return { averagePity: null, luckScore: null };

  // The oldest imported five-star in each pool may begin mid-cycle. Prefer
  // complete cycles, and only fall back when an account has no complete cycle.
  const complete = valid.filter((star) => star.completeCycle);
  const sample = complete.length ? complete : valid;
  const averagePity = Math.round(
    sample.reduce((total, star) => total + star.pity, 0) / sample.length,
  );
  const averageProgress = sample.reduce(
    (total, star) => total + ((star.pity - 1) / Math.max(1, star.pityLimit - 1)),
    0,
  ) / sample.length;
  const luckScore = Math.round(Math.max(0, Math.min(100, 100 - averageProgress * 100)));

  return { averagePity, luckScore };
}

type LuckStar = FiveStarPity & {
  poolType: string;
  upStatus?: string;
};

export function summarizeLuck(stars: readonly LuckStar[], game: StatsGameId) {
  const valid = stars.filter((star) => star.isValid);
  if (!valid.length) {
    return {
      luckScore: null,
      pityScore: null,
      upLuckScore: null,
      captureCount: 0,
      offBannerCount: 0,
    };
  }

  const complete = valid.filter((star) => star.completeCycle);
  const sample = complete.length ? complete : valid;
  const averageProgress = sample.reduce(
    (total, star) => total + ((star.pity - 1) / Math.max(1, star.pityLimit - 1)),
    0,
  ) / sample.length;
  const pityScore = Math.round(Math.max(0, Math.min(100, 100 - averageProgress * 100)));

  let chanceDelta = 0;
  let chanceSamples = 0;
  let captureCount = 0;
  let offBannerCount = 0;

  for (const star of sample) {
    const pool = canonicalPool(game, star.poolType);
    if (star.upStatus === "capturing_radiance") {
      // Forced Capture Radiance is a safety-net outcome, not a lucky roll.
      // Keep it visible as a separate event and give it a neutral UP result.
      captureCount += 1;
      chanceSamples += 1;
      continue;
    }
    if (star.upStatus !== "featured" && star.upStatus !== "off_banner") continue;

    const expected = game === "genshin"
      ? (pool === "301" ? 0.55 : pool === "302" ? 0.75 : null)
      : (pool === "1" || pool === "10" ? 0.5 : null);
    if (expected === null) continue;
    chanceDelta += (star.upStatus === "featured" ? 1 : 0) - expected;
    chanceSamples += 1;
    if (star.upStatus === "off_banner") offBannerCount += 1;
  }

  const upLuckScore = chanceSamples
    ? Math.round(Math.max(0, Math.min(100, 50 + (chanceDelta / chanceSamples) * 100)))
    : 50;
  const luckScore = Math.round(pityScore * 0.65 + upLuckScore * 0.35);

  return { luckScore, pityScore, upLuckScore, captureCount, offBannerCount };
}
