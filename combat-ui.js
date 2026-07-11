// ============================================================
// COMBAT PROTOTİP - UI
// ============================================================

let cbMode = null; // 'move' | 'fire' | null
let cbFireTargetUnit = null;

function cbUid() { return Math.random().toString(36).slice(2, 9); }

let cbPlacementRoster = []; // yerleştirme aşamasında henüz konumlanmamış oyuncu birimleri
let cbPlacingUnitId = null; // şu an yerleştirilmekte olan birim

function cbSetupDemo() {
  cbPlacementRoster = [
    { id: cbUid(), name: "Q", side: "player", dir: "up", hp: 300, weapon: "tabanca_low", magAmmo: 8, spareMags: 2, aimSkill: 10, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
    { id: cbUid(), name: "W", side: "player", dir: "up", hp: 300, weapon: "pompali_low", magAmmo: 2, spareMags: 1, aimSkill: 5, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
    { id: cbUid(), name: "E", side: "player", dir: "right", hp: 300, weapon: "tufek_low", magAmmo: 5, spareMags: 1, aimSkill: 15, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
    { id: cbUid(), name: "R", side: "player", dir: "up", hp: 300, weapon: "makineli_low", magAmmo: 20, spareMags: 1, aimSkill: 0, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
  ];
  cbEnemyRosterTemplate = [
    { name: "A", weapon: "tabanca_low", magAmmo: 8, spareMags: 1, aimSkill: 8 },
    { name: "B", weapon: "makineli_low", magAmmo: 20, spareMags: 0, aimSkill: 0 },
    { name: "C", weapon: "pompali_low", magAmmo: 2, spareMags: 1, aimSkill: 5 },
    { name: "D", weapon: "tufek_low", magAmmo: 5, spareMags: 0, aimSkill: 12 },
  ];

  cbState.units = [];
  cbState.phase = "placement";
  cbState.ambushMode = true;
  cbState.ambushInitiator = "player";
  cbState.round = 1;
}

let cbEnemyRosterTemplate = [];

// Yerleştirme aşaması tamamlanınca çağrılır: düşmanları otomatik yerleştirir,
// FoW'u aktif eder ve kombatı başlatır.
function cbFinishPlacementAndStartCombat() {
  cbEnemyRosterTemplate.forEach(template => {
    const spot = cbFindRandomFloorTile(6); // oyuncu birimlerine en az 6 kare uzak
    if (!spot) return;
    const dirs = ["up", "down", "left", "right"];
    cbState.units.push({
      id: cbUid(), name: template.name, side: "enemy",
      x: spot.x, y: spot.y, dir: dirs[Math.floor(Math.random() * dirs.length)],
      hp: 300, weapon: template.weapon, magAmmo: template.magAmmo, spareMags: template.spareMags,
      aimSkill: template.aimSkill, actionsLeft: { move: true, act: true }, status: "active", injuries: [],
    });
  });

  cbState.phase = "combat";
  cbBuildTurnOrder();
  cbLog("Pusu başladı.");
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

      // Yerleştirme aşamasında: boş floor kareleri, yerleştirilebilir olarak vurgulanır
      if (isPlacement && cbPlacingUnitId && tile === "floor" && !cbUnitAt(x, y)) {
        el.className += " cb-placeable";
      }

      el.dataset.x = x; el.dataset.y = y;

      const unit = cbUnitAt(x, y);
      if (unit && (isVisible || unit.side === "player")) {
        const marker = document.createElement("div");
        marker.className = "cb-unit-marker " + unit.side + (unit.status === "down" ? " down" : "") + (cbState.selectedUnitId === unit.id ? " selected" : "");
        marker.textContent = unit.name;
        marker.title = unit.name;
        el.appendChild(marker);
      }

      el.addEventListener("click", (ev) => cbHandleTileClick(x, y, ev));
      gridEl.appendChild(el);
    }
  }
}

function cbHandleTileClick(x, y, ev) {
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

  const unit = cbUnitAt(x, y);
  if (unit) cbShowUnitPopover(unit, ev.clientX, ev.clientY);
}

function cbHandlePlacementClick(x, y) {
  if (!cbPlacingUnitId) return;
  if (cbTileAt(x, y) !== "floor") {
    cbLog("Sadece yürünebilir (floor) karelere yerleştirebilirsin.");
    cbRefreshAll();
    return;
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
  html += `<div>HP: ${unit.hp}/300</div>`;

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
      <div class="hpbar"><div class="hpfill" style="width:${Math.max(0,u.hp/300*100)}%"></div></div>
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
      <div class="hpbar"><div class="hpfill" style="width:${Math.max(0,u.hp/300*100)}%"></div></div>
      <div>${visibleToPlayer ? (u.hp) + " HP görünüyor" : "görünmüyor"}</div>
    `;
    if (visibleToPlayer) card.addEventListener("click", (e) => cbShowUnitPopover(u, e.clientX, e.clientY));
    rightEl.appendChild(card);
  });
}

function cbRenderActionPanel() {
  const current = cbCurrentUnit();
  document.getElementById("cb-current-name").textContent = current ? current.name + " (" + current.side + ")" : "-";
  document.getElementById("cb-round").textContent = cbState.round;

  const isPlayerTurn = current && current.side === "player";
  document.getElementById("cb-btn-move").disabled = !isPlayerTurn || !current.actionsLeft.move;
  document.getElementById("cb-btn-fire").disabled = !isPlayerTurn || !current.actionsLeft.act || current.magAmmo <= 0;
  document.getElementById("cb-btn-reload").disabled = !isPlayerTurn || !current.actionsLeft.act || current.spareMags <= 0;
  document.getElementById("cb-btn-flee").disabled = !isPlayerTurn;
  document.getElementById("cb-btn-end").disabled = !isPlayerTurn;

  document.getElementById("cb-btn-move").classList.toggle("mode-active", cbMode === "move");
  document.getElementById("cb-btn-fire").classList.toggle("mode-active", cbMode === "fire");

  const statusLine = document.getElementById("cb-status-line");
  if (current) {
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
  if (victory) {
    setTimeout(() => alert(`${victory === "player" ? "Oyuncu" : "Düşman"} kazandı!`), 100);
    return;
  }

  const current = cbCurrentUnit();
  if (current && current.side === "enemy" && current.status === "active") {
    setTimeout(cbRunEnemyAI, 600);
  }
}

// ---------------- BASİT DÜŞMAN AI ----------------
function cbRunEnemyAI() {
  const unit = cbCurrentUnit();
  if (!unit || unit.side !== "enemy" || unit.status !== "active") { cbRefreshAll(); return; }

  const visibleTargets = cbVisibleEnemies(unit);
  if (visibleTargets.length > 0 && unit.magAmmo > 0) {
    const target = visibleTargets[0];
    const parts = ["gogus", "karin", "kol", "bacak"];
    const part = parts[Math.floor(Math.random() * parts.length)];
    cbFire(unit, target, part);
  } else if (unit.spareMags > 0 && unit.magAmmo === 0) {
    cbReload(unit);
  } else {
    const reachable = cbReachableTiles(unit);
    if (reachable.length > 0) {
      const dest = reachable[Math.floor(Math.random() * reachable.length)];
      cbMoveUnit(unit, dest.x, dest.y, unit.dir);
    }
    unit.actionsLeft.act = false;
  }
  unit.actionsLeft.move = false;
  cbEndUnitTurn();
  cbRefreshAll();
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

document.getElementById("cb-btn-reload").addEventListener("click", () => {
  const current = cbCurrentUnit();
  if (current) { cbReload(current); cbRefreshAll(); }
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
  cbEndUnitTurn();
  cbMode = null;
  cbRefreshAll();
  btn.dataset.processing = "0";
});

document.querySelectorAll("#cb-bodyparts button").forEach(btn => {
  btn.addEventListener("click", () => {
    const current = cbCurrentUnit();
    if (!current || !cbFireTargetUnit) return;
    cbFire(current, cbFireTargetUnit, btn.dataset.part);
    cbFireTargetUnit = null;
    cbMode = null;
    document.getElementById("cb-bodyparts").style.display = "none";
    cbRefreshAll();
  });
});

document.getElementById("cb-btn-start-ambush").addEventListener("click", () => {
  cbFinishPlacementAndStartCombat();
  cbRefreshAll();
});

// ---------------- BAŞLAT ----------------
(async function init() {
  await cbLoadMap("map_alley1.json");
  cbSetupDemo();
  cbRefreshAll();
})();
