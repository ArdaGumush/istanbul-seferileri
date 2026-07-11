// ============================================================
// COMBAT PROTOTİP - MOTOR
// ============================================================

const cbState = {
  grid: null, rows: 0, cols: 0,
  units: [], // { id, name, side:'player'|'enemy', x, y, dir, hp, weapon, magAmmo, spareMags, actionsLeft:{move,act}, status:'active'|'down'|'dead'|'fled'|'fleeing', fleeTurnsLeft, injuries:[] }
  turnOrder: [], // unit id sırası (bu round için)
  turnIndex: 0,
  round: 1,
  ambushMode: false, // true ise ilk round'da başlatan taraf topluca oynar
  ambushInitiator: null, // 'player' | 'enemy'
  selectedUnitId: null,
  pendingAction: null, // 'move' | 'fire' | null
  log: [],
};

// ---------------- HARİTA YÜKLEME ----------------
async function cbLoadMap(url) {
  const res = await fetch(url);
  const data = await res.json();
  cbState.grid = data.grid;
  cbState.rows = data.rows;
  cbState.cols = data.cols;
}

function cbTileAt(x, y) {
  if (y < 0 || y >= cbState.rows || x < 0 || x >= cbState.cols) return "wall";
  return cbState.grid[y][x];
}

// ---------------- BİRİM YÖNETİMİ ----------------
function cbUnitAt(x, y) {
  return cbState.units.find(u => u.x === x && u.y === y && u.status !== "dead" && u.status !== "fled");
}

function cbLog(msg) {
  cbState.log.push(msg);
  if (cbState.log.length > 200) cbState.log.shift();
}

// ---------------- GÖRÜŞ ALANI (45-45-90 ÜÇGEN, FOG OF WAR) ----------------
function cbComputeVisionTiles(unit) {
  const range = CB_WEAPONS[unit.weapon].range;
  const vec = CB_DIR_VECTOR[unit.dir];
  const visible = new Set();
  visible.add(`${unit.x},${unit.y}`);

  for (let depth = 1; depth <= range; depth++) {
    for (let width = -depth; width <= depth; width++) {
      let tx, ty;
      if (vec.dx !== 0) {
        tx = unit.x + vec.dx * depth;
        ty = unit.y + width;
      } else {
        tx = unit.x + width;
        ty = unit.y + vec.dy * depth;
      }
      if (tx < 0 || tx >= cbState.cols || ty < 0 || ty >= cbState.rows) continue;
      if (cbHasLineOfSight(unit.x, unit.y, tx, ty)) {
        visible.add(`${tx},${ty}`);
      }
    }
  }
  return visible;
}

function cbHasLineOfSight(x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0, cy = y0;

  while (!(cx === x1 && cy === y1)) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
    if (cx === x1 && cy === y1) break;
    const tile = cbTileAt(cx, cy);
    if (CB_TILE_BLOCKS_LOS[tile]) return false;
  }
  return true;
}

function cbVisibleEnemies(unit) {
  const visionTiles = cbComputeVisionTiles(unit);
  return cbState.units.filter(u => {
    if (u.side === unit.side) return false;
    if (u.status === "dead" || u.status === "fled") return false;
    return visionTiles.has(`${u.x},${u.y}`);
  });
}

// ---------------- HAREKET ----------------
function cbMovementRange(unit) {
  let base = 4;
  const legInjury = (unit.injuries || []).find(i => i.bodyPart === "bacak" && !i.healed);
  if (legInjury) base = Math.max(1, base - (legInjury.chronic ? 1 : 2));
  return base;
}

function cbReachableTiles(unit) {
  const range = cbMovementRange(unit);
  const visited = { [`${unit.x},${unit.y}`]: 0 };
  const queue = [[unit.x, unit.y, 0]];
  const result = [];

  while (queue.length) {
    const [cx, cy, dist] = queue.shift();
    if (dist > 0) result.push({ x: cx, y: cy, dist });
    if (dist >= range) continue;
    const neighbors = [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]];
    neighbors.forEach(([nx, ny]) => {
      const key = `${nx},${ny}`;
      if (visited[key] !== undefined) return;
      if (nx < 0 || nx >= cbState.cols || ny < 0 || ny >= cbState.rows) return;
      const tile = cbTileAt(nx, ny);
      if (CB_TILE_BLOCKS_MOVEMENT[tile]) return;
      if (cbUnitAt(nx, ny)) return;
      visited[key] = dist + 1;
      queue.push([nx, ny, dist + 1]);
    });
  }
  return result;
}

function cbMoveUnit(unit, tx, ty, newDir) {
  unit.x = tx; unit.y = ty;
  if (newDir) unit.dir = newDir;
  unit.actionsLeft.move = false;
  unit._movedThisTurn = true;
  cbLog(`${unit.name} hareket etti (${tx},${ty}).`);
}

function cbTurnInPlace(unit, newDir) {
  unit.dir = newDir;
  unit.actionsLeft.move = false;
  cbLog(`${unit.name} yön değiştirdi.`);
}

// ---------------- SİPER (OTOMATİK) ----------------
function cbCoverBonusAgainst(defender, attacker) {
  const dx = Math.sign(attacker.x - defender.x);
  const dy = Math.sign(attacker.y - defender.y);
  const checkX = defender.x + dx;
  const checkY = defender.y + dy;
  const tile = cbTileAt(checkX, checkY);
  if (tile === "obstacle") return 0.25;
  if (tile === "wall") return 0.4;
  return 0;
}

// ---------------- ATEŞ ETME / İSABET HESABI ----------------
function cbCalculateHitChance(attacker, defender, bodyPart) {
  const weapon = CB_WEAPONS[attacker.weapon];
  const part = CB_BODY_PARTS[bodyPart];
  const dist = Math.abs(attacker.x - defender.x) + Math.abs(attacker.y - defender.y);

  let chance = weapon.baseAccuracy;
  chance *= part.hitDifficulty;

  const distRatio = dist / weapon.range;
  if (distRatio > 0.5) chance -= (distRatio - 0.5) * 40;

  chance += (attacker.aimSkill || 0);

  const attackerArmInjury = (attacker.injuries || []).find(i => i.bodyPart === "kol" && !i.healed);
  if (attackerArmInjury) {
    const penalty = 15 * (attackerArmInjury.chronic ? 1 : 2);
    chance -= penalty;
  }

  const cover = cbCoverBonusAgainst(defender, attacker);
  chance -= cover * 100;

  if (weapon.canMoveAndFire && attacker._movedThisTurn) {
    chance -= 10;
  }

  return Math.max(5, Math.min(95, Math.round(chance)));
}

function cbFire(attacker, defender, bodyPart) {
  const weapon = CB_WEAPONS[attacker.weapon];
  if (attacker.magAmmo <= 0) {
    cbLog(`${attacker.name} ateş edemedi, şarjör boş.`);
    return { success: false, reason: "no_ammo" };
  }
  attacker.magAmmo -= 1;
  attacker.actionsLeft.act = false;

  const hitChance = cbCalculateHitChance(attacker, defender, bodyPart);
  const roll = Math.random() * 100;
  const hit = roll < hitChance;

  if (!hit) {
    cbLog(`${attacker.name} -> ${defender.name}: ISKA (%${hitChance} sans).`);
    return { success: true, hit: false, hitChance };
  }

  const part = CB_BODY_PARTS[bodyPart];
  let damage = Math.round(weapon.damage * part.damageMult * (0.85 + Math.random() * 0.3));

  let instantLethal = false;
  if (bodyPart === "bas" && Math.random() < part.lethalChance) instantLethal = true;
  if (bodyPart === "gogus" && Math.random() < (part.organHitChance || 0) * part.lethalChance) instantLethal = true;

  defender.hp -= damage;
  cbApplyInjury(defender, bodyPart);

  cbLog(`${attacker.name} -> ${defender.name}: ISABET, ${bodyPart} (${damage} hasar).`);

  if (instantLethal || defender.hp <= 0) {
    defender.hp = 0;
    defender.status = "dead";
    cbLog(`${defender.name} oldu.`);
    return { success: true, hit: true, damage, lethal: true };
  }

  if (defender.hp <= CB_CONSTANTS.stunThreshold) {
    defender.status = "down";
    cbLog(`${defender.name} bayildi / soka girdi.`);
    return { success: true, hit: true, damage, downed: true };
  }

  return { success: true, hit: true, damage };
}

function cbApplyInjury(unit, bodyPart) {
  unit.injuries = unit.injuries || [];
  unit.injuries.push({ bodyPart, healed: false, chronic: false, turnApplied: cbState.round });
}

// ---------------- ŞARJÖR DEĞİŞTİRME / MERMİ ÖDÜNÇ ALMA ----------------
function cbReload(unit) {
  const weapon = CB_WEAPONS[unit.weapon];
  if (unit.spareMags <= 0) {
    cbLog(`${unit.name} yedek sarjoru yok.`);
    return false;
  }
  unit.spareMags -= 1;
  unit.magAmmo = weapon.magSize;
  unit.actionsLeft.act = false;
  cbLog(`${unit.name} sarjor degistirdi.`);
  return true;
}

function cbBorrowAmmo(unit, downedAlly) {
  if (downedAlly.weapon !== unit.weapon) {
    cbLog(`${downedAlly.name}'in silahi uyumsuz.`);
    return false;
  }
  if (downedAlly.spareMags <= 0 && downedAlly.magAmmo <= 0) {
    cbLog(`${downedAlly.name}'de alinacak mermi yok.`);
    return false;
  }
  if (downedAlly.spareMags > 0) {
    downedAlly.spareMags -= 1;
    unit.spareMags += 1;
  } else {
    unit.magAmmo += downedAlly.magAmmo;
    downedAlly.magAmmo = 0;
  }
  unit.actionsLeft.act = false;
  cbLog(`${unit.name}, ${downedAlly.name}'den mermi aldi.`);
  return true;
}

// ---------------- KAÇMA ----------------
function cbStartFlee(unit) {
  unit.status = "fleeing";
  unit.fleeTurnsLeft = CB_CONSTANTS.fleeTurnsRequired;
  unit.actionsLeft.move = false;
  unit.actionsLeft.act = false;
  cbLog(`${unit.name} kacmaya calisiyor.`);
}

function cbProcessFleeTick(unit) {
  if (unit.status !== "fleeing") return;
  unit.fleeTurnsLeft -= 1;
  if (unit.fleeTurnsLeft <= 0) {
    unit.status = "fled";
    cbLog(`${unit.name} kacmayi basardi.`);
  }
}

// ---------------- TESLİM OLMA / TAKIM MERMİSİZ KALDIĞINDA ----------------
function cbTeamOutOfAmmo(side) {
  const activeUnits = cbState.units.filter(u => u.side === side && u.status === "active");
  if (activeUnits.length === 0) return false;
  return activeUnits.every(u => u.magAmmo <= 0 && u.spareMags <= 0);
}

function cbResolveTeamCrisis(side) {
  const roll = Math.random();
  const units = cbState.units.filter(u => u.side === side && u.status === "active");
  if (roll < 0.4) {
    units.forEach(u => { u.status = "surrendered"; });
    cbLog(`${side} tarafi teslim oldu.`);
    return "surrender";
  } else if (roll < 0.75) {
    units.forEach(u => cbStartFlee(u));
    cbLog(`${side} tarafi kacmaya calisiyor.`);
    return "flee";
  } else {
    units.forEach(u => { u.hp = 0; u.status = "dead"; });
    cbLog(`${side} tarafi teslim olmak yerine kendini oldurdu.`);
    return "suicide";
  }
}

// ---------------- SIRA SİSTEMİ ----------------
function cbBuildTurnOrder() {
  const alive = cbState.units.filter(u => u.status === "active" || u.status === "fleeing");
  if (cbState.round === 1 && cbState.ambushMode) {
    const initiators = alive.filter(u => u.side === cbState.ambushInitiator);
    const others = alive.filter(u => u.side !== cbState.ambushInitiator);
    cbState.turnOrder = [...initiators.map(u => u.id), ...others.map(u => u.id)];
  } else {
    const bySide = { player: [], enemy: [] };
    alive.forEach(u => bySide[u.side].push(u.id));
    const order = [];
    const starter = cbState.ambushInitiator || "player";
    const other = starter === "player" ? "enemy" : "player";
    const maxLen = Math.max(bySide[starter].length, bySide[other].length);
    for (let i = 0; i < maxLen; i++) {
      if (bySide[starter][i]) order.push(bySide[starter][i]);
      if (bySide[other][i]) order.push(bySide[other][i]);
    }
    cbState.turnOrder = order;
  }
  cbState.turnIndex = 0;
}

function cbCurrentUnit() {
  const id = cbState.turnOrder[cbState.turnIndex];
  return cbState.units.find(u => u.id === id);
}

function cbEndUnitTurn() {
  const unit = cbCurrentUnit();
  if (unit) unit._movedThisTurn = false;
  cbState.turnIndex++;

  if (cbState.turnIndex >= cbState.turnOrder.length) {
    cbState.round++;
    cbState.units.forEach(u => { if (u.status === "fleeing") cbProcessFleeTick(u); });
    ["player", "enemy"].forEach(side => {
      if (cbTeamOutOfAmmo(side)) {
        cbResolveTeamCrisis(side);
      }
    });
    cbBuildTurnOrder();
    cbState.units.forEach(u => {
      if (u.status === "active") u.actionsLeft = { move: true, act: true };
    });
  }

  // Bu round'un sırasında artık aktif/kaçan olmayan (öldü, bayıldı, teslim oldu vb.)
  // birimleri otomatik atla - yoksa sıra onlarda "takılı" kalır.
  let safetyCounter = 0;
  while (safetyCounter < cbState.turnOrder.length + 5) {
    const curr = cbCurrentUnit();
    if (!curr) break;
    const stillTakesTurn = curr.status === "active" || curr.status === "fleeing";
    if (stillTakesTurn) break;
    cbState.turnIndex++;
    if (cbState.turnIndex >= cbState.turnOrder.length) {
      cbState.round++;
      cbState.units.forEach(u => { if (u.status === "fleeing") cbProcessFleeTick(u); });
      ["player", "enemy"].forEach(side => {
        if (cbTeamOutOfAmmo(side)) cbResolveTeamCrisis(side);
      });
      cbBuildTurnOrder();
      cbState.units.forEach(u => {
        if (u.status === "active") u.actionsLeft = { move: true, act: true };
      });
    }
    safetyCounter++;
  }
}

function cbCheckVictory() {
  const playerAlive = cbState.units.some(u => u.side === "player" && (u.status === "active" || u.status === "fleeing"));
  const enemyAlive = cbState.units.some(u => u.side === "enemy" && (u.status === "active" || u.status === "fleeing"));
  if (!enemyAlive) return "player";
  if (!playerAlive) return "enemy";
  return null;
}
