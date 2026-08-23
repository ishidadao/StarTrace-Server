import assert from "node:assert/strict";
import test from "node:test";

import {
  assignDrawOrders,
  calculateCurrentPity,
  calculateFiveStarPities,
  canonicalPool,
  summarizeLuck,
  summarizePities,
} from "../lib/gacha-stats.ts";

function pull(recordId, poolType, rarity) {
  return { recordId, poolType, rarity };
}

test("merges Genshin character event pool 400 into shared pity pool 301", () => {
  assert.equal(canonicalPool("genshin", "400"), "301");

  const records = [
    pull("new-standard", "200", 3),
    pull("lauma", "301", 5),
    ...Array.from({ length: 19 }, (_, index) => pull(`301-${index}`, "301", 3)),
    ...Array.from({ length: 54 }, (_, index) => pull(`400-${index}`, "400", 3)),
    ...Array.from({ length: 49 }, (_, index) => pull(`other-${index}`, index < 47 ? "200" : "302", 3)),
    pull("ineffa", "301", 5),
  ];

  const stars = calculateFiveStarPities(records, "genshin");
  const lauma = stars.find((star) => star.recordId === "lauma");
  assert.equal(lauma?.pity, 74);
  assert.equal(lauma?.pityLimit, 90);
  assert.equal(lauma?.completeCycle, true);
  assert.equal(lauma?.isValid, true);
});

test("counts forced Capture Radiance separately and treats it as a neutral rescue", () => {
  const result = summarizeLuck([
    { pity: 50, pityLimit: 90, completeCycle: true, isValid: true, poolType: "301", upStatus: "capturing_radiance" },
    { pity: 50, pityLimit: 90, completeCycle: true, isValid: true, poolType: "301", upStatus: "guaranteed" },
    { pity: 50, pityLimit: 90, completeCycle: true, isValid: true, poolType: "301", upStatus: "off_banner" },
    { pity: 50, pityLimit: 90, completeCycle: true, isValid: true, poolType: "301", upStatus: "guaranteed" },
    { pity: 50, pityLimit: 90, completeCycle: true, isValid: true, poolType: "301", upStatus: "off_banner" },
    { pity: 50, pityLimit: 90, completeCycle: true, isValid: true, poolType: "301", upStatus: "guaranteed" },
    { pity: 50, pityLimit: 90, completeCycle: true, isValid: true, poolType: "301", upStatus: "off_banner" },
  ], "genshin");

  assert.equal(result.captureCount, 1);
  assert.equal(result.offBannerCount, 3);
  assert.equal(result.pityScore, 45);
  assert.equal(result.upLuckScore, 9);
  assert.equal(result.luckScore, 32);
});

test("keeps each pool independent in all-pool history", () => {
  const records = [
    pull("latest", "301", 3),
    pull("weapon-gold", "302", 5),
    pull("character-gold", "301", 5),
    pull("weapon", "302", 3),
    pull("character", "400", 3),
    pull("older-character-gold", "301", 5),
  ];

  const stars = calculateFiveStarPities(records, "genshin");
  assert.equal(stars.find((star) => star.recordId === "character-gold")?.pity, 2);
  assert.equal(stars.find((star) => star.recordId === "weapon-gold")?.pity, 2);
  assert.equal(calculateCurrentPity(records, "genshin", "301"), 1);
});

test("preserves Wuthering Waves ten-pull order when every draw has the same timestamp", () => {
  const records = [
    { recordId: "newer", poolType: "1", rarity: 3, pulledAt: "2026-08-22 10:00:00" },
    { recordId: "after-gold", poolType: "1", rarity: 3, pulledAt: "2026-08-21 10:11:43" },
    { recordId: "gold", poolType: "1", rarity: 5, pulledAt: "2026-08-21 10:11:43" },
    { recordId: "older", poolType: "1", rarity: 3, pulledAt: "2026-08-21 10:11:43" },
  ];

  assert.deepEqual(assignDrawOrders(records, "wuwa"), [1, 1, 2, 3]);
  assert.equal(calculateCurrentPity(records, "wuwa", "1"), 2);
});

test("averages complete pity cycles when older history is incomplete", () => {
  assert.deepEqual(summarizePities([
    { pity: 74, pityLimit: 90, completeCycle: true, isValid: true },
    { pity: 10, pityLimit: 90, completeCycle: false, isValid: true },
    { pity: 96, pityLimit: 90, completeCycle: true, isValid: false },
  ]), {
    averagePity: 74,
    luckScore: 18,
  });
});
