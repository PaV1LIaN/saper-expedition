(function () {
  'use strict';
  const SAVE_KEY = 'saper-expedition-v1';
  const $ = id => document.getElementById(id);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const iconAliases = {battery:'energy',bolt:'energy',refresh:'reset',sparkles:'spark',anchor:'shield',gem:'spark'};
  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${iconAliases[name] || name}"/></svg>`;
  const number = n => new Intl.NumberFormat('ru-RU').format(Math.floor(n));
  const plural = (n,one,few,many) => n%100>=11&&n%100<=14 ? many : n%10===1 ? one : n%10>=2&&n%10<=4 ? few : many;
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (_) {}
  let engine = new ExpeditionEngine(stored && stored.run);
  const restored = engine.loaded;
  const settings = {sound: !!stored?.settings?.sound, reducedMotion: !!stored?.settings?.reducedMotion};
  const validNumber = x => Number.isSafeInteger(x) && x >= 0;
  let best = {score: validNumber(stored?.best?.score) ? stored.best.score : 0, sector: validNumber(stored?.best?.sector) ? stored.best.sector : 1};
  let logs = Array.isArray(stored?.logs) ? stored.logs.filter(x => x && typeof x.message === 'string' && typeof x.time === 'string').slice(0, 12) : [];
  let mode = 'open';
  let tool = null;
  let focusedCell = 44;
  let currentDialog = null;
  let canSave = true;
  let audioContext = null;
  let lastSector = engine.state.sector;
  let longPress = null;
  let suppressClick = {index:-1,until:0};
  const board = $('board');
  const modal = $('modal');
  const cellButtons = [];

  function log(message) {
    const now = new Date();
    logs.unshift({message, time: now.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})});
    logs = logs.slice(0, 12);
  }

  function save() {
    best.score = Math.max(best.score, engine.state.score);
    best.sector = Math.max(best.sector, engine.state.sector);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({run:engine.snapshot(), best, logs, settings}));
      canSave = true;
    } catch (_) { canSave = false; }
    $('saveStatus').classList.toggle('unsaved', !canSave);
    $('saveStatus').innerHTML = `<span></span>${canSave ? 'Прогресс сохранён' : 'Сохранение недоступно'}`;
  }

  function sound(type) {
    if (!settings.sound) return;
    try {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const patterns = {open:[[480,.06,0],[640,.09,.035]],flag:[[320,.065,0]],scan:[[360,.13,0],[680,.16,.1],[900,.1,.18]],emp:[[180,.18,0],[420,.15,.12],[780,.16,.22]],mine:[[100,.3,0],[65,.25,.08]],shield:[[220,.15,0],[500,.2,.07]],reward:[[440,.12,0],[550,.12,.1],[660,.12,.2],[880,.25,.3]],error:[[180,.09,0]],click:[[550,.07,0]]};
      for (const [frequency,duration,delay] of patterns[type] || patterns.click) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = type === 'mine' ? 'triangle' : 'sine';
        const start = audioContext.currentTime + delay;
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.045, start+.008);
        gain.gain.exponentialRampToValueAtTime(.001, start+duration);
        oscillator.connect(gain); gain.connect(audioContext.destination);
        oscillator.start(start); oscillator.stop(start+duration+.02);
      }
    } catch (_) { /* Audio is optional; gameplay remains available. */ }
  }

  function toast(message, error = false) {
    const region = $('toastRegion');
    while (region.children.length >= 2) region.firstElementChild.remove();
    const node = document.createElement('div');
    node.className = `toast${error ? ' error' : ''}`;
    node.innerHTML = icon(error ? 'help' : 'spark') + `<span>${esc(message)}</span>`;
    region.append(node);
    setTimeout(() => { node.classList.add('out'); setTimeout(() => node.remove(), 250); }, 3400);
  }

  function boardEffect(effect) {
    if (settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const wrap = $('boardWrap');
    wrap.classList.remove(effect);
    void wrap.offsetWidth;
    wrap.classList.add(effect);
    setTimeout(() => wrap.classList.remove(effect), 650);
  }

  function celebrate() {
    if (settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const region = $('particles');
    for (let i=0; i<22; i++) {
      const node = document.createElement('span');
      node.className = 'particle';
      const angle = Math.PI*2*i/22;
      const radius = 80+Math.random()*130;
      node.style.setProperty('--tx', `${Math.cos(angle)*radius}px`);
      node.style.setProperty('--ty', `${Math.sin(angle)*radius}px`);
      node.style.background = i%3 === 0 ? 'var(--gold)' : 'var(--accent)';
      region.append(node);
      setTimeout(() => node.remove(), 750);
    }
  }

  function renderBoard(opened = []) {
    const s = engine.state;
    const fresh = new Set(opened);
    if (!cellButtons.length) {
      for (let i=0; i<100; i++) {
        const cell = document.createElement('button');
        cell.type = 'button'; cell.dataset.index = i; cell.setAttribute('role','gridcell');
        cell.tabIndex = i === focusedCell ? 0 : -1;
        cellButtons.push(cell); board.append(cell);
      }
    }
    s.cells.forEach((c,i) => {
      const node = cellButtons[i];
      const overMine = s.status === 'over' && c.mine && !c.revealed;
      let cls = 'cell';
      let content = '';
      let description = 'закрытая клетка';
      if (c.revealed) {
        cls += ` revealed n${c.n}`;
        if (c.mine) { cls += ' exploded'; content = icon('mine'); description = 'взорванная мина, учитывается в цифрах'; }
        else { content = c.n ? String(c.n) : ''; description = c.n ? `открыта, рядом мин: ${c.n}. Нажать — открыть соседей при верных флагах` : 'открыта, рядом мин нет'; }
      } else if (c.flagged) {
        cls += ' flagged'; content = icon('flag'); description = 'установлен флаг';
        if (s.status === 'over' && !c.mine) { cls += ' wrong-flag'; content = icon('close'); description = 'ошибочный флаг'; }
      } else if (overMine) {
        cls += ' gameover-mine'; content = icon('mine'); description = 'мина';
      } else if (c.scanned) {
        cls += ' scanned';
        if (c.mine) { cls += ' mine-known'; content = icon('mine'); description = 'сонар обнаружил мину'; }
        else { content = icon('check'); description = 'сонар подтвердил безопасность, можно открыть'; }
      }
      if (c.neutralized) { cls += ' neutralized'; content += '<span class="neutralized-mark"></span>'; }
      if (c.revealed && !c.mine && c.loot) content += '<span class="loot-mark" title="Здесь найдена добыча"></span>';
      if (fresh.has(i)) cls += ' just-opened';
      if (!s.generated && i === 44 && !c.flagged) cls += ' safe-start';
      node.className = cls;
      if (node.innerHTML !== content) node.innerHTML = content;
      node.disabled = s.status !== 'playing';
      node.tabIndex = i === focusedCell ? 0 : -1;
      node.setAttribute('aria-label', `${'ABCDEFGHIJ'[i%10]}${Math.floor(i/10)+1}: ${description}`);
      node.setAttribute('aria-selected', c.flagged ? 'true' : 'false');
    });
    board.classList.toggle('is-targeting', !!tool);
    board.setAttribute('aria-label', `Минное поле 10 на 10. Сектор ${s.sector}. ${tool ? 'Выберите центр области для инструмента.' : 'Стрелки — перемещение, Enter — открыть, F — флаг.'}`);
  }

  function render(opened = []) {
    const s = engine.state, info = engine.getInfo();
    const colors = {verdant:'#c6f87c', frost:'#8bdbed', crystal:'#c4a5f8', magma:'#ffc08b'};
    const accent = colors[info.biome.id] || colors.verdant;
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-rgb', [1,3,5].map(n => parseInt(accent.slice(n,n+2),16)).join(','));
    document.body.dataset.biome = info.biome.id;
    document.body.classList.toggle('reduced-motion', settings.reducedMotion);
    $('depthValue').textContent = number(s.sector * 100);
    $('depthValue').style.fontSize = s.sector >= 10000 ? '24px' : s.sector >= 100 ? '30px' : '';
    $('sectorNumber').textContent = String(s.sector).padStart(2,'0');
    $('sectorNumber').style.fontSize = s.sector >= 1000 ? '14px' : '';
    $('biomeName').textContent = info.biome.name;
    $('biomeName').title = info.biome.subtitle;
    $('mineValue').textContent = info.remainingMines;
    $('hearts').innerHTML = Array.from({length:s.maxHp},(_,i) => icon('heart', i>=s.hp ? 'empty' : '')).join('');
    $('hearts').setAttribute('aria-label', `${s.hp} из ${s.maxHp} здоровья`);
    $('shieldValue').innerHTML = `${s.shields} <small>/ ${s.maxShields}</small>`;
    $('energyValue').innerHTML = `${s.energy} <small>/ ${s.maxEnergy}</small>`;
    $('energyBar').innerHTML = Array.from({length:s.maxEnergy},(_,i) => `<span class="energy-segment${i<s.energy ? ' filled' : ''}"></span>`).join('');
    $('energyBar').setAttribute('aria-label', `${s.energy} из ${s.maxEnergy} энергии`);
    $('coinValue').textContent = number(s.coins);
    $('scoreValue').textContent = number(s.score);
    $('bestScore').innerHTML = `${number(Math.max(best.score,s.score))} <small>очков</small>`;
    $('conditionText').textContent = info.anomaly.name;
    const brief = {quiet:'Можно не спешить',elite:'+2 мины · выход на 75%',ion:'Сонар и импульс: +1 энергия',cache:'Двойная добыча в тайниках',fault:'Взрыв наносит 2 урона',blackout:`Энергия за ${info.energyEvery} клеток`};
    $('conditionShort').textContent = brief[info.anomaly.id] || info.anomaly.description;
    $('condition').title = info.anomaly.description;
    $('condition').classList.toggle('danger', !['quiet','cache'].includes(info.anomaly.id));
    $('routeList').innerHTML = [0,1,2].map(offset => {
      const next = s.sector+offset;
      const biome = ExpeditionEngine.BIOMES[Math.floor((next-1)/3)%ExpeditionEngine.BIOMES.length];
      return `<div class="route-item${offset===0 ? ' current' : ''}"><span class="route-node">${offset===0 ? icon('down') : String(next).padStart(2,'0')}</span><div class="route-copy"><strong>${esc(biome.name)}</strong><small>${number(next*100)} м · ${offset===0 ? 'Вы здесь' : next%5===0 ? 'Узел аномалии' : 'Не исследовано'}</small></div></div>`;
    }).join('');
    $('probeCost').innerHTML = info.probeCost===0 ? `${s.freeProbes} БЕСПЛАТНО` : `${icon('energy')}${info.probeCost} ЭНЕРГИИ`;
    $('probeCost').classList.toggle('free', info.probeCost===0);
    $('sonarCost').innerHTML = `${icon('energy')}${info.sonarCost} ЭНЕРГИИ`;
    $('empCost').innerHTML = `${icon('energy')}${info.empCost} ЭНЕРГИИ`;
    $('regenNote').textContent = `+1 энергия за ${info.energyEvery} открытых клеток`;
    for (const name of ['probe','sonar','emp']) {
      const node = $(name+'Tool');
      const blocked = s.status!=='playing' || (name!=='probe' && !s.generated) || s.energy<info[name+'Cost'] || (name==='probe' && info.fullClear);
      node.disabled = blocked;
      node.classList.toggle('selected', tool===name);
      node.setAttribute('aria-pressed', tool===name ? 'true' : 'false');
      node.title = s.status!=='playing' ? 'Завершите привал или начните новую экспедицию' : name!=='probe'&&!s.generated ? 'Сначала откройте первую клетку' : s.energy<info[name+'Cost'] ? 'Недостаточно энергии' : name==='probe' ? 'Безопасное открытие. Бесплатный заряд обновляется в каждом секторе.' : 'Выберите инструмент, затем центр области на поле.';
    }
    const pct = Math.floor(info.progress*100);
    $('goalPercent').innerHTML = `${pct}<span>%</span>`;
    $('goalBar').style.width = pct+'%';
    $('goalRing').style.setProperty('--progress',pct+'%');
    const requiredPct = s.safeTotal ? s.target/s.safeTotal*100 : info.targetPercent;
    $('goalMarker').style.left = requiredPct+'%';
    const remaining = Math.max(0,s.target-s.revealedSafe);
    $('goalText').textContent = s.status==='camp' ? 'Привал готов. Купи припасы и выбери одно улучшение для следующего сектора.' : info.fullClear ? 'Безопасных клеток больше нет. Забирай дополнительную награду и двигайся глубже.' : info.canExtract ? 'Путь открыт. Можно идти дальше или закончить зачистку ради большей награды.' : `Открой ещё ${remaining} ${plural(remaining,'безопасную клетку','безопасные клетки','безопасных клеток')}, чтобы продолжить спуск.`;
    $('goalPanel').classList.toggle('ready',info.canExtract || s.status==='camp');
    const extract = $('extractButton');
    extract.disabled = s.status==='playing' ? !info.canExtract : s.status==='over';
    extract.innerHTML = s.status==='camp' ? `${icon('box')}<span>Выбрать улучшение</span>` : info.canExtract ? `${icon('arrow')}<span>${info.fullClear ? 'Забрать награду' : 'В следующий сектор'}</span>` : `${icon('lock')}<span>${s.status==='over' ? 'Экспедиция завершена' : 'Путь ещё закрыт'}</span>`;
    $('modeOpen').classList.toggle('active',mode==='open');
    $('modeOpen').setAttribute('aria-pressed',String(mode==='open'));
    $('modeFlag').classList.toggle('active',mode==='flag');
    $('modeFlag').setAttribute('aria-pressed',String(mode==='flag'));
    $('comboValue').textContent = '×'+info.multiplier.toFixed(2);
    $('comboDisplay').classList.toggle('hot',info.multiplier>1);
    $('comboDisplay').title = `${s.combo} ходов без взрыва. Каждые 5 ходов множитель очков растёт на 0,25, до ×2,5.`;
    const message = $('boardMessage');
    message.className = 'board-message';
    if (tool) {
      message.classList.add('tool-message');
      message.innerHTML = `${icon(tool==='emp'?'emp':'radar')}<span>${tool==='emp'?'Импульс':'Сонар'}: выбери центр области 3 × 3.</span><button data-action="cancel-tool">Отмена</button>`;
    } else if (s.status==='over') {
      message.classList.add('warning');
      message.innerHTML = `${icon('mine')}<span>Экспедиция завершена.</span><button class="secondary-button" data-action="result" style="padding:3px 8px;min-height:0;font-size:9px">Результаты</button>`;
    } else if (s.status==='camp') message.innerHTML = `${icon('box')}<span>Время привала. Следующий сектор ждёт.</span>`;
    else if (!s.generated) message.innerHTML = `${icon('shield')}<span>Начни с любой клетки. Первый ход безопасен.</span>`;
    else if (mode==='flag') message.innerHTML = `${icon('flag')}<span>Режим флага: нажми на закрытую клетку, чтобы отметить мину.</span>`;
    else if (info.fullClear) message.innerHTML = `${icon('spark')}<span>Чистая работа! Все безопасные клетки открыты.</span>`;
    else if (info.canExtract) message.innerHTML = `${icon('arrow')}<span>Путь дальше открыт. Рискнуть или забрать награду?</span>`;
    else if (info.anomaly.id==='fault') {message.classList.add('warning');message.innerHTML = `${icon('shield')}<span>Осторожно: мины наносят 2 урона. Щит поглощает весь удар.</span>`;}
    else message.innerHTML = `${icon('probe')}<span>${s.revealedSafe} из ${s.safeTotal} безопасных клеток открыто · ${s.freeProbes ? 'Бесплатный зонд готов' : 'Не спеши — таймера нет'}</span>`;
    $('soundButton').innerHTML = icon(settings.sound?'volume':'mute');
    $('soundButton').setAttribute('aria-label',settings.sound?'Выключить звук':'Включить звук');
    $('soundButton').setAttribute('aria-pressed',String(settings.sound));
    $('soundButton').title = settings.sound?'Выключить звук':'Включить звук';
    const latest = logs[0];
    $('journalEntries').innerHTML = latest ? `<span class="log-time">${esc(latest.time)}</span><span class="log-new">${esc(latest.message)}</span>` : 'Связь установлена. Поле ждёт первого хода.';
    $('journalEntries').title = logs.map(x => `${x.time} — ${x.message}`).join('\n');
    renderBoard(opened);
  }

  function handleResult(result, action) {
    if (!result.ok) { if(result.reason) toast(result.reason,true); sound('error'); return false; }
    const events = result.events || [];
    const important = events.filter(e => e.message && !['probe','camp','gameover'].includes(e.type));
    if (important.length) important.forEach(e => log(e.message));
    else if (result.opened?.length) log(`Открыто клеток: ${result.opened.length}. Экспедиция продолжается.`);
    if (action==='chooseUpgrade') {
      const upgrade = events.find(e=>e.type==='upgrade');
      if(upgrade) toast(`Получено улучшение: ${upgrade.name}`);
    }
    if (events.some(e=>e.type==='mine'||e.type==='shield')) {
      boardEffect('shake');
      const hit = events.find(e=>e.type==='mine'||e.type==='shield');
      toast(hit.message,hit.type==='mine');
      sound(hit.type==='mine'?'mine':'shield');
    } else if (events.some(e=>e.type==='cleared'||e.type==='extract-ready')) {
      const ready = events.find(e=>e.type==='cleared') || events.find(e=>e.type==='extract-ready');
      toast(ready.message); celebrate(); sound('reward');
    } else {
      const infoEvent = events.find(e=>['scan','emp','probe','buy','rescue'].includes(e.type));
      if (infoEvent?.message) toast(infoEvent.message);
      const loot = events.filter(e=>e.type==='loot');
      if (loot.length) toast(loot.map(e=>e.message).join(' · '));
      sound(action==='sonar'?'scan':action==='emp'?'emp':action==='flag'?'flag':action==='extract'||action==='chooseUpgrade'?'reward':'open');
    }
    if(action==='sonar'||action==='emp') boardEffect('pulse');
    if(action!=='flag') tool=null;
    if (lastSector!==engine.state.sector) {lastSector=engine.state.sector;mode='open';focusedCell=44;}
    save(); render(result.opened || []);
    if(engine.state.status==='camp') showCamp();
    else if(engine.state.status==='over') showGameOver();
    return true;
  }

  function act(method, argument) {
    const result = argument===undefined ? engine[method]() : engine[method](argument);
    return handleResult(result,method);
  }

  function setTool(name) {
    const s = engine.state, info = engine.getInfo();
    if(s.status!=='playing') return;
    if(!s.generated){toast('Сначала открой любую клетку. Первый ход безопасен.');return;}
    if(s.energy<info[name+'Cost']){toast('Не хватает энергии. Открывай безопасные клетки, чтобы восстановить запас.',true);return;}
    tool=tool===name?null:name;mode='open';sound('click');render();
    if(tool && innerWidth<761) $('boardPanel')?.scrollIntoView({behavior:settings.reducedMotion?'instant':'smooth',block:'center'});
  }

  function openModal(type, content) {
    currentDialog=type;
    $('modalContent').innerHTML=content;
    if(!modal.open) modal.showModal();
  }
  function closeModal() {modal.close();currentDialog=null;}
  const closeButton = () => `<button class="icon-button modal-close" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button>`;

  function showHelp() {
    openModal('help',`${closeButton()}<div class="modal-eyebrow">${icon('map')}ПОЛЕВОЙ СПРАВОЧНИК</div><h2 class="modal-title" id="modalTitle">Всё начинается с одного хода.</h2><p class="modal-intro">Классический сапёр, который уходит всё глубже. Читай цифры, береги здоровье и решай, когда пора двигаться дальше.</p><div class="help-grid"><section class="help-card"><h3>${icon('target')}Читай поле</h3><p>Цифра — количество мин в восьми соседних клетках. Пустая клетка раскрывает безопасную область. Первый ход и все соседние клетки всегда безопасны.</p><div class="help-demo"><span class="demo-cell open">1</span><span class="demo-cell">${icon('flag')}</span><span class="demo-cell open">1</span></div></section><section class="help-card"><h3>${icon('flag')}Отмечай мины</h3><p>Правый клик или режим «Флаг». На телефоне можно удерживать клетку. Нажми на открытую цифру, когда все соседние мины отмечены: остальные соседи откроются. Ошибочные флаги опасны!</p></section><section class="help-card"><h3>${icon('radar')}Используй снаряжение</h3><p>Зонд сам открывает безопасную клетку. Сонар показывает мины и безопасные клетки в зоне 3 × 3. Импульс обезвреживает мины в этой зоне и пересчитывает цифры. Для сонара и импульса выбери центр области.</p></section><section class="help-card"><h3>${icon('arrow')}Иди глубже</h3><p>Открой 70% безопасных клеток и отправляйся на привал. Полная зачистка приносит больше кредитов и очков. На привале можно купить припасы, затем выбрать одно бесплатное улучшение.</p></section><section class="help-card"><h3>${icon('shield')}Береги скафандр</h3><p>Щит полностью поглощает один взрыв. Без щита теряется здоровье; при нуле экспедиция заканчивается. Взорванная мина продолжает учитываться соседними цифрами. Энергия восстанавливается за новые открытые клетки.</p></section><section class="help-card"><h3>${icon('mountain')}Неизвестность впереди</h3><p>Мины постепенно становятся плотнее, появляются аномалии. Их условия показаны над полем. Каждый пятый сектор особый: выход на 75%. Секторы бесконечны, таймера нет. Иногда нужен зонд или риск: поля не гарантируют решение только логикой.</p></section></div><label class="motion-setting"><input type="checkbox" id="motionToggle" ${settings.reducedMotion?'checked':''}> Уменьшить анимацию</label><div class="modal-footer"><span class="modal-note">1 — зонд · 2 — сонар · 3 — импульс · F — флаг<br>Стрелки + Enter — игра с клавиатуры · Esc — отменить инструмент<br>Прогресс сохраняется в этом браузере после каждого действия.</span><button class="primary-button" data-action="close-modal">Всё понятно. Вперёд ${icon('arrow')}</button></div>`);
  }

  function showCamp() {
    const s=engine.state;
    if(s.status!=='camp') return;
    const reward=s.lastSectorReward || {coins:0,score:0,fullClear:false};
    const cards=s.offers.map(id=>{
      const u=ExpeditionEngine.UPGRADES[id];
      let description=u.description;
      if(id==='medkit'&&s.hp===s.maxHp) description='Здоровье уже полное: вместо лечения получишь 14 кредитов.';
      if(id==='shield'&&s.shields===s.maxShields) description='Щиты уже полные: вместо щита получишь 12 кредитов.';
      if(id==='energy'&&s.energy===s.maxEnergy) description='Энергия уже полная: вместо заряда получишь 9 кредитов.';
      return `<button class="upgrade-card" data-upgrade="${id}"><span class="upgrade-icon">${icon(u.icon)}</span><h3>${esc(u.name)}</h3><p>${esc(description)}</p><span class="choose-label">ВЗЯТЬ И ИДТИ ДАЛЬШЕ ${icon('arrow')}</span></button>`;
    }).join('');
    const shop=Object.values(ExpeditionEngine.SHOP).map(item=>{
      const full=item.id==='medkit'?s.hp>=s.maxHp:item.id==='shield'?s.shields>=s.maxShields:s.energy>=s.maxEnergy;
      return `<button class="shop-button" data-buy="${item.id}" ${s.coins<item.cost||full?'disabled':''} title="${esc(item.description)}${full?' · Запас полный':''}">${icon(item.icon)}<span><strong>${esc(item.name)}</strong><small>${icon('coin')}${item.cost} · ${esc(item.description)}</small></span></button>`;
    }).join('');
    openModal('camp',`${closeButton()}<div class="modal-eyebrow">${icon('check')}СЕКТОР ${s.sector} ${reward.fullClear?'ПОЛНОСТЬЮ ЗАЧИЩЕН':'ПРОЙДЕН'}</div><h2 class="modal-title" id="modalTitle">Перед следующим спуском.</h2><p class="modal-intro">Хорошая работа, исследователь. Пополни запасы и выбери <strong>одно бесплатное улучшение</strong>. Впереди сектор ${s.sector+1}.</p><div class="reward-summary"><span>${icon('coin')}+${number(reward.coins)} кредитов</span><span>${icon('spark')}+${number(reward.score)} очков</span><span>${icon('energy')}Энергия: ${s.energy}/${s.maxEnergy}</span></div><div class="section-label">СНАЧАЛА ПРИПАСЫ · У ТЕБЯ ${number(s.coins)} КРЕДИТОВ</div><div class="shop-grid">${shop}</div><div class="section-label">ЗАТЕМ ОДНО УЛУЧШЕНИЕ · БЕСПЛАТНО</div><div class="upgrade-options">${cards}</div><div class="modal-footer"><span class="modal-note">Здоровье: ${s.hp}/${s.maxHp} · Щиты: ${s.shields}/${s.maxShields}<br>Выбор улучшения сразу начинает следующий сектор.</span><button class="secondary-button" data-action="close-modal">Осмотреть поле</button></div>`);
  }

  function showGameOver() {
    const s=engine.state;
    openModal('over',`${closeButton()}<div class="gameover-art">${icon('helmet')}</div><div class="modal-eyebrow">СВЯЗЬ С ЭКСПЕДИЦИЕЙ ПОТЕРЯНА</div><h2 class="modal-title" id="modalTitle">Но глубина ещё зовёт.</h2><p class="modal-intro">Каждый спуск учит замечать чуть больше. Рекорд сохранён — а следующий маршрут будет совсем другим.</p><div class="modal-stats"><div class="modal-stat"><strong>${number(s.score)}</strong><span>ОЧКОВ</span></div><div class="modal-stat"><strong>${number(s.sector*100)} м</strong><span>ГЛУБИНА</span></div><div class="modal-stat"><strong>${number(s.totalOpened)}</strong><span>КЛЕТОК ОТКРЫТО</span></div></div><p class="modal-note">${s.score>=best.score&&s.score>0?'Это твой лучший результат. Отличная экспедиция.':`Личный рекорд: ${number(best.score)} очков · максимальная глубина: ${number(best.sector*100)} м.`}</p><div class="modal-footer"><button class="secondary-button" data-action="close-modal">Посмотреть поле</button><button class="primary-button" data-action="restart-now">Новая экспедиция ${icon('arrow')}</button></div>`);
  }

  function showArsenal() {
    const s=engine.state;
    const items=[];
    if(s.maxHp>3) items.push({name:'Усиленный корпус',desc:`Максимум здоровья: ${s.maxHp}.`,icon:'heart'});
    if(s.maxEnergy>8) items.push({name:'Ёмкая батарея',desc:`Запас энергии увеличен до ${s.maxEnergy}.`,icon:'energy'});
    if(s.upgrades.recycler) items.push({name:'Рекуператор',desc:`Базовая регенерация: +1 энергия за ${12-s.upgrades.recycler*2} клеток.`,icon:'reset'});
    if(s.upgrades.cartographer) items.push({name:'Картограф',desc:`Бесплатных зондов в каждом секторе: ${1+s.upgrades.cartographer}.`,icon:'map'});
    if(s.upgrades.fortune) items.push({name:'Протокол открытия',desc:`Очки за открытие клеток: +${s.upgrades.fortune*10}%.`,icon:'spark'});
    if(s.rescueTokens) items.push({name:'Страховочный трос',desc:'Одна защита от смертельного взрыва.',icon:'shield'});
    openModal('arsenal',`${closeButton()}<div class="modal-eyebrow">${icon('box')}СНАРЯЖЕНИЕ ИССЛЕДОВАТЕЛЯ</div><h2 class="modal-title" id="modalTitle">Твой запас прочности.</h2><p class="modal-intro">Улучшения действуют до конца текущей экспедиции. Новые можно получить на привале после каждого сектора.</p><div class="modal-stats"><div class="modal-stat"><strong>${s.hp}/${s.maxHp}</strong><span>ЗДОРОВЬЕ</span></div><div class="modal-stat"><strong>${s.energy}/${s.maxEnergy}</strong><span>ЭНЕРГИЯ</span></div><div class="modal-stat"><strong>${s.shields}</strong><span>ЩИТЫ</span></div></div>${items.length?`<div class="arsenal-list">${items.map(x=>`<div class="arsenal-item">${icon(x.icon)}<div><strong>${esc(x.name)}</strong><p>${esc(x.desc)}</p></div></div>`).join('')}</div>`:'<div class="arsenal-empty">Пока только базовое снаряжение.<br>Пройди первый сектор — и выбери своё первое улучшение.</div>'}<div class="modal-footer"><span class="modal-note">Обезврежено мин: ${s.totalMinesDefused} · пройдено секторов: ${s.sectorsCleared}<br>Номер экспедиции: ${s.seed.toString(16).toUpperCase()}</span><button class="primary-button" data-action="close-modal">Вернуться на поле ${icon('arrow')}</button></div>`);
  }

  function confirmRestart() {
    if((engine.state.sector===1&&!engine.state.generated) || engine.state.status==='over') {restart();return;}
    openModal('restart',`${closeButton()}<div class="modal-eyebrow">${icon('reset')}НОВЫЙ МАРШРУТ</div><h2 class="modal-title" id="modalTitle">Начать новый спуск?</h2><p class="modal-intro">Текущая экспедиция на глубине ${number(engine.state.sector*100)} м закончится. Личный рекорд останется, а здоровье, снаряжение и маршрут начнутся заново.</p><div class="modal-footer"><button class="secondary-button" data-action="close-modal">Продолжить экспедицию</button><button class="primary-button" data-action="restart-now">Начать заново ${icon('arrow')}</button></div>`);
  }

  function restart() {
    save();closeModal();engine=new ExpeditionEngine();mode='open';tool=null;focusedCell=44;lastSector=1;logs=[];
    log('Новый маршрут проложен. Первый ход безопасен.');
    save();render();sound('reward');toast('Экспедиция началась. Удачного спуска!');
  }

  function action(name) {
    switch(name) {
      case 'play':if(engine.state.status==='camp')showCamp();else if(engine.state.status==='over')showGameOver();else cellButtons[focusedCell].focus();break;
      case 'probe':act('probe');break;
      case 'sonar':setTool('sonar');break;
      case 'emp':setTool('emp');break;
      case 'cancel-tool':tool=null;render();break;
      case 'mode-open':mode='open';tool=null;render();sound('click');break;
      case 'mode-flag':mode='flag';tool=null;render();sound('click');break;
      case 'extract':engine.state.status==='camp'?showCamp():act('extract');break;
      case 'sound':settings.sound=!settings.sound;save();render();sound('click');toast(settings.sound?'Звук включён':'Звук выключен');break;
      case 'help':showHelp();break;
      case 'arsenal':showArsenal();break;
      case 'close-modal':closeModal();break;
      case 'result':showGameOver();break;
      case 'restart':confirmRestart();break;
      case 'restart-now':restart();break;
    }
  }

  document.addEventListener('click',event=>{
    const upgrade=event.target.closest('[data-upgrade]');
    if(upgrade){const id=upgrade.dataset.upgrade;closeModal();act('chooseUpgrade',id);return;}
    const purchase=event.target.closest('[data-buy]');
    if(purchase){act('buy',purchase.dataset.buy);return;}
    const target=event.target.closest('[data-action]');
    if(target){event.preventDefault();action(target.dataset.action);}
  });
  document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();showHelp();});
  document.addEventListener('change',event=>{
    if(event.target.id==='motionToggle'){settings.reducedMotion=event.target.checked;save();document.body.classList.toggle('reduced-motion',settings.reducedMotion);}
  });
  modal.addEventListener('cancel',()=>{currentDialog=null;});

  board.addEventListener('click',event=>{
    const node=event.target.closest('[data-index]');if(!node)return;
    const index=Number(node.dataset.index);
    if(suppressClick.index===index && Date.now()<suppressClick.until){event.preventDefault();return;}
    focusedCell=index;
    if(tool) act(tool,index);
    else act(mode==='flag'?'flag':'open',index);
  });
  board.addEventListener('contextmenu',event=>{
    event.preventDefault();
    const node=event.target.closest('[data-index]');if(!node)return;
    const index=Number(node.dataset.index);
    if(suppressClick.index===index&&Date.now()<suppressClick.until)return;
    if(tool){tool=null;render();return;}
    focusedCell=index;act('flag',index);
  });
  function clearPress(){if(longPress){clearTimeout(longPress.timer);longPress=null;}}
  board.addEventListener('pointerdown',event=>{
    suppressClick={index:-1,until:0};
    if(event.pointerType==='mouse'||event.button!==0||tool||engine.state.status!=='playing')return;
    const node=event.target.closest('[data-index]');if(!node)return;
    clearPress();
    const index=Number(node.dataset.index);
    longPress={x:event.clientX,y:event.clientY,index,timer:setTimeout(()=>{
      suppressClick={index,until:Infinity};focusedCell=index;act('flag',index);clearPress();
      if(navigator.vibrate) navigator.vibrate(15);
    },450)};
  });
  board.addEventListener('pointermove',event=>{
    if(longPress&&Math.hypot(event.clientX-longPress.x,event.clientY-longPress.y)>9)clearPress();
    if(!tool)return;
    const node=event.target.closest('[data-index]');
    cellButtons.forEach(n=>n.classList.remove('target-zone','emp-zone'));
    if(!node)return;
    const index=Number(node.dataset.index),x=index%10,y=Math.floor(index/10);
    for(let yy=Math.max(0,y-1);yy<=Math.min(9,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(9,x+1);xx++){
      cellButtons[yy*10+xx].classList.add('target-zone');
      if(tool==='emp')cellButtons[yy*10+xx].classList.add('emp-zone');
    }
  });
  ['pointerup','pointercancel'].forEach(type=>board.addEventListener(type,()=>{
    clearPress();
    if(suppressClick.until===Infinity)suppressClick.until=Date.now()+900;
  }));
  board.addEventListener('pointerleave',clearPress);
  board.addEventListener('pointerleave',()=>cellButtons.forEach(n=>n.classList.remove('target-zone','emp-zone')));
  board.addEventListener('focusin',event=>{
    const node=event.target.closest('[data-index]');if(!node)return;
    focusedCell=Number(node.dataset.index);
    cellButtons.forEach((b,i)=>b.tabIndex=i===focusedCell?0:-1);
  });
  board.addEventListener('keydown',event=>{
    const directions={ArrowLeft:-1,ArrowRight:1,ArrowUp:-10,ArrowDown:10};
    if(event.key in directions){
      event.preventDefault();let target=focusedCell+directions[event.key];
      if(event.key==='ArrowLeft'&&focusedCell%10===0)return;
      if(event.key==='ArrowRight'&&focusedCell%10===9)return;
      if(target>=0&&target<100)cellButtons[target].focus();
    }
  });
  document.addEventListener('keydown',event=>{
    if(event.ctrlKey||event.altKey||event.metaKey||event.repeat)return;
    if(modal.open)return;
    if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))return;
    if(event.key==='Escape'){tool=null;render();return;}
    const key=event.key.toLowerCase();
    if(['1','2','3'].includes(key)){event.preventDefault();action({1:'probe',2:'sonar',3:'emp'}[key]);}
    if(key==='f'||key==='а'){
      event.preventDefault();
      const cell=event.target.closest('[data-index]');
      if(cell)act('flag',Number(cell.dataset.index));
      else action(mode==='open'?'mode-flag':'mode-open');
    }
    if(event.key==='?'||event.key==='F1'){event.preventDefault();showHelp();}
  });
  // Every completed action is already saved. Do not overwrite newer saves when
  // an old tab is hidden or closed. Other tabs adopt the latest valid run.
  window.addEventListener('storage',event=>{
    if(event.key!==SAVE_KEY||!event.newValue)return;
    try {
      const incoming=JSON.parse(event.newValue);
      const next=new ExpeditionEngine(incoming.run);
      if(!next.loaded)return;
      engine=next;lastSector=engine.state.sector;tool=null;
      if(validNumber(incoming.best?.score))best.score=Math.max(best.score,incoming.best.score);
      if(validNumber(incoming.best?.sector))best.sector=Math.max(best.sector,incoming.best.sector);
      if(Array.isArray(incoming.logs))logs=incoming.logs.filter(x=>x&&typeof x.message==='string'&&typeof x.time==='string').slice(0,12);
      closeModal();render();
      if(engine.state.status==='camp')showCamp();
      if(engine.state.status==='over')showGameOver();
    } catch(_) {}
  });

  if(!logs.length) log(restored?'Экспедиция восстановлена. Продолжим спуск.':'Связь установлена. Поле ждёт первого хода.');
  save();render();
  if(engine.state.status==='camp')showCamp();
  if(engine.state.status==='over')showGameOver();
  if(stored?.run&&!restored)toast('Сохранение повреждено или устарело. Начата новая экспедиция.',true);
  if(!canSave)toast('Браузер не разрешил сохранение. Эта экспедиция доступна, пока открыта вкладка.',true);
})();
