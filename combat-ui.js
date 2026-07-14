// ============================================================
// COMBAT PROTOTİP - UI
// ============================================================

let cbMode = null; // 'move' | 'fire' | null
let cbSuppressNextClick = false; // pan/pinch sonrası yanlışlıkla tıklamayı önlemek için
let cbFireTargetUnit = null;

function cbUid() { return Math.random().toString(36).slice(2, 9); }

let cbPlacementRoster = []; // yerleştirme aşamasında henüz konumlanmamış oyuncu birimleri
let cbPlacingUnitId = null; // şu an yerleştirilmekte olan birim

function cbSetupDemo() {
  cbPlacementRoster = [
    { id: cbUid(), name: "Q", side: "player", dir: "up", hp: 100, weapon: "tabanca_low", magAmmo: 8, spareMags: 2, aimSkill: 10, armorQuality: "standart", consumables: { sersemletici: 2, kirilma_sarji: 2, el_bombasi: 1, molotof: 1 }, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
    { id: cbUid(), name: "W", side: "player", dir: "up", hp: 100, weapon: "pompali_low", magAmmo: 2, spareMags: 1, aimSkill: 5, armorQuality: "hurdalik", actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
    { id: cbUid(), name: "E", side: "player", dir: "right", hp: 100, weapon: "tufek_low", magAmmo: 5, spareMags: 1, aimSkill: 15, armorQuality: "kaliteli", actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
    { id: cbUid(), name: "R", side: "player", dir: "up", hp: 100, weapon: "makineli_low", magAmmo: 20, spareMags: 1, aimSkill: 0, armorQuality: null, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
  ];
  cbEnemyRosterTemplate = [
    { name: "A", weapon: "tabanca_low", magAmmo: 8, spareMags: 1, aimSkill: 8, personality: "agresif", armorQuality: "hurdalik" },
    { name: "B", weapon: "makineli_low", magAmmo: 20, spareMags: 0, aimSkill: 0, personality: "agresif", armorQuality: null },
    { name: "C", weapon: "pompali_low", magAmmo: 2, spareMags: 1, aimSkill: 5, personality: "savunmaci", armorQuality: "standart" },
    { name: "D", weapon: "tufek_low", magAmmo: 5, spareMags: 0, aimSkill: 12, personality: "sinsi", armorQuality: null },
  ];

  cbState.units = [];
  cbState.phase = "placement";
  cbState.ambushMode = true;
  cbState.ambushInitiator = "player";
  cbState.round = 1;

  cbPlaceEnemiesForAmbush(); // rakipler baştan hazır, oyuncu görüp buna göre yerleşir
}

let cbEnemyRosterTemplate = [];

// Yerleştirme aşaması tamamlanınca çağrılır: düşmanları otomatik yerleştirir,
// FoW'u aktif eder ve kombatı başlatır.
function cbPlaceEnemiesForAmbush() {
  const dirs = ["up", "down", "left", "right"];
  const count = cbEnemyRosterTemplate.length;

  let spots;
  if (cbState.mapType === "hideout" && cbState.mapRooms && cbState.mapRooms.length > 0) {
    // Her birim, farklı bir odaya rastgele düşürülür (odalar arası dağınık,
    // ama her zaman bir odanın içinde - koridor/açık alanda değil).
    spots = [];
    for (let i = 0; i < count; i++) {
      const room = cbState.mapRooms[Math.floor(Math.random() * cbState.mapRooms.length)];
      const roomFloorTiles = [];
      for (let y = room.y0; y <= room.y1; y++) {
        for (let x = room.x0; x <= room.x1; x++) {
          if (cbTileAt(x, y) === "floor" && !cbUnitAt(x, y) && !spots.some(s => s.x === x && s.y === y)) {
            roomFloorTiles.push({ x, y });
          }
        }
      }
      if (roomFloorTiles.length > 0) {
        spots.push(roomFloorTiles[Math.floor(Math.random() * roomFloorTiles.length)]);
      }
    }
  } else {
    spots = cbFindClusteredFloorTiles(count, 4);
  }

  cbEnemyRosterTemplate.forEach((template, i) => {
    const spot = spots[i];
    if (!spot) return;
    const randomDir = dirs[Math.floor(Math.random() * dirs.length)];
    cbState.units.push({
      id: cbUid(), name: template.name, side: "enemy",
      x: spot.x, y: spot.y, dir: randomDir,
      hp: 100, weapon: template.weapon, magAmmo: template.magAmmo, spareMags: template.spareMags,
      aimSkill: template.aimSkill, personality: template.personality || "agresif",
      armorQuality: template.armorQuality || null,
      actionsLeft: { move: true, act: true }, status: "active", injuries: [],
    });
  });
}

function cbFinishPlacementAndStartCombat() {
  cbState.phase = "combat";
  cbBuildTurnOrder();
  cbLog("Pusu başladı.");
}

function cbDrawLaser(attacker, defender) {
  const svg = document.getElementById("cb-laser-overlay");
  const tileSize = 30;
  const weapon = CB_WEAPONS[attacker.weapon];

  const x1 = attacker.x * tileSize + tileSize / 2;
  const y1 = attacker.y * tileSize + tileSize / 2;
  const x2 = defender.x * tileSize + tileSize / 2;
  const y2 = defender.y * tileSize + tileSize / 2;

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1); line.setAttribute("y1", y1);
  line.setAttribute("x2", x2); line.setAttribute("y2", y2);
  line.setAttribute("stroke", weapon.laserColor || "#e6c368");
  line.setAttribute("stroke-width", weapon.laserWidth || 1.5);
  line.setAttribute("class", "cb-laser-line");
  svg.appendChild(line);

  requestAnimationFrame(() => { line.classList.add("firing"); });
  setTimeout(() => line.remove(), 550);
}

// Bastırma ateşinin koni alanını, saldırgandan koni içindeki her kareye kısa
// çizgiler çizerek görselleştirir (lazer efektinin çoklu-hedef versiyonu).
function cbDrawConeEffect(attacker) {
  const weapon = CB_WEAPONS[attacker.weapon];
  const tiles = cbGetConeTiles(attacker, weapon.range);
  const svg = document.getElementById("cb-laser-overlay");
  const tileSize = 30;
  const x1 = attacker.x * tileSize + tileSize / 2;
  const y1 = attacker.y * tileSize + tileSize / 2;

  tiles.forEach(t => {
    const x2 = t.x * tileSize + tileSize / 2;
    const y2 = t.y * tileSize + tileSize / 2;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("stroke", weapon.laserColor || "#f0a830");
    line.setAttribute("stroke-width", 1);
    line.setAttribute("opacity", "0.5");
    line.setAttribute("class", "cb-laser-line");
    svg.appendChild(line);
    requestAnimationFrame(() => { line.classList.add("firing"); });
    setTimeout(() => line.remove(), 550);
  });
}

function cbSyncLaserOverlaySize() {
  const grid = document.getElementById("cb-grid");
  const svg = document.getElementById("cb-laser-overlay");
  svg.setAttribute("width", grid.offsetWidth);
  svg.setAttribute("height", grid.offsetHeight);
}

function cbAllVisibleTilesForSide(side) {
  const visible = new Set();
  cbState.units.filter(u => u.side === side && u.status !== "dead" && u.status !== "fled").forEach(u => {
    cbComputeVisionTiles(u).forEach(t => visible.add(t));
  });
  return visible;
}

function cbRenderPlacementPanel() {
  const panel = document.getElementById("cb-placement-panel");
  const actionsPanel = document.getElementById("cb-actions");
  const isPlacement = cbState.phase === "placement";
  panel.classList.toggle("active", isPlacement);
  actionsPanel.style.display = isPlacement ? "none" : "flex";
  if (!isPlacement) return;

  const listEl = document.getElementById("cb-roster-list");
  listEl.innerHTML = "";
  cbPlacementRoster.forEach(u => {
    const placedUnit = cbState.units.find(x => x.id === u.id);
    const item = document.createElement("div");
    item.className = "cb-roster-item" + (cbPlacingUnitId === u.id ? " picking" : "") + (placedUnit ? " placed" : "");
    const weapon = CB_WEAPONS[u.weapon];
    item.innerHTML = `<b>${u.name}</b> — ${weapon.name}${placedUnit ? ` (${placedUnit.x},${placedUnit.y})` : " — yerleştirilmedi"}`;
    item.addEventListener("click", () => {
      cbPlacingUnitId = cbPlacingUnitId === u.id ? null : u.id;
      cbRefreshAll();
    });
    listEl.appendChild(item);
  });

  const allPlaced = cbPlacementRoster.every(u => cbState.units.find(x => x.id === u.id));
  document.getElementById("cb-btn-start-ambush").disabled = !allPlaced;
}

function cbRenderGrid() {
  const gridEl = document.getElementById("cb-grid");
  const tileSize = 30;
  gridEl.style.gridTemplateColumns = `repeat(${cbState.cols}, ${tileSize}px)`;
  gridEl.innerHTML = "";

  const isPlacement = cbState.phase === "placement";

  // Yerleştirme aşamasında FoW devre dışı - tüm harita görünür
  const visibleTiles = isPlacement ? null : cbAllVisibleTilesForSide("player");
  const currentUnit = isPlacement ? null : cbCurrentUnit();
  const isPlayerTurn = !isPlacement && currentUnit && currentUnit.side === "player" && currentUnit.status === "active";
  const canShowReachable = isPlayerTurn && cbMode === "move";
  const reachable = canShowReachable ? cbReachableTiles(currentUnit) : [];
  const reachableSet = new Set(reachable.map(r => `${r.x},${r.y}`));

  for (let y = 0; y < cbState.rows; y++) {
    for (let x = 0; x < cbState.cols; x++) {
      const tile = cbTileAt(x, y);
      const key = `${x},${y}`;
      const isVisible = isPlacement ? true : visibleTiles.has(key);
      const el = document.createElement("div");
      el.className = "cb-tile " + tile + (isVisible ? "" : " hidden");
      if (reachableSet.has(key)) el.className += " cb-reachable";

      // Yerleştirme aşamasında: giriş noktasına yakın boş floor kareleri, yerleştirilebilir olarak vurgulanır
      if (isPlacement && cbPlacingUnitId && tile === "floor" && !cbUnitAt(x, y)) {
        const withinRadius = !cbState.mapEntrance ||
          (Math.abs(x - cbState.mapEntrance.x) + Math.abs(y - cbState.mapEntrance.y)) <= CB_PLACEMENT_RADIUS;
        if (withinRadius) el.className += " cb-placeable";
      }

      el.dataset.x = x; el.dataset.y = y;

      const unit = cbAnyUnitAt(x, y);
      if (unit && (isVisible || unit.side === "player" || unit.status === "fleeing" || unit.status === "fled" || unit.status === "dead")) {
        const marker = document.createElement("div");
        marker.className = "cb-unit-marker " + unit.side + (unit.status === "down" ? " down" : "") + (unit.status === "dead" ? " dead" : "") + (cbState.selectedUnitId === unit.id ? " selected" : "");
        marker.textContent = unit.name;
        marker.title = unit.name;
        el.appendChild(marker);
      }

      // Bekleyen (henüz patlamamış) breach charge işareti - tüm ekip görebilir
      const pendingBreach = (cbState.pendingBreaches || []).find(b => b.x === x && b.y === y);
      if (pendingBreach) {
        const bmarker = document.createElement("div");
        bmarker.className = "cb-breach-marker";
        el.appendChild(bmarker);
      }

      el.addEventListener("click", (ev) => cbHandleTileClick(x, y, ev));
      gridEl.appendChild(el);
    }
  }
  cbSyncLaserOverlaySize();
  if (typeof cbApplyTransform === "function") cbApplyTransform();
}

function cbHandleTileClick(x, y, ev) {
  if (cbSuppressNextClick) { cbSuppressNextClick = false; return; }
  if (cbState.phase === "placement") {
    cbHandlePlacementClick(x, y);
    return;
  }

  const current = cbCurrentUnit();
  if (!current || current.side !== "player") return;

  if (cbMode === "move") {
    const reachable = cbReachableTiles(current);
    const found = reachable.find(r => r.x === x && r.y === y);
    if (found) {
      cbMoveUnit(current, x, y, current.dir);
      cbMode = null;
      cbRefreshAll();
    }
    return;
  }

  if (cbMode === "fire") {
    const target = cbUnitAt(x, y);
    if (target && target.side !== current.side) {
      cbFireTargetUnit = target;
      document.getElementById("cb-bodyparts").style.display = "flex";
    }
    return;
  }

  if (cbMode && cbMode.startsWith("consumable:")) {
    const key = cbMode.split(":")[1];
    if (key === "kirilma_sarji") {
      if (!cbCanPlaceBreach(current, x, y)) {
        cbLog("Buraya kırılma şarjı yerleştirilemez (bitişik duvar/kapı olmalı).");
        return;
      }
      const placed = cbPlaceBreachCharge(current, x, y);
      if (placed) current.consumables.kirilma_sarji -= 1;
    } else {
      const range = CB_CONSUMABLE_THROW_RANGE[key] || 4;
      const dist = Math.abs(current.x - x) + Math.abs(current.y - y);
      if (dist > range) {
        cbLog(`Bu malzeme o kadar uzağa atılamaz (maksimum ${range} kare).`);
        return;
      }
      current.consumables[key] -= 1;
      cbUseConsumable(current, key, x, y);
    }
    cbMode = null;
    cbRefreshAll();
    return;
  }

  if (cbMode === "loot") {
    const target = cbAnyUnitAt(x, y);
    const dist = Math.abs(current.x - x) + Math.abs(current.y - y);
    if (!target || (target.status !== "dead" && target.status !== "down")) {
      cbLog("Sadece ölü ya da bayılmış birimlerin yanından malzeme alabilirsin.");
      return;
    }
    if (dist > 1) {
      cbLog("Malzeme almak için bitişik olman gerekir.");
      return;
    }
    cbLootUnit(current, target);
    cbMode = null;
    cbRefreshAll();
    return;
  }

  if (cbMode === "borrow-ammo") {
    const target = cbAnyUnitAt(x, y);
    const dist = Math.abs(current.x - x) + Math.abs(current.y - y);
    if (!target || target.side !== current.side || target.status !== "down") {
      cbLog("Sadece bayılmış bir müttefikten mermi alabilirsin.");
      return;
    }
    if (dist > 1) {
      cbLog("Mermi almak için bitişik olman gerekir.");
      return;
    }
    const success = cbBorrowAmmo(current, target);
    if (success) {
      cbLog(`${current.name}, ${target.name}'den mermi aldı.`);
    } else {
      cbLog("Bu müttefikte alınacak uygun mermi yok (silah uyumsuz ya da mermisi bitmiş).");
    }
    cbMode = null;
    cbRefreshAll();
    return;
  }

  const unit = cbUnitAt(x, y);
  if (unit) cbShowUnitPopover(unit, ev.clientX, ev.clientY);
}

const CB_PLACEMENT_RADIUS = 4; // giriş noktasına en fazla bu kadar kare uzaklıkta yerleşilebilir

function cbHandlePlacementClick(x, y) {
  if (!cbPlacingUnitId) return;
  if (cbTileAt(x, y) !== "floor") {
    cbLog("Sadece yürünebilir (floor) karelere yerleştirebilirsin.");
    cbRefreshAll();
    return;
  }
  if (cbState.mapEntrance) {
    const dist = Math.abs(x - cbState.mapEntrance.x) + Math.abs(y - cbState.mapEntrance.y);
    if (dist > CB_PLACEMENT_RADIUS) {
      cbLog(`Sadece girişe yakın (${CB_PLACEMENT_RADIUS} kare içinde) yerleşebilirsin.`);
      cbRefreshAll();
      return;
    }
  }
  if (cbUnitAt(x, y)) return; // dolu kare

  const rosterUnit = cbPlacementRoster.find(u => u.id === cbPlacingUnitId);
  if (!rosterUnit) return;

  // Eğer bu birim daha önce yerleştirildiyse, önce eski konumundan kaldır
  cbState.units = cbState.units.filter(u => u.id !== cbPlacingUnitId);

  cbState.units.push({ ...rosterUnit, x, y });
  cbPlacingUnitId = null;
  cbRefreshAll();
}

function cbShowUnitPopover(unit, clientX, clientY) {
  const pop = document.getElementById("cb-popover");
  let html = `<div style="font-weight:600; margin-bottom:6px;">${unit.name}</div>`;
  html += `<div>HP: ${unit.hp}/${CB_CONSTANTS.maxHP}</div>`;

  if (unit.side === "player") {
    const weapon = CB_WEAPONS[unit.weapon];
    html += `<div>Silah: ${weapon.name}</div>`;
    html += `<div>Mermi: ${unit.magAmmo}/${weapon.magSize} (${unit.spareMags} yedek şarjör)</div>`;
    if (unit.injuries && unit.injuries.length > 0) {
      html += `<div style="margin-top:6px; color:#d4453d;">Yaralar: ${unit.injuries.map(i => CB_BODY_PARTS[i.bodyPart].label).join(", ")}</div>`;
    } else {
      html += `<div style="margin-top:6px; color:#4a7c59;">Sağlam</div>`;
    }
  } else {
    if (unit.injuries && unit.injuries.length > 0) {
      html += `<div style="margin-top:6px; color:#d4453d;">Vurulduğu yer: ${CB_BODY_PARTS[unit.injuries[unit.injuries.length-1].bodyPart].label}</div>`;
    } else {
      html += `<div style="margin-top:6px; color:#9098a8;">Henüz vurulmadı</div>`;
    }
  }
  html += `<button id="cb-popover-close">Kapat</button>`;
  pop.innerHTML = html;
  pop.style.left = Math.min(clientX, window.innerWidth - 240) + "px";
  pop.style.top = Math.min(clientY, window.innerHeight - 200) + "px";
  pop.style.display = "block";
  document.getElementById("cb-popover-close").addEventListener("click", () => { pop.style.display = "none"; });
}

function cbRenderSideLists() {
  const leftEl = document.getElementById("cb-left-list");
  const rightEl = document.getElementById("cb-right-list");
  leftEl.innerHTML = ""; rightEl.innerHTML = "";

  const current = cbCurrentUnit();

  cbState.units.filter(u => u.side === "player").forEach(u => {
    const card = document.createElement("div");
    card.className = "cb-unit-card" + (current && current.id === u.id ? " current" : "");
    card.innerHTML = `
      <div class="name">${u.name} ${u.status !== "active" ? "(" + u.status + ")" : ""}</div>
      <div class="hpbar"><div class="hpfill" style="width:${Math.max(0,u.hp/CB_CONSTANTS.maxHP*100)}%"></div></div>
      <div>${u.hp} HP</div>
    `;
    card.addEventListener("click", (e) => cbShowUnitPopover(u, e.clientX, e.clientY));
    leftEl.appendChild(card);
  });

  cbState.units.filter(u => u.side === "enemy").forEach(u => {
    const card = document.createElement("div");
    card.className = "cb-unit-card" + (current && current.id === u.id ? " current" : "");
    const visibleToPlayer = cbAllVisibleTilesForSide("player").has(`${u.x},${u.y}`);
    card.innerHTML = `
      <div class="name">${u.name} ${u.status !== "active" ? "(" + u.status + ")" : ""}</div>
      <div class="hpbar"><div class="hpfill" style="width:${Math.max(0,u.hp/CB_CONSTANTS.maxHP*100)}%"></div></div>
      <div>${visibleToPlayer ? (u.hp) + " HP görünüyor" : "görünmüyor"}</div>
    `;
    if (visibleToPlayer) card.addEventListener("click", (e) => cbShowUnitPopover(u, e.clientX, e.clientY));
    rightEl.appendChild(card);
  });
}

// Her sarf malzemesinin, karakterden ne kadar uzağa atılabileceği (menzil, kare cinsinden).
// Silahlardan bağımsız, elle atma mesafesi olarak tasarlandı.
const CB_CONSUMABLE_THROW_RANGE = {
  sersemletici: 4,
  el_bombasi: 4,
  molotof: 3,
  kirilma_sarji: 1, // sadece bitişik duvar/kapı (cbCanPlaceBreach zaten bunu kontrol ediyor)
};

// Ölü/bayılmış bir birimin (dost veya düşman fark etmeksizin) sarf malzemelerini
// ve zırhını alır. Düşmandan alınan malzemeler de kullanılabilir hale gelir.
function cbLootUnit(looter, target) {
  const lootedItems = [];

  if (target.consumables) {
    Object.keys(target.consumables).forEach(key => {
      const amount = target.consumables[key];
      if (amount > 0) {
        looter.consumables = looter.consumables || {};
        looter.consumables[key] = (looter.consumables[key] || 0) + amount;
        target.consumables[key] = 0;
        const item = CB_CONSUMABLES[key];
        lootedItems.push(`${item ? item.name : key} x${amount}`);
      }
    });
  }

  if (target.armorQuality && !looter.armorQuality) {
    looter.armorQuality = target.armorQuality;
    target.armorQuality = null;
    const armor = CB_ARMOR_QUALITY[looter.armorQuality];
    lootedItems.push(`${armor ? armor.label : "Zırh"}`);
  }

  if (lootedItems.length === 0) {
    cbLog(`${target.name} üzerinde alınacak bir şey yok.`);
  } else {
    cbLog(`${looter.name}, ${target.name}'den şunları aldı: ${lootedItems.join(", ")}.`);
  }
}

function cbRenderConsumableMenu() {
  const current = cbCurrentUnit();
  const menu = document.getElementById("cb-consumable-menu");
  if (!current || !current.consumables) { menu.style.display = "none"; return; }

  const entries = Object.keys(current.consumables).filter(k => current.consumables[k] > 0);
  if (entries.length === 0) {
    menu.innerHTML = `<span style="font-size:10.5px; color:#9098a8;">Envanterinde sarf malzemesi yok.</span>`;
    menu.style.display = "flex";
    return;
  }

  menu.innerHTML = "";
  entries.forEach(key => {
    const item = CB_CONSUMABLES[key];
    if (!item) return;
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.textContent = `${item.name} (${current.consumables[key]})`;
    btn.addEventListener("click", () => {
      cbMode = "consumable:" + key;
      document.getElementById("cb-bodyparts").style.display = "none";
      document.getElementById("cb-consumable-menu").style.display = "none";
      cbRenderGrid();
      cbRenderActionPanel();
    });
    menu.appendChild(btn);
  });
  menu.style.display = "flex";
}

function cbRenderActionPanel() {
  const current = cbCurrentUnit();
  document.getElementById("cb-current-name").textContent = current ? current.name + " (" + current.side + ")" : "-";
  document.getElementById("cb-round").textContent = cbState.round;

  const isPlayerTurn = !!(current && current.side === "player" && current.status === "active");
  const stunned = isPlayerTurn && cbIsStunned(current);

  document.getElementById("cb-btn-move").disabled = !isPlayerTurn || stunned || !current.actionsLeft.move;
  document.getElementById("cb-btn-fire").disabled = !isPlayerTurn || stunned || !current.actionsLeft.act || current.magAmmo <= 0;

  const suppressBtn = document.getElementById("cb-btn-suppress");
  const currentWeapon = isPlayerTurn ? CB_WEAPONS[current.weapon] : null;
  const isMachineGun = currentWeapon && currentWeapon.hasFireModes;
  suppressBtn.style.display = isMachineGun ? "inline-block" : "none";
  if (isMachineGun) {
    suppressBtn.disabled = !isPlayerTurn || stunned || !current.actionsLeft.act || current.magAmmo < currentWeapon.suppressAmmoCost;
    suppressBtn.textContent = `Bastırma Ateşi (${currentWeapon.suppressAmmoCost} mermi)`;
  }
  document.getElementById("cb-btn-reload").disabled = !isPlayerTurn || stunned || !current.actionsLeft.act || current.spareMags <= 0;
  document.getElementById("cb-btn-cover").disabled = !isPlayerTurn || stunned || !current.actionsLeft.act || current.takingCover;
  document.getElementById("cb-btn-cover").classList.toggle("mode-active", isPlayerTurn && current.takingCover);
  document.getElementById("cb-btn-flee").disabled = !isPlayerTurn || stunned;
  document.getElementById("cb-btn-end").disabled = !isPlayerTurn;

  const consumableBtn = document.getElementById("cb-btn-consumables");
  const hasAnyConsumable = isPlayerTurn && current.consumables && Object.values(current.consumables).some(v => v > 0);
  consumableBtn.disabled = !isPlayerTurn || stunned || !current.actionsLeft.act || !hasAnyConsumable;
  consumableBtn.classList.toggle("mode-active", cbMode && cbMode.startsWith("consumable:"));

  const lootBtn = document.getElementById("cb-btn-loot");
  lootBtn.disabled = !isPlayerTurn || stunned || !current.actionsLeft.act;
  lootBtn.classList.toggle("mode-active", cbMode === "loot");

  const borrowBtn = document.getElementById("cb-btn-borrow-ammo");
  borrowBtn.disabled = !isPlayerTurn || stunned || !current.actionsLeft.act;
  borrowBtn.classList.toggle("mode-active", cbMode === "borrow-ammo");

  document.getElementById("cb-btn-move").classList.toggle("mode-active", cbMode === "move");
  document.getElementById("cb-btn-fire").classList.toggle("mode-active", cbMode === "fire");

  document.querySelectorAll("[data-turn]").forEach(btn => {
    btn.disabled = !isPlayerTurn || stunned || (isPlayerTurn && current.turnedThisTurn);
    btn.classList.toggle("mode-active", isPlayerTurn && current.dir === btn.dataset.turn);
  });

  const statusLine = document.getElementById("cb-status-line");
  if (stunned) {
    statusLine.textContent = `${current.name} sersemlemiş durumda (${current.stunnedTurnsLeft} tur kaldı). Sadece sırayı bitirebilirsin.`;
  } else if (isPlayerTurn) {
    statusLine.textContent = `Hareket: ${current.actionsLeft.move ? "kullanılabilir" : "kullanıldı"} | Aksiyon: ${current.actionsLeft.act ? "kullanılabilir" : "kullanıldı"}`;
  } else {
    statusLine.textContent = "";
  }
}

function cbRenderLog() {
  const el = document.getElementById("cb-log");
  el.innerHTML = cbState.log.slice(-30).map(l => `<div>${l}</div>`).join("");
  el.scrollTop = el.scrollHeight;
}

function cbRefreshAll() {
  cbRenderGrid();
  cbRenderSideLists();
  cbRenderPlacementPanel();

  if (cbState.phase === "placement") {
    cbRenderLog();
    return; // kombat henüz başlamadı, sıra/AI mantığı çalışmasın
  }

  cbRenderActionPanel();
  cbRenderLog();

  const victory = cbCheckVictory();
  if (victory && cbState.phase !== "aftermath") {
    cbState.phase = "aftermath";
    cbState.victoryResult = victory;
    setTimeout(cbShowAftermathScreen, 300);
    return;
  }

  const current = cbCurrentUnit();
  if (current && current.side === "enemy" && current.status === "active") {
    setTimeout(cbRunEnemyAI, 600);
  }
}

// ---------------- BASİT DÜŞMAN AI ----------------
function cbRunEnemyAI() {
  try {
    const unit = cbCurrentUnit();
    if (!unit || unit.side !== "enemy" || unit.status !== "active") { cbRefreshAll(); return; }

    if (cbIsStunned(unit)) {
      cbLog(`${unit.name} sersemlemiş durumda, hareket edemiyor.`);
      cbEndUnitTurn();
      cbRefreshAll();
      return;
    }

    const decision = cbDecideEnemyAction(unit); // combat-engine.js içinde tanımlı, gelişmiş AI mantığı
    if (decision.type === "fire") {
      cbDrawLaser(unit, decision.target);
      const weapon = CB_WEAPONS[unit.weapon];
      if (weapon.hasFireModes) {
        cbFireBurst(unit, decision.target, decision.bodyPart);
      } else {
        cbFire(unit, decision.target, decision.bodyPart);
      }
    } else if (decision.type === "reload") {
      cbReload(unit);
    } else if (decision.type === "cover") {
      cbTakeCover(unit);
    } else if (decision.type === "move") {
      cbMoveUnit(unit, decision.x, decision.y, decision.dir);
    }
    // 'wait' durumunda hiçbir şey yapılmaz, sadece sıra biter

    unit.actionsLeft.move = false;
    unit.actionsLeft.act = false;
    cbEndUnitTurn();
    cbRefreshAll();
  } catch (err) {
    console.error("Düşman AI hata:", err);
    alert("HATA (Düşman AI): " + err.message + "\n" + err.stack);
  }
}

// ---------------- BUTON OLAYLARI ----------------
document.getElementById("cb-btn-move").addEventListener("click", () => {
  cbMode = cbMode === "move" ? null : "move";
  cbRenderGrid();
  cbRenderActionPanel();
});

document.getElementById("cb-btn-fire").addEventListener("click", () => {
  cbMode = cbMode === "fire" ? null : "fire";
  document.getElementById("cb-bodyparts").style.display = "none";
  cbRenderGrid();
  cbRenderActionPanel();
});

document.getElementById("cb-btn-suppress").addEventListener("click", () => {
  const current = cbCurrentUnit();
  if (!current) return;
  cbDrawConeEffect(current);
  cbFireSuppression(current);
  cbMode = null;
  cbRefreshAll();
});

document.getElementById("cb-btn-reload").addEventListener("click", () => {
  const current = cbCurrentUnit();
  if (current) { cbReload(current); cbRefreshAll(); }
});

document.getElementById("cb-btn-cover").addEventListener("click", () => {
  const current = cbCurrentUnit();
  if (!current) return;
  const ok = cbTakeCover(current);
  if (!ok) cbLog(`${current.name} burada siperlenecek bir şey yok.`);
  cbRefreshAll();
});

document.getElementById("cb-btn-consumables").addEventListener("click", () => {
  const menu = document.getElementById("cb-consumable-menu");
  const isOpen = menu.style.display !== "none";
  if (isOpen) { menu.style.display = "none"; return; }
  cbRenderConsumableMenu();
});

document.getElementById("cb-btn-loot").addEventListener("click", () => {
  const current = cbCurrentUnit();
  if (!current) return;
  cbMode = cbMode === "loot" ? null : "loot";
  document.getElementById("cb-bodyparts").style.display = "none";
  cbRenderGrid();
  cbRenderActionPanel();
});

document.getElementById("cb-btn-borrow-ammo").addEventListener("click", () => {
  const current = cbCurrentUnit();
  if (!current) return;
  cbMode = cbMode === "borrow-ammo" ? null : "borrow-ammo";
  document.getElementById("cb-bodyparts").style.display = "none";
  cbRenderGrid();
  cbRenderActionPanel();
});

document.getElementById("cb-btn-flee").addEventListener("click", () => {
  const current = cbCurrentUnit();
  if (current) { cbStartFlee(current); cbEndUnitTurn(); cbMode = null; cbRefreshAll(); }
});

document.getElementById("cb-btn-end").addEventListener("click", (ev) => {
  ev.preventDefault();
  const btn = ev.currentTarget;
  if (btn.dataset.processing === "1") return;
  btn.dataset.processing = "1";
  try {
    cbEndUnitTurn();
    cbMode = null;
    cbRefreshAll();
  } catch (err) {
    console.error("Sırayı Bitir hata:", err);
    cbLog("HATA: " + err.message);
    alert("HATA (Sırayı Bitir): " + err.message + "\n" + err.stack);
  } finally {
    btn.dataset.processing = "0";
  }
});

document.querySelectorAll("#cb-bodyparts button").forEach(btn => {
  btn.addEventListener("click", () => {
    const current = cbCurrentUnit();
    if (!current || !cbFireTargetUnit) return;
    cbDrawLaser(current, cbFireTargetUnit);
    const weapon = CB_WEAPONS[current.weapon];
    if (weapon.hasFireModes) {
      cbFireBurst(current, cbFireTargetUnit, btn.dataset.part);
    } else {
      cbFire(current, cbFireTargetUnit, btn.dataset.part);
    }
    cbFireTargetUnit = null;
    cbMode = null;
    document.getElementById("cb-bodyparts").style.display = "none";
    cbRefreshAll();
  });
});

document.querySelectorAll("[data-turn]").forEach(btn => {
  btn.addEventListener("click", () => {
    const current = cbCurrentUnit();
    if (!current || current.side !== "player" || current.turnedThisTurn) return;
    cbTurnInPlace(current, btn.dataset.turn);
    cbMode = null;
    cbRefreshAll();
  });
});

// ============================================================
// ZAFER SONRASI EKRANI (İnfaz / Kaçır / Terk Et)
// ============================================================
let cbCapturedUnits = []; // { unit, decision: 'execute'|'capture'|'release' }

function cbShowAftermathScreen() {
  const overlay = document.getElementById("cb-aftermath-overlay");
  const panel = document.getElementById("cb-aftermath-panel");
  const won = cbState.victoryResult === "player";

  const downedEnemies = won ? cbState.units.filter(u => u.side === "enemy" && u.status === "down") : [];

  let html = `<h3 style="color:${won ? '#4a9c5d' : '#d4453d'}; font-size:16px; margin-bottom:10px;">${won ? "Zafer" : "Yenilgi"}</h3>`;

  if (!won) {
    html += `<div style="color:#9098a8; font-size:12px; margin-bottom:14px;">Ekibin yenildi.</div>`;
    html += `<button id="cb-aftermath-close">Kapat</button>`;
    panel.innerHTML = html;
    overlay.style.display = "flex";
    document.getElementById("cb-aftermath-close").addEventListener("click", () => {
      overlay.style.display = "none";
    });
    return;
  }

  if (downedEnemies.length === 0) {
    html += `<div style="color:#9098a8; font-size:12px; margin-bottom:14px;">Tüm düşmanlar öldürüldü veya kaçtı. Ele geçirilecek kimse yok.</div>`;
    html += `<button id="cb-aftermath-close">Kapat</button>`;
    panel.innerHTML = html;
    overlay.style.display = "flex";
    document.getElementById("cb-aftermath-close").addEventListener("click", () => {
      overlay.style.display = "none";
    });
    return;
  }

  html += `<div style="color:#9098a8; font-size:12px; margin-bottom:14px;">Bayılmış düşmanlar ele geçirildi. Her biri için ne yapılacağına karar ver.</div>`;
  html += `<div id="cb-aftermath-list"></div>`;
  html += `<button id="cb-aftermath-confirm" style="margin-top:12px;">Onayla ve Devam Et</button>`;
  panel.innerHTML = html;

  const listEl = document.getElementById("cb-aftermath-list");
  const decisions = {}; // unitId -> 'execute'|'capture'|'release'
  downedEnemies.forEach(u => { decisions[u.id] = "release"; });

  downedEnemies.forEach(u => {
    const item = document.createElement("div");
    item.style.cssText = "background:#1d2330; border:1px solid #2a3142; border-radius:6px; padding:10px; margin-bottom:8px; font-size:11px;";
    item.innerHTML = `
      <div style="font-weight:600; margin-bottom:6px;">${u.name}</div>
      <div style="display:flex; gap:6px;">
        <button class="secondary" data-decision="execute" data-unit="${u.id}">İnfaz Et</button>
        <button class="secondary" data-decision="capture" data-unit="${u.id}">Kaçır</button>
        <button class="secondary mode-active" data-decision="release" data-unit="${u.id}">Terk Et</button>
      </div>
    `;
    listEl.appendChild(item);

    item.querySelectorAll("[data-decision]").forEach(btn => {
      btn.addEventListener("click", () => {
        decisions[u.id] = btn.dataset.decision;
        item.querySelectorAll("[data-decision]").forEach(b => b.classList.remove("mode-active"));
        btn.classList.add("mode-active");
      });
    });
  });

  document.getElementById("cb-aftermath-confirm").addEventListener("click", () => {
    downedEnemies.forEach(u => {
      const decision = decisions[u.id];
      if (decision === "execute") {
        u.status = "dead";
      } else if (decision === "capture") {
        u.status = "captured";
        cbCapturedUnits.push(u);
      }
      // 'release' durumunda unit'e dokunulmaz, olduğu gibi kalır (sahneden ayrılmış sayılır)
    });
    overlay.style.display = "none";
    cbLog(`Operasyon tamamlandı. ${cbCapturedUnits.length} mahkum ele geçirildi.`);
  });

  overlay.style.display = "flex";
}

document.getElementById("cb-btn-start-ambush").addEventListener("click", () => {
  cbFinishPlacementAndStartCombat();
  cbRefreshAll();
});

// ============================================================
// PAN / ZOOM SİSTEMİ (dokunmatik ve fare desteği)
// ============================================================
const cbViewState = { scale: 1, panX: 0, panY: 0 };
const CB_MIN_SCALE = 0.5, CB_MAX_SCALE = 2.5;

function cbApplyTransform() {
  const container = document.getElementById("cb-grid-container");
  container.style.transform = `translate(${cbViewState.panX}px, ${cbViewState.panY}px) scale(${cbViewState.scale})`;
}

function cbClampPan() {
  const wrap = document.getElementById("cb-map-wrap");
  const grid = document.getElementById("cb-grid");
  if (!wrap || !grid || !grid.offsetWidth) return;
  const scaledW = grid.offsetWidth * cbViewState.scale;
  const scaledH = grid.offsetHeight * cbViewState.scale;
  const wrapW = wrap.offsetWidth, wrapH = wrap.offsetHeight;
  // İçerik wrap'ten küçükse ortala, büyükse sınırlar içinde tut
  const minX = Math.min(0, wrapW - scaledW), maxX = Math.max(0, wrapW - scaledW);
  const minY = Math.min(0, wrapH - scaledH), maxY = Math.max(0, wrapH - scaledH);
  cbViewState.panX = Math.max(minX, Math.min(maxX, cbViewState.panX));
  cbViewState.panY = Math.max(minY, Math.min(maxY, cbViewState.panY));
}

function cbSetZoom(newScale, anchorX, anchorY) {
  const wrap = document.getElementById("cb-map-wrap");
  const rect = wrap.getBoundingClientRect();
  const ax = anchorX !== undefined ? anchorX - rect.left : wrap.offsetWidth / 2;
  const ay = anchorY !== undefined ? anchorY - rect.top : wrap.offsetHeight / 2;

  const clamped = Math.max(CB_MIN_SCALE, Math.min(CB_MAX_SCALE, newScale));
  // Yakınlaştırma noktasının ekran üzerindeki konumu sabit kalsın diye pan'i orantılı ayarla
  const scaleRatio = clamped / cbViewState.scale;
  cbViewState.panX = ax - (ax - cbViewState.panX) * scaleRatio;
  cbViewState.panY = ay - (ay - cbViewState.panY) * scaleRatio;
  cbViewState.scale = clamped;

  cbClampPan();
  cbApplyTransform();
}

function cbResetView() {
  const wrap = document.getElementById("cb-map-wrap");
  const grid = document.getElementById("cb-grid");
  cbViewState.scale = 1;
  if (wrap && grid && grid.offsetWidth) {
    // Grid'i wrap içinde ortala (wrap'ten küçükse ortada, büyükse sol-üstten başlar)
    cbViewState.panX = Math.max(0, (wrap.offsetWidth - grid.offsetWidth) / 2);
    cbViewState.panY = Math.max(0, (wrap.offsetHeight - grid.offsetHeight) / 2);
  } else {
    cbViewState.panX = 0;
    cbViewState.panY = 0;
  }
  cbClampPan();
  cbApplyTransform();
}

(function initPanZoom() {
  const wrap = document.getElementById("cb-map-wrap");
  let isPanning = false;
  let lastX = 0, lastY = 0;
  let pinchStartDist = 0, pinchStartScale = 1;
  let touchStartX = 0, touchStartY = 0;
  const DRAG_THRESHOLD = 8; // bu kadar pikselden fazla hareket ederse "pan" sayılır, tıklama iptal olur

  function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function getTouchCenter(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }

  wrap.addEventListener("touchstart", (ev) => {
    if (ev.touches.length === 1) {
      isPanning = true;
      lastX = ev.touches[0].clientX;
      lastY = ev.touches[0].clientY;
      touchStartX = lastX; touchStartY = lastY;
      cbSuppressNextClick = false;
    } else if (ev.touches.length === 2) {
      isPanning = false;
      pinchStartDist = getTouchDist(ev.touches);
      pinchStartScale = cbViewState.scale;
      cbSuppressNextClick = true; // iki parmaklı hareket asla tıklama sayılmasın
    }
  }, { passive: true });

  wrap.addEventListener("touchmove", (ev) => {
    if (ev.touches.length === 1 && isPanning) {
      const dx = ev.touches[0].clientX - lastX;
      const dy = ev.touches[0].clientY - lastY;
      cbViewState.panX += dx;
      cbViewState.panY += dy;
      lastX = ev.touches[0].clientX;
      lastY = ev.touches[0].clientY;

      const totalMove = Math.abs(lastX - touchStartX) + Math.abs(lastY - touchStartY);
      if (totalMove > DRAG_THRESHOLD) cbSuppressNextClick = true;

      cbClampPan();
      cbApplyTransform();
    } else if (ev.touches.length === 2) {
      const dist = getTouchDist(ev.touches);
      const center = getTouchCenter(ev.touches);
      const newScale = pinchStartScale * (dist / pinchStartDist);
      cbSetZoom(newScale, center.x, center.y);
    }
  }, { passive: true });

  wrap.addEventListener("touchend", (ev) => {
    if (ev.touches.length === 0) isPanning = false;
  });

  // Masaüstü fare desteği: sürükleyerek pan, tekerlek ile zoom
  let mouseDown = false;
  wrap.addEventListener("mousedown", (ev) => {
    mouseDown = true;
    lastX = ev.clientX; lastY = ev.clientY;
  });
  window.addEventListener("mousemove", (ev) => {
    if (!mouseDown) return;
    const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
    cbViewState.panX += dx; cbViewState.panY += dy;
    lastX = ev.clientX; lastY = ev.clientY;
    cbClampPan();
    cbApplyTransform();
  });
  window.addEventListener("mouseup", () => { mouseDown = false; });

  wrap.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const delta = ev.deltaY > 0 ? -0.1 : 0.1;
    cbSetZoom(cbViewState.scale + delta, ev.clientX, ev.clientY);
  }, { passive: false });

  document.getElementById("cb-zoom-in").addEventListener("click", () => cbSetZoom(cbViewState.scale + 0.25));
  document.getElementById("cb-zoom-out").addEventListener("click", () => cbSetZoom(cbViewState.scale - 0.25));
  document.getElementById("cb-zoom-reset").addEventListener("click", cbResetView);
})();

// ---------------- BAŞLAT ----------------
document.querySelectorAll("#cb-map-select-overlay [data-map]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.getElementById("cb-map-select-overlay").style.display = "none";
    cbLoadProceduralMap(btn.dataset.map, 20);
    cbSetupDemo();
    cbRefreshAll();
    // Grid ilk kez DOM'a yerleşti, şimdi doğru boyutlarla ortalayabiliriz
    setTimeout(cbResetView, 50);
  });
});
