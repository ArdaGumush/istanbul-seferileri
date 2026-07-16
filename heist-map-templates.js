// ============================================================
// SOYGUN HARİTA ŞABLONLARI (Kuyumcu / Banka / Sergi)
// Her hedef türünün kendi renk teması + sabit oda düzeni ailesi var.
// Rastgelelik: obstacle sayısı/pozisyonu ve bazı oda boyutları her
// üretimde hafifçe değişir, ama genel akış (giriş->lobi->hedef odası)
// her zaman aynı kalır.
// ============================================================

const CB_HEIST_THEMES = {
  kuyumcu: {
    wall: "#4a3a2e", floor: "#241f1c", obstacle: "#5c4a38",
    door: "#6b5540", entrance: "#7a3a2a", vault_door: "#c9a24b", treasure: "#8a6a3a",
  },
  banka_subesi: {
    wall: "#3a3226", floor: "#1d2330", obstacle: "#4a4438",
    door: "#5a4a35", entrance: "#7a3a2a", vault_door: "#c9a24b", treasure: "#8b6538",
  },
  ozel_sergi: {
    wall: "#2e2a3a", floor: "#1a1826", obstacle: "#3e3850",
    door: "#4a4560", entrance: "#7a3a2a", vault_door: "#8a4bc9", treasure: "#5a3a8a",
  },
};

// Her şablon fonksiyonu bir 20x20 grid (satır 0 = üst) döndürür.
// Hücre değerleri: 'wall' | 'floor' | 'obstacle' | 'door' | 'entrance' | 'vault_door' | 'treasure'

function cbGenerateKuyumcuMap() {
  const GRID = 20;
  const grid = Array.from({ length: GRID }, () => Array(GRID).fill("wall"));
  const setArea = (x0, x1, y0, y1, val) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const row = (GRID - 1) - y, col = x;
      if (row >= 0 && row < GRID && col >= 0 && col < GRID) grid[row][col] = val;
    }
  };
  // Kuyumcu küçük ve kompakt: tek oda + kasa köşesi
  setArea(8, 11, 0, 0, "entrance");
  setArea(5, 13, 1, 11, "floor"); // ana satış salonu (x=14 artık salon dışı, duvar payı bırakıldı)
  // Rastgele obstacle (vitrin/tezgah) - 3-5 arası
  const obstacleCount = 3 + Math.floor(Math.random() * 3);
  const placed = [];
  for (let i = 0; i < obstacleCount; i++) {
    let attempts = 0;
    while (attempts < 20) {
      const x = 6 + Math.floor(Math.random() * 6);
      const y = 3 + Math.floor(Math.random() * 7);
      if (!placed.some(p => Math.abs(p.x - x) < 2 && Math.abs(p.y - y) < 2)) {
        setArea(x, x, y, y, "obstacle");
        placed.push({ x, y });
        break;
      }
      attempts++;
    }
  }
  // Kasa köşesi: salondan duvarla ayrılmış ayrı bir bölge, tek kapı ile bağlı
  setArea(15, 16, 4, 9, "floor");
  setArea(14, 14, 6, 7, "door"); // salon -> kasa önü geçişi
  setArea(15, 16, 10, 10, "vault_door");
  setArea(14, 17, 11, 13, "treasure");
  return grid;
}

function cbGenerateBankaSubesiMap() {
  const GRID = 20;
  const grid = Array.from({ length: GRID }, () => Array(GRID).fill("wall"));
  const setArea = (x0, x1, y0, y1, val) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const row = (GRID - 1) - y, col = x;
      if (row >= 0 && row < GRID && col >= 0 && col < GRID) grid[row][col] = val;
    }
  };
  // Senin onayladığın banka düzeni - sabit iskelet, rastgele obstacle pozisyonu
  setArea(8, 11, 0, 0, "entrance");
  setArea(6, 13, 1, 4, "floor");
  setArea(1, 12, 5, 12, "floor");
  // 4 obstacle, hafif rastgele pozisyon kayması (±1 kare)
  const baseSpots = [{ x: 3, y: 7 }, { x: 9, y: 7 }, { x: 3, y: 10 }, { x: 9, y: 10 }];
  baseSpots.forEach(spot => {
    const jx = Math.max(2, Math.min(11, spot.x + Math.floor(Math.random() * 3) - 1));
    const jy = Math.max(6, Math.min(11, spot.y + Math.floor(Math.random() * 3) - 1));
    setArea(jx, jx, jy, jy, "obstacle");
  });
  setArea(13, 13, 8, 9, "door");
  setArea(13, 16, 8, 9, "floor");
  setArea(15, 18, 10, 13, "floor");
  setArea(16, 17, 14, 14, "vault_door");
  setArea(14, 18, 15, 18, "treasure");
  return grid;
}

function cbGenerateOzelSergiMap() {
  const GRID = 20;
  const grid = Array.from({ length: GRID }, () => Array(GRID).fill("wall"));
  const setArea = (x0, x1, y0, y1, val) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const row = (GRID - 1) - y, col = x;
      if (row >= 0 && row < GRID && col >= 0 && col < GRID) grid[row][col] = val;
    }
  };
  // Sergi en büyük/karmaşık: iki oda + galeri koridoru
  setArea(9, 10, 0, 0, "entrance");
  setArea(6, 13, 1, 5, "floor"); // giriş lobisi
  setArea(2, 17, 6, 10, "floor"); // ana galeri (geniş)
  // Galeri vitrinleri (obstacle), rastgele sayı 5-7
  const obstacleCount = 5 + Math.floor(Math.random() * 3);
  const placed = [];
  for (let i = 0; i < obstacleCount; i++) {
    let attempts = 0;
    while (attempts < 20) {
      const x = 3 + Math.floor(Math.random() * 13);
      const y = 7 + Math.floor(Math.random() * 3);
      if (!placed.some(p => Math.abs(p.x - x) < 2 && Math.abs(p.y - y) < 1)) {
        setArea(x, x, y, y, "obstacle");
        placed.push({ x, y });
        break;
      }
      attempts++;
    }
  }
  setArea(9, 10, 11, 11, "door"); // galeriden özel koleksiyon odasına geçiş
  setArea(6, 13, 12, 15, "floor"); // özel koleksiyon ön odası
  setArea(9, 10, 16, 16, "vault_door");
  setArea(6, 13, 17, 19, "treasure");
  return grid;
}

const CB_HEIST_MAP_GENERATORS = {
  kuyumcu: cbGenerateKuyumcuMap,
  banka_subesi: cbGenerateBankaSubesiMap,
  ozel_sergi: cbGenerateOzelSergiMap,
};

// Bir soygun hedef id'sine göre grid ve tema döndürür. Bilinmeyen id'ler için
// Hideout haritası fallback olarak kullanılabilir (çağıran taraf kontrol eder).
function cbGenerateHeistMap(targetId) {
  const generator = CB_HEIST_MAP_GENERATORS[targetId];
  if (!generator) return null;
  return { grid: generator(), theme: CB_HEIST_THEMES[targetId] };
}
