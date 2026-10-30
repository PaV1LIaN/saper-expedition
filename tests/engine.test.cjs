'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const Engine = require('../dist/engine.js');

function seeded(seed = 12345, sector = 1) {
  const game = new Engine();
  game.state.seed = game.state.rngState = seed;
  game.state.sector = sector;
  game._newBoard();
  return game;
}

function invariant(game) {
  const s = game.state;
  assert.ok(s.hp >= 0 && s.hp <= s.maxHp);
  assert.ok(s.energy >= 0 && s.energy <= s.maxEnergy);
  assert.ok(s.shields >= 0 && s.shields <= s.maxShields);
  assert.ok(s.cells.every(c => !(c.revealed && c.flagged)));
  if (!s.generated) return;
  assert.equal(s.mineCount, s.cells.filter(c => c.mine).length);
  assert.equal(s.safeTotal, 100 - s.mineCount);
  assert.equal(s.revealedSafe, s.cells.filter(c => c.revealed && !c.mine).length);
  for (let i = 0; i < 100; i++) assert.equal(s.cells[i].n, Engine.neighbors(i).filter(j => s.cells[j].mine).length);
  const restored = new Engine(game.serialize());
  assert.equal(restored.loaded, true, 'Every live state must restore');
  assert.deepEqual(restored.state, s);
}

function revealToExit(game, full = false) {
  if (!game.state.generated) game.open(44);
  for (let i = 0; i < 100 && (full ? !game.getInfo().fullClear : !game.getInfo().canExtract); i++) {
    if (!game.state.cells[i].mine && !game.state.cells[i].revealed) {
      if (game.state.cells[i].flagged) game.flag(i);
      game.open(i);
    }
  }
  assert.equal(game.getInfo().canExtract, true);
}

test('Safe first opening protects corners, edges and center over 60 seeds', () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const index of [0, 9, 90, 99, 4, 40, 49, 94, 44]) {
      const game = seeded(seed, 1 + seed % 60);
      assert.equal(game.open(index).ok, true);
      for (const i of Engine.neighbors(index, 1, true)) assert.equal(game.state.cells[i].mine, false);
      assert.equal(game.state.hp, 3);
      assert.ok(game.state.shields >= 1, 'A first flood may find additional shields, but cannot lose one');
      invariant(game);
    }
  }
});

test('Deterministic state round trip preserves future generations and RNG', () => {
  const game = seeded();
  game.open(44);
  game.probe();
  const restored = new Engine(game.snapshot());
  assert.equal(restored.loaded, true);
  assert.deepEqual(restored.probe(), game.probe());
  assert.deepEqual(restored.snapshot(), game.snapshot());
  revealToExit(game);
  game.extract();
  const camp = new Engine(game.serialize());
  assert.equal(camp.loaded, true);
  const id = game.state.offers[0];
  assert.deepEqual(camp.chooseUpgrade(id), game.chooseUpgrade(id));
  camp.open(0); game.open(0);
  assert.deepEqual(camp.state, game.state);
});

test('Flags do not earn score or resources, block opens, and honor board edges', () => {
  const game = seeded();
  const before = game.snapshot();
  assert.equal(game.flag(0).ok, true);
  assert.equal(game.open(0).ok, false);
  assert.equal(game.flag(0).ok, true);
  assert.deepEqual(game.snapshot(), before);
  for (let i = 0; i < 12; i++) assert.equal(game.flag(i).ok, true);
  assert.equal(game.flag(12).ok, false);
  assert.equal(game.flag(-1).ok, false);
  assert.equal(game.flag(100).ok, false);
  assert.deepEqual(Engine.neighbors(0), [1, 10, 11]);
  assert.deepEqual(Engine.neighbors(9), [8, 18, 19]);
});

test('Shield and health are consumed once per mine; exploded mines remain counted', () => {
  const game = seeded();
  game.open(44);
  const mines = game.state.cells.map((c, i) => c.mine ? i : -1).filter(i => i >= 0);
  const count = game.state.mineCount;
  game.state.shields = 1;
  game.open(mines[0]);
  assert.equal(game.state.hp, 3);
  assert.equal(game.state.shields, 0);
  assert.equal(game.state.cells[mines[0]].exploded, true);
  assert.equal(game.open(mines[0]).ok, false);
  game.open(mines[1]);
  assert.equal(game.state.hp, 2);
  assert.equal(game.state.mineCount, count);
  assert.equal(game.state.combo, 0);
  invariant(game);
});

test('Fault damage and rescue token work, and dead runs reject new actions', () => {
  const game = seeded(22, 7);
  game.open(44);
  game.state.shields = 0;
  game.state.hp = 1;
  game.state.rescueTokens = 1;
  const mines = game.state.cells.map((c, i) => c.mine ? i : -1).filter(i => i >= 0);
  assert.equal(game.getInfo().damage, 2);
  game.open(mines[0]);
  assert.equal(game.state.hp, 1);
  assert.equal(game.state.rescueTokens, 0);
  game.open(mines[1]);
  assert.equal(game.state.hp, 0);
  assert.equal(game.state.status, 'over');
  const before = game.serialize();
  assert.equal(game.probe().ok, false);
  assert.equal(game.emp(0).ok, false);
  assert.equal(game.flag(0).ok, false);
  assert.equal(game.serialize(), before);
  invariant(game);
});

test('Probe respects free charges, avoids mines and does not consume on no target', () => {
  const game = seeded();
  assert.equal(game.probe().ok, true);
  assert.equal(game.state.freeProbes, 0);
  assert.equal(game.state.hp, 3);
  for (let i = 0; i < 10; i++) {
    game.state.energy = game.state.maxEnergy;
    const result = game.probe();
    if (!result.ok) break;
    for (const index of result.opened) assert.equal(game.state.cells[index].mine, false);
  }
  revealToExit(game, true);
  const before = game.serialize();
  assert.equal(game.probe().ok, false);
  assert.equal(game.serialize(), before);
  invariant(game);
});

test('Sonar reveals knowledge only and no-op scanning does not spend energy', () => {
  const game = seeded(87, 3);
  assert.equal(game.sonar(0).ok, false);
  game.open(44);
  game.state.energy = 8;
  const target = game.state.cells.findIndex(c => !c.revealed);
  const revealed = game.state.revealedSafe;
  const result = game.sonar(target);
  assert.equal(result.ok, true);
  assert.equal(game.getInfo().sonarCost, 4);
  assert.equal(game.state.energy, 4);
  assert.equal(game.state.revealedSafe, revealed);
  for (const i of Engine.neighbors(target, 1, true)) if (!game.state.cells[i].revealed) assert.equal(game.state.cells[i].scanned, true);
  const before = game.serialize();
  assert.equal(game.sonar(target).ok, false);
  assert.equal(game.serialize(), before);
  invariant(game);
});

test('EMP removes mines, updates every count, retains target and never hurts player', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const game = seeded(seed);
    game.open(44);
    game.state.energy = 8;
    const target = game.state.cells.findIndex(c => c.mine);
    const count = game.state.mineCount;
    const threshold = game.state.target;
    const hp = game.state.hp;
    const shield = game.state.shields;
    game.flag(target);
    const result = game.emp(target);
    assert.equal(result.ok, true);
    assert.ok(game.state.mineCount < count);
    assert.equal(game.state.target, threshold);
    assert.equal(game.state.hp, hp);
    assert.equal(game.state.shields >= shield, true);
    for (const i of Engine.neighbors(target, 1, true)) {
      assert.equal(game.state.cells[i].mine, false);
      assert.equal(game.state.cells[i].flagged, false);
      assert.equal(game.state.cells[i].revealed, true);
    }
    invariant(game);
  }
});

test('EMP can clear an already exploded mine without double scoring', () => {
  const game = seeded();
  game.open(44);
  const target = game.state.cells.findIndex(c => c.mine);
  game.open(target);
  game.state.energy = 8;
  game.emp(target);
  assert.equal(game.state.cells[target].mine, false);
  assert.equal(game.state.cells[target].exploded, false);
  assert.equal(game.state.cells[target].neutralized, true);
  invariant(game);
});

test('Correct chords open neighbors; wrong flags can trigger a mine', () => {
  let checkedGood = false;
  let checkedBad = false;
  for (let seed = 1; seed < 200 && (!checkedGood || !checkedBad); seed++) {
    const game = seeded(seed);
    game.open(44);
    const index = game.state.cells.findIndex((c, i) => c.revealed && c.n > 0 && Engine.neighbors(i).some(j => !game.state.cells[j].mine && !game.state.cells[j].revealed));
    if (index < 0) continue;
    const good = new Engine(game.snapshot());
    const around = Engine.neighbors(index);
    for (const i of around) if (good.state.cells[i].mine) good.flag(i);
    const count = good.state.revealedSafe;
    assert.equal(good.open(index).ok, true);
    assert.ok(good.state.revealedSafe > count);
    assert.equal(good.state.hp, 3);
    invariant(good);
    checkedGood = true;
    const mine = around.find(i => game.state.cells[i].mine);
    const safe = around.find(i => !game.state.cells[i].mine && !game.state.cells[i].revealed);
    if (mine === undefined || safe === undefined) continue;
    for (const i of around) if (game.state.cells[i].mine && i !== mine) game.flag(i);
    game.flag(safe);
    game.state.shields = 0;
    game.open(index);
    assert.ok(game.state.hp < 3);
    assert.equal(game.state.cells[mine].exploded, true);
    invariant(game);
    checkedBad = true;
  }
  assert.equal(checkedGood && checkedBad, true);
});

test('Extraction and camp rewards are idempotent; full clear earns bonus', () => {
  const game = seeded();
  assert.equal(game.extract().ok, false);
  revealToExit(game, true);
  assert.equal(game.extract().ok, true);
  assert.equal(game.state.status, 'camp');
  assert.equal(game.state.offers.length, 3);
  assert.equal(new Set(game.state.offers).size, 3);
  assert.equal(game.state.lastSectorReward.fullClear, true);
  assert.equal(game.state.lastSectorReward.coins, 21);
  const before = game.serialize();
  assert.equal(game.extract().ok, false);
  assert.equal(game.serialize(), before);
  assert.equal(game.chooseUpgrade('unknown').ok, false);
  const id = game.state.offers[0];
  assert.equal(game.chooseUpgrade(id).ok, true);
  assert.equal(game.state.sector, 2);
  assert.equal(game.state.status, 'playing');
  assert.equal(game.state.generated, false);
  assert.equal(game.chooseUpgrade(id).ok, false);
  invariant(game);
});

test('Camp shop validates stock and funds and caps resources', () => {
  const game = seeded();
  assert.equal(game.buy('medkit').ok, false);
  revealToExit(game);
  game.extract();
  game.state.coins = 100;
  const full = game.serialize();
  assert.equal(game.buy('medkit').ok, false);
  assert.equal(game.serialize(), full);
  game.state.hp = 1;
  assert.equal(game.buy('medkit').ok, true);
  assert.equal(game.state.hp, 2);
  assert.equal(game.state.coins, 86);
  game.state.energy = game.state.maxEnergy - 1;
  assert.equal(game.buy('battery').ok, true);
  assert.equal(game.state.energy, game.state.maxEnergy);
  game.state.coins = 0;
  assert.equal(game.buy('medkit').ok, false);
  invariant(game);
});

test('High sectors remain playable and density stays bounded, upgrades remain useful', () => {
  for (const sector of [100, 101, 999, 1000, 1001, 100000]) {
    const game = seeded(7, sector);
    assert.ok(game.state.mineCount <= 28);
    assert.ok(game.state.mineCount >= 26);
    game.open(44);
    invariant(game);
    revealToExit(game);
    game.state.maxHp = game.state.hp = 6;
    game.state.maxEnergy = game.state.energy = 14;
    game.state.shields = 3;
    game.state.upgrades = { recycler: 3, cartographer: 2, fortune: 5 };
    game.state.energyProgress = 0;
    game.state.rescueTokens = 1;
    game.extract();
    assert.equal(game.state.offers.length, 3);
    assert.ok(game.state.offers.every(id => ['salvage', 'research', 'treasure'].includes(id)));
    game.chooseUpgrade(game.state.offers[0]);
    assert.equal(game.state.sector, sector + 1);
    invariant(game);
  }
});

test('Malformed or inconsistent saves start a clean game safely', () => {
  const valid = seeded();
  valid.open(44);
  for (const input of ['{', '{}', { version: 1 }, null, { ...valid.snapshot(), hp: -1 }, { ...valid.snapshot(), sector: Infinity }, { ...valid.snapshot(), cells: [] }, { ...valid.snapshot(), rngState: 'x' }]) {
    const game = new Engine(input);
    assert.equal(game.loaded, false);
    assert.equal(game.state.status, 'playing');
    assert.equal(game.state.sector, 1);
  }
  const badCounts = valid.snapshot();
  badCounts.cells[0].n = (badCounts.cells[0].n + 1) % 9;
  assert.equal(new Engine(badCounts).loaded, false);
});

test('Capped permanent offers are rejected at restore and cannot exceed limits at runtime', () => {
  const setters = {
    hull: s => { s.maxHp = s.hp = 6; },
    battery: s => { s.maxEnergy = s.energy = 14; },
    recycler: s => { s.upgrades.recycler = 3; s.energyProgress = 0; },
    cartographer: s => { s.upgrades.cartographer = 2; },
    fortune: s => { s.upgrades.fortune = 5; },
    rescue: s => { s.rescueTokens = 1; }
  };
  for (const [id, setCap] of Object.entries(setters)) {
    const game = seeded();
    revealToExit(game);
    game.extract();
    setCap(game.state);
    game.state.offers = [id, 'salvage', 'research'];
    assert.equal(new Engine(game.serialize()).loaded, false, `Reject capped ${id} offer`);
    const before = game.serialize();
    const result = game.chooseUpgrade(id);
    assert.equal(result.ok, false);
    assert.equal(game.serialize(), before, `${id} must not alter the capped state`);
  }
});

test('Consumable offers stay restorable after camp purchases fill their resource', () => {
  for (const [offer, shop, prepare] of [
    ['medkit', 'medkit', s => { s.hp = s.maxHp - 1; }],
    ['shield', 'shield', s => { s.shields = s.maxShields - 1; }],
    ['energy', 'battery', s => { s.energy = s.maxEnergy - 1; }]
  ]) {
    const game = seeded();
    revealToExit(game);
    game.extract();
    prepare(game.state);
    game.state.coins = 100;
    game.state.offers = [offer, 'salvage', 'research'];
    assert.equal(game.buy(shop).ok, true);
    const restored = new Engine(game.serialize());
    assert.equal(restored.loaded, true, `${offer} remains a legal choice after purchase`);
    const coins = restored.state.coins;
    assert.equal(restored.chooseUpgrade(offer).ok, true);
    assert.ok(restored.state.coins > coins, 'A redundant consumable converts to coins');
    invariant(restored);
  }
});

test('Reward records validate shape, values and camp consistency before restoration', () => {
  const game = seeded();
  revealToExit(game);
  game.extract();
  assert.equal(new Engine(game.serialize()).loaded, true);
  const reward = game.state.lastSectorReward;
  const malformed = [
    null, undefined, 'reward', [], {},
    { ...reward, coins: -1 }, { ...reward, coins: '13' }, { ...reward, coins: 999999 },
    { ...reward, score: -1 }, { ...reward, score: Infinity }, { ...reward, score: reward.score + 1 },
    { ...reward, sector: 0 }, { ...reward, sector: game.state.sector + 1 },
    { ...reward, fullClear: 'false' }, { ...reward, fullClear: !reward.fullClear }
  ];
  for (const invalid of malformed) {
    const state = game.snapshot();
    state.lastSectorReward = invalid;
    assert.equal(new Engine(state).loaded, false);
  }
  game.chooseUpgrade(game.state.offers[0]);
  assert.equal(new Engine(game.serialize()).loaded, true, 'Previous valid reward remains available after moving on');
  const badPrevious = game.snapshot();
  badPrevious.lastSectorReward = { ...reward, score: '100' };
  assert.equal(new Engine(badPrevious).loaded, false, 'Validate non-camp reward records too');
});

test('Late-sector extraction money is capped while score keeps growing', () => {
  for (const sector of [21, 101, 1001]) {
    const game = seeded(18, sector);
    revealToExit(game);
    const full = game.getInfo().fullClear;
    game.extract();
    assert.equal(game.state.lastSectorReward.coins, 32 + (full ? 8 : 0));
    assert.equal(game.state.lastSectorReward.score, 100 * sector + (full ? 200 : 0));
    invariant(game);
  }
  const elite = seeded(18, 1000);
  revealToExit(elite, true);
  elite.extract();
  assert.equal(elite.state.lastSectorReward.coins, 50);
  assert.equal(elite.state.lastSectorReward.score, Math.round((100000 + 200) * 1.25));
  invariant(elite);
});
