import assert from "node:assert/strict";
import test from "node:test";

import { annotateUpStatuses } from "../lib/up-status.ts";

const emptyCatalog = {
  genshinWindows: [],
  wuwaUpRoleIds: new Set(),
  wuwaUpWeaponIds: new Set(),
  wuwaKnownRoleIds: new Set(),
};

function row(recordId, poolType, itemId, itemName, pulledAt) {
  return {
    record_id: recordId,
    pool_type: poolType,
    item_id: itemId,
    item_name: itemName,
    rarity: 5,
    pulled_at: pulledAt,
  };
}

test("uses historical Genshin banners before treating a standard character as off-banner", () => {
  const catalog = {
    ...emptyCatalog,
    genshinWindows: [{
      poolType: "301",
      start: "2022-08-24 07:00:00",
      end: "2022-09-09 17:59:59",
      featuredNames: new Set(["提纳里"]),
    }],
  };
  const [tighnari] = annotateUpStatuses("genshin", [
    row("1", "301", "", "提纳里", "2022-08-25 12:00:00"),
  ], catalog);
  assert.equal(tighnari.up_status, "featured");
});

test("inherits character guarantee across Genshin pool types 301 and 400", () => {
  const catalog = {
    ...emptyCatalog,
    genshinWindows: [{
      poolType: "301",
      start: "2023-01-01 00:00:00",
      end: "2023-12-31 23:59:59",
      featuredNames: new Set(["胡桃"]),
    }],
  };
  const [huTao, qiqi] = annotateUpStatuses("genshin", [
    row("new", "301", "", "胡桃", "2023-02-10 12:00:00"),
    row("old", "400", "", "七七", "2023-02-01 12:00:00"),
  ], catalog);
  assert.equal(qiqi.up_status, "off_banner");
  assert.equal(huTao.up_status, "guaranteed");
});

test("identifies the forced Capture Radiance after three second-five-star UP cycles", () => {
  const catalog = {
    ...emptyCatalog,
    genshinWindows: [{
      poolType: "301",
      start: "2026-01-01 00:00:00",
      end: "2026-12-31 23:59:59",
      featuredNames: new Set(["爱可菲", "莉奈娅", "桑多涅", "奥黛塔"]),
    }],
  };
  const results = annotateUpStatuses("genshin", [
    row("7", "301", "", "奥黛塔", "2026-08-12 12:00:00"),
    row("6", "301", "", "桑多涅", "2026-07-01 12:00:00"),
    row("5", "301", "", "梦见月瑞希", "2026-05-20 12:00:00"),
    row("4", "301", "", "莉奈娅", "2026-04-19 12:00:00"),
    row("3", "301", "", "刻晴", "2026-04-08 12:00:00"),
    row("2", "301", "", "爱可菲", "2026-03-18 12:00:00"),
    row("1", "301", "", "梦见月瑞希", "2026-02-25 12:00:00"),
  ], catalog);

  assert.deepEqual(results.map((result) => result.up_status), [
    "capturing_radiance", "guaranteed", "off_banner", "guaranteed",
    "off_banner", "guaranteed", "off_banner",
  ]);
  assert.equal(results[0].up_label, "捕获明光");
});

test("keeps Genshin weapon promotional guarantee while not pretending to know Fate Points", () => {
  const catalog = {
    ...emptyCatalog,
    genshinWindows: [
      { poolType: "302", start: "2023-01-01 00:00:00", end: "2023-01-31 23:59:59", featuredNames: new Set(["雾切之回光"]) },
      { poolType: "302", start: "2023-02-01 00:00:00", end: "2023-02-28 23:59:59", featuredNames: new Set(["护摩之杖"]) },
    ],
  };
  const [homa, skyward] = annotateUpStatuses("genshin", [
    row("new", "302", "", "护摩之杖", "2023-02-10 12:00:00"),
    row("old", "302", "", "天空之翼", "2023-01-10 12:00:00"),
  ], catalog);
  assert.equal(skyward.up_status, "off_banner");
  assert.equal(homa.up_status, "guaranteed");
});

test("marks Wuthering Waves character loss, inherited guarantee, and weapon certainty", () => {
  const catalog = {
    ...emptyCatalog,
    wuwaUpRoleIds: new Set(["1511"]),
    wuwaUpWeaponIds: new Set(["21020096"]),
    wuwaKnownRoleIds: new Set(["1405", "1511"]),
  };
  const [lucy, jianxin] = annotateUpStatuses("wuwa", [
    row("new", "10", "1511", "露西", "2026-06-25 16:55:06"),
    row("old", "10", "1405", "鉴心", "2026-06-20 14:24:05"),
  ], catalog);
  const [weapon] = annotateUpStatuses("wuwa", [
    row("weapon", "2", "21020096", "天之苍苍", "2026-07-11 07:42:04"),
  ], catalog);
  assert.equal(jianxin.up_status, "off_banner");
  assert.equal(lucy.up_status, "guaranteed");
  assert.equal(weapon.up_status, "always_featured");
});
