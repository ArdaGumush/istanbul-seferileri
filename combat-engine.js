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
  phase: "placement", // 'placement' | 'combat' | 'aftermath' - ambush senaryosunda çok aşamalı akış
  victoryResult: null, // 'player' | 'enemy' - savaş bitince belirlenir
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

function cbIsFloorAndEmpty(x, y) {
  if (cbTileAt(x, y) !== "floor") return false;
  return !cbUnitAt(x, y);
}

// Haritada rastgele bir floor karesi bulur (düşman otomatik yerleşimi için).
// avoidNear: bu koordinatlara çok yakın olmayan bir yer tercih edilir (opsiyonel).
function cbFindRandomFloorTile(minDistFromPlayers) {
  const playerUnits = cbState.units.filter(u => u.side === "player");
  const candidates = [];
  for (let y = 0; y < cbState.rows; y++) {
    for (let x = 0; x < cbState.cols; x++) {
      if (cbTileAt(x, y) !== "floor") continue;
      if (cbUnitAt(x, y)) continue;
      if (minDistFromPlayers) {
        const tooClose = playerUnits.some(p => Math.abs(p.x - x) + Math.abs(p.y - y) < minDistFromPlayers);
        if (tooClose) continue;
      }
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
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
  unit.takingCover = false; // hareket edince siper geçersiz olur
  // Hareket sessizce gerçekleşir, log'a yazılmaz (sadece çatışma sonuçları loglanır)
}

function cbTurnInPlace(unit, newDir) {
  if (unit.turnedThisTurn) return false;
  unit.dir = newDir;
  unit.turnedThisTurn = true;
  // Yön değişimi sessizce gerçekleşir, log'a yazılmaz
  return true;
}

// ---------------- SİPER (OTOMATİK) ----------------
function cbCoverBonusAgainst(defender, attacker) {
  const dx = Math.sign(attacker.x - defender.x);
  const dy = Math.sign(attacker.y - defender.y);
  const checkX = defender.x + dx;
  const checkY = defender.y + dy;
  const tile = cbTileAt(checkX, checkY);

  // Manuel "Siper Al" aktifse: sadece siperin durduğu yön korunur, ağır ceza.
  // Diğer yönlerden gelen saldırılar ise karakteri normalden daha savunmasız bırakır (bonus isabet, negatif "ceza").
  if (defender.takingCover) {
    const isCoveredTile = (tile === "obstacle" || tile === "wall");
    if (isCoveredTile) return 0.6; // siperin olduğu yönden gelen ateşe ağır isabet düşüşü
    return -0.2; // siperin olmadığı yönden gelen ateşe karşı ekstra savunmasız (isabet artışı)
  }

  // Otomatik/pasif siper (siper alma aktif değilken de az miktarda geçerli)
  if (tile === "obstacle") return 0.25;
  if (tile === "wall") return 0.4;
  return 0;
}

// Bir karakterin bulunduğu karenin komşularında en az bir duvar/obstacle var mı?
// Siper alma sadece fiziksel olarak siperlenebilecek bir konumda mümkündür.
function cbHasAdjacentCover(unit) {
  const neighbors = [[unit.x+1,unit.y],[unit.x-1,unit.y],[unit.x,unit.y+1],[unit.x,unit.y-1]];
  return neighbors.some(([nx,ny]) => {
    const t = cbTileAt(nx, ny);
    return t === "wall" || t === "obstacle";
  });
}

function cbTakeCover(unit) {
  if (!cbHasAdjacentCover(unit)) return false;
  unit.takingCover = true;
  unit.actionsLeft.act = false;
  return true;
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
    return { success: false, reason: "no_ammo" };
  }
  attacker.magAmmo -= 1;
  attacker.actionsLeft.act = false;

  const hitChance = cbCalculateHitChance(attacker, defender, bodyPart);
  const roll = Math.random() * 100;
  const hit = roll < hitChance;

  if (!hit) {
    cbLog(`${defender.name} ıskalandı.`);
    return { success: true, hit: false, hitChance };
  }

  const part = CB_BODY_PARTS[bodyPart];
  let damage = Math.round(weapon.damage * part.damageMult * (0.85 + Math.random() * 0.3));

  let instantLethal = false;
  if (bodyPart === "bas" && Math.random() < part.lethalChance) instantLethal = true;
  if (bodyPart === "gogus" && Math.random() < (part.organHitChance || 0) * part.lethalChance) instantLethal = true;

  defender.hp -= damage;
  cbApplyInjury(defender, bodyPart);

  if (instantLethal || defender.hp <= 0) {
    defender.hp = 0;
    defender.status = "dead";
    cbLog(`${defender.name} öldü.`);
    return { success: true, hit: true, damage, lethal: true };
  }

  if (defender.hp <= CB_CONSTANTS.stunThreshold) {
    defender.status = "down";
    cbLog(`${defender.name} bayıldı.`);
    return { success: true, hit: true, damage, downed: true };
  }

  cbLog(`${defender.name} vuruldu (${part.label}).`);
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
    return false;
  }
  unit.spareMags -= 1;
  unit.magAmmo = weapon.magSize;
  unit.actionsLeft.act = false;
  return true;
}

function cbBorrowAmmo(unit, downedAlly) {
  if (downedAlly.weapon !== unit.weapon) {
    return false;
  }
  if (downedAlly.spareMags <= 0 && downedAlly.magAmmo <= 0) {
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
  if (unit) { unit._movedThisTurn = false; unit.turnedThisTurn = false; }
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

// ============================================================
// AI KARAR MOTORU
// ============================================================
// Kişilik profilleri: agresif = ileri atılır, az siper alır, yakın hedefe öncelik verir
//                      sinsi = kritik/ölümcül bölgeye nişan alır, mesafeyi korur
//                      savunmaci = sık siper alır, düşük canda geri çekilir, temkinli hareket eder
const CB_PERSONALITY_PROFILES = {
  agresif: { coverChance: 0.25, retreatHpRatio: 0.15, preferNearest: true, criticalPartChance: 0.15 },
  sinsi: { coverChance: 0.45, retreatHpRatio: 0.35, preferNearest: false, criticalPartChance: 0.45 },
  savunmaci: { coverChance: 0.65, retreatHpRatio: 0.5, preferNearest: false, criticalPartChance: 0.1 },
};

function cbGetPersonalityProfile(unit) {
  return CB_PERSONALITY_PROFILES[unit.personality] || CB_PERSONALITY_PROFILES.agresif;
}

// ---- 1. HEDEF SEÇİMİ: ağırlıklı puanlama ----
// Puan = yakınlık + düşük can + (müttefik tarafından zaten hasarlanmışsa bonus)
function cbScoreTarget(unit, target, allAllyTargets) {
  const dist = Math.abs(unit.x - target.x) + Math.abs(unit.y - target.y);
  const weapon = CB_WEAPONS[unit.weapon];

  let score = 0;
  // Yakınlık: menzil içindeyse ve yakınsa yüksek puan (menzil dışına küçük ceza, yine de hedeflenebilir sayılır)
  const distScore = Math.max(0, (weapon.range - dist) / weapon.range) * 40;
  score += distScore;

  // Düşük can: canı azaldıkça öncelik artar (bitirici atış fırsatı)
  const hpRatio = target.hp / CB_CONSTANTS.maxHP;
  score += (1 - hpRatio) * 35;

  // Takım koordinasyonu: bu tur içinde başka bir müttefik tarafından zaten hedeflenmiş/hasarlanmışsa bonus
  const recentlyDamaged = target.injuries && target.injuries.length > 0 &&
    target.injuries[target.injuries.length - 1].turnApplied >= cbState.round - 1;
  if (recentlyDamaged) score += 15;

  // Zaten bayılmış/kaçmakta olan hedeflere düşük öncelik (öldürücü darbe isteğe bağlı ama gereksiz risk)
  if (target.status === "down") score -= 10;
  if (target.status === "fleeing") score -= 5;

  return score;
}

function cbChooseTarget(unit) {
  const visible = cbVisibleEnemies(unit);
  if (visible.length === 0) return null;
  const profile = cbGetPersonalityProfile(unit);

  const scored = visible.map(t => ({ target: t, score: cbScoreTarget(unit, t, visible) }));
  scored.sort((a, b) => b.score - a.score);

  // Agresif profil basitçe en yüksek puanlıyı seçer; diğerleri de aynı puanlamayı kullanır
  // (preferNearest gelecekte farklı ağırlıklandırma için genişletilebilir bir kanca)
  return scored[0].target;
}

// ---- 2. VÜCUT BÖLGESİ SEÇİMİ: beklenen hasar + kişilik ----
function cbChooseBodyPart(unit, target) {
  const profile = cbGetPersonalityProfile(unit);
  const weapon = CB_WEAPONS[unit.weapon];

  // Kişiliğe göre kritik bölgeye (baş/göğüs) gitme ihtimali
  if (Math.random() < profile.criticalPartChance) {
    return Math.random() < 0.5 ? "bas" : "gogus";
  }

  // Aksi halde: her bölge için beklenen hasarı hesaplayıp en yükseği seç
  // (beklenen hasar = isabet şansı x bölge hasar çarpanı)
  const candidates = ["gogus", "karin", "kol", "bacak"];
  let best = candidates[0], bestValue = -1;
  candidates.forEach(part => {
    const hitChance = cbCalculateHitChance(unit, target, part);
    const dmgMult = CB_BODY_PARTS[part].damageMult;
    const expected = (hitChance / 100) * dmgMult;
    if (expected > bestValue) { bestValue = expected; best = part; }
  });
  return best;
}

// ---- 3. HAREKET STRATEJİSİ: avlanma + temkinli siper arama ----
// Birim son bilinen düşman konumunu hafızasında tutar (unit.lastKnownEnemyPos)
function cbUpdateEnemyMemory(unit) {
  const visible = cbVisibleEnemies(unit);
  if (visible.length > 0) {
    // En yakın görüneni hatırla
    let closest = visible[0], closestDist = Infinity;
    visible.forEach(t => {
      const d = Math.abs(unit.x - t.x) + Math.abs(unit.y - t.y);
      if (d < closestDist) { closestDist = d; closest = t; }
    });
    unit.lastKnownEnemyPos = { x: closest.x, y: closest.y };
  }
}

function cbDecideMovement(unit) {
  const profile = cbGetPersonalityProfile(unit);
  const hpRatio = unit.hp / CB_CONSTANTS.maxHP;
  const reachable = cbReachableTiles(unit);
  if (reachable.length === 0) return null;

  // Düşük canlıysa (kişiliğe göre eşik farklı): siper arayan temkinli hareket
  if (hpRatio <= profile.retreatHpRatio) {
    const coveredTiles = reachable.filter(r => {
      const neighbors = [[r.x+1,r.y],[r.x-1,r.y],[r.x,r.y+1],[r.x,r.y-1]];
      return neighbors.some(([nx,ny]) => {
        const t = cbTileAt(nx, ny);
        return t === "wall" || t === "obstacle";
      });
    });
    if (coveredTiles.length > 0) {
      // Bilinen düşmandan mümkün olduğunca uzak, ama siperli bir kareye çekil
      if (unit.lastKnownEnemyPos) {
        coveredTiles.sort((a, b) => {
          const da = Math.abs(a.x - unit.lastKnownEnemyPos.x) + Math.abs(a.y - unit.lastKnownEnemyPos.y);
          const db = Math.abs(b.x - unit.lastKnownEnemyPos.x) + Math.abs(b.y - unit.lastKnownEnemyPos.y);
          return db - da; // en uzak önce
        });
      }
      return coveredTiles[0];
    }
  }

  // Bilinen bir düşman konumu varsa (avlanma): ona doğru ilerle
  if (unit.lastKnownEnemyPos) {
    reachable.sort((a, b) => {
      const da = Math.abs(a.x - unit.lastKnownEnemyPos.x) + Math.abs(a.y - unit.lastKnownEnemyPos.y);
      const db = Math.abs(b.x - unit.lastKnownEnemyPos.x) + Math.abs(b.y - unit.lastKnownEnemyPos.y);
      return da - db; // en yakın önce
    });
    return reachable[0];
  }

  // Hiçbir bilgi yoksa rastgele keşif hareketi
  return reachable[Math.floor(Math.random() * reachable.length)];
}

// ---- ANA KARAR FONKSİYONU ----
// Dönen obje: { type: 'fire'|'reload'|'cover'|'move'|'wait', ...detaylar }
function cbDecideEnemyAction(unit) {
  cbUpdateEnemyMemory(unit);
  const profile = cbGetPersonalityProfile(unit);
  const target = cbChooseTarget(unit);

  if (target && unit.magAmmo > 0) {
    const bodyPart = cbChooseBodyPart(unit, target);
    return { type: "fire", target, bodyPart };
  }

  if (unit.magAmmo <= 0 && unit.spareMags > 0) {
    return { type: "reload" };
  }

  // Görünür hedef yok: kişiliğe göre siper alma ihtimali
  if (!unit.takingCover && cbHasAdjacentCover(unit) && Math.random() < profile.coverChance) {
    return { type: "cover" };
  }

  // Aksi halde hareket (avlanma ya da temkinli çekilme)
  const dest = cbDecideMovement(unit);
  if (dest) {
    return { type: "move", x: dest.x, y: dest.y, dir: unit.dir };
  }

  return { type: "wait" };
}
