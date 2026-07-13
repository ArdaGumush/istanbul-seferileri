// ============================================================
// COMBAT PROTOTİP - VERİ MODELİ
// ============================================================

const CB_DIRECTIONS = ["up", "down", "left", "right"];
const CB_DIR_VECTOR = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

// Basitleştirilmiş silah seti (prototip için ana game-data.js silahlarından türetildi)
const CB_WEAPONS = {
  tabanca_low: { name: "Tabanca (Standart)", range: 5, baseAccuracy: 70, damage: 14, magSize: 8, canMoveAndFire: true, aoe: null,
    laserColor: "#e6c368", laserWidth: 1.5, attributeKey: "tabanca_kabiliyeti" },
  pompali_low: { name: "Pompalı (Kesme Namlu)", range: 2, baseAccuracy: 80, damage: 22, magSize: 2, canMoveAndFire: false, aoe: "cone",
    laserColor: "#d4453d", laserWidth: 4, attributeKey: "pompali_kabiliyeti" },
  makineli_low: { name: "Makineli (Hafif)", range: 6, baseAccuracy: 55, damage: 9, magSize: 20, canMoveAndFire: false, aoe: null,
    laserColor: "#f0a830", laserWidth: 2, attributeKey: "makineli_kabiliyeti",
    hasFireModes: true, burstShotCount: 5, burstAmmoCost: 5, suppressAmmoCost: 8, suppressAccuracyPenalty: 25 },
  tufek_low: { name: "Tüfek (Av Tüfeği Modifiyeli)", range: 9, baseAccuracy: 65, damage: 30, magSize: 5, canMoveAndFire: false, aoe: null,
    laserColor: "#4ec9e8", laserWidth: 1, attributeKey: "nisan_kabiliyeti" },
};

// Vücut bölgeleri - isabet zorluğu (küçük hedef = düşük baz isabet) ve etkiler
const CB_BODY_PARTS = {
  bas: { label: "Baş", hitDifficulty: 0.55, lethalChance: 0.65, damageMult: 2.2 },
  gogus: { label: "Göğüs", hitDifficulty: 1.0, lethalChance: 0.35, damageMult: 1.4, organHitChance: 0.5 },
  karin: { label: "Karın", hitDifficulty: 1.0, lethalChance: 0.15, damageMult: 1.1 },
  kol: { label: "Kol", hitDifficulty: 0.7, lethalChance: 0.02, damageMult: 0.6, accuracyPenaltyMult: 2 },
  bacak: { label: "Bacak", hitDifficulty: 0.7, lethalChance: 0.02, damageMult: 0.6, movementPenalty: true },
};

const CB_CONSTANTS = {
  maxHP: 100,
  stunThreshold: 30, // 1/3 kuralı: bu değerin altına düşünce bayılma
  fleeTurnsRequired: 2,
  bleedThreshold: 3, // kaç kez vurulunca kanama/şok tetiklenir (ekstra kural, genişletilebilir)
};

// Zırh kalite seviyeleri: göğüs/karın vuruşlarına karşı düz hasar azaltma (armor point)
const CB_ARMOR_QUALITY = {
  hurdalik: { label: "Hurdalık", armorPoints: 15 },
  standart: { label: "Standart", armorPoints: 50 },
  kaliteli: { label: "Kaliteli", armorPoints: 75 },
  mukemmel: { label: "Mükemmel", armorPoints: 100 },
};

// Sarf malzemeleri (consumables) - ana oyundaki game-data.js CONSUMABLES ile aynı değerler
const CB_CONSUMABLES = {
  sersemletici: {
    name: "Sersemletici (Flashbang)", aoeRadius: 2, damage: 0, stunTurns: 1, coverPierce: 0,
  },
  el_bombasi: {
    name: "El Bombası", aoeRadius: 2, damage: 12, stunTurns: 0, coverPierce: 0.4,
  },
  molotof: {
    name: "Molotof", aoeRadius: 1, damage: 5, burnTurns: 3, stunTurns: 0, coverPierce: 0,
  },
  kirilma_sarji: {
    name: "Kırılma Şarjı", aoeRadius: 1, damage: 7, stunTurns: 1, coverPierce: 1.0, breachesWalls: true,
  },
};

// Tile tipleri: floor (yürünebilir), wall (duvar/geçilmez, LOS engelleyici), obstacle (siper, geçilmez ama daha kısa)
const CB_TILE_BLOCKS_MOVEMENT = { wall: true, obstacle: true, floor: false, door: false, entrance: false };
const CB_TILE_BLOCKS_LOS = { wall: true, obstacle: true, floor: false, door: false, entrance: false };

// Breach Charge hedefleyebileceği tile tipleri: hem kapılar (door/entrance, kolay hedef)
// hem de düz duvarlar (wall, sürpriz giriş için) hedeflenebilir.
const CB_BREACHABLE_TILES = { wall: true, door: true, entrance: true, obstacle: false, floor: false };
