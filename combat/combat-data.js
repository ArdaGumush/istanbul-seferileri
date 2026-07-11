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
  tabanca_low: { name: "Tabanca (Standart)", range: 5, baseAccuracy: 70, damage: 40, magSize: 8, canMoveAndFire: true, aoe: null },
  pompali_low: { name: "Pompalı (Kesme Namlu)", range: 2, baseAccuracy: 80, damage: 65, magSize: 2, canMoveAndFire: false, aoe: "cone" },
  makineli_low: { name: "Makineli (Hafif)", range: 6, baseAccuracy: 55, damage: 25, magSize: 20, canMoveAndFire: false, aoe: null },
  tufek_low: { name: "Tüfek (Av Tüfeği Modifiyeli)", range: 9, baseAccuracy: 65, damage: 90, magSize: 5, canMoveAndFire: false, aoe: null },
};

// Vücut bölgeleri - isabet zorluğu (küçük hedef = düşük baz isabet) ve etkiler
const CB_BODY_PARTS = {
  bas: { label: "Baş", hitDifficulty: 0.5, lethalChance: 0.65, damageMult: 2.2 },
  gogus: { label: "Göğüs", hitDifficulty: 0.85, lethalChance: 0.35, damageMult: 1.4, organHitChance: 0.5 },
  karin: { label: "Karın", hitDifficulty: 0.9, lethalChance: 0.15, damageMult: 1.1 },
  kol: { label: "Kol", hitDifficulty: 0.75, lethalChance: 0.02, damageMult: 0.6, accuracyPenaltyMult: 2 },
  bacak: { label: "Bacak", hitDifficulty: 0.75, lethalChance: 0.02, damageMult: 0.6, movementPenalty: true },
};

const CB_CONSTANTS = {
  maxHP: 300,
  stunThreshold: 100, // bu değerin altına düşünce bayılma
  fleeTurnsRequired: 2,
  bleedThreshold: 3, // kaç kez vurulunca kanama/şok tetiklenir (ekstra kural, genişletilebilir)
};

// Tile tipleri: floor (yürünebilir), wall (duvar/geçilmez, LOS engelleyici), obstacle (siper, geçilmez ama daha kısa)
const CB_TILE_BLOCKS_MOVEMENT = { wall: true, obstacle: true, floor: false };
const CB_TILE_BLOCKS_LOS = { wall: true, obstacle: true, floor: false };
