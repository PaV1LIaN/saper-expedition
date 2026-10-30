(function (root) {
  'use strict';

  const SIZE = 10;
  const COUNT = SIZE * SIZE;
  const VERSION = 1;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
  const BIOMES = [
    { id: 'verdant', name: 'Зелёный рубеж', subtitle: 'Забытые шахты под живым лесом', color: '#b5f36b' },
    { id: 'frost', name: 'Ледяной разлом', subtitle: 'Тишина под вечной мерзлотой', color: '#77dbf5' },
    { id: 'crystal', name: 'Кристальные пещеры', subtitle: 'Здесь даже камни хранят энергию', color: '#be9cf7' },
    { id: 'magma', name: 'Огненное ядро', subtitle: 'На границе с сердцем планеты', color: '#ffa970' }
  ];
  const UPGRADES = {
    medkit: { id: 'medkit', name: 'Полевая медицина', description: 'Восстанавливает 2 здоровья.', icon: 'heart', rarity: 'common' },
    shield: { id: 'shield', name: 'Бронепластина', description: '+1 щит. Полностью поглощает один взрыв.', icon: 'shield', rarity: 'common' },
    battery: { id: 'battery', name: 'Ёмкая батарея', description: '+1 к запасу энергии и +3 энергии сейчас. Максимум 14.', icon: 'battery', rarity: 'rare' },
    recycler: { id: 'recycler', name: 'Рекуператор', description: 'Энергия за каждые 2 клетки быстрее. Предел: 1 за 6 клеток.', icon: 'refresh', rarity: 'rare' },
    cartographer: { id: 'cartographer', name: 'Картограф', description: '+1 бесплатный зонд в каждом секторе. Максимум 3.', icon: 'radar', rarity: 'rare' },
    hull: { id: 'hull', name: 'Усиленный корпус', description: '+1 к максимуму здоровья и +1 здоровье. Максимум 6.', icon: 'heart', rarity: 'rare' },
    fortune: { id: 'fortune', name: 'Протокол открытия', description: 'На 10% больше очков за клетки. Максимум +50%.', icon: 'sparkles', rarity: 'rare' },
    rescue: { id: 'rescue', name: 'Страховочный трос', description: 'Один раз спасает от гибели, оставляя 1 здоровье.', icon: 'anchor', rarity: 'epic' },
    energy: { id: 'energy', name: 'Энергоячейка', description: 'Полностью восстанавливает энергию.', icon: 'bolt', rarity: 'common' },
    salvage: { id: 'salvage', name: 'Тайник разведчика', description: '+18 монет для закупки снаряжения.', icon: 'coin', rarity: 'common' },
    research: { id: 'research', name: 'Архив экспедиции', description: '+500 очков за каждый текущий сектор.', icon: 'map', rarity: 'common' },
    treasure: { id: 'treasure', name: 'Редкий минерал', description: '+12 монет и +250 очков.', icon: 'gem', rarity: 'common' }
  };
  const SHOP = {
    medkit: { id: 'medkit', name: 'Аптечка', description: '+1 здоровье', cost: 14, icon: 'heart' },
    battery: { id: 'battery', name: 'Энергоячейка', description: '+3 энергии', cost: 9, icon: 'bolt' },
    shield: { id: 'shield', name: 'Щит', description: '+1 щит', cost: 12, icon: 'shield' }
  };

  function neighbors(index, radius = 1, includeCenter = false) {
    const x = index % SIZE;
    const y = Math.floor(index / SIZE);
    const cells = [];
    for (let yy = Math.max(0, y - radius); yy <= Math.min(SIZE - 1, y + radius); yy++) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(SIZE - 1, x + radius); xx++) {
        const i = yy * SIZE + xx;
        if (includeCenter || i !== index) cells.push(i);
      }
    }
    return cells;
  }

  function blankCell() {
    return { mine: false, n: 0, revealed: false, flagged: false, scanned: false, exploded: false, neutralized: false, loot: null };
  }

  function initialSeed() {
    try {
      const value = new Uint32Array(1);
      if (root.crypto && root.crypto.getRandomValues) {
        root.crypto.getRandomValues(value);
        return value[0] || 1;
      }
    } catch (_) { /* A non-cryptographic seed is sufficient for a local game. */ }
    return ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1;
  }

  function anomalyFor(sector) {
    if (sector <= 2) return { id: 'quiet', name: 'Спокойный сектор', description: 'Обычный урон. Первый ход и соседние клетки безопасны.' };
    if (sector % 5 === 0) return { id: 'elite', name: 'Узел аномалии', description: '+2 мины, выход после 75% зачистки. Награда сектора +25%.' };
    const phase = sector % 6;
    if (phase === 3) return { id: 'ion', name: 'Ионная буря', description: 'Сонар и ЭМИ стоят на 1 энергию больше.' };
    if (phase === 4) return { id: 'cache', name: 'Заброшенный склад', description: 'Монеты в тайниках приносят двойную добычу.' };
    if (phase === 1 && sector >= 7) return { id: 'fault', name: 'Острые осколки', description: 'Каждый взрыв наносит 2 урона. Щит поглощает весь удар.' };
    if (phase === 2) return { id: 'blackout', name: 'Обесточенный узел', description: 'Для восстановления 1 энергии нужно открыть на 4 клетки больше.' };
    return { id: 'quiet', name: 'Спокойный сектор', description: 'Обычный урон. Первый ход и соседние клетки безопасны.' };
  }

  function plannedMines(sector) {
    const extra = anomalyFor(sector).id === 'elite' ? 2 : 0;
    return Math.min(28, Math.min(26, 12 + Math.floor((sector - 1) / 2)) + extra);
  }

  function sectorReward(sector, fullClear) {
    let coins = 12 + Math.min(20, Math.floor(sector * 1.5)) + (fullClear ? 8 : 0);
    let score = 100 * sector + (fullClear ? 200 : 0);
    if (anomalyFor(sector).id === 'elite') { coins = Math.round(coins * 1.25); score = Math.round(score * 1.25); }
    return { sector, coins, score, fullClear };
  }

  function permanentAvailable(s, id) {
    if (id === 'battery') return s.maxEnergy < 14;
    if (id === 'recycler') return s.upgrades.recycler < 3;
    if (id === 'cartographer') return s.upgrades.cartographer < 2;
    if (id === 'hull') return s.maxHp < 6;
    if (id === 'fortune') return s.upgrades.fortune < 5;
    if (id === 'rescue') return s.rescueTokens < 1;
    return true;
  }

  function validateSaved(saved) {
    try {
      const s = typeof saved === 'string' ? JSON.parse(saved) : copy(saved);
      if (!s || s.version !== VERSION || !integer(s.sector, 1) || !['playing', 'camp', 'over'].includes(s.status)) return null;
      if (!integer(s.seed, 1, 0xffffffff) || !integer(s.rngState, 0, 0xffffffff) || typeof s.generated !== 'boolean') return null;
      if (!Array.isArray(s.cells) || s.cells.length !== COUNT || !Array.isArray(s.offers)) return null;
      if (!s.upgrades || typeof s.upgrades !== 'object' || Array.isArray(s.upgrades)) return null;
      for (const key of ['hp', 'maxHp', 'shields', 'maxShields', 'energy', 'maxEnergy', 'coins', 'score', 'combo', 'freeProbes', 'revealedSafe', 'safeTotal', 'target', 'mineCount', 'totalOpened', 'sectorsCleared', 'energyProgress', 'coinProgress', 'rescueTokens', 'totalMinesDefused']) {
        if (!integer(s[key])) return null;
      }
      if (s.maxHp < 3 || s.maxHp > 6 || s.hp > s.maxHp || s.maxShields !== 3 || s.shields > s.maxShields || s.maxEnergy < 8 || s.maxEnergy > 14 || s.energy > s.maxEnergy || s.rescueTokens > 1 || s.freeProbes > 3) return null;
      if ((s.status === 'over') !== (s.hp === 0)) return null;
      if (s.safeTotal > COUNT || s.revealedSafe > s.safeTotal || s.target > s.safeTotal || s.mineCount > 28 || s.energyProgress > 15 || s.coinProgress >= 20) return null;
      for (const [key, limit] of Object.entries({ recycler: 3, cartographer: 2, fortune: 5 })) {
        if (!integer(s.upgrades[key], 0, limit)) return null;
      }
      for (const cell of s.cells) {
        if (!cell || typeof cell !== 'object' || !integer(cell.n, 0, 8)) return null;
        for (const key of ['mine', 'revealed', 'flagged', 'scanned', 'exploded', 'neutralized']) if (typeof cell[key] !== 'boolean') return null;
        if (![null, 'coin', 'battery', 'shield'].includes(cell.loot) || (cell.revealed && cell.flagged) || (cell.exploded && (!cell.mine || !cell.revealed)) || (cell.neutralized && cell.mine)) return null;
      }
      if (s.offers.some(id => !Object.hasOwn(UPGRADES, id)) || new Set(s.offers).size !== s.offers.length) return null;
      if (s.status === 'camp' && (s.offers.length !== 3 || !s.generated || s.revealedSafe < s.target)) return null;
      if (s.status !== 'camp' && s.offers.length) return null;
      // Purchases can fill a consumable after it was offered, but cannot make
      // permanent upgrades eligible beyond their advertised level caps.
      if (s.offers.some(id => !permanentAvailable(s, id))) return null;
      const reward = s.lastSectorReward;
      if (reward !== null) {
        if (!reward || typeof reward !== 'object' || Array.isArray(reward) || !integer(reward.sector, 1, s.sector) || !integer(reward.coins) || !integer(reward.score) || typeof reward.fullClear !== 'boolean') return null;
        const expected = sectorReward(reward.sector, reward.fullClear);
        if (reward.coins !== expected.coins || reward.score !== expected.score) return null;
      }
      if (s.status === 'camp' && (!reward || reward.sector !== s.sector || reward.fullClear !== (s.revealedSafe === s.safeTotal))) return null;
      if (s.generated) {
        if (s.cells.filter(c => c.mine).length !== s.mineCount || s.safeTotal !== COUNT - s.mineCount || s.cells.filter(c => c.revealed && !c.mine).length !== s.revealedSafe) return null;
        for (let i = 0; i < COUNT; i++) if (s.cells[i].n !== neighbors(i).filter(j => s.cells[j].mine).length) return null;
      } else if (s.cells.some(c => c.mine || c.revealed || c.scanned || c.exploded || c.neutralized || c.loot !== null || c.n) || s.revealedSafe !== 0 || s.mineCount !== plannedMines(s.sector) || s.safeTotal !== COUNT - s.mineCount) return null;
      return s;
    } catch (_) { return null; }
  }

  class ExpeditionEngine {
    constructor(savedState = null) {
      const restored = savedState == null ? null : validateSaved(savedState);
      this.loaded = !!restored;
      if (restored) { this.state = restored; return; }
      const seed = initialSeed();
      this.state = {
        version: VERSION, sector: 1, status: 'playing', seed, rngState: seed, cells: [], generated: false,
        hp: 3, maxHp: 3, shields: 1, maxShields: 3, energy: 6, maxEnergy: 8, coins: 0, score: 0, combo: 0,
        freeProbes: 1, upgrades: { recycler: 0, cartographer: 0, fortune: 0 },
        revealedSafe: 0, safeTotal: 88, target: 62, mineCount: 12, offers: [], totalOpened: 0, sectorsCleared: 0,
        energyProgress: 0, coinProgress: 0, rescueTokens: 0, totalMinesDefused: 0, lastSectorReward: null
      };
      this._newBoard();
    }

    _random() {
      this.state.rngState = (this.state.rngState + 0x6D2B79F5) >>> 0;
      let t = this.state.rngState;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    _shuffle(values) {
      for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(this._random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
      }
      return values;
    }

    _newBoard() {
      const s = this.state;
      s.cells = Array.from({ length: COUNT }, blankCell);
      s.generated = false;
      s.mineCount = plannedMines(s.sector);
      s.safeTotal = COUNT - s.mineCount;
      s.target = Math.ceil(s.safeTotal * (anomalyFor(s.sector).id === 'elite' ? 0.75 : 0.7));
      s.revealedSafe = 0;
      s.freeProbes = 1 + s.upgrades.cartographer;
      s.offers = [];
      s.status = 'playing';
      // Recalibration at a new sector keeps an old anomaly's remainder valid.
      s.energyProgress %= this.getInfo().energyEvery;
    }

    _generate(first) {
      const s = this.state;
      const protectedCells = new Set(neighbors(first, 1, true));
      const candidates = this._shuffle(Array.from({ length: COUNT }, (_, i) => i).filter(i => !protectedCells.has(i)));
      for (const index of candidates.slice(0, s.mineCount)) s.cells[index].mine = true;
      this._recount();
      const lootCandidates = this._shuffle(Array.from({ length: COUNT }, (_, i) => i).filter(i => !s.cells[i].mine && !protectedCells.has(i)));
      const lootTypes = ['coin', 'coin', 'battery', 'shield'];
      lootCandidates.slice(0, lootTypes.length).forEach((index, j) => { s.cells[index].loot = lootTypes[j]; });
      s.generated = true;
    }

    _recount() {
      const s = this.state;
      for (let i = 0; i < COUNT; i++) s.cells[i].n = neighbors(i).reduce((n, j) => n + Number(s.cells[j].mine), 0);
      s.mineCount = s.cells.filter(c => c.mine).length;
      s.safeTotal = COUNT - s.mineCount;
    }

    _result(ok, reason, events = [], opened = []) {
      const result = { ok, events, opened };
      if (reason) result.reason = reason;
      return result;
    }

    _ready(index) {
      if (this.state.status !== 'playing') return 'Сначала завершите выбор награды или начните новую экспедицию.';
      if (index !== undefined && !integer(index, 0, COUNT - 1)) return 'Выберите клетку на поле.';
      return null;
    }

    _energy(amount, events) {
      const before = this.state.energy;
      this.state.energy = Math.min(this.state.maxEnergy, this.state.energy + amount);
      if (this.state.energy > before) events.push({ type: 'energy', amount: this.state.energy - before });
    }

    _loot(index, events) {
      const s = this.state;
      const type = s.cells[index].loot;
      if (!type) return;
      let amount = 0;
      if (type === 'coin') {
        amount = this.getInfo().anomaly.id === 'cache' ? 10 : 5;
        s.coins += amount;
      } else if (type === 'battery') {
        amount = Math.min(2, s.maxEnergy - s.energy);
        this._energy(2, events);
      } else if (type === 'shield') {
        if (s.shields < s.maxShields) { s.shields++; amount = 1; }
        else { s.coins += 5; amount = 5; }
      }
      events.push({ type: 'loot', loot: type, amount, index, message: type === 'coin' ? `Тайник: +${amount} монет` : type === 'battery' ? 'Найдена энергоячейка' : amount === 5 ? 'Запасной щит: +5 монет' : 'Найден щит' });
    }

    _hit(index, events) {
      const s = this.state;
      const cell = s.cells[index];
      cell.revealed = true;
      cell.flagged = false;
      cell.exploded = true;
      s.combo = 0;
      if (s.shields > 0) {
        s.shields--;
        events.push({ type: 'shield', index, message: 'Щит поглотил взрыв' });
      } else {
        const damage = this.getInfo().damage;
        s.hp = Math.max(0, s.hp - damage);
        events.push({ type: 'mine', index, damage, message: `Мина! −${damage} здоровья` });
        if (!s.hp) {
          if (s.rescueTokens) {
            s.rescueTokens--;
            s.hp = 1;
            events.push({ type: 'rescue', message: 'Страховочный трос спас экспедицию' });
          } else {
            s.status = 'over';
            events.push({ type: 'gameover', message: 'Экспедиция завершена' });
          }
        }
      }
    }

    _reveal(indices, events, opened) {
      const s = this.state;
      const queue = [...indices];
      const queued = new Set(queue);
      const points = Math.round((10 + s.sector) * this.getInfo().multiplier * (1 + s.upgrades.fortune * 0.1));
      let hit = false;
      for (let cursor = 0; cursor < queue.length && s.status === 'playing'; cursor++) {
        const index = queue[cursor];
        const cell = s.cells[index];
        if (cell.revealed || cell.flagged) continue;
        if (cell.mine) { this._hit(index, events); hit = true; opened.push(index); continue; }
        cell.revealed = true;
        s.revealedSafe++;
        s.totalOpened++;
        s.score += points;
        s.energyProgress++;
        s.coinProgress++;
        opened.push(index);
        const every = this.getInfo().energyEvery;
        while (s.energyProgress >= every) { s.energyProgress -= every; this._energy(1, events); }
        while (s.coinProgress >= 20) { s.coinProgress -= 20; s.coins += 2; events.push({ type: 'coins', amount: 2 }); }
        this._loot(index, events);
        if (cell.n === 0) {
          for (const j of neighbors(index)) {
            if (!queued.has(j) && !s.cells[j].revealed && !s.cells[j].flagged) { queued.add(j); queue.push(j); }
          }
        }
      }
      return hit;
    }

    _finishAction(events, opened, wasReady, wasFull, hit, countCombo = true) {
      const s = this.state;
      if (countCombo && !hit && s.status === 'playing') s.combo++;
      const info = this.getInfo();
      if (!wasReady && info.canExtract) events.push({ type: 'extract-ready', message: 'Путь дальше открыт. Можно перейти в следующий сектор.' });
      if (!wasFull && info.fullClear) events.push({ type: 'cleared', message: 'Сектор полностью зачищен! Дополнительная награда ждёт в лагере.' });
      return this._result(true, null, events, opened);
    }

    open(index) {
      const error = this._ready(index);
      if (error) return this._result(false, error);
      const s = this.state;
      const cell = s.cells[index];
      if (cell.flagged) return this._result(false, 'Сначала снимите флаг.');
      let targets = [index];
      if (cell.revealed) {
        if (cell.mine || !cell.n) return this._result(false, 'Эта клетка уже открыта.');
        const around = neighbors(index);
        const marked = around.filter(i => s.cells[i].flagged || (s.cells[i].mine && s.cells[i].revealed)).length;
        if (marked !== cell.n) return this._result(false, 'Для быстрого открытия число флагов вокруг должно совпадать с цифрой.');
        targets = around.filter(i => !s.cells[i].revealed && !s.cells[i].flagged);
        if (!targets.length) return this._result(false, 'Все соседние клетки уже разобраны.');
      }
      const before = this.getInfo();
      if (!s.generated) this._generate(index);
      const events = [];
      const opened = [];
      const hit = this._reveal(targets, events, opened);
      return this._finishAction(events, opened, before.canExtract, before.fullClear, hit);
    }

    flag(index) {
      const error = this._ready(index);
      if (error) return this._result(false, error);
      const s = this.state;
      const cell = s.cells[index];
      if (cell.revealed) return this._result(false, 'На открытой клетке флаг не нужен.');
      if (!cell.flagged && s.cells.filter(c => c.flagged).length >= s.mineCount - s.cells.filter(c => c.exploded).length) return this._result(false, 'Все оставшиеся мины уже отмечены. Снимите лишний флаг.');
      cell.flagged = !cell.flagged;
      return this._result(true, null, [{ type: 'flag', index, flagged: cell.flagged }]);
    }

    probe() {
      const error = this._ready();
      if (error) return this._result(false, error);
      const s = this.state;
      const before = this.getInfo();
      if (s.energy < before.probeCost) return this._result(false, `Нужно ${before.probeCost} энергии для зонда.`);
      let candidates = s.cells.map((c, i) => ({ c, i })).filter(({ c }) => !c.revealed && !c.flagged && (!s.generated || !c.mine)).map(({ i }) => i);
      if (!candidates.length) return this._result(false, 'Нет доступных безопасных клеток. Проверьте свои флаги.');
      let index;
      if (!s.generated) {
        index = candidates.includes(44) ? 44 : candidates[0];
        this._generate(index);
      } else {
        const edge = candidates.filter(i => neighbors(i).some(j => s.cells[j].revealed));
        if (edge.length) candidates = edge;
        index = candidates[Math.floor(this._random() * candidates.length)];
      }
      if (s.freeProbes) s.freeProbes--;
      else s.energy -= before.probeCost;
      const events = [{ type: 'probe', index, message: 'Зонд нашёл безопасную клетку' }];
      const opened = [];
      this._reveal([index], events, opened);
      return this._finishAction(events, opened, before.canExtract, before.fullClear, false);
    }

    sonar(index) {
      const error = this._ready(index);
      if (error) return this._result(false, error);
      const s = this.state;
      if (!s.generated) return this._result(false, 'Сначала откройте первую клетку.');
      const before = this.getInfo();
      if (s.energy < before.sonarCost) return this._result(false, `Сонару нужно ${before.sonarCost} энергии.`);
      const targets = neighbors(index, 1, true).filter(i => !s.cells[i].revealed && !s.cells[i].scanned);
      if (!targets.length) return this._result(false, 'В этой области всё уже исследовано.');
      s.energy -= before.sonarCost;
      for (const i of targets) s.cells[i].scanned = true;
      const mines = targets.filter(i => s.cells[i].mine).length;
      return this._finishAction([{ type: 'scan', index, indices: targets, mines, message: `Область просканирована. Найдено мин: ${mines}` }], [], before.canExtract, before.fullClear, false);
    }

    emp(index) {
      const error = this._ready(index);
      if (error) return this._result(false, error);
      const s = this.state;
      if (!s.generated) return this._result(false, 'Сначала откройте первую клетку.');
      const before = this.getInfo();
      if (s.energy < before.empCost) return this._result(false, `ЭМИ нужно ${before.empCost} энергии.`);
      const targets = neighbors(index, 1, true);
      if (!targets.some(i => s.cells[i].mine || !s.cells[i].revealed)) return this._result(false, 'В этой области уже нечего обезвреживать.');
      s.energy -= before.empCost;
      let defused = 0;
      for (const i of targets) {
        const cell = s.cells[i];
        cell.flagged = false;
        if (cell.mine) {
          const alreadyRevealed = cell.revealed;
          cell.mine = false;
          cell.exploded = false;
          cell.neutralized = true;
          cell.scanned = true;
          // Previously exploded cells count as safely revealed after defusing,
          // but must never grant the same opening reward twice.
          if (alreadyRevealed) s.revealedSafe++;
          defused++;
        }
      }
      this._recount();
      s.totalMinesDefused += defused;
      const events = [{ type: 'emp', index, defused, message: `ЭМИ: обезврежено мин — ${defused}` }];
      const opened = [];
      this._reveal(targets, events, opened);
      return this._finishAction(events, opened, before.canExtract, before.fullClear, false);
    }

    _eligibleUpgrades() {
      const s = this.state;
      const eligible = ['salvage', 'research', 'treasure'];
      if (s.hp < s.maxHp) eligible.push('medkit');
      if (s.shields < s.maxShields) eligible.push('shield');
      if (s.maxEnergy < 14) eligible.push('battery');
      if (s.upgrades.recycler < 3) eligible.push('recycler');
      if (s.upgrades.cartographer < 2) eligible.push('cartographer');
      if (s.maxHp < 6) eligible.push('hull');
      if (s.upgrades.fortune < 5) eligible.push('fortune');
      if (!s.rescueTokens) eligible.push('rescue');
      if (s.energy < s.maxEnergy) eligible.push('energy');
      return eligible;
    }

    extract() {
      const error = this._ready();
      if (error) return this._result(false, error);
      const s = this.state;
      const info = this.getInfo();
      if (!info.canExtract) return this._result(false, `Для перехода откройте ещё ${Math.max(0, s.target - s.revealedSafe)} безопасных клеток.`);
      const reward = sectorReward(s.sector, info.fullClear);
      const { coins, score } = reward;
      s.coins += coins;
      s.score += score;
      s.sectorsCleared++;
      s.lastSectorReward = reward;
      const events = [{ type: 'camp', coins, score, fullClear: info.fullClear, message: 'Привал. Выберите одно улучшение.' }];
      this._energy(3, events);
      s.status = 'camp';
      s.offers = this._shuffle(this._eligibleUpgrades()).slice(0, 3);
      return this._result(true, null, events);
    }

    chooseUpgrade(id) {
      const s = this.state;
      if (s.status !== 'camp' || !s.offers.includes(id)) return this._result(false, 'Выберите одну из предложенных наград.');
      if (!permanentAvailable(s, id)) return this._result(false, 'Это улучшение уже достигло максимума. Выберите другую награду.');
      // Shop purchases may fill a resource after offers were rolled. Convert
      // such a now-redundant consumable instead of presenting a dead choice.
      const events = [];
      if (id === 'medkit') {
        if (s.hp === s.maxHp) { s.coins += 14; events.push({ type: 'coins', amount: 14 }); }
        else s.hp = Math.min(s.maxHp, s.hp + 2);
      } else if (id === 'shield') {
        if (s.shields === s.maxShields) { s.coins += 12; events.push({ type: 'coins', amount: 12 }); }
        else s.shields++;
      } else if (id === 'battery') { s.maxEnergy = Math.min(14, s.maxEnergy + 1); this._energy(3, events); }
      else if (id === 'recycler') s.upgrades.recycler = Math.min(3, s.upgrades.recycler + 1);
      else if (id === 'cartographer') s.upgrades.cartographer = Math.min(2, s.upgrades.cartographer + 1);
      else if (id === 'hull') { s.maxHp = Math.min(6, s.maxHp + 1); s.hp = Math.min(s.maxHp, s.hp + 1); }
      else if (id === 'fortune') s.upgrades.fortune = Math.min(5, s.upgrades.fortune + 1);
      else if (id === 'rescue') s.rescueTokens = 1;
      else if (id === 'energy') {
        if (s.energy === s.maxEnergy) { s.coins += 9; events.push({ type: 'coins', amount: 9 }); }
        else this._energy(s.maxEnergy, events);
      } else if (id === 'salvage') s.coins += 18;
      else if (id === 'research') s.score += 500 * s.sector;
      else if (id === 'treasure') { s.coins += 12; s.score += 250; }
      events.push({ type: 'upgrade', id, name: UPGRADES[id].name });
      s.sector++;
      this._newBoard();
      events.push({ type: 'sector', sector: s.sector, message: `Сектор ${s.sector}. Первый ход безопасен.` });
      return this._result(true, null, events);
    }

    buy(id) {
      const s = this.state;
      if (s.status !== 'camp') return this._result(false, 'Снаряжение можно купить на привале.');
      if (!Object.hasOwn(SHOP, id)) return this._result(false, 'Такого снаряжения нет.');
      const item = SHOP[id];
      if (s.coins < item.cost) return this._result(false, 'Не хватает монет.');
      if ((id === 'medkit' && s.hp === s.maxHp) || (id === 'battery' && s.energy === s.maxEnergy) || (id === 'shield' && s.shields === s.maxShields)) return this._result(false, 'Этот запас уже полон.');
      s.coins -= item.cost;
      if (id === 'medkit') s.hp++;
      else if (id === 'battery') s.energy = Math.min(s.maxEnergy, s.energy + 3);
      else s.shields++;
      return this._result(true, null, [{ type: 'buy', id, name: item.name, message: `Куплено: ${item.name}` }]);
    }

    getInfo() {
      const s = this.state;
      const anomaly = anomalyFor(s.sector);
      const flags = s.cells.filter(c => c.flagged).length;
      const exploded = s.cells.filter(c => c.exploded).length;
      const baseEnergyEvery = 12 - s.upgrades.recycler * 2;
      return {
        biome: copy(BIOMES[Math.floor((s.sector - 1) / 3) % BIOMES.length]),
        anomaly, density: s.mineCount / COUNT, initialDensity: plannedMines(s.sector) / COUNT,
        mines: s.mineCount, flags, remainingMines: s.mineCount - exploded - flags,
        canExtract: s.status === 'playing' && s.generated && s.revealedSafe >= s.target,
        progress: s.safeTotal ? clamp(s.revealedSafe / s.safeTotal, 0, 1) : 0,
        probeCost: s.freeProbes > 0 ? 0 : 2,
        sonarCost: 3 + Number(anomaly.id === 'ion'), empCost: 5 + Number(anomaly.id === 'ion'),
        energyEvery: baseEnergyEvery + (anomaly.id === 'blackout' ? 4 : 0),
        damage: anomaly.id === 'fault' ? 2 : 1,
        multiplier: Math.min(2.5, 1 + Math.floor(s.combo / 5) * 0.25),
        fullClear: s.generated && s.revealedSafe === s.safeTotal,
        targetPercent: anomaly.id === 'elite' ? 75 : 70,
        width: SIZE, height: SIZE
      };
    }

    snapshot() { return copy(this.state); }
    serialize() { return JSON.stringify(this.state); }
  }

  ExpeditionEngine.UPGRADES = UPGRADES;
  ExpeditionEngine.BIOMES = BIOMES;
  ExpeditionEngine.SHOP = SHOP;
  ExpeditionEngine.SIZE = SIZE;
  ExpeditionEngine.neighbors = neighbors;
  if (typeof module !== 'undefined' && module.exports) module.exports = ExpeditionEngine;
  root.ExpeditionEngine = ExpeditionEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
