// ============================================================
// COMBAT PROTOTİP - UI
// ============================================================

let cbMode = null; // 'move' | 'fire' | null
let cbFireTargetUnit = null;

function cbUid() { return Math.random().toString(36).slice(2, 9); }

function cbSetupDemo() {
  cbState.units = [
    { id: cbUid(), name: "Q", side: "player", x: 3, y: 15, dir: "up", hp: 300, weapon: "tabanca_low", magAmmo: 8, spareMags: 2, aimSkill: 10, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
    { id: cbUid(), name: "W", side: "player", x: 4, y: 16, dir: "up", hp: 300, weapon: "pompali_low", magAmmo: 2, spareMags: 1, aimSkill: 5, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
    { id: cbUid(), name: "E", side: "player", x: 2, y: 16, dir: "right", hp: 300, weapon: "tufek_low", magAmmo: 5, spareMags: 1, aimSkill: 15, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
    { id: cbUid(), name: "R", side: "player", x: 3, y: 17, dir: "up", hp: 300, weapon: "makineli_low", magAmmo: 20, spareMags: 1, aimSkill: 0, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },

    { id: cbUid(), name: "A", side: "enemy", x: 10, y: 8, dir: "down", hp: 300, weapon: "tabanca_low", magAmmo: 8, spareMags: 1, aimSkill: 8, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
    { id: cbUid(), name: "B", side: "enemy", x: 11, y: 9, dir: "down", hp: 300, weapon: "makineli_low", magAmmo: 20, spareMags: 0, aimSkill: 0, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
    { id: cbUid(), name: "C", side: "enemy", x: 9, y: 9, dir: "left", hp: 300, weapon: "pompali_low", magAmmo: 2, spareMags: 1, aimSkill: 5, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
    { id: cbUid(), name: "D", side: "enemy", x: 10, y: 10, dir: "down", hp: 300, weapon: "tufek_low", magAmmo: 5, spareMags: 0, aimSkill: 12, actionsLeft: { move: true, act: true }, status: "active", injuries: [] },
  ];
  cbState.ambushMode = true;
  cbState.ambushInitiator = "player";
  cbState.round = 1;
  cbBuildTurnOrder();
}

function cbAllVisibleTilesForSide(side) {
  const visible = new Set();
  cbState.units.filter(u => u.side === side && u.status !== "dead" && u.status !== "fled").forEach(u => {
    cbComputeVisionTiles(u).forEach(t => visible.add(t));
  });
  return visible;
}

function cbRenderGrid() {
  const gridEl = document.getElementById("cb-grid");
  const tileSize = 22;
  gridEl.style.gridTemplateColumns = `repeat(${cbState.cols}, ${tileSize}px)`;
  gridEl.innerHTML = "";

  const visibleTiles = cbAllVisibleTilesForSide("player");
  const currentUnit = cbCurrentUnit();
  const isPlayerTurn = currentUnit && currentUnit.side === "player" && currentUnit.status === "active";
  const canShowReachable = isPlayerTurn && currentUnit.actionsLeft.move && (cbMode === "move" || cbMode === null);
  const reachable = canShowReachable ? cbReachableTiles(currentUnit) : [];
  const reachableSet = new Set(reachable.map(r => `${r.x},${r.y}`));

  for (let y = 0; y < cbState.rows; y++) {
    for (let x = 0; x < cbState.cols; x++) {
      const tile = cbTileAt(x, y);
      const key = `${x},${y}`;
      const isVisible = visibleTiles.has(key);
      const el = document.createElement("div");
      el.className = "cb-tile " + tile + (isVisible ? "" : " hidden");
      if (reachableSet.has(key)) el.className += " cb-reachable";
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
});

document.getElementById("cb-btn-fire").addEventListener("click", () => {
  cbMode = cbMode === "fire" ? null : "fire";
  document.getElementById("cb-bodyparts").style.display = "none";
  cbRenderGrid();
});

document.getElementById("cb-btn-reload").addEventListener("click", () => {
  const current = cbCurrentUnit();
  if (current) { cbReload(current); cbRefreshAll(); }
});

document.getElementById("cb-btn-flee").addEventListener("click", () => {
  const current = cbCurrentUnit();
  if (current) { cbStartFlee(current); cbEndUnitTurn(); cbMode = null; cbRefreshAll(); }
});

document.getElementById("cb-btn-end").addEventListener("click", () => {
  cbEndUnitTurn();
  cbMode = null;
  cbRefreshAll();
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

// ---------------- BAŞLAT ----------------
(async function init() {
  await cbLoadMap("map_alley1.json");
  cbSetupDemo();
  cbRefreshAll();
})();
