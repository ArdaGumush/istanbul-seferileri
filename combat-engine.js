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
  pendingBreaches: [], // { x, y, detonateAtRound, placedBy } - gecikmeli breach charge'lar
  log: [],

  // ---- SOYGUN (Heist Extraction) moduna özel alanlar ----
  isHeistMode: false,
  heistTheme: null,
  heistDifficulty: "orta", // 'kolay' | 'orta' | 'zor' - vault door süresini belirler
  heistTotalHaul: 0, // mekanda başlangıçta bulunan toplam para
  heistRemainingHaul: 0, // henüz pickup edilmemiş, hazine odasında kalan miktar
  heistExtractedTotal: 0, // başarıyla çıkarılmış (extraction noktasından geçmiş) toplam
  vaultDoorOpen: false,
  vaultDoorTimer: null, // { triggeredAtRound, roundsRequired } - null ise henüz tetiklenmedi
  policeWaveNumber: 0, // kaçıncı dalga geldi (0 = henüz gelmedi)
  policeWaveNextRound: null, // bir sonraki dalganın geleceği round
};

// ---------------- HARİTA YÜKLEME ----------------
async function cbLoadMap(url) {
  const res = await fetch(url);
  const data = await res.json();
  cbState.grid = data.grid;
  cbState.rows = data.rows;
  cbState.cols = data.cols;
}

// Görsel dosyaya bağımlı olmadan, anlık kod ile harita üretir ve state'e yükler.
function cbLoadProceduralMap(mapType, size) {
  const data = cbGenerateMap(mapType, size || 20);
  cbState.grid = data.grid;
  cbState.rows = data.rows;
  cbState.cols = data.cols;
  cbState.mapEntrance = data.entrance;
  cbState.mapRooms = data.rooms || null; // sadece hideout için dolu, alley'de null
  cbState.mapType = mapType;
}

// Soygun hedefine özel harita şablonunu (heist-map-templates.js) yükler.
// Genel cbLoadProceduralMap'ten farkı: hazır grid kullanır, üretmez; ayrıca
// tema renklerini (cbState.heistTheme) UI'ın kullanabilmesi için saklar.
function cbLoadHeistMap(targetId) {
  const data = cbGenerateHeistMap(targetId);
  if (!data) return false;
  cbState.grid = data.grid;
  cbState.rows = data.grid.length;
  cbState.cols = data.grid[0].length;
  cbState.heistTheme = data.theme;
  cbState.mapType = "heist_" + targetId;
  cbState.mapRooms = null;

  // Entrance koordinatını grid içinde arayarak buluyoruz (şablonlarda sabit tanımlı)
  let entrance = null;
  for (let y = 0; y < cbState.rows && !entrance; y++) {
    for (let x = 0; x < cbState.cols; x++) {
      if (data.grid[y][x] === "entrance") { entrance = { x, y }; break; }
    }
  }
  cbState.mapEntrance = entrance;
  return true;
}

// ============================================================
// SOYGUN (Heist Extraction) MEKANİKLERİ
// ============================================================

const CB_VAULT_DOOR_ROUNDS = { kolay: 2, orta: 3, zor: 4 };
const CB_PICKUP_FRACTION = 1 / 9; // her pickup, toplam mekan parasının 1/9'unu verir
const CB_CHARACTER_HAUL_LIMIT_FRACTION = 1 / 3; // bir karakterin taşıyabileceği maksimum (toplamın 1/3'ü)

// Bir karakter vault door'un bitişiğinde "Kasayı Aç" aksiyonunu kullanınca çağrılır.
// Zorluk seviyesine göre tur sayacını başlatır. Aksiyon puanı harcanır.
function cbStartVaultDoorTimer(unit) {
  if (cbState.vaultDoorOpen || cbState.vaultDoorTimer) return false; // zaten açık ya da açılıyor
  const roundsRequired = CB_VAULT_DOOR_ROUNDS[cbState.heistDifficulty] || 3;
  cbState.vaultDoorTimer = { triggeredAtRound: cbState.round, roundsRequired };
  unit.actionsLeft.act = false;
  cbLog(`${unit.name} kasa kapısını açmaya başladı. ${roundsRequired} tur sürecek.`);
  return true;
}

// Her yeni round başında çağrılır - vault door sayacını kontrol edip süresi
// dolmuşsa kapıyı gerçekten açar (grid üzerindeki vault_door karelerini floor'a çevirir).
function cbProcessVaultDoorTimer() {
  if (!cbState.vaultDoorTimer || cbState.vaultDoorOpen) return;
  const elapsed = cbState.round - cbState.vaultDoorTimer.triggeredAtRound;
  if (elapsed >= cbState.vaultDoorTimer.roundsRequired) {
    cbState.vaultDoorOpen = true;
    for (let y = 0; y < cbState.rows; y++) {
      for (let x = 0; x < cbState.cols; x++) {
        if (cbState.grid[y][x] === "vault_door") cbState.grid[y][x] = "floor";
      }
    }
    cbLog("Kasa kapısı açıldı!");
  }
}

// Bir karakter treasure karesinde "Eşyayı Çantana Koy" aksiyonunu kullanınca çağrılır.
function cbPickupHaul(unit) {
  if (cbState.heistRemainingHaul <= 0) {
    cbLog("Hazine odasında alınacak bir şey kalmadı.");
    return false;
  }
  const characterLimit = Math.round(cbState.heistTotalHaul * CB_CHARACTER_HAUL_LIMIT_FRACTION);
  const currentCarried = unit.carriedHaul || 0;
  if (currentCarried >= characterLimit) {
    cbLog(`${unit.name} taşıyabileceği maksimum miktara ulaştı.`);
    return false;
  }
  const pickupAmount = Math.min(
    Math.round(cbState.heistTotalHaul * CB_PICKUP_FRACTION),
    cbState.heistRemainingHaul,
    characterLimit - currentCarried
  );
  unit.carriedHaul = currentCarried + pickupAmount;
  cbState.heistRemainingHaul -= pickupAmount;
  unit.actionsLeft.act = false;
  cbLog(`${unit.name} çantasına ${cbFormatTL(pickupAmount)} koydu. Üzerinde: ${cbFormatTL(unit.carriedHaul)}.`);
  return true;
}

// Bir karakter extraction (giriş) karesine ulaşınca üzerindeki parayı "teslim eder".
// Ölü/bayılmış birimlerden para otomatik düşer (ayrı bir fonksiyonla, bkz. cbDropCarriedHaul).
function cbExtractCarriedHaul(unit) {
  const amount = unit.carriedHaul || 0;
  if (amount <= 0) return 0;
  cbState.heistExtractedTotal += amount;
  unit.carriedHaul = 0;
  cbLog(`${unit.name} ${cbFormatTL(amount)} ile güvenli bölgeye ulaştı.`);
  return amount;
}

// Bir birim ölünce/bayılınca üzerindeki parayı yere düşürür (kaybolmaz, o karede kalır,
// başka bir birim gelip cbPickupDroppedHaul ile alabilir).
function cbDropCarriedHaul(unit) {
  const amount = unit.carriedHaul || 0;
  if (amount <= 0) return;
  unit.droppedHaulAt = { x: unit.x, y: unit.y, amount };
  unit.carriedHaul = 0;
  cbLog(`${unit.name} düştü, üzerindeki ${cbFormatTL(amount)} yere saçıldı.`);
}

// Bir birim, düşmüş/ölmüş bir müttefikin bıraktığı parayı yerden alır.
function cbPickupDroppedHaul(unit, deadUnit) {
  if (!deadUnit.droppedHaulAt) return false;
  const characterLimit = Math.round(cbState.heistTotalHaul * CB_CHARACTER_HAUL_LIMIT_FRACTION);
  const currentCarried = unit.carriedHaul || 0;
  const available = deadUnit.droppedHaulAt.amount;
  const takeAmount = Math.min(available, characterLimit - currentCarried);
  if (takeAmount <= 0) {
    cbLog(`${unit.name} zaten taşıyabileceği maksimuma ulaşmış.`);
    return false;
  }
  unit.carriedHaul = currentCarried + takeAmount;
  deadUnit.droppedHaulAt.amount -= takeAmount;
  if (deadUnit.droppedHaulAt.amount <= 0) deadUnit.droppedHaulAt = null;
  cbLog(`${unit.name} yerden ${cbFormatTL(takeAmount)} topladı.`);
  return true;
}

function cbFormatTL(amount) {
  return Math.round(amount).toLocaleString("tr-TR") + " TL";
}

// ---- POLİS DALGALARI (Heist Extraction) ----
// Vault door açıldıktan sonra (ilk pickup/kapı açma tetiklendiğinde) her 2 turda
// bir, öncekinden daha güçlü bir polis dalgası girişten spawn olur. Bu birimler
// "rushcu" kişilikte - siper almaz, geri çekilmez, en yakın hedefi kovalar.
const CB_POLICE_WAVE_INTERVAL_ROUNDS = 2;
const CB_POLICE_WEAPONS = ["tabanca_low", "tabanca_low", "makineli_low", "pompali_low", "tufek_low"];

function cbProcessPoliceWaves() {
  // İlk dalganın tetiklenmesi: vault door timer'ı başlatılınca (kapı açılmasa bile
  // alarm çalmış sayılır) polis gelmeye başlar.
  if (!cbState.vaultDoorTimer && cbState.policeWaveNumber === 0) return;

  if (cbState.policeWaveNextRound === null) {
    cbState.policeWaveNextRound = cbState.round + CB_POLICE_WAVE_INTERVAL_ROUNDS;
    return;
  }
  if (cbState.round < cbState.policeWaveNextRound) return;

  cbState.policeWaveNumber++;
  const waveSize = 1 + cbState.policeWaveNumber; // 1. dalga=2 kişi, 2. dalga=3, 3. dalga=4...
  const entrance = cbState.mapEntrance;
  if (!entrance) return;

  for (let i = 0; i < waveSize; i++) {
    const spot = cbFindSpawnSpotNearEntrance(entrance, i);
    if (!spot) continue;
    const weapon = CB_POLICE_WEAPONS[Math.min(i, CB_POLICE_WEAPONS.length - 1)];
    const unit = {
      id: cbUid(), name: `Polis ${cbState.policeWaveNumber}-${i + 1}`, side: "enemy",
      x: spot.x, y: spot.y, dir: "up", hp: 100,
      weapon, magAmmo: CB_WEAPONS[weapon].magSize, spareMags: 1,
      armorQuality: cbState.policeWaveNumber >= 3 ? "standart" : null, // 3. dalgadan itibaren zırhlı
      personality: "rushcu",
      actionsLeft: { move: true, act: true }, status: "active", injuries: [],
    };
    cbState.units.push(unit);
  }
  cbLog(`${cbState.policeWaveNumber}. polis dalgası geldi! (${waveSize} kişi)`);
  cbState.policeWaveNextRound = cbState.round + CB_POLICE_WAVE_INTERVAL_ROUNDS;
  cbBuildTurnOrder(); // yeni birimler sıraya dahil edilsin
}

// Giriş noktasının etrafında, boş bir floor karesi bulur (spawn için).
function cbFindSpawnSpotNearEntrance(entrance, offset) {
  const candidates = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = entrance.x + dx, y = entrance.y + dy;
      if (cbTileAt(x, y) === "floor" || cbTileAt(x, y) === "entrance") {
        if (!cbUnitAt(x, y)) candidates.push({ x, y });
      }
    }
  }
  if (candidates.length === 0) return null;
  return candidates[offset % candidates.length];
}

// Bir birimin, belirtilen tile tipine bitişik (4 komşu yön) olup olmadığını kontrol eder.
function cbIsAdjacentToTile(unit, tileType) {
  const neighbors = [[unit.x + 1, unit.y], [unit.x - 1, unit.y], [unit.x, unit.y + 1], [unit.x, unit.y - 1]];
  return neighbors.some(([nx, ny]) => cbTileAt(nx, ny) === tileType);
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

// Bir grup birimi TEK bir bölgede kümeli (birbirine yakın) yerleştirmek için:
// önce oyuncudan uzak bir "merkez" nokta bulur, sonra BFS ile o merkeze yakın
// count kadar boş floor karesi toplar. Pusuya uğrayan taraf dağınık değil,
// gerçekçi bir grup halinde durur.
// Verilen bir kare havuzundan (örn. tek bir odanın floor kareleri), birbirine
// yakın (BFS ile bağlı) count kadar kareyi seçer. Havuz dışına çıkmaz.
function cbPickClusteredFromPool(pool, count) {
  if (pool.length === 0) return [];
  const poolSet = new Set(pool.map(p => `${p.x},${p.y}`));
  const start = pool[Math.floor(Math.random() * pool.length)];

  const visited = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  const cluster = [start];

  while (queue.length > 0 && cluster.length < count) {
    const curr = queue.shift();
    const neighbors = [
      { x: curr.x + 1, y: curr.y }, { x: curr.x - 1, y: curr.y },
      { x: curr.x, y: curr.y + 1 }, { x: curr.x, y: curr.y - 1 },
    ];
    neighbors.sort(() => Math.random() - 0.5);
    neighbors.forEach(n => {
      const key = `${n.x},${n.y}`;
      if (visited.has(key)) return;
      if (!poolSet.has(key)) return; // havuzun dışına çıkma
      visited.add(key);
      cluster.push(n);
      queue.push(n);
    });
  }

  // Küme havuz içinde yeterince büyüyemediyse, havuzdan rastgele tamamla
  let attempts = 0;
  while (cluster.length < count && attempts < 100) {
    attempts++;
    const candidate = pool[Math.floor(Math.random() * pool.length)];
    const key = `${candidate.x},${candidate.y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    cluster.push(candidate);
  }

  return cluster.slice(0, count);
}

// Girişten (mapEntrance) en az minDist kadar uzak bir merkez noktadan başlayarak,
// birbirine yakın (BFS ile bağlı) count kadar floor karesi kümesi bulur.
function cbFindClusteredFloorTilesFromEntrance(count, minDist) {
  const entrance = cbState.mapEntrance;
  const candidates = [];
  for (let y = 0; y < cbState.rows; y++) {
    for (let x = 0; x < cbState.cols; x++) {
      if (cbTileAt(x, y) !== "floor") continue;
      if (cbUnitAt(x, y)) continue;
      if (entrance) {
        const dist = Math.abs(x - entrance.x) + Math.abs(y - entrance.y);
        if (dist < minDist) continue;
      }
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return cbFindClusteredFloorTiles(count, 0); // fallback: herhangi bir yer

  const center = candidates[Math.floor(Math.random() * candidates.length)];
  const visited = new Set([`${center.x},${center.y}`]);
  const queue = [center];
  const cluster = [center];

  while (queue.length > 0 && cluster.length < count) {
    const curr = queue.shift();
    const neighbors = [
      { x: curr.x + 1, y: curr.y }, { x: curr.x - 1, y: curr.y },
      { x: curr.x, y: curr.y + 1 }, { x: curr.x, y: curr.y - 1 },
    ];
    neighbors.sort(() => Math.random() - 0.5);
    neighbors.forEach(n => {
      const key = `${n.x},${n.y}`;
      if (visited.has(key)) return;
      visited.add(key);
      if (cbTileAt(n.x, n.y) !== "floor") return;
      if (cbUnitAt(n.x, n.y)) return;
      cluster.push(n);
      queue.push(n);
    });
  }

  let attempts = 0;
  while (cluster.length < count && attempts < 100) {
    attempts++;
    const fallback = candidates[Math.floor(Math.random() * candidates.length)];
    const key = `${fallback.x},${fallback.y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    cluster.push(fallback);
  }

  return cluster.slice(0, count);
}

function cbFindClusteredFloorTiles(count, minDistFromPlayers) {
  const center = cbFindRandomFloorTile(minDistFromPlayers);
  if (!center) return [];

  const visited = new Set([`${center.x},${center.y}`]);
  const queue = [center];
  const cluster = [center];

  while (queue.length > 0 && cluster.length < count) {
    const curr = queue.shift();
    const neighbors = [
      { x: curr.x + 1, y: curr.y }, { x: curr.x - 1, y: curr.y },
      { x: curr.x, y: curr.y + 1 }, { x: curr.x, y: curr.y - 1 },
    ];
    // Komşuları rastgele sırala ki küme her seferinde farklı bir şekil alsın
    neighbors.sort(() => Math.random() - 0.5);
    neighbors.forEach(n => {
      const key = `${n.x},${n.y}`;
      if (visited.has(key)) return;
      visited.add(key);
      if (cbTileAt(n.x, n.y) !== "floor") return;
      if (cbUnitAt(n.x, n.y)) return;
      cluster.push(n);
      queue.push(n);
    });
  }

  // Eğer küme yeterince büyüyemediyse (dar bir köşeye sıkıştıysa), eksik kalan
  // kadarını haritanın başka bir yerinden rastgele tamamla (garanti yerleşim için).
  // Sonsuz döngüyü önlemek için deneme sayısı sınırlanır.
  let attempts = 0;
  while (cluster.length < count && attempts < 200) {
    attempts++;
    const fallback = cbFindRandomFloorTile(minDistFromPlayers);
    if (!fallback) break;
    const key = `${fallback.x},${fallback.y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    cluster.push(fallback);
  }

  return cluster.slice(0, count);
}

// ---------------- BİRİM YÖNETİMİ ----------------
// Sadece "aktif olarak orada duran" birimleri bulur (hareket engelleme, hedef seçimi için).
// Ölü bedenler artık fiziksel bir engel değildir, bu yüzden burada sayılmaz.
function cbUnitAt(x, y) {
  return cbState.units.find(u => u.x === x && u.y === y && u.status !== "dead" && u.status !== "fled");
}

// Ölü bedenler dahil, o karedeki HERHANGİ bir birimi bulur (loot/render için).
// "fled" (kaçmayı tamamlamış) birimler hariç, çünkü onlar artık sahne dışı sayılır.
function cbAnyUnitAt(x, y) {
  return cbState.units.find(u => u.x === x && u.y === y && u.status !== "fled");
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
  // Saldırganın defender'a göre BASKIN yönünü bul (yatay mı dikey mi daha büyük fark var).
  // Böylece çapraz durumlarda köşe kontrolü yerine gerçek saldırı hattına bakılır.
  const rawDx = attacker.x - defender.x;
  const rawDy = attacker.y - defender.y;
  let checkX = defender.x, checkY = defender.y;
  if (Math.abs(rawDx) >= Math.abs(rawDy)) {
    checkX = defender.x + Math.sign(rawDx);
  } else {
    checkY = defender.y + Math.sign(rawDy);
  }
  const tile = cbTileAt(checkX, checkY);

  // Manuel "Siper Al" aktifse: sadece siperin durduğu yön korunur, ağır ceza.
  // Diğer yönlerden gelen saldırılar ise karakteri normalden daha savunmasız bırakır (bonus isabet, negatif "ceza").
  if (defender.takingCover) {
    const isCoveredTile = (tile === "obstacle" || tile === "wall");
    if (isCoveredTile) return 0.55; // siperin olduğu yönden gelen ateşe ağır isabet düşüşü
    return -0.15; // siperin olmadığı yönden gelen ateşe karşı ekstra savunmasız (isabet artışı)
  }

  // Otomatik/pasif siper: çok hafif bir taktik avantaj, ceza değil.
  // Asıl anlamlı koruma manuel "Siper Al" aksiyonundan gelir.
  if (tile === "obstacle") return 0.04;
  if (tile === "wall") return 0.06;
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

  // Silaha özel kabiliyet attribute'u (10 nötr taban, her puan ~%1.5 isabet etkisi).
  // unit.attributes yoksa (eski test verisi/aimSkill uyumluluğu için) eski aimSkill alanına düşer.
  let skillBonus;
  if (attacker.attributes && weapon.attributeKey) {
    const skill = attacker.attributes[weapon.attributeKey];
    skillBonus = (skill - 10) * 1.5;
  } else {
    skillBonus = attacker.aimSkill || 0;
  }
  chance += skillBonus;

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

  // Zırh: sadece göğüs/karın vuruşlarında geçerli, düz hasar azaltma (armor point)
  if ((bodyPart === "gogus" || bodyPart === "karin") && defender.armorQuality) {
    const armor = CB_ARMOR_QUALITY[defender.armorQuality];
    if (armor) {
      damage = Math.max(1, damage - armor.armorPoints * 0.15); // armor point'in bir kısmı düz hasar azaltımı olarak uygulanır
      damage = Math.round(damage);
    }
  }

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

// ---------------- MAKİNELİ TÜFEK: NORMAL ATIŞ (5 ayrı deneme) ----------------
// Her mermi kendi isabet/hasar hesabıyla ayrı ayrı işlenir. Hedef ölür/bayılırsa
// kalan mermiler boşa harcanmaz, atış dizisi orada durur.
function cbFireBurst(attacker, defender, bodyPart) {
  const weapon = CB_WEAPONS[attacker.weapon];
  const shotCount = weapon.burstShotCount || 1;
  const results = [];

  attacker.actionsLeft.act = false;

  for (let i = 0; i < shotCount; i++) {
    if (attacker.magAmmo <= 0) break;
    if (defender.status === "dead" || defender.status === "down") break;

    attacker.magAmmo -= 1;
    const hitChance = cbCalculateHitChance(attacker, defender, bodyPart);
    const roll = Math.random() * 100;
    const hit = roll < hitChance;

    if (!hit) {
      results.push({ hit: false });
      continue;
    }

    const part = CB_BODY_PARTS[bodyPart];
    let damage = Math.round(weapon.damage * part.damageMult * (0.85 + Math.random() * 0.3));

    if ((bodyPart === "gogus" || bodyPart === "karin") && defender.armorQuality) {
      const armor = CB_ARMOR_QUALITY[defender.armorQuality];
      if (armor) {
        damage = Math.max(1, Math.round(damage - armor.armorPoints * 0.15));
      }
    }

    let instantLethal = false;
    if (bodyPart === "bas" && Math.random() < part.lethalChance) instantLethal = true;
    if (bodyPart === "gogus" && Math.random() < (part.organHitChance || 0) * part.lethalChance) instantLethal = true;

    defender.hp -= damage;
    cbApplyInjury(defender, bodyPart);
    results.push({ hit: true, damage });

    if (instantLethal || defender.hp <= 0) {
      defender.hp = 0;
      defender.status = "dead";
      results[results.length - 1].lethal = true;
      break;
    }
    if (defender.hp <= CB_CONSTANTS.stunThreshold) {
      defender.status = "down";
      results[results.length - 1].downed = true;
      break;
    }
  }

  const hitCount = results.filter(r => r.hit).length;
  const totalDamage = results.reduce((sum, r) => sum + (r.damage || 0), 0);

  if (defender.status === "dead") {
    cbLog(`${defender.name} öldü.`);
  } else if (defender.status === "down") {
    cbLog(`${defender.name} bayıldı.`);
  } else if (hitCount > 0) {
    cbLog(`${defender.name} vuruldu (${hitCount} isabet).`);
  } else {
    cbLog(`${defender.name} ıskalandı.`);
  }

  return { success: true, shotsF: results.length, hitCount, totalDamage, results };
}

// ---------------- MAKİNELİ TÜFEK: BASTIRMA ATEŞİ (koni AOE) ----------------
// Saldırganın baktığı yöne doğru dar bir üçgen/koni içindeki TÜM birimleri
// (dost/düşman fark etmeksizin) düşük isabet ihtimaliyle etkiler.
function cbFireSuppression(attacker) {
  const weapon = CB_WEAPONS[attacker.weapon];
  if (attacker.magAmmo < weapon.suppressAmmoCost) {
    return { success: false, reason: "not_enough_ammo" };
  }
  attacker.magAmmo -= weapon.suppressAmmoCost;
  attacker.actionsLeft.act = false;

  const coneTiles = cbGetConeTiles(attacker, weapon.range);
  const affected = [];

  coneTiles.forEach(tile => {
    const u = cbUnitAt(tile.x, tile.y);
    if (!u || u === attacker || u.status === "dead" || u.status === "fled") return;

    const dist = Math.abs(attacker.x - tile.x) + Math.abs(attacker.y - tile.y);
    const distFactor = 1 - (dist / weapon.range) * 0.5; // yakın = tam etki, uzak = azalan
    const hitChance = Math.max(10, (weapon.baseAccuracy - weapon.suppressAccuracyPenalty) * distFactor);
    const roll = Math.random() * 100;

    if (roll < hitChance) {
      const damage = Math.round(weapon.damage * 0.7 * distFactor * (0.85 + Math.random() * 0.3)); // bastırma ateşi biraz daha düşük hasarlı
      u.hp -= damage;
      cbApplyInjury(u, "gogus"); // bastırma ateşi genel gövde vuruşu olarak işlenir
      if (u.hp <= 0) { u.hp = 0; u.status = "dead"; }
      else if (u.hp <= CB_CONSTANTS.stunThreshold && u.status === "active") u.status = "down";
      affected.push({ unit: u, damage });
    } else {
      affected.push({ unit: u, damage: 0 });
      // Isabet etmese bile koni içinde kalan birimler "baskı altında" sayılabilir (ileride moral sistemine bağlanabilir)
    }
  });

  const hitNames = affected.filter(a => a.damage > 0).map(a => a.unit.name);
  cbLog(`Bastırma ateşi açıldı. Vurulanlar: ${hitNames.join(", ") || "kimse"}.`);

  return { success: true, affected };
}

// Saldırganın baktığı yöne göre dar bir üçgen (koni) alan hesaplar - Fog of War'daki
// görüş üçgeni mantığına benzer ama sabit, dar bir açı kullanır (silahın menzili kadar).
function cbGetConeTiles(unit, range) {
  const vec = CB_DIR_VECTOR[unit.dir];
  const tiles = [];
  for (let depth = 1; depth <= range; depth++) {
    const width = Math.floor(depth / 2); // dar koni: derinlik arttıkça yavaş genişler
    for (let w = -width; w <= width; w++) {
      let tx, ty;
      if (vec.dx !== 0) { tx = unit.x + vec.dx * depth; ty = unit.y + w; }
      else { tx = unit.x + w; ty = unit.y + vec.dy * depth; }
      if (tx < 0 || tx >= cbState.cols || ty < 0 || ty >= cbState.rows) continue;
      if (cbHasLineOfSight(unit.x, unit.y, tx, ty)) tiles.push({ x: tx, y: ty });
    }
  }
  return tiles;
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
    cbState.units.forEach(u => { if (u.status === "active") cbProcessStatusEffectsForUnit(u); });
    cbProcessBreachCharges();
    if (cbState.isHeistMode) { cbProcessVaultDoorTimer(); cbProcessPoliceWaves(); }
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
      cbState.units.forEach(u => { if (u.status === "active") cbProcessStatusEffectsForUnit(u); });
      cbProcessBreachCharges();
      if (cbState.isHeistMode) { cbProcessVaultDoorTimer(); cbProcessPoliceWaves(); }
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
  if (cbState.isHeistMode) return cbCheckHeistVictory();

  const playerAlive = cbState.units.some(u => u.side === "player" && (u.status === "active" || u.status === "fleeing"));
  const enemyAlive = cbState.units.some(u => u.side === "enemy" && (u.status === "active" || u.status === "fleeing"));
  if (!enemyAlive) return "player";
  if (!playerAlive) return "enemy";
  return null;
}

// Heist modunda kazanma koşulu farklıdır: düşmanları tamamen yok etmek gerekmez
// (polis dalgaları sürekli gelir), bunun yerine TÜM hayatta kalan oyuncu karakterleri
// entrance (çıkış) karesinden geçip haritadan ayrılmalıdır ("extracted" sayılır).
// Kaybetme koşulu: tüm oyuncu birimleri öldü/bayıldı (kaçamayacak durumda).
function cbCheckHeistVictory() {
  const playerUnits = cbState.units.filter(u => u.side === "player");
  const stillOnMap = playerUnits.filter(u => u.status === "active" || u.status === "fleeing");

  if (stillOnMap.length === 0) {
    // Haritada aktif/kaçan kimse kalmadı - hepsi ya çıktı ya da düştü
    const anyDeadOrDown = playerUnits.some(u => u.status === "dead" || u.status === "down");
    const anyExtracted = playerUnits.some(u => u.extracted);
    if (anyExtracted) return "player"; // en az biri çıkmayı başardıysa kazanılmış sayılır
    if (anyDeadOrDown) return "enemy"; // kimse çıkamadan tüm ekip düştüyse kayıp
  }
  return null; // hâlâ haritada aktif birim var, savaş devam ediyor
}

// ============================================================
// SARF MALZEMESİ SİSTEMİ (Molotof, El Bombası, Sersemletici, Kırılma Şarjı)
// ============================================================

// Hedef karenin AOE yarıçapı içindeki tüm kareleri döndürür (Manhattan mesafesi ile,
// basit ve grid'e uygun bir "daire" yaklaşımı).
function cbGetAoeTiles(centerX, centerY, radius) {
  const tiles = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > radius) continue; // elmas şeklinde alan
      const x = centerX + dx, y = centerY + dy;
      if (x < 0 || x >= cbState.cols || y < 0 || y >= cbState.rows) continue;
      tiles.push({ x, y });
    }
  }
  return tiles;
}

// Bir sarf malzemesini (consumable) hedef kareye kullanır. Etki alanındaki TÜM
// birimleri (dost/düşman ayrımı yapmadan - patlama herkesi etkiler) işler.
function cbUseConsumable(user, consumableId, targetX, targetY) {
  const item = CB_CONSUMABLES[consumableId];
  if (!item) return { success: false, reason: "unknown_item" };

  const aoeTiles = cbGetAoeTiles(targetX, targetY, item.aoeRadius);
  const affectedUnits = [];

  aoeTiles.forEach(tile => {
    const unit = cbUnitAt(tile.x, tile.y);
    if (!unit || unit.status === "dead" || unit.status === "fled") return;
    affectedUnits.push(unit);

    // Hasar (varsa)
    if (item.damage > 0) {
      const dmg = Math.round(item.damage * (0.85 + Math.random() * 0.3));
      unit.hp -= dmg;
      if (unit.hp <= 0) {
        unit.hp = 0;
        unit.status = "dead";
      } else if (unit.hp <= CB_CONSTANTS.stunThreshold && unit.status === "active") {
        unit.status = "down";
      }
    }

    // Stun etkisi (flashbang / breach charge)
    if (item.stunTurns > 0 && unit.status === "active") {
      unit.stunnedTurnsLeft = (unit.stunnedTurnsLeft || 0) + item.stunTurns;
    }

    // Yanma etkisi (molotof) - birkaç tur boyunca ek hasar
    if (item.burnTurns > 0) {
      unit.burningTurnsLeft = (unit.burningTurnsLeft || 0) + item.burnTurns;
      unit.burnDamagePerTurn = Math.round(item.damage * 0.3); // her tur bu kadar yanma hasarı
    }
  });

  user.actionsLeft.act = false;
  const affectedNames = affectedUnits.map(u => u.name).join(", ") || "kimse";
  cbLog(`${item.name} kullanıldı. Etkilenenler: ${affectedNames}.`);

  return { success: true, affectedUnits };
}

// Stun ve yanma etkilerinin tur başına işlenmesi (cbEndUnitTurn / round geçişinde çağrılır)
function cbProcessStatusEffectsForUnit(unit) {
  if (unit.stunnedTurnsLeft > 0) {
    unit.stunnedTurnsLeft -= 1;
  }
  if (unit.burningTurnsLeft > 0) {
    unit.burningTurnsLeft -= 1;
    unit.hp -= (unit.burnDamagePerTurn || 5);
    if (unit.hp <= 0) {
      unit.hp = 0;
      unit.status = "dead";
    } else if (unit.hp <= CB_CONSTANTS.stunThreshold && unit.status === "active") {
      unit.status = "down";
    }
  }
}

// Bir birimin şu an stun etkisinde olup olmadığını (aksiyon alamaz) kontrol eder
function cbIsStunned(unit) {
  return (unit.stunnedTurnsLeft || 0) > 0;
}

// ============================================================
// PROSEDÜREL HARİTA ÜRETİCİ (görsel bağımlılığı olmadan, kod ile rastgele harita)
// ============================================================

// ---- HIDEOUT (iç mekan, odalar + kapılar + tek giriş) ----
function cbGenerateHideoutMap(size) {
  size = size || 20;
  const grid = [];
  for (let y = 0; y < size; y++) {
    grid.push(new Array(size).fill("wall"));
  }

  // Basit oda bölme: haritayı 2x2 ya da 2x3 bir ızgara halinde odalara ayır
  const roomCols = 2 + Math.floor(Math.random() * 2); // 2-3 sütun
  const roomRows = 2; // 2 satır (3-4 oda hedefi)
  const margin = 1; // dış duvar kalınlığı
  const usableW = size - margin * 2;
  const usableH = size - margin * 2;
  const roomW = Math.floor(usableW / roomCols);
  const roomH = Math.floor(usableH / roomRows);

  const rooms = [];
  for (let ry = 0; ry < roomRows; ry++) {
    for (let rx = 0; rx < roomCols; rx++) {
      const x0 = margin + rx * roomW;
      const y0 = margin + ry * roomH;
      const x1 = (rx === roomCols - 1) ? size - margin - 1 : x0 + roomW - 1;
      const y1 = (ry === roomRows - 1) ? size - margin - 1 : y0 + roomH - 1;
      rooms.push({ x0, y0, x1, y1 });
      // Oda içini floor yap
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          grid[y][x] = "floor";
        }
      }
    }
  }

  // Odalar arası duvarları geri çiz (her odanın kendi sınırı olsun), sonra kapı boşlukları aç
  // Basitlik için: her komşu oda çiftinin arasına 1 kalınlığında duvar + 1-2 kare kapı deliği koyarız
  for (let ry = 0; ry < roomRows; ry++) {
    for (let rx = 0; rx < roomCols; rx++) {
      const room = rooms[ry * roomCols + rx];
      // Sağdaki komşuyla arasına duvar + kapı
      if (rx < roomCols - 1) {
        const wallX = room.x1 + Math.floor((rooms[ry * roomCols + rx + 1].x0 - room.x1) / 2) || room.x1 + 1;
        const doorY = room.y0 + Math.floor(Math.random() * (room.y1 - room.y0 - 1)) + 1;
        for (let y = room.y0; y <= room.y1; y++) {
          if (grid[y]) grid[y][room.x1 + 1] = "wall";
        }
        if (grid[doorY]) grid[doorY][room.x1 + 1] = "door";
      }
      // Alttaki komşuyla arasına duvar + kapı
      if (ry < roomRows - 1) {
        const doorX = room.x0 + Math.floor(Math.random() * (room.x1 - room.x0 - 1)) + 1;
        for (let x = room.x0; x <= room.x1; x++) {
          if (grid[room.y1 + 1]) grid[room.y1 + 1][x] = "wall";
        }
        if (grid[room.y1 + 1]) grid[room.y1 + 1][doorX] = "door";
      }
    }
  }

  // Rastgele bir obstacle serpiştir (mobilya hissi, her odada 1-3 tane)
  rooms.forEach(room => {
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const x = room.x0 + 1 + Math.floor(Math.random() * Math.max(1, room.x1 - room.x0 - 2));
      const y = room.y0 + 1 + Math.floor(Math.random() * Math.max(1, room.y1 - room.y0 - 2));
      if (grid[y] && grid[y][x] === "floor") grid[y][x] = "obstacle";
    }
  });

  // Ana giriş: dış duvarların birinde (rastgele bir kenar), 1-2 kare
  const edge = Math.floor(Math.random() * 4); // 0:üst 1:alt 2:sol 3:sağ
  let entranceX, entranceY;
  if (edge === 0) { entranceX = margin + Math.floor(Math.random() * usableW); entranceY = 0; }
  else if (edge === 1) { entranceX = margin + Math.floor(Math.random() * usableW); entranceY = size - 1; }
  else if (edge === 2) { entranceX = 0; entranceY = margin + Math.floor(Math.random() * usableH); }
  else { entranceX = size - 1; entranceY = margin + Math.floor(Math.random() * usableH); }
  grid[entranceY][entranceX] = "entrance";
  // Girişin hemen içindeki kareyi floor yap (girişten içeri adım atılabilsin)
  const innerX = entranceX === 0 ? 1 : (entranceX === size - 1 ? size - 2 : entranceX);
  const innerY = entranceY === 0 ? 1 : (entranceY === size - 1 ? size - 2 : entranceY);
  if (grid[innerY] && grid[innerY][innerX] !== undefined) grid[innerY][innerX] = "floor";

  return { grid, rows: size, cols: size, entrance: { x: entranceX, y: entranceY }, rooms };
}

// ---- ARA SOKAK (dar, dolambaçlı, çok siper) ----
function cbGenerateAlleyMap(size) {
  size = size || 20;
  const grid = [];
  for (let y = 0; y < size; y++) grid.push(new Array(size).fill("wall"));

  // Birden fazla random walk başlatıcı kullan (haritanın farklı bölgelerinden), böylece
  // tüm harita alanına yayılan bir yol ağı oluşur, tek bir köşede sıkışıp kalmaz.
  const walkers = 4;
  const stepsPerWalker = size * 12;
  for (let w = 0; w < walkers; w++) {
    let x = 1 + Math.floor(Math.random() * (size - 2));
    let y = 1 + Math.floor(Math.random() * (size - 2));
    grid[y][x] = "floor";
    for (let i = 0; i < stepsPerWalker; i++) {
      const dir = Math.floor(Math.random() * 4);
      if (dir === 0) x = Math.min(size - 2, x + 1);
      else if (dir === 1) x = Math.max(1, x - 1);
      else if (dir === 2) y = Math.min(size - 2, y + 1);
      else y = Math.max(1, y - 1);
      grid[y][x] = "floor";
      if (Math.random() < 0.3) {
        const wx = Math.min(size - 2, Math.max(1, x + (Math.random() < 0.5 ? 1 : -1)));
        grid[y][wx] = "floor";
      }
    }
  }

  // Rastgele obstacle (kutu, çöp konteyneri hissi) - sadece floor karelerin üstüne
  for (let i = 0; i < size * 2; i++) {
    const ox = 1 + Math.floor(Math.random() * (size - 2));
    const oy = 1 + Math.floor(Math.random() * (size - 2));
    if (grid[oy][ox] === "floor") grid[oy][ox] = "obstacle";
  }

  // Giriş: alt kenarın ortası civarı, bu noktanın içeri açıldığından emin ol
  const entranceX = Math.floor(size / 2);
  const entranceY = size - 1;
  grid[entranceY][entranceX] = "entrance";

  // Girişten haritanın merkezine kadar garantili bir bağlantı koridoru çiz
  // (rastgele üretimin girişi izole bırakma ihtimaline karşı).
  let cx = entranceX, cy = entranceY - 1;
  const targetY = Math.floor(size / 2);
  while (cy > targetY) {
    grid[cy][cx] = "floor";
    cy--;
  }
  grid[cy][cx] = "floor";

  return { grid, rows: size, cols: size, entrance: { x: entranceX, y: entranceY } };
}

// Harita türüne göre üretici seçer
// ---- ANAYOL (geniş açık alan, az ama stratejik siper, uzun görüş hatları) ----
function cbGenerateMainRoadMap(size) {
  size = size || 20;
  const grid = [];
  for (let y = 0; y < size; y++) grid.push(new Array(size).fill("floor"));

  // Dış kenarları duvar yap (haritanın sınırı)
  for (let x = 0; x < size; x++) { grid[0][x] = "wall"; grid[size - 1][x] = "wall"; }
  for (let y = 0; y < size; y++) { grid[y][0] = "wall"; grid[y][size - 1] = "wall"; }

  // Yol kenarındaki kaldırım/bina bloklarını simüle etmek için haritanın üst ve alt
  // şeridine seyrek bina/köşe blokları koy (tam kapatmadan, sadece köşe siperleri).
  const cornerBlockCount = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < cornerBlockCount; i++) {
    const isTop = Math.random() < 0.5;
    const bx = 2 + Math.floor(Math.random() * (size - 8));
    const by = isTop ? (1 + Math.floor(Math.random() * 3)) : (size - 4 + Math.floor(Math.random() * 3));
    const bw = 2 + Math.floor(Math.random() * 3);
    const bh = 2 + Math.floor(Math.random() * 2);
    for (let y = by; y < Math.min(size - 1, by + bh); y++) {
      for (let x = bx; x < Math.min(size - 1, bx + bw); x++) {
        grid[y][x] = "wall";
      }
    }
  }

  // Yolun ortasında refüj/orta ayırıcı hissi - ince, kesintili bir obstacle şeridi
  const medianY = Math.floor(size / 2) + (Math.random() < 0.5 ? -1 : 1);
  for (let x = 2; x < size - 2; x++) {
    if (Math.random() < 0.6) grid[medianY][x] = "obstacle"; // kesintili, tam kapatmıyor (üzerinden görüş geçebilir boşluklar var)
  }

  // Park edilmiş araçlar / konteynerler: rastgele küçük 1x2 ya da 2x1 obstacle blokları
  const vehicleCount = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < vehicleCount; i++) {
    const vx = 1 + Math.floor(Math.random() * (size - 3));
    const vy = 1 + Math.floor(Math.random() * (size - 3));
    const horizontal = Math.random() < 0.5;
    if (grid[vy][vx] === "floor") grid[vy][vx] = "obstacle";
    if (horizontal && grid[vy][vx + 1] === "floor") grid[vy][vx + 1] = "obstacle";
    else if (!horizontal && grid[vy + 1] && grid[vy + 1][vx] === "floor") grid[vy + 1][vx] = "obstacle";
  }

  // Giriş: bir kenarın ortası (rastgele hangi kenar)
  const edge = Math.floor(Math.random() * 4);
  let entranceX, entranceY;
  if (edge === 0) { entranceX = Math.floor(size / 2); entranceY = 0; }
  else if (edge === 1) { entranceX = Math.floor(size / 2); entranceY = size - 1; }
  else if (edge === 2) { entranceX = 0; entranceY = Math.floor(size / 2); }
  else { entranceX = size - 1; entranceY = Math.floor(size / 2); }
  grid[entranceY][entranceX] = "entrance";
  // Girişin hemen içi kesinlikle floor olsun
  const innerX = entranceX === 0 ? 1 : (entranceX === size - 1 ? size - 2 : entranceX);
  const innerY = entranceY === 0 ? 1 : (entranceY === size - 1 ? size - 2 : entranceY);
  if (grid[innerY] && grid[innerY][innerX] !== undefined) grid[innerY][innerX] = "floor";

  return { grid, rows: size, cols: size, entrance: { x: entranceX, y: entranceY } };
}

// ---- KÖPRÜ (doğrusal, dar geçit, az siper, kısıtlı geri çekilme) ----
function cbGenerateBridgeMap(size) {
  size = size || 20;
  const grid = [];
  for (let y = 0; y < size; y++) grid.push(new Array(size).fill("wall"));

  // Köprü yatay mı dikey mi olsun rastgele seç
  const horizontal = Math.random() < 0.5;
  const bridgeWidth = 3 + Math.floor(Math.random() * 2); // 3-4 kare genişlik
  const start = Math.floor((size - bridgeWidth) / 2);

  if (horizontal) {
    // Köprü soldan sağa uzanır, dar bir şerit halinde
    for (let y = start; y < start + bridgeWidth; y++) {
      for (let x = 1; x < size - 1; x++) {
        grid[y][x] = "floor";
      }
    }
    // Köprü korkulukları: üst ve alt kenarda ince, kesintili obstacle (siper çok az)
    for (let x = 1; x < size - 1; x++) {
      if (Math.random() < 0.25) grid[start][x] = "obstacle";
      if (Math.random() < 0.25) grid[start + bridgeWidth - 1][x] = "obstacle";
    }
    // Girişler: iki uçta (iki yaka)
    const entranceX = Math.random() < 0.5 ? 0 : size - 1;
    const entranceY = start + Math.floor(bridgeWidth / 2);
    grid[entranceY][entranceX] = "entrance";
    const innerX = entranceX === 0 ? 1 : size - 2;
    grid[entranceY][innerX] = "floor";
    return { grid, rows: size, cols: size, entrance: { x: entranceX, y: entranceY } };
  } else {
    // Köprü yukarıdan aşağıya uzanır
    for (let x = start; x < start + bridgeWidth; x++) {
      for (let y = 1; y < size - 1; y++) {
        grid[y][x] = "floor";
      }
    }
    for (let y = 1; y < size - 1; y++) {
      if (Math.random() < 0.25) grid[y][start] = "obstacle";
      if (Math.random() < 0.25) grid[y][start + bridgeWidth - 1] = "obstacle";
    }
    const entranceY = Math.random() < 0.5 ? 0 : size - 1;
    const entranceX = start + Math.floor(bridgeWidth / 2);
    grid[entranceY][entranceX] = "entrance";
    const innerY = entranceY === 0 ? 1 : size - 2;
    grid[innerY][entranceX] = "floor";
    return { grid, rows: size, cols: size, entrance: { x: entranceX, y: entranceY } };
  }
}

// ---- ARAÇ PUSU (yol kenarı, duran araç enkazları, karışık açık-kapalı alan) ----
function cbGenerateVehicleAmbushMap(size) {
  size = size || 20;
  const grid = [];
  for (let y = 0; y < size; y++) grid.push(new Array(size).fill("floor"));

  // Dış kenarları duvar yap
  for (let x = 0; x < size; x++) { grid[0][x] = "wall"; grid[size - 1][x] = "wall"; }
  for (let y = 0; y < size; y++) { grid[y][0] = "wall"; grid[y][size - 1] = "wall"; }

  // Ana yol şeridi: haritayı ikiye bölen, nispeten açık bir koridor (yol)
  // Yolun iki tarafında daha yoğun obstacle (kenar/kaldırım hissi)
  const roadY = Math.floor(size / 2);
  const roadWidth = 4;

  // Yol dışındaki alanlara rastgele obstacle serpiştir (bina/çit hissi, orta yoğunluk)
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const distFromRoad = Math.abs(y - roadY);
      if (distFromRoad > roadWidth / 2) {
        if (Math.random() < 0.25) grid[y][x] = "obstacle";
      }
    }
  }

  // Duran/devrilmiş araç enkazları: yolun üzerinde ve kenarında 2-3 kareli obstacle blokları
  const vehicleCount = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < vehicleCount; i++) {
    const vx = 2 + Math.floor(Math.random() * (size - 6));
    const vy = roadY + Math.floor(Math.random() * 3) - 1;
    const horizontal = Math.random() < 0.5;
    if (grid[vy] && grid[vy][vx] === "floor") grid[vy][vx] = "obstacle";
    if (horizontal) {
      if (grid[vy] && grid[vy][vx + 1] === "floor") grid[vy][vx + 1] = "obstacle";
      if (grid[vy] && grid[vy][vx + 2] === "floor") grid[vy][vx + 2] = "obstacle";
    } else {
      if (grid[vy + 1] && grid[vy + 1][vx] === "floor") grid[vy + 1][vx] = "obstacle";
    }
  }

  // Giriş: yolun bir ucunda (sol ya da sağ kenar, yol hizasında)
  const fromLeft = Math.random() < 0.5;
  const entranceX = fromLeft ? 0 : size - 1;
  const entranceY = roadY;
  grid[entranceY][entranceX] = "entrance";
  const innerX = fromLeft ? 1 : size - 2;
  grid[entranceY][innerX] = "floor";

  return { grid, rows: size, cols: size, entrance: { x: entranceX, y: entranceY } };
}

function cbGenerateMap(mapType, size) {
  if (mapType === "hideout") return cbGenerateHideoutMap(size);
  if (mapType === "alley") return cbGenerateAlleyMap(size);
  if (mapType === "mainroad") return cbGenerateMainRoadMap(size);
  if (mapType === "bridge") return cbGenerateBridgeMap(size);
  if (mapType === "vehicleambush") return cbGenerateVehicleAmbushMap(size);
  // Varsayılan: alley tarzı
  return cbGenerateAlleyMap(size);
}

// ============================================================
// BREACH CHARGE SİSTEMİ (gecikmeli patlama, duvar/kapı kırma)
// ============================================================
// cbState.pendingBreaches: [{ x, y, plantedByRound, detonateAtRound, placedBy }]

function cbCanPlaceBreach(unit, targetX, targetY) {
  const dist = Math.abs(unit.x - targetX) + Math.abs(unit.y - targetY);
  if (dist !== 1) return false; // sadece bitişik kare
  const tile = cbTileAt(targetX, targetY);
  return !!CB_BREACHABLE_TILES[tile];
}

function cbPlaceBreachCharge(unit, targetX, targetY) {
  if (!cbCanPlaceBreach(unit, targetX, targetY)) return false;
  cbState.pendingBreaches = cbState.pendingBreaches || [];
  cbState.pendingBreaches.push({
    x: targetX, y: targetY,
    detonateAtRound: cbState.round + 1, // 1 tur sonra patlar
    placedBy: unit.id,
  });
  unit.actionsLeft.act = false;
  cbLog(`${unit.name} bir kırılma şarjı yerleştirdi.`);
  return true;
}

// Round geçişinde çağrılır: zamanı gelen charge'ları patlatır
function cbProcessBreachCharges() {
  cbState.pendingBreaches = cbState.pendingBreaches || [];
  const toDetonate = cbState.pendingBreaches.filter(b => cbState.round >= b.detonateAtRound);
  toDetonate.forEach(breach => cbDetonateBreach(breach));
  cbState.pendingBreaches = cbState.pendingBreaches.filter(b => cbState.round < b.detonateAtRound);
}

function cbDetonateBreach(breach) {
  const item = CB_CONSUMABLES.kirilma_sarji;
  const placer = cbState.units.find(u => u.id === breach.placedBy);

  // 1) HASAR: patlama noktasının yakın çevresi (mevcut dar radius, her iki tarafı da kapsar)
  const damageTiles = cbGetAoeTiles(breach.x, breach.y, item.aoeRadius);
  const damaged = [];
  damageTiles.forEach(t => {
    const u = cbUnitAt(t.x, t.y);
    if (!u || u.status === "dead" || u.status === "fled") return;
    damaged.push(u);
    const dmg = Math.round(item.damage * (0.85 + Math.random() * 0.3));
    u.hp -= dmg;
    if (u.hp <= 0) {
      u.hp = 0;
      u.status = "dead";
    } else if (u.hp <= CB_CONSTANTS.stunThreshold && u.status === "active") {
      u.status = "down";
    }
  });

  // 2) STUN: duvarın KARŞI tarafındaki kapalı odanın tamamı (flood-fill).
  // ÖNEMLİ: Bu hesaplama duvar/kapı YIKILMADAN ÖNCE yapılmalı, aksi halde flood-fill
  // artık "floor" olan breach noktasından dışarıyla içeriyi birleştirip tek dev alan sanır.
  if (placer) {
    const farSideStart = cbFindFarSideStartTile(breach.x, breach.y, placer.x, placer.y);
    if (farSideStart) {
      const roomTiles = cbFloodFillRoom(farSideStart.x, farSideStart.y);
      const stunned = [];
      roomTiles.forEach(t => {
        const u = cbUnitAt(t.x, t.y);
        if (!u || u.status === "dead" || u.status === "fled" || u.status !== "active") return;
        if (damaged.includes(u)) return; // zaten hasar aldıysa tekrar işlemeye gerek yok, ayrı stun ekle
        u.stunnedTurnsLeft = (u.stunnedTurnsLeft || 0) + item.stunTurns;
        stunned.push(u);
      });
      // Hasar alan ama ölmeyen/bayılmayan kişilere de stun uygula (breach noktasındaki kişi)
      damaged.forEach(u => {
        if (u.status === "active") u.stunnedTurnsLeft = (u.stunnedTurnsLeft || 0) + item.stunTurns;
      });
      cbLog(`Kırılma şarjı patladı. Hasar alan: ${damaged.map(u => u.name).join(", ") || "kimse"}. Sersemleyen (oda): ${stunned.map(u => u.name).join(", ") || "kimse"}.`);
      // Duvarı/kapıyı EN SON yıkıyoruz (stun hesaplaması bitince)
      const tile = cbTileAt(breach.x, breach.y);
      if (tile === "wall" || tile === "door") {
        cbState.grid[breach.y][breach.x] = "floor";
      }
      return;
    }
  }

  // Karşı taraf bulunamazsa (örn. placer bilgisi kayıpsa) eski basit davranışa düş
  damaged.forEach(u => {
    if (u.status === "active") u.stunnedTurnsLeft = (u.stunnedTurnsLeft || 0) + item.stunTurns;
  });
  cbLog(`Kırılma şarjı patladı. Etkilenenler: ${damaged.map(u => u.name).join(", ") || "kimse"}.`);

  // Duvarı/kapıyı yık (fallback durumunda da)
  const tile = cbTileAt(breach.x, breach.y);
  if (tile === "wall" || tile === "door") {
    cbState.grid[breach.y][breach.x] = "floor";
  }
}

// Breach noktasının, yerleştiren kişinin durduğu tarafın TERSİNDEKİ komşu karesini bulur.
// Bu kare, flood-fill'in başlangıç noktası olur (karşı odanın bir parçası).
// Not: obstacle kareler de "karşı taraf" içinde sayılır (flood-fill zaten obstacle'da durur,
// ama başlangıç noktası olarak kabul edilmemeli - bu yüzden en yakın FLOOR komşusunu ararız,
// sadece breach noktasına bitişik olanı değil, geometrik olarak ters yöndeki ilk floor'u).
function cbFindFarSideStartTile(breachX, breachY, placerX, placerY) {
  const dx = Math.sign(breachX - placerX);
  const dy = Math.sign(breachY - placerY);

  // Karşı taraftaki ilk kare (breach noktasının hemen ötesi)
  const firstX = breachX + dx, firstY = breachY + dy;
  if (firstX < 0 || firstX >= cbState.cols || firstY < 0 || firstY >= cbState.rows) return null;
  const firstTile = cbTileAt(firstX, firstY);
  if (firstTile === "wall" || firstTile === "door") return null; // hemen sınıra çarptık, karşı taraf yok
  if (firstTile === "floor") return { x: firstX, y: firstY };

  // Obstacle ise: o obstacle kümesinin çevresinde bir FLOOR arayarak "karşı odanın" içine gir.
  // Mini BFS: sadece obstacle kareler üzerinden yayılıp, ilk floor komşuya ulaşınca dur.
  const visited = new Set([`${firstX},${firstY}`]);
  const queue = [{ x: firstX, y: firstY }];
  const MAX_PROBE = 40;
  let steps = 0;

  while (queue.length > 0 && steps < MAX_PROBE) {
    steps++;
    const curr = queue.shift();
    const neighbors = [
      { x: curr.x + 1, y: curr.y }, { x: curr.x - 1, y: curr.y },
      { x: curr.x, y: curr.y + 1 }, { x: curr.x, y: curr.y - 1 },
    ];
    for (const n of neighbors) {
      const key = `${n.x},${n.y}`;
      if (visited.has(key)) continue;
      if (n.x < 0 || n.x >= cbState.cols || n.y < 0 || n.y >= cbState.rows) continue;
      const t = cbTileAt(n.x, n.y);
      if (t === "floor") return n; // karşı odanın gerçek zeminine ulaştık
      if (t === "obstacle") {
        visited.add(key);
        queue.push(n);
      }
      // wall/door ise o yönde durur, genişlemez
    }
  }
  return null;
}

// Belirtilen noktadan başlayarak, duvar/kapı ile çevrelenene kadar bağlı floor
// karelerini toplar (flood-fill). "Oda" sınırlarını bu şekilde tespit ederiz.
function cbFloodFillRoom(startX, startY) {
  const visited = new Set([`${startX},${startY}`]);
  const queue = [{ x: startX, y: startY }];
  const room = [{ x: startX, y: startY }];
  const MAX_ROOM_SIZE = 150; // güvenlik sınırı, açık haritalarda sonsuz büyümeyi önler

  while (queue.length > 0 && room.length < MAX_ROOM_SIZE) {
    const curr = queue.shift();
    const neighbors = [
      { x: curr.x + 1, y: curr.y }, { x: curr.x - 1, y: curr.y },
      { x: curr.x, y: curr.y + 1 }, { x: curr.x, y: curr.y - 1 },
    ];
    neighbors.forEach(n => {
      const key = `${n.x},${n.y}`;
      if (visited.has(key)) return;
      if (n.x < 0 || n.x >= cbState.cols || n.y < 0 || n.y >= cbState.rows) return;
      const t = cbTileAt(n.x, n.y);
      if (t !== "floor") return; // duvar/kapı/obstacle odayı sınırlar, geçilmez
      visited.add(key);
      room.push(n);
      queue.push(n);
    });
  }
  return room;
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
  rushcu: { coverChance: 0, retreatHpRatio: 0, preferNearest: true, criticalPartChance: 0.2 }, // polis dalgaları: hiç siper almaz, asla geri çekilmez
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
