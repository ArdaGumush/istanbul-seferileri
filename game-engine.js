// ============================================================
// KARANLIK ŞEHİR - OYUN MOTORU
// ============================================================

// ---------------- STATE ----------------
const state = {
  cash: GAME_CONSTANTS.startingCash,
  heat: GAME_CONSTANTS.startingHeat,
  day: 1,
  minutes: 8 * 60, // 08:00 başlar
  speed: 1, // 0 = duraklat, 1 = normal, 2 = hızlı
  selectedDistrict: null,
  activeTab: "district",

  profile: {
    leaderName: "", codeName: "", orgName: "",
    originId: null, leadershipId: null, ideologyId: null,
  },
  modifiers: {}, // setup seçimlerinden türeyen çarpanlar/bonuslar

  districts: {}, // id -> { owner: 'player'|'rival:<id>'|null, businesses: [...], refinery: null, lab: null }
  crew: [], // { id, name, role, wage, loyalty, assignedTo }
  vehicles: [], // { id, faction: 'player'|gangId|'polis', kind, status, routeNodes, ... }
  materialStock: {}, // material id -> amount (genel depo)
  drugStock: {}, // product id -> amount (genel depo)
  activeHeists: [], // { targetId, crewIds, equipmentIds, finishesAtMin, successChance }
  activeStreetSales: [], // { productId, amount, finishesAtMin } - manuel "Sokak Satışı" ilanları
  gangRelations: {}, // gangId -> { hostility: 0-100 }
  gangEconomy: {}, // gangId -> { cash, materialStock, drugStock }
  activeCounterOps: [], // { type, targetVehicleId, crewIds, finishesAtMin, successChance }

  armory: { weapons: {}, armors: {}, consumables: {} }, // id -> adet

  garage: [], // { id, vehicleTypeId, durability, status: 'available'|'on_mission', currentDistrictId }

  captives: [], // { id, name, sourceGangId, hp, maxHpAtCapture, loyalty, lastHealAtMin, resolved: bool, districtId }
  blackMarketListings: [], // { id, itemType, itemId, price, sourceLabel, expiresAtMin, amount }

  neighborhoodAssignments: {}, // crewId -> { districtId, neighborhoodName }
  activeProductionMinigame: null, // { productId, districtId, ... } - UI tarafından yönetilir
  dailyIncomeTracker: { lastResetDay: 1, incomeSoFar: 0, expenseSoFar: 0, lastFullDayNet: null },
  intelMarkers: [], // { id, districtId, description, expiresAtMin } - casus tarafından üretilir

  log: [],
};

// ---- YARALANMA SİSTEMİ (Doktor mekaniği - combat sistemine bağlanacak) ----
// Her injury: { bodyPart, severity, startedAtMin, healMinutesTotal, chronicChance }
// crew üyesinde: c.injuries = [ ... ]
const INJURY_CONFIG = {
  bacak: { statAffected: "movement", normalPenalty: 2, chronicPenalty: 1, baseHealDays: 45, doctorHealDays: 21, chronicChanceNoDoctor: 0.25 },
  kol: { statAffected: "accuracy", normalPenalty: 15, chronicPenalty: 8, baseHealDays: 40, doctorHealDays: 18, chronicChanceNoDoctor: 0.2 },
  toraks: { statAffected: "general", normalPenalty: 30, chronicPenalty: 15, baseHealDays: 60, doctorHealDays: 25, chronicChanceNoDoctor: 0.35 },
};

function applyInjury(crewMember, bodyPart) {
  const cfg = INJURY_CONFIG[bodyPart];
  if (!cfg) return;
  const hasDoctor = state.crew.some(c => c.role === "doktor" && !c.assignedTo);
  const healDays = hasDoctor ? cfg.doctorHealDays : cfg.baseHealDays;
  crewMember.injuries = crewMember.injuries || [];
  crewMember.injuries.push({
    bodyPart, startedAtMin: state.minutes,
    healMinutesTotal: healDays * 24 * 60,
    willBeChronic: hasDoctor ? false : Math.random() < cfg.chronicChanceNoDoctor,
    resolved: false,
  });
}

function processInjuryHealing() {
  const hasDoctor = state.crew.some(c => c.role === "doktor" && !c.assignedTo);
  state.crew.forEach(c => {
    if (!c.injuries) return;
    c.injuries.forEach(inj => {
      if (inj.resolved) return;
      const elapsed = state.minutes - inj.startedAtMin;
      if (elapsed >= inj.healMinutesTotal) {
        inj.resolved = true;
        if (inj.willBeChronic) {
          inj.chronic = true;
          toast("Kalıcı Sakatlık", `${c.name}, ${inj.bodyPart} yarasından kalıcı olarak etkilendi.`, "negative");
        } else {
          toast("İyileşme Tamamlandı", `${c.name} tamamen iyileşti.`, "positive");
        }
      }
    });
  });
}

// ============================================================
// LOKAL KAYIT SİSTEMİ (localStorage)
// ============================================================
const SAVE_KEY = "karanlik_sehir_save_v1";
let saveThrottleTimer = null;

// render() her çağrıldığında tetiklenir, ama gerçek yazma en fazla 3 saniyede
// bir gerçekleşir (throttle) - performans için sürekli disk yazımını önler.
function requestAutoSave() {
  if (saveThrottleTimer) return;
  saveThrottleTimer = setTimeout(() => {
    saveGameToLocalStorage();
    saveThrottleTimer = null;
  }, 3000);
}

function saveGameToLocalStorage() {
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(SAVE_KEY, serialized);
    localStorage.setItem(SAVE_KEY + "_timestamp", Date.now().toString());
  } catch (e) {
    console.error("Oyun kaydedilemedi:", e);
  }
}

function loadGameFromLocalStorage() {
  try {
    const serialized = localStorage.getItem(SAVE_KEY);
    if (!serialized) return false;
    const loaded = JSON.parse(serialized);
    Object.keys(state).forEach(key => delete state[key]);
    Object.assign(state, loaded);
    return true;
  } catch (e) {
    console.error("Kayıtlı oyun yüklenemedi:", e);
    return false;
  }
}

function hasSavedGame() {
  return localStorage.getItem(SAVE_KEY) !== null;
}

function clearSavedGame() {
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(SAVE_KEY + "_timestamp");
}

function initState() {
  DISTRICTS.forEach(d => {
    const rival = RIVAL_GANGS.find(g => g.controlledStart.includes(d.id));
    state.districts[d.id] = {
      owner: rival ? `rival:${rival.id}` : null,
      businesses: [],
      refinery: false,
      lab: null, // { level }
    };
  });
  // Oyuncuya başlangıç bölgesi ver - "sıfırdan serseri" hikayesi: kendi evinde
  // küçük bir uyuşturucu lab'ı zaten kurulu (ücretsiz, Level 1)
  state.districts["tarlabasi"].owner = "player";
  state.districts["tarlabasi"].lab = { level: 1 };

  // Başlangıç aracı: eski, biraz yıpranmış ama çalışan bir panelvan
  const starterVehicle = VEHICLES.find(v => v.id === "panelvan");
  state.garage.push({
    id: uid(), vehicleTypeId: "panelvan",
    durability: Math.round(starterVehicle.maxDurability * 0.7), // sıfırdan başlayan biri için biraz yıpranmış
    status: "available", currentDistrictId: "tarlabasi",
    plate: generatePlate(), flagged: false, replatedRecently: false,
  });

  RIVAL_GANGS.forEach(g => {
    state.gangRelations[g.id] = { hostility: 20 };
    state.gangEconomy[g.id] = {
      cash: 15000 + Math.floor(Math.random() * 10000),
      materialStock: {}, drugStock: {},
    };
    RAW_MATERIALS.forEach(m => { state.gangEconomy[g.id].materialStock[m.id] = 10; });
    DRUG_PRODUCTS.forEach(p => { state.gangEconomy[g.id].drugStock[p.id] = 0; });
  });
  RAW_MATERIALS.forEach(m => { state.materialStock[m.id] = 0; });
  DRUG_PRODUCTS.forEach(p => { state.drugStock[p.id] = 0; });

  // Kuruluş seçimlerinden gelen bonusları uygula
  const origin = ORIGINS.find(o => o.id === state.profile.originId);
  const leadership = LEADERSHIP_STYLES.find(l => l.id === state.profile.leadershipId);
  const ideology = IDEOLOGIES.find(i => i.id === state.profile.ideologyId);
  [origin, leadership, ideology].forEach(choice => { if (choice) choice.apply(state); });

  // Zorluk seviyesi: ekonomi (gelir/gider) + rakip gücü + operasyon başarı bonusu
  const difficulty = DIFFICULTY_LEVELS.find(d => d.id === state.profile.difficultyId);
  if (difficulty) {
    state.modifiers.businessIncomeMult = (state.modifiers.businessIncomeMult || 1) * difficulty.incomeMult;
    state.modifiers.wageMult = (state.modifiers.wageMult || 1) * difficulty.expenseMult;
    state.modifiers.districtCostMult = (state.modifiers.districtCostMult || 1) * difficulty.expenseMult;
    state.modifiers.heistSuccessBonus = (state.modifiers.heistSuccessBonus || 0) + difficulty.operationSuccessBonus;
    state.modifiers.attackSuccessBonus = (state.modifiers.attackSuccessBonus || 0) + difficulty.operationSuccessBonus;
    state.modifiers.rivalStrengthMult = difficulty.rivalStrengthMult;
  }

  if (state.modifiers.startingCashBonus) state.cash += state.modifiers.startingCashBonus;
  if (state.modifiers.freeCrewOnStart) {
    const roleId = "asker_devriye";
    state.crew.push({
      id: uid(), name: randomName(), role: roleId,
      wage: Math.round(CREW_ROLES[roleId].baseWage * 0.6),
      loyalty: 75, assignedTo: null,
    });
  }

  // Weapons/Armors artık adet değil, segment bazında "kilidi açık mı" + "dayanıklılık" tutuyor.
  // Consumables hâlâ adet bazlı (sarf malzemesi mantığı bunu gerektiriyor).
  // Weapons/Armors artık her biri kendi kimliğine (id, durability) sahip birer
  // envanter öğesi olarak tutulur - aynı segmentten birden fazla adet olabilir,
  // her biri farklı bir ekip üyesine atanabilir (Garaj/Filo mantığına benzer).
  WEAPONS.forEach(w => { state.armory.weapons[w.id] = []; });
  ARMORS.forEach(a => { state.armory.armors[a.id] = []; });
  CONSUMABLES.forEach(c => { state.armory.consumables[c.id] = 0; });
}

// ---------------- UTILITY ----------------
function fmt(n) {
  return "₺" + Math.round(n).toLocaleString("tr-TR");
}
function fmtTime(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
function districtById(id) { return DISTRICTS.find(d => d.id === id); }
function playerDistrictIds() {
  return Object.keys(state.districts).filter(id => state.districts[id].owner === "player");
}
function toast(title, body, type = "neutral") {
  const stack = document.getElementById("toast-stack");
  const el = document.createElement("div");
  el.className = "toast" + (type !== "neutral" ? " " + type : "");
  el.style.cursor = "pointer";
  el.innerHTML = `<div class="toast-title">${title}</div><div class="toast-body">${body}</div>`;
  const dismiss = () => { el.style.opacity = "0"; el.style.transition = "opacity 0.3s"; setTimeout(() => el.remove(), 300); };
  el.addEventListener("click", dismiss);
  stack.appendChild(el);
  setTimeout(dismiss, 5000);
}
function randomName() {
  const f = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const l = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return f + " " + l;
}
function uid() { return Math.random().toString(36).slice(2, 10); }

// ============================================================
// MUTLAK ZAMAN YARDIMCI FONKSİYONLARI
// ============================================================
// state.minutes her gün 0-1440 arasında sıfırlanıyor (state.day artıyor), bu yüzden
// "X dakika sonra bitecek" gibi gelecekteki zamanları SADECE state.minutes ile
// hesaplamak yanlıştır - gün geçişinde karşılaştırma bozulur (kalan süre binlerce
// dakikaya sıçrar). Tüm "finishesAtMin"/"arrivesAtMin"/"expiresAtMin" gibi alanlar
// bu mutlak (gün*1440+dakika) zaman üzerinden hesaplanmalı ve karşılaştırılmalıdır.
function nowAbsoluteMin() {
  return state.day * 24 * 60 + state.minutes;
}
function remainingMinutesUntil(absoluteTargetMin) {
  return Math.max(0, absoluteTargetMin - nowAbsoluteMin());
}

// ---------------- YOL AĞI (ROAD NETWORK) ----------------
let roadAdjacency = null;
function buildRoadAdjacency() {
  if (roadAdjacency) return roadAdjacency;
  roadAdjacency = ROAD_NODES.map(() => []);
  ROAD_EDGES.forEach(([i, j]) => {
    const [xi, yi] = ROAD_NODES[i];
    const [xj, yj] = ROAD_NODES[j];
    const dist = Math.hypot(xi - xj, yi - yj);
    roadAdjacency[i].push([j, dist]);
    roadAdjacency[j].push([i, dist]);
  });
  return roadAdjacency;
}

function nearestRoadNode(x, y) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < ROAD_NODES.length; i++) {
    const [nx, ny] = ROAD_NODES[i];
    const d = Math.hypot(nx - x, ny - y);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// Dijkstra: iki düğüm arası en kısa yolu düğüm indeksleri listesi olarak döndürür
function findRoute(startNodeIdx, endNodeIdx) {
  const adj = buildRoadAdjacency();
  const dist = new Array(ROAD_NODES.length).fill(Infinity);
  const prev = new Array(ROAD_NODES.length).fill(-1);
  const visited = new Array(ROAD_NODES.length).fill(false);
  dist[startNodeIdx] = 0;

  // Basit öncelik kuyruğu (küçük graf için lineer arama yeterli)
  for (let iter = 0; iter < ROAD_NODES.length; iter++) {
    let u = -1, uDist = Infinity;
    for (let i = 0; i < ROAD_NODES.length; i++) {
      if (!visited[i] && dist[i] < uDist) { uDist = dist[i]; u = i; }
    }
    if (u === -1 || u === endNodeIdx) break;
    visited[u] = true;
    adj[u].forEach(([v, w]) => {
      if (dist[u] + w < dist[v]) {
        dist[v] = dist[u] + w;
        prev[v] = u;
      }
    });
  }

  if (dist[endNodeIdx] === Infinity) return null;
  const route = [];
  let curr = endNodeIdx;
  while (curr !== -1) {
    route.unshift(curr);
    curr = prev[curr];
  }
  return { nodeIndices: route, totalDist: dist[endNodeIdx] };
}

// Bir semtin harita üzerindeki (x,y) konumuna en yakın yol düğümünü bulur
const districtRoadNodeCache = {};
function districtRoadNode(districtId) {
  if (districtRoadNodeCache[districtId] !== undefined) return districtRoadNodeCache[districtId];
  const d = districtById(districtId);
  const idx = nearestRoadNode(d.x, d.y);
  districtRoadNodeCache[districtId] = idx;
  return idx;
}

// Rota üzerindeki toplam mesafeyi oyun-dakikasına çevir (hız çarpanına göre)
function routeTravelMinutes(totalDist, speedFactor) {
  // totalDist viewBox biriminde; deneysel bir ölçek ile dakikaya çeviriyoruz
  return Math.max(3, Math.round(totalDist * 9 / speedFactor));
}

// ---------------- TOPBAR RENDER ----------------
function renderTopbar() {
  const brandEl = document.getElementById("topbar-brand");
  if (brandEl && state.profile.orgName) brandEl.textContent = state.profile.orgName.toUpperCase();

  const hasAccountant = state.crew.some(c => c.role === "muhasebeci" && !c.assignedTo);
  const cashEl = document.getElementById("stat-cash");
  if (hasAccountant) {
    // O anki günün, o ana kadarki canlı net kâr/zararı gösterilir (gün bitmesini beklemez)
    const tracker = state.dailyIncomeTracker;
    const net = tracker.incomeSoFar - tracker.expenseSoFar;
    const sign = net >= 0 ? "+" : "";
    const color = net >= 0 ? "var(--gold-bright)" : "var(--blood-bright)";
    cashEl.innerHTML = `${fmt(state.cash)} <span style="font-size:10px; color:${color};">(${sign}${fmt(net)} bugün)</span>`;
  } else {
    cashEl.textContent = fmt(state.cash);
  }
  document.getElementById("stat-districts").textContent = playerDistrictIds().length;
  document.getElementById("stat-crew").textContent = state.crew.length;
  document.getElementById("heat-value").textContent = Math.round(state.heat);
  document.getElementById("heat-bar-fill").style.width = state.heat + "%";
  document.getElementById("clock-day").textContent = state.day;
  document.getElementById("clock-time").textContent = fmtTime(state.minutes);

  document.querySelectorAll(".speed-btn").forEach(b => {
    b.classList.toggle("active", parseInt(b.dataset.speed, 10) === state.speed);
  });
}

// ---------------- MAP RENDER ----------------
function districtStatusClass(id) {
  const d = state.districts[id];
  if (d.owner === "player") return "owned";
  if (d.owner && d.owner.startsWith("rival:")) return "rival";
  return "";
}

function renderMap() {
  const svg = document.getElementById("map-svg");
  svg.innerHTML = "";
  const ns = "http://www.w3.org/2000/svg";

  // Bağlantı çizgileri
  const drawn = new Set();
  DISTRICTS.forEach(d => {
    d.neighbors.forEach(nId => {
      const key = [d.id, nId].sort().join("-");
      if (drawn.has(key)) return;
      drawn.add(key);
      const n = districtById(nId);
      if (!n) return;
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", d.x); line.setAttribute("y1", d.y);
      line.setAttribute("x2", n.x); line.setAttribute("y2", n.y);
      line.setAttribute("class", "map-edge");
      svg.appendChild(line);
    });
  });

  // Bölge düğümleri
  DISTRICTS.forEach(d => {
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "district-node");
    g.addEventListener("click", () => openDistrictModal(d.id));

    const statusClass = districtStatusClass(d.id);
    const dObj = state.districts[d.id];
    const rivalGang = dObj.owner && dObj.owner.startsWith("rival:") ? RIVAL_GANGS.find(g => "rival:" + g.id === dObj.owner) : null;

    if (statusClass === "rival") {
      const pulse = document.createElementNS(ns, "circle");
      pulse.setAttribute("cx", d.x); pulse.setAttribute("cy", d.y);
      pulse.setAttribute("class", "district-pulse active");
      if (rivalGang) pulse.style.stroke = rivalGang.color;
      g.appendChild(pulse);
    }

    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", d.x); dot.setAttribute("cy", d.y);
    dot.setAttribute("class", "district-dot " + statusClass + (state.selectedDistrict === d.id ? " selected" : ""));
    if (rivalGang) {
      dot.style.fill = rivalGang.color;
      dot.style.stroke = rivalGang.color;
    }
    g.appendChild(dot);

    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", d.x); label.setAttribute("y", d.y - 3.6);
    label.setAttribute("class", "district-label " + (statusClass === "owned" ? "owned" : ""));
    if (rivalGang) label.style.fill = rivalGang.color;
    label.textContent = d.name;
    g.appendChild(label);

    svg.appendChild(g);
  });

  // Yoldaki araçları rota üzerinde gerçek konumlarına göre çiz (5 taraf, farklı renk)
  state.vehicles.forEach(v => {
    if (v.status !== "transit" || !v.routeNodes) return;
    const pos = vehiclePositionOnRoute(v);
    if (!pos) return;
    const color = vehicleColor(v);
    const vg = document.createElementNS(ns, "g");
    vg.style.cursor = "pointer";
    vg.addEventListener("click", (e) => { e.stopPropagation(); openVehicleModal(v.id); });

    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", pos.x); dot.setAttribute("cy", pos.y);
    dot.setAttribute("r", v.kind === "weapon_smuggle" ? "1.3" : "1.15");
    dot.setAttribute("fill", color);
    dot.setAttribute("stroke", v.kind === "weapon_smuggle" ? "#a5342e" : "#0a0d14");
    dot.setAttribute("stroke-width", v.kind === "weapon_smuggle" ? "0.45" : "0.3");
    vg.appendChild(dot);

    if (v.faction !== "player") {
      const ring = document.createElementNS(ns, "circle");
      ring.setAttribute("cx", pos.x); ring.setAttribute("cy", pos.y);
      ring.setAttribute("r", "1.9");
      ring.setAttribute("fill", "none");
      ring.setAttribute("stroke", color);
      ring.setAttribute("stroke-width", "0.25");
      ring.setAttribute("opacity", "0.5");
      vg.appendChild(ring);
    }

    svg.appendChild(vg);
  });

  // Not: Hideout ayrı bir görsel işaretle gösterilmiyor; rakip çetenin
  // kontrolündeki bölgeler zaten kendi rengiyle boyalı, bu yeterli bir ayrım sağlıyor.

  // Casus istihbarat işaretleri
  state.intelMarkers.forEach(marker => {
    const d = districtById(marker.districtId);
    if (!d) return;
    const g = document.createElementNS(ns, "g");
    g.style.cursor = "pointer";
    g.addEventListener("click", (e) => { e.stopPropagation(); toast("İstihbarat", marker.description, "neutral"); });

    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", d.x + 2.6); dot.setAttribute("cy", d.y - 2.6);
    dot.setAttribute("r", "1.3");
    dot.setAttribute("fill", "#2980b9");
    dot.setAttribute("stroke", "#e8e6df");
    dot.setAttribute("stroke-width", "0.3");
    g.appendChild(dot);
    svg.appendChild(g);
  });
}

function vehicleColor(v) {
  if (v.faction === "player") return "#e6c368";
  if (v.faction === "polis") return POLICE_FACTION.color;
  const gang = RIVAL_GANGS.find(g => g.id === v.faction);
  return gang ? gang.color : "#9098a8";
}

// ---------------- ARAÇ MODALI (KARŞI-OPERASYONLAR) ----------------
function openVehicleModal(vehicleId) {
  const v = state.vehicles.find(x => x.id === vehicleId);
  if (!v) return;
  const backdrop = document.getElementById("district-modal-backdrop");
  const modal = document.getElementById("district-modal");

  if (v.faction === "player") {
    modal.innerHTML = `
      <button class="close-x" id="close-vehicle-modal">×</button>
      <div class="panel-title">Senin Aracın</div>
      <div class="panel-subtitle">${districtById(v.fromId).name} → ${districtById(v.toId).name} rotasında.</div>
    `;
    document.getElementById("close-vehicle-modal").addEventListener("click", closeModal);
    backdrop.classList.add("open");
    return;
  }

  if (v.faction === "polis") {
    modal.innerHTML = `
      <button class="close-x" id="close-vehicle-modal">×</button>
      <div class="panel-title">Polis Devriyesi</div>
      <div class="panel-subtitle">${districtById(v.fromId).name} → ${districtById(v.toId).name} rotasında devriye geziyor. Bu araca müdahale edemezsin.</div>
    `;
    document.getElementById("close-vehicle-modal").addEventListener("click", closeModal);
    backdrop.classList.add("open");
    return;
  }

  const gang = RIVAL_GANGS.find(g => g.id === v.faction);
  const kindLabel = v.kind === "heist_escape" ? "Soygundan Kaçıyor" : "Malzeme Nakliyesi";
  const relevantOps = v.kind === "heist_escape"
    ? [COUNTER_OPS.ambush, COUNTER_OPS.kidnap]
    : [COUNTER_OPS.hijack, COUNTER_OPS.kidnap];

  let html = `
    <button class="close-x" id="close-vehicle-modal">×</button>
    <div class="panel-title">${gang.name}</div>
    <div class="panel-subtitle">${kindLabel} — ${districtById(v.fromId).name} → ${districtById(v.toId).name}</div>
    ${v.kind === "heist_escape" ? `<div class="badge gold" style="margin-bottom:12px;">Tahmini Yük: ${fmt(v.payout || 0)}</div>` : ""}
    <div class="section-label">Karşı Operasyon Başlat</div>
  `;

  relevantOps.forEach(op => {
    html += `
      <div class="card">
        <div class="card-title">${op.name}</div>
        <div class="card-desc">${op.description}</div>
        <button class="btn btn-blood btn-sm btn-full" data-launch-op="${op.name}" data-op-key="${Object.keys(COUNTER_OPS).find(k=>COUNTER_OPS[k]===op)}">Ekip Ata ve Başlat</button>
      </div>
    `;
  });

  modal.innerHTML = html;
  document.getElementById("close-vehicle-modal").addEventListener("click", closeModal);
  modal.querySelectorAll("[data-launch-op]").forEach(btn => {
    btn.addEventListener("click", () => openCounterOpPlanner(v.id, btn.dataset.opKey));
  });

  backdrop.classList.add("open");
}

function openCounterOpPlanner(vehicleId, opKey) {
  const v = state.vehicles.find(x => x.id === vehicleId);
  const op = COUNTER_OPS[opKey];
  if (!v || !op) return;
  const backdrop = document.getElementById("district-modal-backdrop");
  const modal = document.getElementById("district-modal");

  const roleCounts = {};
  op.requiredRoles.forEach(r => { roleCounts[r] = (roleCounts[r]||0)+1; });

  let html = `
    <button class="close-x" id="close-op-modal">×</button>
    <div class="panel-title">${op.name}</div>
    <div class="panel-subtitle">${op.description}</div>
    <div class="section-label">Ekip Ata</div>
    <div id="op-role-slots"></div>
    <div class="section-label">Özet</div>
    <div class="card">
      <div class="card-desc" style="margin-bottom:0;">Bu operasyon gerçek zamanlı bir çatışmayla sonuçlanacak. Ekibinin donanımı ve sayısı savaşın gidişatını belirler.</div>
    </div>
    <button class="btn btn-blood btn-full" id="launch-counter-op" style="margin-top:10px;">Operasyonu Başlat</button>
  `;
  modal.innerHTML = html;

  const slotsEl = document.getElementById("op-role-slots");
  let slotIndex = 0;
  Object.keys(roleCounts).forEach(roleId => {
    for (let i=0; i<roleCounts[roleId]; i++) {
      const roleName = roleSlotLabel(roleId);
      const available = roleSlotAvailableCrew(roleId);
      const div = document.createElement("div");
      div.className = "role-slot";
      div.innerHTML = `${roleName}
        <select data-slot="${slotIndex}" data-role="${roleId}">
          <option value="">— Boş —</option>
          ${available.map(c => `<option value="${c.id}">${c.name} (Sadakat ${Math.round(c.loyalty)})</option>`).join("")}
        </select>`;
      slotsEl.appendChild(div);
      slotIndex++;
    }
  });

  document.getElementById("close-op-modal").addEventListener("click", closeModal);
  document.getElementById("launch-counter-op").addEventListener("click", () => {
    const crewIds = Array.from(slotsEl.querySelectorAll("select")).map(s => s.value).filter(Boolean);
    if (crewIds.length < op.requiredRoles.length) {
      toast("Ekip Eksik", "Tüm rolleri doldurmalısın.", "negative");
      return;
    }
    if (new Set(crewIds).size !== crewIds.length) {
      toast("Aynı Kişi Birden Fazla Role Atanamaz", "Her ekip üyesi sadece bir role atanabilir.", "negative");
      return;
    }
    crewIds.forEach(cid => {
      const c = state.crew.find(x => x.id === cid);
      c.assignedTo = "counterop:" + vehicleId;
    });

    // Operasyon süresi, hedefin kalan yolculuk süresini AŞMAMALI - yoksa araç zaten
    // ulaşmış olur ve operasyon her zaman sessizce "hedef kayboldu" ile başarısız olur.
    const targetVehicle = state.vehicles.find(v => v.id === vehicleId);
    const remainingTravelMin = targetVehicle ? Math.max(1, targetVehicle.arrivesAtMin - nowAbsoluteMin()) : 6;
    const opDuration = Math.min(6, Math.max(1, remainingTravelMin - 1)); // hedeften en az 1 dk önce yetişsin

    state.activeCounterOps.push({
      type: opKey, targetVehicleId: vehicleId, crewIds,
      finishesAtMin: nowAbsoluteMin() + opDuration,
    });
    toast("Operasyon Başladı", `${op.name} için ekip yola çıktı.`, "neutral");
    closeModal();
    render();
  });

  backdrop.classList.add("open");
}

function resolveCounterOp(op) {
  const v = state.vehicles.find(x => x.id === op.targetVehicleId);
  const opDef = COUNTER_OPS[op.type];

  // Hedef araç hâlâ yolda değilse (zaten vardıysa) operasyon boşa gider
  if (!v || v.status !== "transit") {
    op.crewIds.forEach(cid => { const c = state.crew.find(x => x.id === cid); if (c) c.assignedTo = null; });
    toast("Hedef Kayboldu", `${opDef.name} için hedef zaten hedefine ulaşmış.`, "negative");
    return;
  }

  const gang = RIVAL_GANGS.find(g => g.id === v.faction);
  const opCrew = op.crewIds.map(cid => state.crew.find(c => c.id === cid)).filter(Boolean);
  const playerCrew = opCrew.slice(0, 6).map(c => {
    const weapon = cbDetermineCrewWeapon(c);
    return {
      gameCharacterId: c.id, name: c.name, weapon,
      magAmmo: CB_WEAPONS[weapon].magSize, spareMags: 1,
      armorQuality: cbDetermineCrewArmor(c), attributes: c.attributes || null,
      consumables: {},
    };
  });

  if (playerCrew.length === 0) {
    op.crewIds.forEach(cid => { const c = state.crew.find(x => x.id === cid); if (c) c.assignedTo = null; });
    toast("Operasyon Başarısız", `${opDef.name} için ekip bulunamadı.`, "negative");
    render();
    return;
  }

  const escortWeapons = ["tabanca_low", "makineli_low"];
  const enemyRoster = escortWeapons.map((weapon, i) => ({
    name: `${gang ? gang.name.split(" ")[0] : "Muhafız"} ${i + 1}`,
    weapon, magAmmo: CB_WEAPONS[weapon].magSize, spareMags: 1,
    personality: "agresif",
    armorQuality: null,
  }));

  state.speedBeforeCombat = state.speed;
  state.speed = 0;
  document.getElementById("cb-embedded-overlay").classList.add("active");
  cbInitEmbedded({
    mapType: "vehicleambush",
    playerCrew,
    enemyRoster,
    ambushInitiator: "player",
    onComplete: (result) => {
      op.crewIds.forEach(cid => { const c = state.crew.find(x => x.id === cid); if (c) c.assignedTo = null; });
      applyCombatResultToGame(result,
        () => {
          v.status = "intercepted";
          if (op.type === "ambush" && v.kind === "heist_escape") {
            const stolen = Math.round((v.payout || 0) * (0.7 + Math.random() * 0.3));
            state.cash += stolen;
            toast("Kaçış Aracı Durduruldu!", `${gang.name}'ın soygun parasından ${fmt(stolen)} çaldın.`, "positive");
          } else if (op.type === "hijack" && v.kind === "shipment") {
            state.materialStock[v.material] = (state.materialStock[v.material] || 0) + v.amount;
            toast("Nakliye Soyuldu!", `${gang.name}'dan ${v.amount} birim malzeme çaldın.`, "positive");
          } else if (op.type === "kidnap") {
            state.gangRelations[v.faction].hostility = Math.min(100, state.gangRelations[v.faction].hostility + 15);
            const econ = state.gangEconomy[v.faction];
            if (econ) econ.cash = Math.max(0, econ.cash - 5000);
            toast("Operasyon Başarılı", `${gang.name}'ın adamları etkisiz hale getirildi.`, "positive");
          }
          state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 10 * (state.modifiers.heatGainMult || 1));
        },
        () => {
          state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 15 * (state.modifiers.heatGainMult || 1));
          state.gangRelations[v.faction].hostility = Math.min(100, state.gangRelations[v.faction].hostility + 10);
          toast("Operasyon Başarısız", `${opDef.name} çöktü.`, "negative");
        }
      );
    },
  });
}

// Bir aracın rota üzerindeki mevcut konumunu (viewBox koordinatı) hesaplar
function vehiclePositionOnRoute(v) {
  if (!v.routeNodes || v.routeNodes.length < 2) return null;
  const totalTime = v.totalTravelMin || 1;
  const elapsed = state.minutes - v.departedAtMin;
  const progress = Math.max(0, Math.min(1, elapsed / totalTime));

  // Rota üzerindeki toplam mesafeyi düğüm segmentlerine göre dağıt
  const pts = v.routeNodes.map(idx => ROAD_NODES[idx]);
  let segLengths = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i][0]-pts[i+1][0], pts[i][1]-pts[i+1][1]);
    segLengths.push(d);
    total += d;
  }
  if (total === 0) return { x: pts[0][0], y: pts[0][1] };

  let target = progress * total;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    if (acc + segLengths[i] >= target) {
      const segProgress = (target - acc) / (segLengths[i] || 1);
      const x = pts[i][0] + (pts[i+1][0] - pts[i][0]) * segProgress;
      const y = pts[i][1] + (pts[i+1][1] - pts[i][1]) * segProgress;
      return { x, y };
    }
    acc += segLengths[i];
  }
  return { x: pts[pts.length-1][0], y: pts[pts.length-1][1] };
}

// ---------------- TAB: BÖLGE (seçili bölge detayı / genel liste) ----------------
function renderDistrictTab() {
  const el = document.getElementById("panel-content");
  const id = state.selectedDistrict;

  if (!id) {
    el.innerHTML = `
      <div class="panel-title">Bölgeler</div>
      <div class="panel-subtitle">Haritadan bir semt seç, detaylarını buradan yönet.</div>
      <div class="section-label">Kontrolündeki Bölgeler</div>
      ${playerDistrictIds().length === 0 ? '<div class="empty-state">Henüz bölgen yok.</div>' :
        playerDistrictIds().map(did => districtMiniCard(did)).join("")}
      <div class="section-label">Rakip Bölgeler</div>
      ${DISTRICTS.filter(d => state.districts[d.id].owner && state.districts[d.id].owner.startsWith("rival:"))
        .map(d => districtMiniCard(d.id)).join("")}
    `;
    el.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => {
      state.selectedDistrict = b.dataset.goto; render();
    }));
    return;
  }

  const d = districtById(id);
  const dObj = state.districts[id];
  const isPlayer = dObj.owner === "player";
  const rivalGang = dObj.owner && dObj.owner.startsWith("rival:") ? RIVAL_GANGS.find(g => "rival:" + g.id === dObj.owner) : null;

  let html = `
    <button class="btn btn-outline btn-sm" id="back-to-list" style="margin-bottom:14px;">← Tüm Bölgeler</button>
    <div class="panel-title">${d.name}</div>
    <div class="panel-subtitle">${d.description}</div>
    <div style="display:flex; gap:6px; margin-bottom:16px;">
      <span class="badge">Zenginlik ${d.wealth}/5</span>
      <span class="badge">Isı Direnci ${d.heatResistance}/5</span>
      ${isPlayer ? '<span class="badge gold">Senin Bölgen</span>' : ''}
      ${rivalGang ? `<span class="badge blood">${rivalGang.name}</span>` : ''}
    </div>
  `;

  if (!dObj.owner) {
    const price = districtPrice(d);
    html += `
      <div class="card">
        <div class="card-title">Bölgeyi Ele Geçir</div>
        <div class="card-desc">Bu bölge kimsenin kontrolünde değil. Satın alarak imparatorluğuna kat.</div>
        <div class="card-row">
          <span class="card-stat gold">Maliyet: <span class="num">${fmt(price)}</span></span>
          <button class="btn btn-gold" id="buy-district" ${state.cash < price ? "disabled" : ""}>Satın Al</button>
        </div>
      </div>
    `;
  } else if (rivalGang) {
    const relation = state.gangRelations[rivalGang.id];
    html += `
      <div class="card">
        <div class="card-title">${rivalGang.name} Kontrolünde</div>
        <div class="card-desc">Bu bölgeyi almak için saldırman gerekiyor. Ekibinin gücü, rakip çetenin gücünü aşmalı. Başarısız saldırılar ısını ciddi artırır.</div>
        <div class="card-stat blood">Çete Gücü: <span class="num">${rivalGang.strength}</span> · Düşmanlık: <span class="num">${relation.hostility}</span></div>
        <button class="btn btn-blood btn-full" id="attack-district" style="margin-top:10px;">Bölgeye Saldır</button>
      </div>
    `;
  } else if (isPlayer) {
    html += `<div class="section-label">Laboratuvar</div>`;
    if (dObj.lab) {
      const lvl = LAB_LEVELS.find(l => l.level === dObj.lab.level);
      const next = LAB_LEVELS.find(l => l.level === dObj.lab.level + 1);
      html += `
        <div class="card">
          <div class="card-title">Laboratuvar — Seviye ${lvl.level}</div>
          <div class="card-desc">Parti süresi: ${lvl.batchTimeMin} dk · Kapasite: ${lvl.capacity} parti/döngü</div>
          ${next ? `<div class="card-row"><span class="card-stat gold">Yükselt: <span class="num">${fmt(next.cost)}</span></span><button class="btn btn-outline btn-sm" id="upgrade-lab" ${state.cash < next.cost ? "disabled" : ""}>Seviye ${next.level}</button></div>` : `<div class="card-stat">Maksimum seviye.</div>`}
        </div>
      `;
    } else {
      html += `
        <div class="card">
          <div class="card-title">Laboratuvar Kur</div>
          <div class="card-desc">Hammaddeyi işlenmiş ürüne çevirir. Üretim sekmesinden yönetilir.</div>
          <div class="card-row">
            <span class="card-stat gold">Maliyet: <span class="num">${fmt(LAB_LEVELS[0].cost)}</span></span>
            <button class="btn btn-gold btn-sm" id="build-lab" ${state.cash < LAB_LEVELS[0].cost ? "disabled" : ""}>Kur</button>
          </div>
        </div>
      `;
    }

    html += `<div class="section-label">Hammadde Üretim Tesisi</div>`;
    if (dObj.refinery) {
      html += `<div class="card"><div class="card-title">Üretim Tesisi Aktif</div><div class="card-desc">Saatte ${RAW_MATERIAL_PRODUCTION_PER_HOUR} birim rastgele hammadde üretiyor. Nakliye ile laboratuvara taşınmalı.</div></div>`;
    } else {
      html += `
        <div class="card">
          <div class="card-title">Tesis Kur</div>
          <div class="card-desc">Bu semtte hammadde üretimi başlat. Üretilen malzeme laboratuvara nakledilmelidir.</div>
          <div class="card-row">
            <span class="card-stat gold">Maliyet: <span class="num">${fmt(REFINERY_SITE_COST)}</span></span>
            <button class="btn btn-gold btn-sm" id="build-refinery" ${state.cash < REFINERY_SITE_COST ? "disabled" : ""}>Kur</button>
          </div>
        </div>
      `;
    }

    html += `<div class="section-label">İşletmeler</div>`;
    if (dObj.businesses.length === 0) {
      html += `<div class="empty-state">Bu bölgede henüz işletmen yok.</div>`;
    } else {
      dObj.businesses.forEach(b => {
        const type = BUSINESS_TYPES.find(t => t.id === b.typeId);
        html += `
          <div class="card">
            <div class="card-title">${type.name}</div>
            <div class="card-stat gold">Saatlik Gelir: <span class="num">${fmt(type.baseIncomePerHour)}</span></div>
            <div class="card-stat blood">Isı: <span class="num">+${type.heatPerHour}/sa</span></div>
          </div>
        `;
      });
    }
    html += `<div class="section-label">Yeni İşletme Kur</div>`;
    BUSINESS_TYPES.filter(t => !dObj.businesses.some(b => b.typeId === t.id)).forEach(t => {
      html += `
        <div class="card">
          <div class="card-title">${t.name}</div>
          <div class="card-desc">${t.description}</div>
          <div class="card-row">
            <span class="card-stat gold">Maliyet: <span class="num">${fmt(t.baseCost)}</span></span>
            <button class="btn btn-gold btn-sm" data-build-biz="${t.id}" ${state.cash < t.baseCost ? "disabled" : ""}>Kur</button>
          </div>
        </div>
      `;
    });
  }

  el.innerHTML = html;

  const back = document.getElementById("back-to-list");
  if (back) back.addEventListener("click", () => { state.selectedDistrict = null; render(); });

  const buyBtn = document.getElementById("buy-district");
  if (buyBtn) buyBtn.addEventListener("click", () => buyDistrict(id));

  const attackBtn = document.getElementById("attack-district");
  if (attackBtn) attackBtn.addEventListener("click", () => attackDistrict(id));

  el.querySelectorAll("[data-build-biz]").forEach(b => b.addEventListener("click", () => buildBusiness(id, b.dataset.buildBiz)));

  const refBtn = document.getElementById("build-refinery");
  if (refBtn) refBtn.addEventListener("click", () => buildRefinery(id));

  const labBtn = document.getElementById("build-lab");
  if (labBtn) labBtn.addEventListener("click", () => buildLab(id));

  const upgradeBtn = document.getElementById("upgrade-lab");
  if (upgradeBtn) upgradeBtn.addEventListener("click", () => upgradeLab(id));
}

function districtMiniCard(id) {
  const d = districtById(id);
  const dObj = state.districts[id];
  const rival = dObj.owner && dObj.owner.startsWith("rival:") ? RIVAL_GANGS.find(g => "rival:" + g.id === dObj.owner) : null;
  return `
    <div class="card" data-goto="${id}" style="cursor:pointer;">
      <div class="card-row">
        <span class="card-title">${d.name}</span>
        ${rival ? `<span class="badge blood">${rival.name}</span>` : '<span class="badge gold">Kontrol</span>'}
      </div>
      <div class="card-desc" style="margin-bottom:0;">${d.description}</div>
    </div>
  `;
}

// ---------------- ACTIONS: DISTRICT ----------------
function districtPrice(d) {
  return Math.round(d.basePrice * (state.modifiers.districtCostMult || 1));
}

function buyDistrict(id) {
  const d = districtById(id);
  const price = districtPrice(d);
  if (state.cash < price) return;
  state.cash -= price;
  state.districts[id].owner = "player";
  toast("Bölge Ele Geçirildi", `${d.name} artık senin kontrolünde.`, "positive");
  render();
}

// ============================================================
// COMBAT KÖPRÜSÜ (Ana Oyun ↔ Gömülü Combat Sistemi)
// ============================================================

// Ana oyundaki bir ekip üyesinin silah type'ını combat'ın weapon id'sine çevirir.
// Ana oyunda 3 segment (low/mid/high) var, combat şimdilik sadece _low kullanıyor.
function cbMapWeaponIdToCombat(weaponType) {
  const validTypes = ["tabanca", "pompali", "makineli", "tufek"];
  const t = validTypes.includes(weaponType) ? weaponType : "tabanca";
  return t + "_low";
}

// Bir crew üyesinin kullanacağı silahı belirler: önce kendi atanmış silahına
// (loadout ekranından seçilmiş - segment + spesifik kopya) bakar, yoksa rolüne
// göre varsayılan _low segmentine düşer.
function cbDetermineCrewWeapon(crewMember) {
  if (crewMember.assignedWeaponId && crewMember.assignedWeaponInstanceId) {
    const list = state.armory.weapons[crewMember.assignedWeaponId];
    const entry = list && list.find(x => x.id === crewMember.assignedWeaponInstanceId);
    if (entry && entry.durability > 0) return crewMember.assignedWeaponId;
  }
  if (crewMember.role === "asker_nisanci") return "tufek_low";
  if (crewMember.role === "asker_agir_silahli") return "makineli_low";
  if (crewMember.role === "asker_devriye") return "tabanca_low";
  return "tabanca_low"; // savaşamayan roller de (sürücü vb.) tabanca ile temsil edilir
}

// Ana oyunun zırh id'lerini (yelek_hafif/orta/agir), combat'ın kalite sistemine
// (hurdalik/standart/kaliteli/mukemmel) eşler.
const CB_ARMOR_ID_MAP = {
  yelek_hafif: "standart",
  yelek_orta: "kaliteli",
  yelek_agir: "mukemmel",
};

// Bir crew üyesinin kullanacağı zırhı belirler: kendi atanmış zırhı varsa (kırık
// değil) onu kullanır, yoksa zırhsız kalır.
function cbDetermineCrewArmor(crewMember) {
  if (crewMember.assignedArmorId && crewMember.assignedArmorInstanceId) {
    const list = state.armory.armors[crewMember.assignedArmorId];
    const entry = list && list.find(x => x.id === crewMember.assignedArmorInstanceId);
    if (entry && entry.durability > 0) return CB_ARMOR_ID_MAP[crewMember.assignedArmorId] || null;
  }
  return null;
}

// Ana oyunun crew listesinden, combat'ın beklediği playerCrew formatını üretir.
// Sadece COMBAT_CAPABLE_ROLES içindeki (ve göreve atanmamış) üyeler alınır, en fazla 4 kişi.
function buildCombatPlayerCrew() {
  const available = state.crew.filter(c => COMBAT_CAPABLE_ROLES.includes(c.role) && !c.assignedTo);
  const selected = available.slice(0, 6);
  return selected.map(c => {
    const weapon = cbDetermineCrewWeapon(c);
    return {
      gameCharacterId: c.id,
      name: c.name,
      weapon,
      magAmmo: CB_WEAPONS[weapon].magSize,
      spareMags: 1,
      armorQuality: cbDetermineCrewArmor(c),
      attributes: c.attributes || null,
      consumables: {},
    };
  });
}

// Bir rakip çete için, gücüne (strength) göre 4 kişilik bir düşman roster'ı üretir.
function buildCombatEnemyRoster(gang) {
  const weapons = ["tabanca_low", "tabanca_low", "makineli_low", "pompali_low"];
  const personalities = { agresif: "agresif", sinsi: "sinsi", savunmaci: "savunmaci" };
  const gangPersonality = personalities[gang.personality] || "agresif";
  return weapons.map((weapon, i) => ({
    name: `${gang.name.split(" ")[0]} ${i + 1}`,
    weapon,
    magAmmo: CB_WEAPONS[weapon].magSize,
    spareMags: 1,
    personality: gangPersonality,
    armorQuality: gang.strength > 6 ? "standart" : null,
    sourceGangId: gang.id,
  }));
}

// Combat sonucunu (cbBuildCombatResult formatı) ana oyunun state'ine uygular:
// yaralanan/ölen crew üyelerini işler, kazandıysa çağırana bildirir.
function applyCombatResultToGame(result, onWin, onLose) {
  result.playerUnits.forEach(pu => {
    const crewMember = state.crew.find(c => c.id === pu.gameCharacterId);
    if (!crewMember) return;
    if (pu.status === "dead") {
      state.crew = state.crew.filter(c => c.id !== pu.gameCharacterId);
      toast("Kayıp", `${pu.name} operasyonda hayatını kaybetti.`, "negative");
    } else if (pu.status === "down" || pu.hp < 100) {
      crewMember.injured = true;
      crewMember.injuryHealAtMin = nowAbsoluteMin() + (3 * 24 * 60); // basitleştirilmiş: 3 gün iyileşme
      toast("Yaralanma", `${pu.name} yaralandı, iyileşmesi zaman alacak.`, "negative");
    }

    // Silah/zırh yıpranması: savaşa katılmak silahı biraz, hasar almak zırhı daha çok yıpratır.
    if (crewMember.assignedWeaponId && crewMember.assignedWeaponInstanceId) {
      const list = state.armory.weapons[crewMember.assignedWeaponId];
      const wEntry = list && list.find(x => x.id === crewMember.assignedWeaponInstanceId);
      if (wEntry) wEntry.durability = Math.max(0, wEntry.durability - (4 + Math.random() * 4)); // ~%4-8 aşınma
    }
    if (crewMember.assignedArmorId && crewMember.assignedArmorInstanceId) {
      const list = state.armory.armors[crewMember.assignedArmorId];
      const aEntry = list && list.find(x => x.id === crewMember.assignedArmorInstanceId);
      if (aEntry) {
        const tookDamage = pu.hp < 100;
        const wear = tookDamage ? 8 + Math.random() * 10 : 2 + Math.random() * 3; // hasar aldıysa çok, almadıysa az
        aEntry.durability = Math.max(0, aEntry.durability - wear);
      }
    }
  });

  document.getElementById("cb-embedded-overlay").classList.remove("active");

  // Combat açılırken duraklatılan oyun zamanı, kaydedilen önceki hıza geri döner.
  // Kaydedilmiş bir hız yoksa (beklenmedik durum) güvenli varsayılan olarak 1x kullanılır.
  state.speed = state.speedBeforeCombat !== undefined ? state.speedBeforeCombat : 1;
  state.speedBeforeCombat = undefined;

  if (result.won) { if (onWin) onWin(result); }
  else { if (onLose) onLose(result); }
  render();
}

// Bölge Saldırısı için combat'ı başlatır. Kazanma/kaybetme sonrası orijinal
// attackDistrict mantığının geri kalanını (bölge sahipliği, ısı, ilişki) uygular.
function launchDistrictCombat(id) {
  const d = districtById(id);
  const dObj = state.districts[id];
  const gangId = dObj.owner.split(":")[1];
  const gang = RIVAL_GANGS.find(g => g.id === gangId);

  const playerCrew = buildCombatPlayerCrew();
  if (playerCrew.length === 0) {
    toast("Yetersiz Ekip", "Saldırı için en az bir savaşçın olmalı.", "negative");
    return;
  }
  const enemyRoster = buildCombatEnemyRoster(gang);

  // Combat'a giden ekip üyeleri, savaş süresince başka bir operasyona seçilemesin diye işaretlenir.
  playerCrew.forEach(pc => {
    const c = state.crew.find(x => x.id === pc.gameCharacterId);
    if (c) c.assignedTo = "attack:" + id;
  });

  state.speedBeforeCombat = state.speed;
  state.speed = 0;
  document.getElementById("cb-embedded-overlay").classList.add("active");
  cbInitEmbedded({
    mapType: "alley",
    playerCrew,
    enemyRoster,
    ambushInitiator: "player",
    onComplete: (result) => {
      playerCrew.forEach(pc => {
        const c = state.crew.find(x => x.id === pc.gameCharacterId);
        if (c) c.assignedTo = null;
      });
      applyCombatResultToGame(result,
        () => {
          dObj.owner = "player";
          state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 12 * (state.modifiers.heatGainMult || 1));
          toast("Saldırı Başarılı!", `${d.name} artık senin. ${gang.name} geri çekildi.`, "positive");
        },
        () => {
          state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 20 * (state.modifiers.heatGainMult || 1));
          state.gangRelations[gangId].hostility = Math.min(100, state.gangRelations[gangId].hostility + 20 * (state.modifiers.hostilityGainMult || 1));
          toast("Saldırı Başarısız", `${d.name} alınamadı. ${gang.name} misilleme yapabilir.`, "negative");
        }
      );
    },
  });
}

function attackDistrict(id) {
  launchDistrictCombat(id);
}

function buildBusiness(districtId, typeId) {
  const t = BUSINESS_TYPES.find(b => b.id === typeId);
  if (state.cash < t.baseCost) return;
  state.cash -= t.baseCost;
  state.districts[districtId].businesses.push({ typeId });
  toast("İşletme Kuruldu", `${t.name} artık ${districtById(districtId).name}'de faaliyette.`, "positive");
  render();
}

function buildRefinery(districtId) {
  if (state.cash < REFINERY_SITE_COST) return;
  state.cash -= REFINERY_SITE_COST;
  state.districts[districtId].refinery = true;
  toast("Üretim Tesisi Kuruldu", `${districtById(districtId).name}'de hammadde üretimi başladı.`, "positive");
  render();
}

function buildLab(districtId) {
  const cost = LAB_LEVELS[0].cost;
  if (state.cash < cost) return;
  state.cash -= cost;
  state.districts[districtId].lab = { level: 1 };
  toast("Laboratuvar Kuruldu", `${districtById(districtId).name}'de üretim başlayabilir.`, "positive");
  render();
}

function upgradeLab(districtId) {
  const lab = state.districts[districtId].lab;
  const next = LAB_LEVELS.find(l => l.level === lab.level + 1);
  if (!next || state.cash < next.cost) return;
  state.cash -= next.cost;
  lab.level = next.level;
  toast("Laboratuvar Yükseltildi", `Artık seviye ${next.level}.`, "positive");
  render();
}

// ---------------- TAB: ÜRETİM (drugs) ----------------
function renderDrugsTab() {
  const el = document.getElementById("panel-content");
  const labDistricts = playerDistrictIds().filter(id => state.districts[id].lab);
  const refineryDistricts = playerDistrictIds().filter(id => state.districts[id].refinery);

  let html = `
    <div class="panel-title">Üretim Zinciri</div>
    <div class="panel-subtitle">Hammadde → Nakliye → Laboratuvar → Dağıtım. Malzemeyi tesislerden laboratuvarlara taşı, işlensin, sokakta sat.</div>

    <div class="section-label">Depo</div>
    <div class="card">
      ${RAW_MATERIALS.map(m => `<div class="card-row"><span class="card-stat">${m.name}</span><span class="card-stat"><span class="num">${state.materialStock[m.id]}</span> birim</span></div>`).join("")}
    </div>
    <div class="card">
      ${DRUG_PRODUCTS.map(p => `<div class="card-row"><span class="card-stat">${p.name}</span><span class="card-stat gold"><span class="num">${state.drugStock[p.id]}</span> birim</span></div>`).join("")}
    </div>

    <div class="section-label">Nakliye — Yeni Sevkiyat</div>
  `;

  if (refineryDistricts.length === 0 || labDistricts.length === 0) {
    html += `<div class="empty-state">Nakliye başlatmak için en az bir üretim tesisin ve bir laboratuvarın olmalı.</div>`;
  } else {
    html += `
      <div class="card">
        <div style="margin-bottom:8px;">
          <label class="card-stat">Kaynak (Tesis)</label>
          <select id="ship-from">${refineryDistricts.map(id => `<option value="${id}">${districtById(id).name}</option>`).join("")}</select>
        </div>
        <div style="margin-bottom:8px;">
          <label class="card-stat">Hedef (Laboratuvar)</label>
          <select id="ship-to">${labDistricts.map(id => `<option value="${id}">${districtById(id).name}</option>`).join("")}</select>
        </div>
        <div style="margin-bottom:8px;">
          <label class="card-stat">Araç</label>
          <select id="ship-vehicle">${VEHICLES.map(v => `<option value="${v.id}">${v.name} (Kapasite ${v.capacity}, ${fmt(v.cost)})</option>`).join("")}</select>
        </div>
        <button class="btn btn-gold btn-full" id="dispatch-shipment">Sevkiyatı Başlat</button>
      </div>
    `;
  }

  html += `<div class="section-label">Yoldaki Sevkiyatlar</div>`;
  const activeShipments = state.vehicles.filter(v => v.status === "transit" && v.faction === "player" && v.kind === "shipment");
  if (activeShipments.length === 0) {
    html += `<div class="empty-state">Şu an yolda sevkiyat yok.</div>`;
  } else {
    activeShipments.forEach(v => {
      const remaining = Math.max(0, v.arrivesAtMin - nowAbsoluteMin());
      const totalTime = v.totalTravelMin || 1;
      const pct = Math.min(100, 100 - (remaining / totalTime) * 100);
      const vehicleDef = VEHICLES.find(x => x.id === v.type);
      html += `
        <div class="card">
          <div class="card-title">${vehicleDef ? vehicleDef.name : "Nakliye"}</div>
          <div class="card-desc">${districtById(v.fromId).name} → ${districtById(v.toId).name}</div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="card-stat">Kalan: <span class="num">${remaining} dk</span></div>
        </div>
      `;
    });
  }

  html += `<div class="section-label">Üretim Başlat (Laboratuvar)</div>`;
  if (labDistricts.length === 0) {
    html += `<div class="empty-state">Laboratuvarın yok.</div>`;
  } else {
    labDistricts.forEach(id => {
      const lab = state.districts[id].lab;
      const activeBatch = lab.activeBatch;
      html += `<div class="card"><div class="card-title">${districtById(id).name} — Seviye ${lab.level}</div>`;
      const hasAssignedProducer = state.crew.some(c => c.role === "uretici" && c.assignedTo === "lab:" + id);
      if (activeBatch) {
        const remaining = Math.max(0, activeBatch.finishesAtMin - nowAbsoluteMin());
        const pct = Math.min(100, 100 - (remaining / activeBatch.totalMin) * 100);
        html += `
          <div class="card-desc">${DRUG_PRODUCTS.find(p => p.id === activeBatch.productId).name} üretiliyor...${activeBatch.auto ? " (otomatik)" : ""}</div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="card-stat">Kalan: <span class="num">${remaining} dk</span></div>
        `;
      } else if (hasAssignedProducer) {
        html += `<div class="card-desc">Bu laboratuvarda atanmış bir üretici var — üretim, Ekip sekmesinden seçtiğin ürüne göre otomatik devam edecek.</div>`;
      } else {
        html += `
          <div style="margin-bottom:8px;">
            <select id="produce-select-${id}">
              ${DRUG_PRODUCTS.map(p => `<option value="${p.id}">${p.name} (${p.requires.map(r => RAW_MATERIALS.find(m => m.id === r.material).name + " x" + r.amount).join(", ")})</option>`).join("")}
            </select>
          </div>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <span class="card-stat">Parti Sayısı:</span>
            <input type="number" id="produce-batch-${id}" value="1" min="1" max="20" style="width:60px;">
          </div>
          <div class="card-desc" id="produce-batch-hint-${id}" style="margin-bottom:8px;"></div>
          <button class="btn btn-gold btn-sm btn-full" data-produce="${id}">Üretimi Başlat (Mini-Oyun)</button>
        `;
      }
      html += `</div>`;
    });
  }

  html += `<div class="section-label">Sokak Satışı</div>`;
  html += `<div class="card">`;
  DRUG_PRODUCTS.forEach(p => {
    const pendingSale = state.activeStreetSales.find(s => s.productId === p.id);
    if (pendingSale) {
      const remaining = Math.max(0, pendingSale.finishesAtMin - nowAbsoluteMin());
      html += `
        <div class="card-row">
          <span class="card-stat">${p.name} × <span class="num">${pendingSale.amount}</span> — ilan verildi</span>
          <span class="card-stat gold">Kalan: <span class="num">${remaining} dk</span></span>
        </div>
      `;
    } else {
      html += `
        <div class="card-row">
          <span class="card-stat">${p.name} × <span class="num">${state.drugStock[p.id]}</span></span>
          <button class="btn btn-outline btn-sm" data-sell="${p.id}" ${state.drugStock[p.id] === 0 ? "disabled" : ""}>İlan Ver (${fmt(p.streetPrice)}/birim, ~3sa)</button>
        </div>
      `;
    }
  });
  html += `</div>`;

  el.innerHTML = html;

  const dispatchBtn = document.getElementById("dispatch-shipment");
  if (dispatchBtn) dispatchBtn.addEventListener("click", dispatchShipment);

  el.querySelectorAll("[data-produce]").forEach(b => b.addEventListener("click", () => {
    const districtId = b.dataset.produce;
    const select = document.getElementById("produce-select-" + districtId);
    const batchInput = document.getElementById("produce-batch-" + districtId);
    const batchCount = Math.max(1, parseInt(batchInput.value, 10) || 1);
    startProduction(districtId, select.value, batchCount);
  }));

  // Ürün ya da parti sayısı değiştikçe, o kadar hammadde ile kaç parti üretilebileceğini göster
  playerDistrictIds().forEach(id => {
    const lab = state.districts[id].lab;
    if (!lab || lab.activeBatch) return;
    const select = document.getElementById("produce-select-" + id);
    const batchInput = document.getElementById("produce-batch-" + id);
    const hint = document.getElementById("produce-batch-hint-" + id);
    if (!select || !batchInput || !hint) return;

    const updateHint = () => {
      const product = DRUG_PRODUCTS.find(p => p.id === select.value);
      const lvl = LAB_LEVELS.find(l => l.level === lab.level);
      const maxAffordable = Math.min(...product.requires.map(req =>
        Math.floor(state.materialStock[req.material] / (req.amount * lvl.capacity))
      ));
      hint.textContent = `Elindeki hammaddeyle en fazla ${Math.max(0, maxAffordable)} parti üretebilirsin.`;
    };
    select.addEventListener("change", updateHint);
    batchInput.addEventListener("input", updateHint);
    updateHint();
  });

  el.querySelectorAll("[data-sell]").forEach(b => b.addEventListener("click", () => sellDrug(b.dataset.sell)));
}

function dispatchShipment() {
  const fromId = document.getElementById("ship-from").value;
  const toId = document.getElementById("ship-to").value;
  const vehicleType = document.getElementById("ship-vehicle").value;
  const vehicleDef = VEHICLES.find(v => v.id === vehicleType);

  // Önce filoda uygun (available, aynı türde) bir araç var mı bak
  const garageVehicle = state.garage.find(v => v.vehicleTypeId === vehicleType && v.status === "available" && v.durability > 0);

  if (!garageVehicle && state.cash < vehicleDef.cost) {
    toast("Araç Yok", "Filonda uygun araç yok ve satın almak için yeterli paran yok.", "negative");
    return;
  }

  const startNode = districtRoadNode(fromId);
  const endNode = districtRoadNode(toId);
  const route = findRoute(startNode, endNode);
  if (!route) { toast("Rota Bulunamadı", "Bu iki bölge arasında yol tespit edilemedi.", "negative"); return; }

  let usedGarageId = null;
  if (garageVehicle) {
    garageVehicle.status = "on_mission";
    usedGarageId = garageVehicle.id;
  } else {
    // Filoda yoksa, satıcıdan geçici (tek seferlik) araç satın al - eski davranış
    state.cash -= vehicleDef.cost;
  }

  const material = RAW_MATERIALS[Math.floor(Math.random() * RAW_MATERIALS.length)];
  const travelTime = routeTravelMinutes(route.totalDist, 1) * vehicleDef.riskModifier;

  state.vehicles.push({
    id: uid(), type: vehicleType, status: "transit", faction: "player", kind: "shipment",
    fromId, toId, material: material.id, amount: vehicleDef.capacity,
    routeNodes: route.nodeIndices,
    departedAtMin: state.minutes,
    arrivesAtMin: nowAbsoluteMin() + travelTime, totalTravelMin: travelTime,
    garageVehicleId: usedGarageId,
  });
  toast("Sevkiyat Yola Çıktı", `${vehicleDef.name} ${districtById(fromId).name}'den ${districtById(toId).name}'e hareket etti.`, "neutral");
  render();
}

// Bir laboratuvara üretici atanınca (ya da atanmış üreticinin ürünü değiştiğinde)
// çağrılır: hangi ürünün sürekli/otomatik üretileceğini belirler. gameTick bu
// ayarı kullanarak, batch bitince otomatik olarak yenisini başlatır.
function setAutoProduction(districtId, productId) {
  const lab = state.districts[districtId].lab;
  lab.autoProductionId = productId || null;
  render();
}

// Bir laboratuvarda, hammadde yeterliyse otomatik bir üretim partisi başlatır
// (üretici atanmış laboratuvarlar için gameTick tarafından çağrılır). Manuel
// mini-oyun akışından farklı olarak sessizce başarısız olabilir (hammadde
// yetmezse bir sonraki tik'te tekrar denenir, spam toast önlenir).
function tryAutoStartProduction(districtId) {
  const lab = state.districts[districtId].lab;
  if (!lab || !lab.autoProductionId || lab.activeBatch) return;
  const producer = state.crew.find(c => c.role === "uretici" && c.assignedTo === "lab:" + districtId);
  if (!producer) return;

  const product = DRUG_PRODUCTS.find(p => p.id === lab.autoProductionId);
  const lvl = LAB_LEVELS.find(l => l.level === lab.level);

  // Elindeki hammaddeyle üretilebilecek maksimum parti sayısını hesapla (güvenli üst sınır: 20)
  const maxAffordable = Math.min(20, ...product.requires.map(req =>
    Math.floor(state.materialStock[req.material] / (req.amount * lvl.capacity))
  ));
  if (maxAffordable <= 0) return; // hammadde yetersiz, sessizce bekle
  const batchCount = maxAffordable;

  product.requires.forEach(req => { state.materialStock[req.material] -= req.amount * lvl.capacity * batchCount; });

  // Toplu üretim süresi: ilk parti tam süre, her ek parti yarı süre alır
  const totalMin = Math.round(lvl.batchTimeMin * (1 + (batchCount - 1) * 0.5));
  const qualityFactor = 0.85 + (producer.loyalty / 100) * 0.3; // sadakate göre %85-115 verim
  lab.activeBatch = {
    productId: product.id, totalMin, batchCount,
    finishesAtMin: nowAbsoluteMin() + totalMin,
    yieldAmount: Math.round(product.yieldPerBatch * lvl.capacity * batchCount * qualityFactor),
    auto: true,
  };
}

// Manuel üretim başlatma: sadece laboratuvarda ATANMIŞ bir üretici YOKSA kullanılabilir
// (mini-oyun akışı). Üreticili laboratuvarlar artık setAutoProduction ile yönetilir.
function startProduction(districtId, productId, batchCount) {
  const lab = state.districts[districtId].lab;
  if (lab.activeBatch) {
    toast("Üretim Zaten Sürüyor", "Bu laboratuvarda hâlâ devam eden bir üretim var, önce onun bitmesini bekle.", "negative");
    return;
  }
  if (state.activeProductionMinigame && state.activeProductionMinigame.districtId === districtId) {
    toast("Üretim Zaten Başlıyor", "Bu laboratuvar için zaten bir üretim süreci devam ediyor.", "negative");
    return;
  }
  batchCount = Math.max(1, Math.min(20, batchCount || 1)); // güvenlik sınırı: input'tan gelen değer ne olursa olsun 20'yi aşamaz
  const product = DRUG_PRODUCTS.find(p => p.id === productId);
  const lvl = LAB_LEVELS.find(l => l.level === lab.level);

  for (const req of product.requires) {
    if (state.materialStock[req.material] < req.amount * lvl.capacity * batchCount) {
      toast("Yetersiz Hammadde", `${RAW_MATERIALS.find(m => m.id === req.material).name} stoğun yeterli değil.`, "negative");
      return;
    }
  }
  product.requires.forEach(req => { state.materialStock[req.material] -= req.amount * lvl.capacity * batchCount; });

  // Toplu üretim süresi: ilk parti tam süre, her ek parti yarı süre alır
  // (örn. 30dk temel süre, 3 parti = 30 + 15 + 15 = 60dk)
  const totalMin = Math.round(lvl.batchTimeMin * (1 + (batchCount - 1) * 0.5));

  // Mini-oyun akışı (sadece üreticisiz laboratuvarlar için)
  openProductionMinigame(districtId, productId, lvl, batchCount);
}

// Manuel "Sokak Satışı": artık anlık değil, bir ilan oluşturup 3 saat sonra
// gerçekleşen bir süreç. Bu süre boyunca stok "rezerve" edilmiş sayılır (tekrar
// satışa çıkarılamaz), satış tamamlanınca gelir hesaba geçer.
const STREET_SALE_DURATION_MIN = 3 * 60;

function sellDrug(productId) {
  const product = DRUG_PRODUCTS.find(p => p.id === productId);
  const amount = state.drugStock[productId];
  if (amount === 0) return;
  if (state.activeStreetSales.some(s => s.productId === productId)) {
    toast("İlan Zaten Açık", `${product.name} için zaten bekleyen bir satış ilanın var.`, "negative");
    return;
  }
  state.drugStock[productId] = 0;
  state.activeStreetSales.push({
    productId, amount,
    finishesAtMin: nowAbsoluteMin() + STREET_SALE_DURATION_MIN,
  });
  toast("İlan Çıkarıldı", `${amount} birim ${product.name} için satış ilanı verildi. ~3 saat sürecek.`, "neutral");
  render();
}

function resolveStreetSale(sale) {
  const product = DRUG_PRODUCTS.find(p => p.id === sale.productId);
  const revenue = sale.amount * product.streetPrice;
  state.cash += revenue;
  state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + product.riskPerBatch * 2);
  trackDailyIncome(revenue, 0);
  toast("Satış Tamamlandı", `${sale.amount} birim ${product.name} satıldı: ${fmt(revenue)}`, "positive");
}

// ---------------- TAB: SOYGUN ----------------
function renderHeistTab() {
  const el = document.getElementById("panel-content");
  let html = `
    <div class="panel-title">Soygunlar</div>
    <div class="panel-subtitle">Ekip ata, ekipman seç, zamanlamayı planla. Başarısızlık ısını ciddi artırır.</div>
    <div class="section-label">Devam Eden Operasyonlar</div>
  `;

  if (state.activeHeists.length === 0) {
    html += `<div class="empty-state">Aktif soygun yok.</div>`;
  } else {
    state.activeHeists.forEach(h => {
      const target = HEIST_TARGETS.find(t => t.id === h.targetId);
      const remaining = Math.max(0, h.finishesAtMin - nowAbsoluteMin());
      const pct = Math.min(100, 100 - (remaining / h.totalPrepMin) * 100);
      html += `
        <div class="card">
          <div class="card-title">${target.name}</div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="card-stat">Kalan: <span class="num">${remaining} dk</span> — süre dolunca çatışma başlayacak</div>
        </div>
      `;
    });
  }

  html += `<div class="section-label">Yeni Hedef Planla</div>`;
  HEIST_TARGETS.forEach(t => {
    html += `
      <div class="card">
        <div class="card-title">${t.name}</div>
        <div class="card-desc">${t.description}</div>
        <div class="card-stat gold">Ödül: <span class="num">${fmt(t.payout[0])} - ${fmt(t.payout[1])}</span></div>
        <button class="btn btn-outline btn-sm btn-full" style="margin-top:8px;" data-plan="${t.id}">Planla</button>
      </div>
    `;
  });

  el.innerHTML = html;
  el.querySelectorAll("[data-plan]").forEach(b => b.addEventListener("click", () => openHeistPlanner(b.dataset.plan)));
}

function openHeistPlanner(targetId) {
  const target = HEIST_TARGETS.find(t => t.id === targetId);
  const backdrop = document.getElementById("district-modal-backdrop");
  const modal = document.getElementById("district-modal");

  const roleCounts = {};
  target.requiredRoles.forEach(r => { roleCounts[r] = (roleCounts[r] || 0) + 1; });

  let html = `
    <button class="close-x" id="close-heist-modal">×</button>
    <div class="panel-title">${target.name}</div>
    <div class="panel-subtitle">${target.description}</div>
    <div class="section-label">Ekip Ata</div>
    <div id="heist-role-slots"></div>
    <div class="section-label">Ekipman</div>
    ${target.equipmentOptions.map(eq => `
      <label class="role-slot" style="cursor:pointer;">
        <input type="checkbox" data-eq="${eq.id}" style="margin-right:6px;">
        ${eq.name} — ${fmt(eq.cost)} (${eq.description})
      </label>
    `).join("")}
    <div class="section-label">Özet</div>
    <div class="card">
      <div class="card-desc" style="margin-bottom:0;">Bu operasyon gerçek zamanlı bir çatışmayla sonuçlanacak. Seçtiğin ekipmanlar savaş sırasında somut avantajlar sağlar.</div>
      <div class="card-stat gold">Hazırlık Süresi: <span class="num">${target.prepTimeMin} dk</span></div>
    </div>
    <button class="btn btn-blood btn-full" id="launch-heist" style="margin-top:10px;">Operasyonu Başlat</button>
  `;
  modal.innerHTML = html;

  const slotsEl = document.getElementById("heist-role-slots");
  let slotIndex = 0;
  Object.keys(roleCounts).forEach(roleId => {
    for (let i = 0; i < roleCounts[roleId]; i++) {
      const roleName = roleSlotLabel(roleId);
      const available = roleSlotAvailableCrew(roleId);
      const div = document.createElement("div");
      div.className = "role-slot";
      div.innerHTML = `${roleName}
        <select data-slot="${slotIndex}" data-role="${roleId}">
          <option value="">— Boş —</option>
          ${available.map(c => `<option value="${c.id}">${c.name} (Sadakat ${c.loyalty})</option>`).join("")}
        </select>`;
      slotsEl.appendChild(div);
      slotIndex++;
    }
  });

  document.getElementById("close-heist-modal").addEventListener("click", closeModal);

  document.getElementById("launch-heist").addEventListener("click", () => {
    const crewIds = Array.from(slotsEl.querySelectorAll("select")).map(s => s.value).filter(Boolean);
    if (crewIds.length < target.requiredRoles.length) {
      toast("Ekip Eksik", "Tüm rolleri doldurmalısın.", "negative");
      return;
    }
    if (new Set(crewIds).size !== crewIds.length) {
      toast("Aynı Kişi Birden Fazla Role Atanamaz", "Her ekip üyesi sadece bir role atanabilir.", "negative");
      return;
    }
    const equipmentIds = Array.from(modal.querySelectorAll("[data-eq]:checked")).map(c => c.dataset.eq);
    const equipmentCost = equipmentIds.reduce((sum, id) => sum + target.equipmentOptions.find(e => e.id === id).cost, 0);
    if (state.cash < equipmentCost) {
      toast("Yetersiz Bakiye", "Ekipman için yeterli paran yok.", "negative");
      return;
    }
    state.cash -= equipmentCost;
    crewIds.forEach(cid => {
      const crewMember = state.crew.find(c => c.id === cid);
      crewMember.assignedTo = "heist:" + target.id;
    });

    // guardCount hesabı için kaba bir zorluk göstergesi olarak baseSuccess kullanılmaya devam eder
    // (gerçek "başarı şansı" artık yok, bu sadece düşman sayısını belirlemede yardımcı bir değer)
    state.activeHeists.push({
      targetId: target.id, crewIds, equipmentIds,
      finishesAtMin: nowAbsoluteMin() + target.prepTimeMin,
      totalPrepMin: target.prepTimeMin,
      successChance: target.baseSuccess,
    });
    toast("Operasyon Planlandı", `${target.name} için hazırlıklar başladı.`, "neutral");
    closeModal();
    render();
  });

  backdrop.classList.add("open");
}

function closeModal() {
  document.getElementById("district-modal-backdrop").classList.remove("open");
}

function resolveHeist(heist) {
  const target = HEIST_TARGETS.find(t => t.id === heist.targetId);

  const heistCrew = heist.crewIds.map(cid => state.crew.find(c => c.id === cid)).filter(Boolean);
  const playerCrew = heistCrew.slice(0, 6).map(c => {
    const weapon = cbDetermineCrewWeapon(c);
    return {
      gameCharacterId: c.id, name: c.name, weapon,
      magAmmo: CB_WEAPONS[weapon].magSize, spareMags: 1,
      armorQuality: cbDetermineCrewArmor(c), attributes: c.attributes || null,
      consumables: {},
    };
  });

  if (playerCrew.length === 0) {
    // Ekip kalmadıysa (hepsi başka yere atanmış/kovulmuş) otomatik başarısız say
    heist.crewIds.forEach(cid => { const c = state.crew.find(x => x.id === cid); if (c) c.assignedTo = null; });
    state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + target.heatOnFail);
    toast("Soygun Başarısız!", `${target.name} için ekip bulunamadı.`, "negative");
    render();
    return;
  }

  // Hedefin güvenlik gücüne göre (baseSuccess'in tersine orantılı) bir "güvenlik" roster'ı üret
  const guardCount = Math.max(2, Math.min(4, Math.round((100 - heist.successChance) / 20)));
  const guardWeapons = ["tabanca_low", "tabanca_low", "makineli_low", "pompali_low"];
  const enemyRoster = Array.from({ length: guardCount }, (_, i) => ({
    name: `Güvenlik ${i + 1}`,
    weapon: guardWeapons[i % guardWeapons.length],
    magAmmo: CB_WEAPONS[guardWeapons[i % guardWeapons.length]].magSize,
    spareMags: 1,
    personality: "savunmaci",
    armorQuality: target.difficulty >= 2 ? "standart" : null,
  }));

  const heistMapTypes = ["kuyumcu", "banka_subesi", "ozel_sergi"];
  const heistMapType = heistMapTypes.includes(target.id) ? target.id : "hideout"; // henüz özel şablonu olmayan hedefler için
  const isRealHeistMap = heistMapTypes.includes(target.id);

  // Zorluk seviyesini hedefin difficulty alanından (1-4) heist-difficulty'e çeviriyoruz
  const heistDifficulty = target.difficulty <= 1 ? "kolay" : target.difficulty <= 3 ? "orta" : "zor";
  const totalHaul = Math.round(target.payout[0] + Math.random() * (target.payout[1] - target.payout[0]));

  // Seçilen ekipmanların combat'a aktarılacak somut etkilerini topluyoruz
  const equipmentEffects = { policeDelayBonus: 0, vaultSpeedBonus: 0, armorPierceBonus: 0, policeWaveSizeMod: 0 };
  (heist.equipmentIds || []).forEach(eqId => {
    const eq = target.equipmentOptions.find(e => e.id === eqId);
    if (!eq) return;
    if (eq.effect === "police_delay") equipmentEffects.policeDelayBonus += eq.effectValue;
    if (eq.effect === "vault_speed") equipmentEffects.vaultSpeedBonus += eq.effectValue;
    if (eq.effect === "armor_pierce") equipmentEffects.armorPierceBonus += eq.effectValue;
    if (eq.effect === "police_wave_size") equipmentEffects.policeWaveSizeMod += eq.effectValue;
  });

  state.speedBeforeCombat = state.speed;
  state.speed = 0; // hazırlanan operasyon vakti geldi, oyun zamanı duraklar
  document.getElementById("cb-embedded-overlay").classList.add("active");
  cbInitEmbedded({
    mapType: heistMapType,
    playerCrew,
    enemyRoster,
    ambushInitiator: "player",
    heistConfig: isRealHeistMap ? {
      difficulty: heistDifficulty,
      totalHaul,
      equipmentEffects,
    } : null,
    onComplete: (result) => {
      heist.crewIds.forEach(cid => { const c = state.crew.find(x => x.id === cid); if (c) c.assignedTo = null; });
      applyCombatResultToGame(result,
        () => {
          const extracted = result.heistExtractedTotal || 0;
          state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + target.heatOnSuccess);
          triggerExtractionAmbushCheck(extracted, target, () => {
            if (extracted > 0) {
              toast("Soygun Başarılı!", `${target.name}: ${fmt(extracted)} güvenli bölgeye ulaştırdın.`, "positive");
            } else {
              toast("Soygun Yarım Kaldı", `${target.name}: Düşmanlar temizlendi ama ganimet çıkarılamadı.`, "negative");
            }
          });
        },
        () => {
          state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + target.heatOnFail);
          toast("Soygun Başarısız!", `${target.name} çöktü. Isı ciddi arttı.`, "negative");
        }
      );
    },
  });
}

// Heist başarıyla tamamlandıktan sonra, ekip hideout'a dönerken rakip çete ya da
// polis tarafından pusuya düşürülme ihtimalini kontrol eder. Isı seviyesi arttıkça
// bu ihtimal yükselir. Tetiklenirse gerçek bir Araç Pusu combat'ı açılır; oyuncu bu
// ikinci savaşı kaybederse taşınan paranın bir kısmı kaybedilir.
function triggerExtractionAmbushCheck(extractedAmount, target, onSafeArrival) {
  // Taban %15 ihtimal, ısı arttıkça yükselir (ısı 100'de +%25 ekstra, toplam %40'a kadar)
  const ambushChance = 15 + (state.heat / 100) * 25;
  const triggered = Math.random() * 100 < ambushChance;

  if (!triggered || extractedAmount <= 0) {
    // Pusu yok, ya da zaten taşınan para yoksa risk edilecek bir şey yok - direkt eve varır
    state.cash += extractedAmount;
    onSafeArrival();
    render();
    return;
  }

  toast("Dönüş Yolunda Tehlike", "Hideout'a dönerken pusu kurulmuş olabilir!", "negative");

  // Dönüş yolu için kaba bir düşman roster'ı (kim pusu kurduğu belirsiz - genel "sokak" tehdidi)
  const ambushWeapons = ["tabanca_low", "tabanca_low", "makineli_low"];
  const enemyRoster = ambushWeapons.map((weapon, i) => ({
    name: `Sokak Çetesi ${i + 1}`,
    weapon, magAmmo: CB_WEAPONS[weapon].magSize, spareMags: 1,
    personality: "agresif", armorQuality: null,
  }));

  // Extraction'ı başaran ekip üyelerinden (ölmemiş/bayılmamış olanlardan) devam
  // eden karakterleri alıyoruz - bu bilgi zaten crew listesinde mevcut.
  const survivingCrew = state.crew.filter(c => !c.assignedTo).slice(0, 6);
  const playerCrew = survivingCrew.map(c => {
    const weapon = cbDetermineCrewWeapon(c);
    return {
      gameCharacterId: c.id, name: c.name, weapon,
      magAmmo: CB_WEAPONS[weapon].magSize, spareMags: 1,
      armorQuality: cbDetermineCrewArmor(c), attributes: c.attributes || null,
      consumables: {},
    };
  });

  if (playerCrew.length === 0) {
    // Ekip zaten yoksa (hepsi düşmüş) pusu anlamsız, direkt sonuçlan
    state.cash += extractedAmount;
    onSafeArrival();
    render();
    return;
  }

  document.getElementById("cb-embedded-overlay").classList.add("active");
  cbInitEmbedded({
    mapType: "vehicleambush",
    playerCrew,
    enemyRoster,
    ambushInitiator: "enemy", // dönüş yolunda pusuya DÜŞÜLÜYOR, initiator düşman
    onComplete: (result) => {
      applyCombatResultToGame(result,
        () => {
          state.cash += extractedAmount;
          toast("Pusu Atlatıldı!", `${fmt(extractedAmount)} güvenle hideout'a ulaştı.`, "positive");
          onSafeArrival();
        },
        () => {
          // Pusu kaybedildi: taşınan paranın yarısı yolda kaybedilir
          const lost = Math.round(extractedAmount * 0.5);
          const salvaged = extractedAmount - lost;
          state.cash += salvaged;
          toast("Pusuda Kayıp!", `${fmt(lost)} pusu sırasında kayboldu, ${fmt(salvaged)} kurtarılabildi.`, "negative");
        }
      );
    },
  });
}

// ---------------- TAB: SİLAHLAR (Satıcı + Karaborsa) ----------------
function renderArmoryTab() {
  const el = document.getElementById("panel-content");
  let html = `
    <div class="panel-title">Silahlar</div>
    <div class="panel-subtitle">Satıcıdan güvenli ama pahalı al, ya da karaborsa ilanlarını kaçakçılıkla ucuza getirt.</div>

    <div class="section-label">Envanterin</div>
    <div class="card">
  `;
  const ownedWeapons = WEAPONS.filter(w => state.armory.weapons[w.id] && state.armory.weapons[w.id].length > 0);
  const ownedArmors = ARMORS.filter(a => state.armory.armors[a.id] && state.armory.armors[a.id].length > 0);
  const ownedConsumables = CONSUMABLES.filter(c => state.armory.consumables[c.id] > 0);
  if (ownedWeapons.length === 0 && ownedArmors.length === 0 && ownedConsumables.length === 0) {
    html += `<div class="card-desc" style="margin-bottom:0;">Henüz hiç silah/zırh/malzemen yok.</div>`;
  } else {
    ownedWeapons.forEach(w => {
      state.armory.weapons[w.id].forEach((entry, i) => {
        const dur = entry.durability;
        const durColor = dur < 30 ? "blood" : dur < 70 ? "" : "gold";
        html += `
          <div class="card-row">
            <span class="card-stat">${w.name} #${i + 1}</span>
            <span class="card-stat ${durColor}">Dayanıklılık: <span class="num">%${Math.round(dur)}</span></span>
            ${dur < 100 ? `<button class="btn btn-outline btn-sm" data-repair="weapons:${w.id}:${entry.id}">Tamir Et (${fmt(cbRepairCost(w.priceShop, dur))})</button>` : ""}
          </div>`;
      });
    });
    ownedArmors.forEach(a => {
      state.armory.armors[a.id].forEach((entry, i) => {
        const dur = entry.durability;
        const durColor = dur < 30 ? "blood" : dur < 70 ? "" : "gold";
        html += `
          <div class="card-row">
            <span class="card-stat">${a.name} #${i + 1}</span>
            <span class="card-stat ${durColor}">Dayanıklılık: <span class="num">%${Math.round(dur)}</span></span>
            ${dur < 100 ? `<button class="btn btn-outline btn-sm" data-repair="armors:${a.id}:${entry.id}">Tamir Et (${fmt(cbRepairCost(a.priceShop, dur))})</button>` : ""}
          </div>`;
      });
    });
    ownedConsumables.forEach(c => { html += `<div class="card-row"><span class="card-stat">${c.name}</span><span class="card-stat gold"><span class="num">${state.armory.consumables[c.id]}</span> adet</span></div>`; });
  }
  html += `</div>`;

  html += `<div class="section-label">Silah Satıcısı — Her Zaman Açık</div>`;
  html += renderShopCategory("Silahlar", WEAPONS, "weapons");
  html += renderShopCategory("Zırhlar", ARMORS, "armors");
  html += renderShopCategory("Sarf Malzemeleri", CONSUMABLES, "consumables");

  html += `<div class="section-label">Karaborsa İlanları</div>`;
  if (state.blackMarketListings.length === 0) {
    html += `<div class="empty-state">Şu an aktif ilan yok. Piyasa değişkendir, tekrar kontrol et.</div>`;
  } else {
    state.blackMarketListings.forEach(listing => {
      const item = findArmoryItem(listing.itemType, listing.itemId);
      const remaining = Math.max(0, listing.expiresAtMin - nowAbsoluteMin());
      html += `
        <div class="card">
          <div class="card-row">
            <span class="card-title">${item.name}</span>
            <span class="badge blood">${remaining} dk kaldı</span>
          </div>
          <div class="card-desc">Kaynak: ${listing.sourceLabel}</div>
          <div class="card-row">
            <span class="card-stat gold">Fiyat: <span class="num">${fmt(listing.price)}</span> (${listing.amount} adet)</span>
            <button class="btn btn-blood btn-sm" data-smuggle="${listing.id}" ${state.cash < listing.price ? "disabled" : ""}>Kaçakçılıkla Getirt</button>
          </div>
        </div>
      `;
    });
  }

  el.innerHTML = html;

  el.querySelectorAll("[data-buy-shop]").forEach(b => b.addEventListener("click", () => {
    const [category, itemId] = b.dataset.buyShop.split("|");
    buyFromShop(category, itemId);
  }));
  el.querySelectorAll("[data-repair]").forEach(b => b.addEventListener("click", () => {
    const [category, itemId, instanceId] = b.dataset.repair.split(":");
    repairArmoryItem(category, itemId, instanceId);
  }));
  el.querySelectorAll("[data-smuggle]").forEach(b => b.addEventListener("click", () => smuggleListing(b.dataset.smuggle)));
}

function renderShopCategory(title, items, category) {
  let html = `<div class="card"><div class="card-title" style="margin-bottom:8px;">${title}</div>`;
  items.forEach(item => {
    const isAmmoLike = category === "consumables";
    const ownedCount = !isAmmoLike && state.armory[category][item.id] ? state.armory[category][item.id].length : 0;
    html += `
      <div class="card-row">
        <span class="card-stat">${item.name}${ownedCount > 0 ? ` <span class="card-stat gold">(${ownedCount} adet)</span>` : ""}</span>
        <span style="display:flex; align-items:center; gap:8px;">
          <span class="card-stat gold"><span class="num">${fmt(item.priceShop)}</span></span>
          <button class="btn btn-outline btn-sm" data-buy-shop="${category}|${item.id}" ${state.cash < item.priceShop ? "disabled" : ""}>Satın Al</button>
        </span>
      </div>
    `;
  });
  html += `</div>`;
  return html;
}

// "asker_any" özel rol id'si, herhangi bir asker alt-tipini (nişancı/ağır silahlı/
// devriye) temsil eder - operasyon planlayıcılarında tip zorunluluğu olmadan
// asker atanabilmesini sağlar. Bu fonksiyon slot etiketini ve uygun ekip listesini üretir.
function roleSlotLabel(roleId) {
  if (roleId === "asker_any") return "Asker (herhangi)";
  return CREW_ROLES[roleId] ? CREW_ROLES[roleId].name : roleId;
}

function roleSlotAvailableCrew(roleId) {
  if (roleId === "asker_any") {
    return state.crew.filter(c => COMBAT_CAPABLE_ROLES.includes(c.role) && c.role !== "surucu" && !c.assignedTo);
  }
  return state.crew.filter(c => c.role === roleId && !c.assignedTo);
}

function findArmoryItem(itemType, itemId) {
  if (itemType === "weapons") return WEAPONS.find(w => w.id === itemId);
  if (itemType === "armors") return ARMORS.find(a => a.id === itemId);
  if (itemType === "consumables") return CONSUMABLES.find(c => c.id === itemId);
  return null;
}

// Tamir maliyeti: kayıp dayanıklılık oranına göre, item'ın orijinal fiyatının bir kısmı.
// %0 dayanıklılık (tam kırık) tamir etmek, orijinal fiyatın %60'ı kadar tutar.
function cbRepairCost(originalPrice, currentDurability) {
  const missingRatio = (100 - currentDurability) / 100;
  return Math.round(originalPrice * missingRatio * 0.6);
}

// itemInstanceId: envanterdeki spesifik silah/zırh kopyasının kendi id'si (segment id'si değil)
function repairArmoryItem(category, itemId, itemInstanceId) {
  const item = findArmoryItem(category, itemId);
  const list = state.armory[category][itemId];
  const entry = list && list.find(x => x.id === itemInstanceId);
  if (!item || !entry || entry.durability >= 100) return;
  const cost = cbRepairCost(item.priceShop, entry.durability);
  if (state.cash < cost) { toast("Yetersiz Bakiye", "Tamir için yeterli paran yok.", "negative"); return; }
  state.cash -= cost;
  entry.durability = 100;
  toast("Tamir Edildi", `${item.name} tam dayanıklılığa kavuştu.`, "positive");
  render();
}

function buyFromShop(category, itemId) {
  const item = findArmoryItem(category, itemId);
  if (!item || state.cash < item.priceShop) return;
  state.cash -= item.priceShop;
  if (category === "consumables") {
    state.armory[category][itemId] = (state.armory[category][itemId] || 0) + 1;
  } else {
    // weapons/armors: her satın alma, kendi kimliği olan yeni bir envanter kalemi ekler
    state.armory[category][itemId].push({ id: uid(), durability: 100 });
  }
  toast("Satın Alındı", `${item.name} envanterine eklendi.`, "positive");
  render();
}

function smuggleListing(listingId) {
  const listing = state.blackMarketListings.find(l => l.id === listingId);
  if (!listing || state.cash < listing.price) return;
  const item = findArmoryItem(listing.itemType, listing.itemId);

  // Kaçakçılık kaynağı olarak rastgele bir "tedarik semti" seç (liman/sanayi temalı), hideout'a doğru taşı
  const sourceCandidates = ["bakirkoy", "zeytinburnu", "halic"];
  const fromId = sourceCandidates[Math.floor(Math.random() * sourceCandidates.length)];
  const toId = playerDistrictIds()[0] || "tarlabasi";
  const startNode = districtRoadNode(fromId);
  const endNode = districtRoadNode(toId);
  const route = findRoute(startNode, endNode);
  if (!route) { toast("Rota Yok", "Bu sevkiyat için uygun yol bulunamadı.", "negative"); return; }

  state.cash -= listing.price;
  const travelTime = routeTravelMinutes(route.totalDist, 1);

  // Filoda uygun (available) araç varsa onu kullan - mimlenme/hasar riski gerçek olsun
  const garageVehicle = state.garage.find(v => v.status === "available" && v.durability > 0);
  if (garageVehicle) garageVehicle.status = "on_mission";

  state.vehicles.push({
    id: uid(), faction: "player", kind: "weapon_smuggle", status: "transit",
    fromId, toId,
    itemType: listing.itemType, itemId: listing.itemId, amount: listing.amount,
    routeNodes: route.nodeIndices,
    departedAtMin: state.minutes,
    arrivesAtMin: nowAbsoluteMin() + travelTime, totalTravelMin: travelTime,
    garageVehicleId: garageVehicle ? garageVehicle.id : null,
  });

  state.blackMarketListings = state.blackMarketListings.filter(l => l.id !== listingId);
  toast("Kaçakçılık Başladı", `${item.name} yola çıktı. Yol üstünde durdurulma riski var.`, "neutral");
  render();
}

// Karaborsa ilan üretimi (periyodik olarak gameTick'ten çağrılır)
const BLACK_MARKET_SOURCES = ["Kartallar'dan sızan bir parti", "Gölge Örgütü'nden bir bağlantı", "Demir Yumruk'un fazla stoğu", "İsimsiz bir tedarikçi", "Liman işçilerinden bir ihbar"];

function maybeSpawnBlackMarketListing() {
  if (state.blackMarketListings.length >= 4) return;
  if (Math.random() > 0.06) return;

  const pool = [
    ...WEAPONS.map(w => ({ type: "weapons", item: w })),
    ...ARMORS.map(a => ({ type: "armors", item: a })),
    ...CONSUMABLES.map(c => ({ type: "consumables", item: c })),
  ];
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const discount = 0.55 + Math.random() * 0.2; // %55-75 fiyatına
  const amount = pick.type === "consumables" ? 2 + Math.floor(Math.random()*3) : 1;

  state.blackMarketListings.push({
    id: uid(),
    itemType: pick.type, itemId: pick.item.id,
    price: Math.round(pick.item.priceSmuggle * discount),
    sourceLabel: BLACK_MARKET_SOURCES[Math.floor(Math.random() * BLACK_MARKET_SOURCES.length)],
    expiresAtMin: nowAbsoluteMin() + 45 + Math.floor(Math.random() * 60),
    amount,
  });
}

// ---------------- TAB: GARAJ (Kalıcı Araç Filosu) ----------------
function renderGarageTab() {
  const el = document.getElementById("panel-content");
  let html = `
    <div class="panel-title">Garaj</div>
    <div class="panel-subtitle">Araçlarını satın alıp filona kat. Operasyonlarda (nakliye, kaçakçılık, mahkum taşıma) buradan atarsın.</div>
    <div class="section-label">Filon (${state.garage.length})</div>
  `;

  if (state.garage.length === 0) {
    html += `<div class="empty-state">Henüz hiç aracın yok.</div>`;
  } else {
    state.garage.forEach(v => {
      const def = VEHICLES.find(x => x.id === v.vehicleTypeId);
      const durabilityPct = Math.round((v.durability / def.maxDurability) * 100);
      const statusLabel = v.status === "available" ? "Hazır" : "Görevde";
      const repairCost = Math.round((def.maxDurability - v.durability) * (def.cost / def.maxDurability) * 0.5);
      const sellPrice = Math.round(def.cost * (v.flagged ? 0.06 : 0.3)); // mimlenmişse satış bedeli %80 düşer (0.3 -> 0.06)
      const platePrice = Math.round(def.cost * 0.08);
      html += `
        <div class="card">
          <div class="card-row">
            <span class="card-title">${def.name}</span>
            <span class="badge ${v.status === 'available' ? 'gold' : 'blood'}">${statusLabel}</span>
          </div>
          <div class="card-stat">Plaka: <span class="num">${v.plate}</span> ${v.flagged ? '<span class="badge blood">Mimlenmiş</span>' : ''}</div>
          <div class="card-stat">Yük Kapasitesi: <span class="num">${def.capacity}</span> · Yolcu: <span class="num">${def.passengerCapacity}</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${durabilityPct}%; background:${durabilityPct < 40 ? 'var(--blood)' : 'var(--gold)'};"></div></div>
          <div class="card-stat">Dayanıklılık: <span class="num">${v.durability}/${def.maxDurability}</span></div>
          ${v.durability < def.maxDurability ? `
            <button class="btn btn-outline btn-sm btn-full" style="margin-top:8px;" data-repair="${v.id}" ${state.cash < repairCost ? "disabled" : ""}>Onar (${fmt(repairCost)})</button>
          ` : ''}
          ${v.durability <= 0 ? `<div class="card-stat blood">Bu araç kullanılamaz durumda, onarılmalı.</div>` : ''}
          ${v.flagged ? `
            <button class="btn btn-outline btn-sm btn-full" style="margin-top:6px;" data-replate="${v.id}" ${state.cash < platePrice ? "disabled" : ""}>Plaka Değiştir (${fmt(platePrice)})</button>
          ` : ''}
          <button class="btn btn-outline btn-sm btn-full" style="margin-top:6px;" data-sell-vehicle="${v.id}">Sat (${fmt(sellPrice)})</button>
        </div>
      `;
    });
  }

  html += `<div class="section-label">Satıcıdan Yeni Araç Al</div>`;
  VEHICLES.forEach(def => {
    html += `
      <div class="card">
        <div class="card-title">${def.name}</div>
        <div class="card-stat">Yük: <span class="num">${def.capacity}</span> · Yolcu: <span class="num">${def.passengerCapacity}</span> · Dayanıklılık: <span class="num">${def.maxDurability}</span></div>
        <div class="card-row">
          <span class="card-stat gold">Fiyat: <span class="num">${fmt(def.cost)}</span></span>
          <button class="btn btn-gold btn-sm" data-buy-vehicle="${def.id}" ${state.cash < def.cost ? "disabled" : ""}>Satın Al</button>
        </div>
      </div>
    `;
  });

  el.innerHTML = html;
  el.querySelectorAll("[data-buy-vehicle]").forEach(b => b.addEventListener("click", () => buyVehicleForGarage(b.dataset.buyVehicle)));
  el.querySelectorAll("[data-repair]").forEach(b => b.addEventListener("click", () => repairVehicle(b.dataset.repair)));
  el.querySelectorAll("[data-sell-vehicle]").forEach(b => b.addEventListener("click", () => sellVehicleFromGarage(b.dataset.sellVehicle)));
  el.querySelectorAll("[data-replate]").forEach(b => b.addEventListener("click", () => replateVehicle(b.dataset.replate)));
}

function buyVehicleForGarage(vehicleTypeId) {
  const def = VEHICLES.find(v => v.id === vehicleTypeId);
  if (!def || state.cash < def.cost) return;
  state.cash -= def.cost;
  state.garage.push({
    id: uid(), vehicleTypeId, durability: def.maxDurability,
    status: "available", currentDistrictId: playerDistrictIds()[0] || "tarlabasi",
    plate: generatePlate(), flagged: false,
  });
  toast("Araç Satın Alındı", `${def.name} filona eklendi.`, "positive");
  render();
}

function repairVehicle(garageId) {
  const v = state.garage.find(x => x.id === garageId);
  if (!v) return;
  const def = VEHICLES.find(x => x.id === v.vehicleTypeId);
  const repairCost = Math.round((def.maxDurability - v.durability) * (def.cost / def.maxDurability) * 0.5);
  if (state.cash < repairCost) return;
  state.cash -= repairCost;
  v.durability = def.maxDurability;
  toast("Araç Onarıldı", `${def.name} tam kapasiteye getirildi.`, "positive");
  render();
}

function sellVehicleFromGarage(garageId) {
  const v = state.garage.find(x => x.id === garageId);
  if (!v) return;
  const def = VEHICLES.find(x => x.id === v.vehicleTypeId);
  const sellPrice = Math.round(def.cost * (v.flagged ? 0.06 : 0.3));
  state.cash += sellPrice;
  state.garage = state.garage.filter(x => x.id !== garageId);
  toast("Araç Satıldı", `${def.name} filondan çıkarıldı (${fmt(sellPrice)}).`, "neutral");
  render();
}

function replateVehicle(garageId) {
  const v = state.garage.find(x => x.id === garageId);
  if (!v || !v.flagged) return;
  const def = VEHICLES.find(x => x.id === v.vehicleTypeId);
  const cost = Math.round(def.cost * 0.08);
  if (state.cash < cost) return;
  state.cash -= cost;
  v.plate = generatePlate();
  v.flagged = false;
  v.replatedRecently = true; // yakalanma riski normalin biraz üstünde kalır (geçici temkinli dönem)
  toast("Plaka Değiştirildi", `${def.name} artık yeni plaka (${v.plate}) ile kayıtlı.`, "positive");
  render();
}

// Filodan uygun (available, yeterli kapasiteli) bir araç bulur - operasyon başlatma
// fonksiyonlarının (nakliye, kaçakçılık, mahkum taşıma) kullanması için yardımcı fonksiyon.
function findAvailableVehicleForCargo(minCapacity) {
  return state.garage.find(v => {
    if (v.status !== "available") return false;
    if (v.durability <= 0) return false;
    const def = VEHICLES.find(x => x.id === v.vehicleTypeId);
    return def.capacity >= (minCapacity || 0);
  });
}

function findAvailableVehicleForPassengers(minPassengers) {
  return state.garage.find(v => {
    if (v.status !== "available") return false;
    if (v.durability <= 0) return false;
    const def = VEHICLES.find(x => x.id === v.vehicleTypeId);
    return def.passengerCapacity >= (minPassengers || 1);
  });
}

// ---------------- TAB: EKİP ----------------
function renderCrewTab() {
  const el = document.getElementById("panel-content");
  let html = `
    <div class="panel-title">Ekip</div>
    <div class="panel-subtitle">Adamlarını yönet, yeni eleman işe al. Maaşlar her saat başı otomatik kesilir.</div>
    <div class="section-label">Mevcut Ekip (${state.crew.length})</div>
  `;

  if (state.crew.length === 0) {
    html += `<div class="empty-state">Henüz kimseyi işe almadın.</div>`;
  } else {
    state.crew.forEach(c => {
      const role = CREW_ROLES[c.role];
      const assignment = state.neighborhoodAssignments[c.id];
      html += `
        <div class="card">
          <div class="card-row">
            <span class="card-title">${c.name}</span>
            ${c.assignedTo ? '<span class="badge blood">Görevde</span>' : '<span class="badge gold">Hazır</span>'}
          </div>
          <div class="card-stat">${role.name} · Sadakat: <span class="num">${Math.round(c.loyalty)}</span> · Maaş: <span class="num">${fmt(c.wage)}/sa</span></div>
      `;

      if (c.attributes) {
        const topAttrs = Object.entries(c.attributes)
          .sort((a, b) => b[1] - a[1]).slice(0, 3)
          .sort((a, b) => ATTRIBUTES[a[0]].name.localeCompare(ATTRIBUTES[b[0]].name, "tr"));
        html += `<div class="card-stat gold">${topAttrs.map(([key, val]) => `${ATTRIBUTES[key].name}: ${val}`).join(" · ")}</div>`;
        html += `<button class="btn btn-outline btn-sm" style="margin-top:6px;" data-show-attrs="${c.id}">Tüm Özellikler</button>`;
      }

      if (c.role === "satici") {
        if (assignment) {
          html += `<div class="card-stat gold">Görev yeri: <span class="num">${districtById(assignment.districtId).name} — ${assignment.neighborhoodName}</span></div>`;
          html += `<button class="btn btn-outline btn-sm" style="margin-top:8px;" data-reassign="${c.id}">Yeniden Ata</button>`;
        } else {
          html += `<div class="card-desc">Henüz bir mahalleye atanmadı, gelir üretmiyor.</div>`;
          html += `<button class="btn btn-gold btn-sm" style="margin-top:8px;" data-assign="${c.id}">Mahalleye Ata</button>`;
        }
      } else if (c.role === "bas_satici") {
        html += `<div class="card-desc">Kontrolündeki bölgelerde satıcıları otomatik yönetir, gelirlerinin %15'ini alır.</div>`;
      } else if (c.role === "uretici") {
        const assignedDistrictId = c.assignedTo && c.assignedTo.startsWith("lab:") ? c.assignedTo.slice(4) : null;
        const labDistricts = playerDistrictIds().filter(id => state.districts[id].lab);
        if (assignedDistrictId && state.districts[assignedDistrictId] && state.districts[assignedDistrictId].lab) {
          const lab = state.districts[assignedDistrictId].lab;
          html += `<div class="card-stat gold">Laboratuvar: <span class="num">${districtById(assignedDistrictId).name}</span></div>`;
          html += `<div class="card-stat">Şunu Üret:</div>`;
          html += `<select data-set-autoproduction="${assignedDistrictId}" style="width:100%; margin-bottom:6px;">`;
          html += `<option value="">— Seçilmedi —</option>`;
          DRUG_PRODUCTS.forEach(p => {
            const selected = lab.autoProductionId === p.id ? "selected" : "";
            html += `<option value="${p.id}" ${selected}>${p.name}</option>`;
          });
          html += `</select>`;
          html += `<button class="btn btn-outline btn-sm" data-unassign-producer="${c.id}">Laboratuvardan Ayır</button>`;
        } else if (labDistricts.length === 0) {
          html += `<div class="card-desc">Henüz sahip olduğun bir laboratuvar yok.</div>`;
        } else {
          html += `<div class="card-desc">Henüz bir laboratuvara atanmadı, üretim yapmıyor.</div>`;
          html += `<select data-assign-producer="${c.id}" style="width:100%;">`;
          html += `<option value="">— Laboratuvar Seç —</option>`;
          labDistricts.forEach(id => { html += `<option value="${id}">${districtById(id).name}</option>`; });
          html += `</select>`;
        }
      } else if (c.role === "doktor") {
        html += `<div class="card-desc">Yaralı ekip üyelerinin iyileşme süresini kısaltır, kronik sakatlık riskini sıfırlar.</div>`;
      } else if (c.role === "muhasebeci") {
        html += `<div class="card-desc">Üst barda günlük net kâr/zarar takibini aktif eder.</div>`;
      } else if (c.role === "tamirci") {
        html += `<div class="card-desc">Hasarlı araçları onarır, yakalanan ekipmanın bir kısmını kurtarabilir.</div>`;
      } else if (c.role === "casus") {
        html += `<div class="card-desc">Haritada rakip/polis operasyonlarını önceden haber verir.</div>`;
      } else if (c.role === "surucu") {
        html += `<div class="card-desc">Araç gerektiren operasyonlarda başarı şansını artırır.</div>`;
      }

      if (COMBAT_CAPABLE_ROLES.includes(c.role)) {
        html += `<div class="card-stat" style="margin-top:8px;">Silah:</div>`;
        html += `<select data-assign-weapon="${c.id}" style="width:100%; margin-bottom:6px;">`;
        html += `<option value="">— Varsayılan (Standart) —</option>`;
        WEAPONS.forEach(w => {
          const list = state.armory.weapons[w.id] || [];
          list.forEach((entry, i) => {
            const isAssignedElsewhere = state.crew.some(other => other.id !== c.id && other.assignedWeaponInstanceId === entry.id);
            const selected = c.assignedWeaponInstanceId === entry.id ? "selected" : "";
            const disabled = entry.durability <= 0 || isAssignedElsewhere;
            html += `<option value="${w.id}:${entry.id}" ${selected} ${disabled ? "disabled" : ""}>${w.name} #${i + 1} (%${Math.round(entry.durability)})${isAssignedElsewhere ? " — başkasında" : ""}</option>`;
          });
        });
        html += `</select>`;
        html += `<div class="card-stat">Zırh:</div>`;
        html += `<select data-assign-armor="${c.id}" style="width:100%;">`;
        html += `<option value="">— Zırhsız —</option>`;
        ARMORS.forEach(a => {
          const list = state.armory.armors[a.id] || [];
          list.forEach((entry, i) => {
            const isAssignedElsewhere = state.crew.some(other => other.id !== c.id && other.assignedArmorInstanceId === entry.id);
            const selected = c.assignedArmorInstanceId === entry.id ? "selected" : "";
            const disabled = entry.durability <= 0 || isAssignedElsewhere;
            html += `<option value="${a.id}:${entry.id}" ${selected} ${disabled ? "disabled" : ""}>${a.name} #${i + 1} (%${Math.round(entry.durability)})${isAssignedElsewhere ? " — başkasında" : ""}</option>`;
          });
        });
        html += `</select>`;
      }

      html += `<button class="btn btn-outline btn-sm" style="margin-top:8px;" data-fire="${c.id}">İşten Çıkar</button>`;
      html += `</div>`;
    });
  }

  html += `<div class="section-label">İşe Alım Havuzu</div>`;
  if (!state.recruitPool || state.recruitPool.length === 0) generateRecruitPool();
  state.recruitPool.forEach(r => {
    const role = CREW_ROLES[r.role];
    html += `
      <div class="card">
        <div class="card-title">${r.name}</div>
        <div class="card-desc">${role.name} · Sadakat: ${r.loyalty} · Maaş: ${fmt(r.wage)}/sa</div>
        <button class="btn btn-gold btn-sm btn-full" data-recruit="${r.id}">İşe Al (${fmt(r.wage * 10)})</button>
      </div>
    `;
  });

  el.innerHTML = html;
  el.querySelectorAll("[data-fire]").forEach(b => b.addEventListener("click", () => fireCrew(b.dataset.fire)));
  el.querySelectorAll("[data-show-attrs]").forEach(b => b.addEventListener("click", () => showCrewAttributes(b.dataset.showAttrs)));
  el.querySelectorAll("[data-assign-weapon]").forEach(sel => sel.addEventListener("change", () => {
    const c = state.crew.find(x => x.id === sel.dataset.assignWeapon);
    if (!c) return;
    if (!sel.value) { c.assignedWeaponId = null; c.assignedWeaponInstanceId = null; render(); return; }
    const [weaponId, instanceId] = sel.value.split(":");
    // Güvenlik kontrolü: bu kopya başka birine atanmışsa reddet (render gecikmesine karşı)
    const alreadyTaken = state.crew.some(other => other.id !== c.id && other.assignedWeaponInstanceId === instanceId);
    if (alreadyTaken) {
      toast("Silah Zaten Atanmış", "Bu silah kopyası başka bir ekip üyesine atanmış.", "negative");
      render();
      return;
    }
    c.assignedWeaponId = weaponId;
    c.assignedWeaponInstanceId = instanceId;
    render();
  }));
  el.querySelectorAll("[data-assign-armor]").forEach(sel => sel.addEventListener("change", () => {
    const c = state.crew.find(x => x.id === sel.dataset.assignArmor);
    if (!c) return;
    if (!sel.value) { c.assignedArmorId = null; c.assignedArmorInstanceId = null; render(); return; }
    const [armorId, instanceId] = sel.value.split(":");
    const alreadyTaken = state.crew.some(other => other.id !== c.id && other.assignedArmorInstanceId === instanceId);
    if (alreadyTaken) {
      toast("Zırh Zaten Atanmış", "Bu zırh kopyası başka bir ekip üyesine atanmış.", "negative");
      render();
      return;
    }
    c.assignedArmorId = armorId;
    c.assignedArmorInstanceId = instanceId;
    render();
  }));
  el.querySelectorAll("[data-assign]").forEach(b => b.addEventListener("click", () => openNeighborhoodAssignModal(b.dataset.assign)));
  el.querySelectorAll("[data-reassign]").forEach(b => b.addEventListener("click", () => openNeighborhoodAssignModal(b.dataset.reassign)));
  el.querySelectorAll("[data-assign-producer]").forEach(sel => sel.addEventListener("change", () => {
    const c = state.crew.find(x => x.id === sel.dataset.assignProducer);
    if (c && sel.value) { c.assignedTo = "lab:" + sel.value; render(); }
  }));
  el.querySelectorAll("[data-unassign-producer]").forEach(b => b.addEventListener("click", () => {
    const c = state.crew.find(x => x.id === b.dataset.unassignProducer);
    if (c) { c.assignedTo = null; render(); }
  }));
  el.querySelectorAll("[data-set-autoproduction]").forEach(sel => sel.addEventListener("change", () => {
    setAutoProduction(sel.dataset.setAutoproduction, sel.value);
  }));
  el.querySelectorAll("[data-recruit]").forEach(b => b.addEventListener("click", () => recruitCrew(b.dataset.recruit)));
}

// ---------------- ÜRETİM MİNİ-OYUNU ----------------
function openProductionMinigame(districtId, productId, lvl, batchCount) {
  const product = DRUG_PRODUCTS.find(p => p.id === productId);
  const backdrop = document.getElementById("district-modal-backdrop");
  const modal = document.getElementById("district-modal");

  state.activeProductionMinigame = {
    districtId, productId, lvl, batchCount: Math.max(1, batchCount || 1),
    stepIndex: 0,
    score: 0, // 0-100 arası birikimli başarı puanı
    stepsTotal: product.minigame.steps.length,
  };

  renderMinigameStep();
  backdrop.classList.add("open");
}

function renderMinigameStep() {
  const mg = state.activeProductionMinigame;
  if (!mg) return;
  const product = DRUG_PRODUCTS.find(p => p.id === mg.productId);
  const step = product.minigame.steps[mg.stepIndex];
  const modal = document.getElementById("district-modal");

  let html = `
    <div class="panel-title">${product.name} Üretimi</div>
    <div class="panel-subtitle">Adım ${mg.stepIndex + 1} / ${mg.stepsTotal}: ${step.label}</div>
    <div id="minigame-content"></div>
  `;
  modal.innerHTML = html;
  const content = document.getElementById("minigame-content");

  if (step.type === "add_material" || step.type === "pack") {
    content.innerHTML = `
      <div class="card">
        <div class="card-desc">${step.label}. Devam etmek için hazır olduğunda onayla.</div>
        <button class="btn btn-gold btn-full" id="minigame-confirm-step">Onayla</button>
      </div>
    `;
    document.getElementById("minigame-confirm-step").addEventListener("click", () => {
      // Basit adımlar: sabit orta-yüksek puan katkısı
      mg.score += 20 + Math.random() * 10;
      advanceMinigameStep();
    });
  } else if (step.type === "temperature") {
    let currentTemp = (step.targetMin + step.targetMax) / 2 - 15;
    let remaining = step.durationSec;
    let inRangeTicks = 0, totalTicks = 0;

    content.innerHTML = `
      <div class="card">
        <div class="card-desc">Sıcaklığı ${step.targetMin}°C - ${step.targetMax}°C arasında tut. Kalan süre: <span id="mg-timer">${remaining}</span>sn</div>
        <div style="font-family:var(--font-mono); font-size:28px; text-align:center; margin:14px 0; color:var(--gold-bright);" id="mg-temp-display">${Math.round(currentTemp)}°C</div>
        <div class="progress-track"><div class="progress-fill" id="mg-progress" style="width:0%"></div></div>
        <div style="display:flex; gap:10px; margin-top:12px;">
          <button class="btn btn-outline btn-full" id="mg-decrease">− Soğut</button>
          <button class="btn btn-outline btn-full" id="mg-increase">+ Isıt</button>
        </div>
      </div>
    `;

    const tempDisplay = document.getElementById("mg-temp-display");
    const timerDisplay = document.getElementById("mg-timer");
    const progressBar = document.getElementById("mg-progress");

    document.getElementById("mg-decrease").addEventListener("click", () => { currentTemp = Math.max(0, currentTemp - 4); tempDisplay.textContent = Math.round(currentTemp) + "°C"; });
    document.getElementById("mg-increase").addEventListener("click", () => { currentTemp = currentTemp + 4; tempDisplay.textContent = Math.round(currentTemp) + "°C"; });

    const interval = setInterval(() => {
      remaining -= 1;
      totalTicks++;
      // Sıcaklık her saniye biraz doğal olarak düşer (soğuma eğilimi), oyuncu ısıtmalı
      currentTemp = Math.max(0, currentTemp - 1.5);
      tempDisplay.textContent = Math.round(currentTemp) + "°C";

      const inRange = currentTemp >= step.targetMin && currentTemp <= step.targetMax;
      if (inRange) inRangeTicks++;
      progressBar.style.width = Math.round((totalTicks / step.durationSec) * 100) + "%";
      if (timerDisplay) timerDisplay.textContent = Math.max(0, remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        const accuracy = inRangeTicks / totalTicks;
        mg.score += accuracy * 30;
        advanceMinigameStep();
      }
    }, 1000);

    mg._activeInterval = interval;
  } else if (step.type === "wait") {
    let remaining = step.durationSec;
    content.innerHTML = `
      <div class="card">
        <div class="card-desc">${step.label}. Kalan süre: <span id="mg-timer">${remaining}</span>sn</div>
        <div class="progress-track"><div class="progress-fill" id="mg-progress" style="width:0%"></div></div>
      </div>
    `;
    const timerDisplay = document.getElementById("mg-timer");
    const progressBar = document.getElementById("mg-progress");
    let elapsed = 0;
    const interval = setInterval(() => {
      remaining -= 1; elapsed += 1;
      if (timerDisplay) timerDisplay.textContent = Math.max(0, remaining);
      progressBar.style.width = Math.round((elapsed / step.durationSec) * 100) + "%";
      if (remaining <= 0) {
        clearInterval(interval);
        mg.score += 20; // bekleme adımları sabit puan
        advanceMinigameStep();
      }
    }, 1000);
    mg._activeInterval = interval;
  }
}

function advanceMinigameStep() {
  const mg = state.activeProductionMinigame;
  if (!mg) return;
  if (mg._activeInterval) { clearInterval(mg._activeInterval); mg._activeInterval = null; }

  mg.stepIndex++;
  const product = DRUG_PRODUCTS.find(p => p.id === mg.productId);
  if (mg.stepIndex >= mg.stepsTotal) {
    finishMinigame();
  } else {
    renderMinigameStep();
  }
}

function finishMinigame() {
  const mg = state.activeProductionMinigame;
  if (!mg) return;
  const product = DRUG_PRODUCTS.find(p => p.id === mg.productId);
  const normalizedScore = Math.min(100, Math.round((mg.score / (mg.stepsTotal * 30)) * 100));
  const qualityFactor = 0.5 + (normalizedScore / 100) * 0.7; // %50 - %120 verim aralığı
  const batchCount = mg.batchCount || 1;

  // Toplu üretim süresi: ilk parti tam süre, her ek parti yarı süre alır
  const totalMin = Math.round(mg.lvl.batchTimeMin * (1 + (batchCount - 1) * 0.5));

  const lab = state.districts[mg.districtId].lab;
  lab.activeBatch = {
    productId: mg.productId, totalMin, batchCount,
    finishesAtMin: nowAbsoluteMin() + totalMin,
    yieldAmount: Math.max(1, Math.round(product.yieldPerBatch * mg.lvl.capacity * batchCount * qualityFactor)),
    auto: false,
  };

  const grade = normalizedScore >= 80 ? "Mükemmel" : normalizedScore >= 55 ? "İyi" : normalizedScore >= 30 ? "Vasat" : "Kötü";
  toast("Üretim Tamamlandı", `${product.name} üretimi başlatıldı (${batchCount} parti). Performans: ${grade} (%${normalizedScore})`, normalizedScore >= 55 ? "positive" : "neutral");

  state.activeProductionMinigame = null;
  closeModal();
  render();
}

// ---------------- MAHALLE ATAMA (Satıcı) ----------------
function openNeighborhoodAssignModal(crewId) {
  const crewMember = state.crew.find(c => c.id === crewId);
  if (!crewMember) return;
  const backdrop = document.getElementById("district-modal-backdrop");
  const modal = document.getElementById("district-modal");

  const owned = playerDistrictIds();
  let html = `
    <button class="close-x" id="close-assign-modal">×</button>
    <div class="panel-title">${crewMember.name}</div>
    <div class="panel-subtitle">Satış yapacağı mahalleyi seç. Sadece kontrolündeki bölgelerde atama yapılabilir.</div>
  `;

  if (owned.length === 0) {
    html += `<div class="empty-state">Henüz kontrolünde bir bölge yok.</div>`;
  } else {
    owned.forEach(did => {
      const d = districtById(did);
      const neighborhoods = NEIGHBORHOODS[did] || [];
      if (neighborhoods.length === 0) return;
      html += `<div class="section-label">${d.name}</div>`;
      neighborhoods.forEach(nName => {
        const occupied = Object.values(state.neighborhoodAssignments).some(a => a.districtId === did && a.neighborhoodName === nName);
        html += `
          <div class="card-row" style="padding:8px 0;">
            <span class="card-stat">${nName}</span>
            <button class="btn btn-outline btn-sm" data-pick-neighborhood="${did}|${nName}" ${occupied ? "disabled" : ""}>${occupied ? "Dolu" : "Ata"}</button>
          </div>
        `;
      });
    });
  }

  modal.innerHTML = html;
  document.getElementById("close-assign-modal").addEventListener("click", closeModal);
  modal.querySelectorAll("[data-pick-neighborhood]").forEach(b => {
    b.addEventListener("click", () => {
      const [districtId, neighborhoodName] = b.dataset.pickNeighborhood.split("|");
      state.neighborhoodAssignments[crewId] = { districtId, neighborhoodName };
      toast("Atama Yapıldı", `${crewMember.name} artık ${neighborhoodName}'de satış yapıyor.`, "positive");
      closeModal();
      render();
    });
  });

  backdrop.classList.add("open");
}

// Satıcı ve Dağıtım Amiri gelirini hesaplar (gameTick tarafından çağrılır)
function processSalesIncome(minutesPassed) {
  const hasBasSatici = state.crew.some(c => c.role === "bas_satici" && !c.assignedTo);
  const basSaticiCut = 0.15;

  // Her satıcının ürettiği ham gelir (birim zamanda sabit bir taban + rastgele dalgalanma)
  const salesPerCrew = {}; // crewId -> gelir bu tick'te
  state.crew.filter(c => c.role === "satici" && !c.assignedTo).forEach(c => {
    const assignment = state.neighborhoodAssignments[c.id];
    if (!assignment) return;
    // Karizma ve İkna, taban satış gelirini artırır/azaltır (10 nötr taban, her puan ~%2 etki)
    const karizma = c.attributes ? c.attributes.karizma : 10;
    const ikna = c.attributes ? c.attributes.ikna : 10;
    const attrMultiplier = 1 + ((karizma - 10) * 0.02) + ((ikna - 10) * 0.02);
    const baseHourly = 260 * Math.max(0.5, attrMultiplier); // satıcı başına ortalama saatlik brüt satış geliri
    const grossIncome = baseHourly * (minutesPassed / 60) * (0.7 + Math.random() * 0.6);
    salesPerCrew[c.id] = { gross: grossIncome, districtId: assignment.districtId };
  });

  let totalOwnerIncome = 0;
  let totalSaticiPrimIncome = 0; // satıcıların kendi primleri (bilgi amaçlı, maaşlarına ek değil, ayrı prim cebi)
  let totalBasSaticiIncome = 0;

  Object.keys(salesPerCrew).forEach(crewId => {
    const { gross } = salesPerCrew[crewId];
    const saticiPrim = gross * 0.15;
    const afterSatici = gross - saticiPrim;
    totalSaticiPrimIncome += saticiPrim;

    if (hasBasSatici) {
      const basSaticiPay = afterSatici * basSaticiCut;
      totalBasSaticiIncome += basSaticiPay;
      totalOwnerIncome += afterSatici - basSaticiPay;
    } else {
      totalOwnerIncome += afterSatici;
    }
  });

  if (totalOwnerIncome > 0) {
    state.cash += totalOwnerIncome * (state.modifiers.businessIncomeMult || 1);
    trackDailyIncome(totalOwnerIncome * (state.modifiers.businessIncomeMult || 1), 0);
  }
}

function trackDailyIncome(income, expense) {
  const tracker = state.dailyIncomeTracker;
  if (tracker.lastResetDay !== state.day) {
    tracker.lastFullDayNet = tracker.incomeSoFar - tracker.expenseSoFar;
    tracker.incomeSoFar = 0;
    tracker.expenseSoFar = 0;
    tracker.lastResetDay = state.day;
  }
  tracker.incomeSoFar += income;
  tracker.expenseSoFar += expense;
}

// ---------------- CASUS İSTİHBARAT SİSTEMİ ----------------
function runSpyIntelGeneration(minutesPassed) {
  const spyCount = state.crew.filter(c => c.role === "casus" && !c.assignedTo).length;
  if (spyCount === 0) return;
  if (state.intelMarkers.length >= spyCount + 1) return;
  if (Math.random() > 0.05 * spyCount * (minutesPassed / 5)) return;

  // Rastgele bir rakip/polis aktivitesi hakkında erken bilgi üret
  const candidates = [];
  RIVAL_GANGS.forEach(g => {
    const territories = rivalDistrictIds(g.id);
    if (territories.length > 0) {
      candidates.push({ districtId: territories[Math.floor(Math.random()*territories.length)], label: `${g.name} bir operasyon hazırlığında.` });
    }
  });
  candidates.push({ districtId: POLICE_FACTION.hideoutDistrict, label: "Polis bölgede devriye artırmayı planlıyor." });
  if (candidates.length === 0) return;

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  state.intelMarkers.push({
    id: uid(), districtId: pick.districtId, description: pick.label,
    expiresAtMin: nowAbsoluteMin() + 60 + Math.floor(Math.random()*60),
  });
}

function showCrewAttributes(crewId) {
  const c = state.crew.find(x => x.id === crewId);
  if (!c || !c.attributes) return;
  const backdrop = document.getElementById("district-modal-backdrop");
  const modal = document.getElementById("district-modal");

  const sorted = Object.entries(c.attributes).sort((a, b) => ATTRIBUTES[a[0]].name.localeCompare(ATTRIBUTES[b[0]].name, "tr"));
  let html = `
    <button class="close-x" id="close-attrs-modal">×</button>
    <div class="panel-title">${c.name}</div>
    <div class="panel-subtitle">${CREW_ROLES[c.role].name} — Özellikler (20 üzerinden)</div>
  `;
  sorted.forEach(([key, val]) => {
    const pct = Math.round((val / 20) * 100);
    html += `
      <div class="card-row" style="margin-bottom:6px;">
        <span class="card-stat" style="width:150px;">${ATTRIBUTES[key].name}</span>
        <div class="progress-track" style="flex:1; margin:0 8px;"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="card-stat gold"><span class="num">${val}</span></span>
      </div>
    `;
  });
  modal.innerHTML = html;
  document.getElementById("close-attrs-modal").addEventListener("click", closeModal);
  backdrop.classList.add("open");
}

function generateRecruitPool() {
  const roles = Object.keys(CREW_ROLES);
  state.recruitPool = Array.from({ length: 5 }, () => {
    const roleId = roles[Math.floor(Math.random() * roles.length)];
    const role = CREW_ROLES[roleId];
    return {
      id: uid(), name: randomName(), role: roleId,
      loyalty: 40 + Math.floor(Math.random() * 50),
      wage: role.baseWage + Math.floor(Math.random() * 100),
      attributes: generateAttributesForRole(roleId),
    };
  });
  state.recruitPoolGeneratedAtMin = state.day * 24 * 60 + state.minutes;
}

function recruitCrew(recruitId) {
  const r = state.recruitPool.find(x => x.id === recruitId);
  const signingCost = r.wage * 10;
  if (state.cash < signingCost) { toast("Yetersiz Bakiye", "İşe alım maliyetini karşılayamıyorsun.", "negative"); return; }
  state.cash -= signingCost;
  state.crew.push({ id: r.id, name: r.name, role: r.role, wage: r.wage, loyalty: r.loyalty, attributes: r.attributes, assignedTo: null });
  state.recruitPool = state.recruitPool.filter(x => x.id !== recruitId);
  toast("Yeni Eleman", `${r.name} ekibine katıldı.`, "positive");
  render();
}

function fireCrew(crewId) {
  state.crew = state.crew.filter(c => c.id !== crewId);
  render();
}

// ---------------- TAB: İMPARATORLUK (genel özet) ----------------
function renderEmpireTab() {
  const el = document.getElementById("panel-content");
  const owned = playerDistrictIds();
  const totalBizIncome = owned.reduce((sum, id) => {
    return sum + state.districts[id].businesses.reduce((s, b) => s + BUSINESS_TYPES.find(t => t.id === b.typeId).baseIncomePerHour, 0);
  }, 0);

  const origin = ORIGINS.find(o => o.id === state.profile.originId);
  const leadership = LEADERSHIP_STYLES.find(l => l.id === state.profile.leadershipId);
  const ideology = IDEOLOGIES.find(i => i.id === state.profile.ideologyId);

  let html = `
    <div class="panel-title">${state.profile.orgName}</div>
    <div class="panel-subtitle">${state.profile.codeName} (${state.profile.leaderName}) tarafından yönetiliyor.</div>

    <div class="section-label">Örgüt Profili</div>
    <div class="card">
      <div class="setup-summary-row"><span class="label">Geçmiş</span><span class="value">${origin.name}</span></div>
      <div class="setup-summary-row"><span class="label">Liderlik</span><span class="value">${leadership.name}</span></div>
      <div class="setup-summary-row"><span class="label">İdeoloji</span><span class="value">${ideology.name}</span></div>
    </div>

    <div class="section-label">Özet</div>
    <div class="card">
      <div class="card-row"><span class="card-stat">Kontrol Edilen Bölge</span><span class="card-stat gold"><span class="num">${owned.length}</span> / ${DISTRICTS.length}</span></div>
      <div class="card-row"><span class="card-stat">Saatlik İşletme Geliri</span><span class="card-stat gold"><span class="num">${fmt(totalBizIncome)}</span></span></div>
      <div class="card-row"><span class="card-stat">Ekip Sayısı</span><span class="card-stat"><span class="num">${state.crew.length}</span></span></div>
      <div class="card-row"><span class="card-stat">Toplam Nakit</span><span class="card-stat gold"><span class="num">${fmt(state.cash)}</span></span></div>
    </div>

    <div class="section-label">Rakip Çeteler</div>
  `;
  RIVAL_GANGS.forEach(g => {
    const territories = Object.keys(state.districts).filter(id => state.districts[id].owner === `rival:${g.id}`);
    const econ = state.gangEconomy[g.id];
    const isAlive = territories.length > 0;
    html += `
      <div class="card">
        <div class="card-row">
          <span class="card-title">${g.name}</span>
          <span class="badge blood">Güç ${g.strength}</span>
        </div>
        <div class="card-desc">Kontrol: ${isAlive ? territories.map(id => districtById(id).name).join(", ") : "Bölgesi kalmadı"}</div>
        <div class="card-stat blood">Düşmanlık: <span class="num">${state.gangRelations[g.id].hostility}</span></div>
        ${econ ? `<div class="card-stat gold">Tahmini Nakit: <span class="num">${fmt(econ.cash)}</span></div>` : ""}
        ${isAlive ? `<button class="btn btn-blood btn-sm btn-full" style="margin-top:8px;" data-hideout-raid="${g.id}">Hideout'a Baskın Düzenle</button>` : ""}
      </div>
    `;
  });

  html += `<div class="section-label">Son Olaylar</div>`;
  if (state.log.length === 0) {
    html += `<div class="empty-state">Henüz kayda değer bir olay yok.</div>`;
  } else {
    state.log.slice(-8).reverse().forEach(entry => {
      html += `<div class="card"><div class="card-desc" style="margin-bottom:0;">Gün ${entry.day}, ${entry.time} — ${entry.text}</div></div>`;
    });
  }

  html += `<div class="section-label">Mahkumlar</div>`;
  const activeCaptives = state.captives.filter(c => !c.resolved);
  if (activeCaptives.length === 0) {
    html += `<div class="empty-state">Elinde mahkum yok.</div>`;
    html += `<button class="btn btn-outline btn-sm btn-full" id="spawn-test-captive">Test: Rastgele Mahkum Oluştur</button>`;
  } else {
    activeCaptives.forEach(c => {
      const hpPct = Math.round((c.hp / c.maxHpAtCapture) * 100);
      const threshold = Math.ceil(c.hp / 3);
      const heldHours = Math.floor((c.heldMinutes || 0) / 60);
      html += `
        <div class="card">
          <div class="card-row"><span class="card-title">${c.name}</span><span class="badge blood">${RIVAL_GANGS.find(g=>g.id===c.sourceGangId)?.name || "Bilinmeyen"}</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${hpPct}%"></div></div>
          <div class="card-stat">Can: <span class="num">${c.hp}</span> · Konuşma Eşiği: <span class="num">${threshold}</span></div>
          <div class="card-stat blood">Tutulma Süresi: <span class="num">${heldHours}</span> saat — ne kadar uzun tutulursa hideout baskın riski o kadar artar</div>
          <button class="btn btn-blood btn-sm btn-full" style="margin-top:8px;" data-interrogate="${c.id}">Sorgula</button>
        </div>
      `;
    });
  }

  el.innerHTML = html;
  const spawnBtn = document.getElementById("spawn-test-captive");
  if (spawnBtn) spawnBtn.addEventListener("click", spawnTestCaptive);
  el.querySelectorAll("[data-interrogate]").forEach(b => b.addEventListener("click", () => openInterrogationScreen(b.dataset.interrogate)));
  el.querySelectorAll("[data-hideout-raid]").forEach(b => b.addEventListener("click", () => openHideoutRaidPlanner(b.dataset.hideoutRaid)));
}

// ---------------- MAHKUM / SORGU SİSTEMİ ----------------
function spawnTestCaptive() {
  const gang = RIVAL_GANGS[Math.floor(Math.random() * RIVAL_GANGS.length)];
  const hp = 20 + Math.floor(Math.random() * 60); // combat'tan gelen "kalan can" simülasyonu (test amaçlı)
  const roles = Object.keys(CREW_ROLES);
  const randomRole = roles[Math.floor(Math.random() * roles.length)];
  state.captives.push({
    id: uid(), name: randomName(), sourceGangId: gang.id,
    hp, maxHpAtCapture: hp, loyalty: 30 + Math.floor(Math.random() * 50),
    lastHealAtMin: nowAbsoluteMin(), resolved: false,
    attributes: generateAttributesForRole(randomRole),
  });
  toast("Mahkum Ele Geçirildi", "Test amaçlı bir mahkum oluşturuldu.", "neutral");
  render();
}

// Mahkumun pasif iyileşmesini işler (gameTick tarafından çağrılır)
function processCaptiveHealing(minutesPassed) {
  state.captives.forEach(c => {
    if (c.resolved) return;
    const elapsed = nowAbsoluteMin() - c.lastHealAtMin;
    const healInterval = INTERROGATION_HEAL_MIN_MINUTES + Math.random() * (INTERROGATION_HEAL_MAX_MINUTES - INTERROGATION_HEAL_MIN_MINUTES);
    if (elapsed >= healInterval) {
      c.hp += 1;
      c.lastHealAtMin = nowAbsoluteMin();
    }
  });
  processCaptiveRaidRisk(minutesPassed);
}

// Mahkum ne kadar uzun tutulursa, rakip çetenin hideout'a baskın düzenleyip onu
// kurtarma ihtimali o kadar birikir. En yüksek Gizlilik'e sahip ekip üyesi bu riski azaltır.
function processCaptiveRaidRisk(minutesPassed) {
  const activeCaptives = state.captives.filter(c => !c.resolved);
  if (activeCaptives.length === 0) return;

  const bestSecrecy = state.crew.reduce((max, c) => {
    const gizlilik = c.attributes ? c.attributes.gizlilik : 8;
    return Math.max(max, gizlilik);
  }, 8);
  const secrecyReduction = Math.max(0.3, 1 - (bestSecrecy - 8) * 0.04); // 8 nötr taban, üstü riski azaltır

  activeCaptives.forEach(c => {
    c.heldMinutes = (c.heldMinutes || 0) + minutesPassed;
    // Baz risk: her geçen dakika için çok küçük bir birikimli şans (saatte ~%1.5 taban)
    const raidChancePerTick = (minutesPassed / 60) * 1.5 * secrecyReduction;
    if (Math.random() * 100 < raidChancePerTick) {
      c.resolved = true;
      c.escaped = true;
      const gang = RIVAL_GANGS.find(g => g.id === c.sourceGangId);
      toast("Mahkum Kurtarıldı!", `${gang ? gang.name : "Rakip çete"} hideout'a baskın yapıp ${c.name}'i kurtardı.`, "negative");
      logEvent(`${c.name}, rakip çete tarafından hideout baskınıyla kurtarıldı.`);
      state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 10);
    }
  });
}

function openInterrogationScreen(captiveId) {
  const captive = state.captives.find(c => c.id === captiveId);
  if (!captive) return;
  const backdrop = document.getElementById("district-modal-backdrop");
  const modal = document.getElementById("district-modal");

  const threshold = Math.ceil(captive.hp / 3);

  let html = `
    <button class="close-x" id="close-interrogation-modal">×</button>
    <div class="panel-title">${captive.name}</div>
    <div class="panel-subtitle">${RIVAL_GANGS.find(g => g.id === captive.sourceGangId)?.name || "Bilinmeyen"} — Sorgu</div>
    <div class="card">
      <div class="card-stat">Mevcut Can: <span class="num">${captive.hp}</span></div>
      <div class="card-stat blood">Konuşma Eşiği: <span class="num">${threshold}</span> (bu değerin altına düşerse bilgi verir)</div>
    </div>
    <div class="section-label">İşkence Yöntemi Seç</div>
  `;

  INTERROGATION_LEVELS.forEach(lvl => {
    html += `
      <div class="card">
        <div class="card-title">${lvl.name}</div>
        <div class="card-desc">${lvl.description}</div>
        <div class="card-stat blood">Can Kaybı: <span class="num">${lvl.damageMin}-${lvl.damageMax}</span></div>
        <button class="btn btn-blood btn-sm btn-full" style="margin-top:8px;" data-interrogate-level="${lvl.id}">Uygula</button>
      </div>
    `;
  });

  html += `<div class="section-label">Diğer Seçenekler</div>`;
  html += `
    <div class="card">
      <div class="card-desc">Mahkumu bırakıp beklet, canı zamanla kendiliğinden yükselir (daha güvenli sorgu için tampon büyür, ama bu süre boyunca hideout'un baskın riski taşır).</div>
    </div>
    <div class="card">
      <div class="card-title">Kendi Tarafına Çekmeyi Dene</div>
      <div class="card-desc">İşkence yerine ikna/vaat yoluyla mahkumu kendi ekibine katmayı dene. Sadakati düşükse ve az işkence görmüşse başarı ihtimali yüksek olur. Başarısız olursa mahkum artık hiçbir şekilde konuşmaz.</div>
      <div class="card-stat">Mahkum Sadakati: <span class="num">${captive.loyalty}</span> · İşkence Sayısı: <span class="num">${captive.tortureCount || 0}</span></div>
      <button class="btn btn-outline btn-sm btn-full" style="margin-top:8px;" id="try-turn-captive">Çevirmeyi Dene</button>
    </div>
    <div class="card">
      <div class="card-title">Fidye İste</div>
      <div class="card-desc">Mahkumu canlı teslim etmek karşılığında rakip çeteden fidye talep et. ${(captive.tortureCount || 0) > 0 ? '<span class="blood">Sorgu görmüş bir mahkumun fidye değeri düşer.</span>' : ''}</div>
      <div class="card-stat gold">Tahmini Fidye: <span class="num">${fmt(estimateRansomValue(captive))}</span></div>
      <button class="btn btn-gold btn-sm btn-full" style="margin-top:8px;" id="request-ransom">Fidye İste</button>
    </div>
  `;

  modal.innerHTML = html;
  document.getElementById("close-interrogation-modal").addEventListener("click", closeModal);
  modal.querySelectorAll("[data-interrogate-level]").forEach(b => {
    b.addEventListener("click", () => applyInterrogation(captive.id, b.dataset.interrogateLevel));
  });
  const turnBtn = document.getElementById("try-turn-captive");
  if (turnBtn) turnBtn.addEventListener("click", () => tryTurnCaptive(captive.id));
  const ransomBtn = document.getElementById("request-ransom");
  if (ransomBtn) ransomBtn.addEventListener("click", () => requestRansom(captive.id));

  backdrop.classList.add("open");
}

// Fidye değeri: rakip çetenin nakdine oranlı taban, sorgu görmüşse düşer,
// ekipte Pazarlık yeteneği yüksek biri varsa artar.
function estimateRansomValue(captive) {
  const gang = RIVAL_GANGS.find(g => g.id === captive.sourceGangId);
  const gangCash = gang && state.gangEconomy[gang.id] ? state.gangEconomy[gang.id].cash : 40000;
  let value = gangCash * 0.25;

  // Sorgu görmüşse (her işkence turu) değer ciddi düşer
  const tortureCount = captive.tortureCount || 0;
  value *= Math.max(0.2, 1 - tortureCount * 0.25);

  // En yüksek Pazarlık yeteneğine sahip boştaki ekip üyesi müzakereyi güçlendirir
  const negotiator = state.crew.filter(c => !c.assignedTo).sort((a, b) => {
    const aPaz = a.attributes ? a.attributes.pazarlik : 8;
    const bPaz = b.attributes ? b.attributes.pazarlik : 8;
    return bPaz - aPaz;
  })[0];
  const negotiatorPazarlik = negotiator && negotiator.attributes ? negotiator.attributes.pazarlik : 8;
  value *= 1 + ((negotiatorPazarlik - 8) * 0.03);

  return Math.round(Math.max(1000, value));
}

function requestRansom(captiveId) {
  const captive = state.captives.find(c => c.id === captiveId);
  if (!captive) return;
  const value = estimateRansomValue(captive);
  const gang = RIVAL_GANGS.find(g => g.id === captive.sourceGangId);

  // Rakip çete kabul etme ihtimali: nakdi yeterliyse ve mahkum onlar için hâlâ değerliyse yüksektir
  const gangCash = gang && state.gangEconomy[gang.id] ? state.gangEconomy[gang.id].cash : 40000;
  const acceptChance = gangCash >= value ? 75 : 35;
  const accepted = Math.random() * 100 < acceptChance;

  captive.resolved = true;
  if (accepted) {
    if (gang && state.gangEconomy[gang.id]) state.gangEconomy[gang.id].cash -= value;
    state.cash += value;
    toast("Fidye Ödendi", `${gang ? gang.name : "Rakip çete"} fidyeyi ödedi: ${fmt(value)}.`, "positive");
    logEvent(`${captive.name} için fidye alındı: ${fmt(value)}.`);
  } else {
    toast("Fidye Reddedildi", `${gang ? gang.name : "Rakip çete"} fidyeyi ödemedi. Mahkum serbest bırakıldı.`, "negative");
    logEvent(`${captive.name} için fidye talebi reddedildi.`);
  }

  closeModal();
  render();
}

function applyInterrogation(captiveId, levelId) {
  const captive = state.captives.find(c => c.id === captiveId);
  const level = INTERROGATION_LEVELS.find(l => l.id === levelId);
  if (!captive || !level) return;

  captive.tortureCount = (captive.tortureCount || 0) + 1;
  const damage = level.damageMin + Math.floor(Math.random() * (level.damageMax - level.damageMin + 1));
  const thresholdBefore = Math.ceil(captive.hp / 3);
  captive.hp -= damage;

  if (captive.hp <= 0) {
    captive.hp = 0;
    captive.resolved = true;
    toast("Mahkum Öldü", `${captive.name} işkence sırasında öldü. Bilgi alınamadı.`, "negative");
    closeModal();
    render();
    return;
  }

  if (captive.hp <= thresholdBefore) {
    captive.resolved = true;
    const gang = RIVAL_GANGS.find(g => g.id === captive.sourceGangId);
    // İstihbarat ödülü: rakip çetenin nakdinden bir kısmını "öğrenip" avantaja çeviriyoruz (basitleştirilmiş ödül)
    const intelValue = gang && state.gangEconomy[gang.id] ? Math.round(state.gangEconomy[gang.id].cash * 0.15) : 5000;
    state.cash += intelValue;
    toast("Mahkum Konuştu", `${captive.name} bilgi verdi. İstihbarat değeri: ${fmt(intelValue)}.`, "positive");
    logEvent(`${captive.name} sorgu sonucu konuştu.`);
    closeModal();
    render();
    return;
  }

  toast("Sorgu Devam Ediyor", `${captive.name} henüz konuşmadı. Can: ${captive.hp}.`, "neutral");
  closeModal();
  render();
}

function tryTurnCaptive(captiveId) {
  const captive = state.captives.find(c => c.id === captiveId);
  if (!captive) return;

  // Çevirmeyi deneyen kişi olarak, boştaki ekipten en yüksek İkna'ya sahip olanı kullanırız.
  const negotiator = state.crew.filter(c => !c.assignedTo).sort((a, b) => {
    const aIkna = a.attributes ? a.attributes.ikna : 8;
    const bIkna = b.attributes ? b.attributes.ikna : 8;
    return bIkna - aIkna;
  })[0];
  const negotiatorIkna = negotiator && negotiator.attributes ? negotiator.attributes.ikna : 8; // ekip yoksa nötr taban
  const captiveResistance = captive.attributes ? captive.attributes.sadakat_direnci : 10;

  // Başarı şansı: düşük sadakat kolaylaştırır, her işkence turu zorlaştırır,
  // negotiator'ın İkna'sı yardımcı olur, mahkumun Sadakat Direnci zorlaştırır.
  let chance = 70 - captive.loyalty * 0.5 - (captive.tortureCount || 0) * 15;
  chance += (negotiatorIkna - 10) * 1.5; // 10 nötr taban, üstü bonus, altı ceza
  chance -= (captiveResistance - 10) * 1.5;
  chance = Math.max(5, Math.min(85, chance));

  const success = Math.random() * 100 < chance;

  if (success) {
    captive.resolved = true;
    state.crew.push({
      id: uid(), name: captive.name, role: "satici", // varsayılan olarak düşük riskli bir role başlar
      wage: 220, loyalty: Math.max(10, captive.loyalty - 30), // yeni katıldığı için sadakati düşük başlar
      attributes: generateAttributesForRole("satici"),
      assignedTo: null,
    });
    toast("Çevirme Başarılı", `${captive.name} artık senin örgütünde.`, "positive");
    logEvent(`${captive.name} kendi tarafımıza çekildi.`);
  } else {
    captive.resolved = true;
    toast("Çevirme Başarısız", `${captive.name} ikna olmadı. Bir daha konuşturulamaz.`, "negative");
    logEvent(`${captive.name} çevirme girişimi başarısız oldu.`);
  }

  closeModal();
  render();
}

function openHideoutRaidPlanner(gangId) {
  const gang = RIVAL_GANGS.find(g => g.id === gangId);
  const op = COUNTER_OPS.hideout_raid;
  const backdrop = document.getElementById("district-modal-backdrop");
  const modal = document.getElementById("district-modal");

  const roleCounts = {};
  op.requiredRoles.forEach(r => { roleCounts[r] = (roleCounts[r]||0)+1; });

  let html = `
    <button class="close-x" id="close-raid-modal">×</button>
    <div class="panel-title">${gang.name} Hideout'u</div>
    <div class="panel-subtitle">${op.description} Bu çetenin ana üssüne doğrudan saldırıyorsun — en riskli operasyon.</div>
    <div class="section-label">Ekip Ata</div>
    <div id="raid-role-slots"></div>
    <div class="section-label">Özet</div>
    <div class="card">
      <div class="card-desc" style="margin-bottom:0;">Bu operasyon gerçek zamanlı bir çatışmayla sonuçlanacak. En riskli operasyon olduğu için ekibin iyi donanımlı olmalı.</div>
      <div class="card-stat gold">Tahmini Ganimet: <span class="num">${fmt(state.gangEconomy[gangId] ? state.gangEconomy[gangId].cash : 0)}</span></div>
    </div>
    <button class="btn btn-blood btn-full" id="launch-raid" style="margin-top:10px;">Baskını Başlat</button>
  `;
  modal.innerHTML = html;

  const slotsEl = document.getElementById("raid-role-slots");
  let slotIndex = 0;
  Object.keys(roleCounts).forEach(roleId => {
    for (let i=0; i<roleCounts[roleId]; i++) {
      const roleName = roleSlotLabel(roleId);
      const available = roleSlotAvailableCrew(roleId);
      const div = document.createElement("div");
      div.className = "role-slot";
      div.innerHTML = `${roleName}
        <select data-slot="${slotIndex}" data-role="${roleId}">
          <option value="">— Boş —</option>
          ${available.map(c => `<option value="${c.id}">${c.name} (Sadakat ${Math.round(c.loyalty)})</option>`).join("")}
        </select>`;
      slotsEl.appendChild(div);
      slotIndex++;
    }
  });

  document.getElementById("close-raid-modal").addEventListener("click", closeModal);
  document.getElementById("launch-raid").addEventListener("click", () => {
    const crewIds = Array.from(slotsEl.querySelectorAll("select")).map(s => s.value).filter(Boolean);
    if (crewIds.length < op.requiredRoles.length) {
      toast("Ekip Eksik", "Tüm rolleri doldurmalısın.", "negative");
      return;
    }
    if (new Set(crewIds).size !== crewIds.length) {
      toast("Aynı Kişi Birden Fazla Role Atanamaz", "Her ekip üyesi sadece bir role atanabilir.", "negative");
      return;
    }
    const raidCrew = crewIds.map(cid => state.crew.find(c => c.id === cid)).filter(Boolean);
    const playerCrew = raidCrew.slice(0, 6).map(c => {
      const weapon = cbDetermineCrewWeapon(c);
      return {
        gameCharacterId: c.id, name: c.name, weapon,
        magAmmo: CB_WEAPONS[weapon].magSize, spareMags: 2,
        armorQuality: cbDetermineCrewArmor(c), attributes: c.attributes || null,
        consumables: { sersemletici: 1, kirilma_sarji: 1 }, // en riskli operasyon, ekstra donanım
      };
    });

    if (playerCrew.length === 0) {
      toast("Ekip Eksik", "Baskın için uygun ekip bulunamadı.", "negative");
      return;
    }

    crewIds.forEach(cid => {
      const c = state.crew.find(x => x.id === cid);
      if (c) c.assignedTo = "hideoutraid:" + gangId;
    });

    const guardWeapons = ["makineli_low", "tabanca_low", "tufek_low", "pompali_low", "tabanca_low"];
    const enemyRoster = guardWeapons.map((weapon, i) => ({
      name: `${gang.name.split(" ")[0]} Muhafız ${i + 1}`,
      weapon, magAmmo: CB_WEAPONS[weapon].magSize, spareMags: 1,
      personality: i % 2 === 0 ? "agresif" : "savunmaci",
      armorQuality: "standart",
    }));

    closeModal();
    state.speedBeforeCombat = state.speed;
    state.speed = 0;
    document.getElementById("cb-embedded-overlay").classList.add("active");
    cbInitEmbedded({
      mapType: "hideout",
      playerCrew,
      enemyRoster,
      ambushInitiator: "player",
      onComplete: (result) => {
        crewIds.forEach(cid => { const c = state.crew.find(x => x.id === cid); if (c) c.assignedTo = null; });
        applyCombatResultToGame(result,
          () => {
            const econ = state.gangEconomy[gangId];
            const stolen = econ ? econ.cash : 0;
            state.cash += stolen;
            if (econ) econ.cash = 0;
            state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 30 * (state.modifiers.heatGainMult || 1));
            state.gangRelations[gangId].hostility = Math.min(100, state.gangRelations[gangId].hostility + 35);
            toast("Baskın Başarılı!", `${gang.name}'ın hideout'undan ${fmt(stolen)} ele geçirdin.`, "positive");
          },
          () => {
            state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 40 * (state.modifiers.heatGainMult || 1));
            toast("Baskın Başarısız!", `${gang.name} seni geri püskürttü.`, "negative");
          }
        );
      },
    });
  });

  backdrop.classList.add("open");
}

// ---------------- MASTER RENDER ----------------
function render() {
  renderTopbar();
  renderMap();
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === state.activeTab));

  switch (state.activeTab) {
    case "district": renderDistrictTab(); break;
    case "drugs": renderDrugsTab(); break;
    case "heist": renderHeistTab(); break;
    case "armory": renderArmoryTab(); break;
    case "garage": renderGarageTab(); break;
    case "crew": renderCrewTab(); break;
    case "empire": renderEmpireTab(); break;
  }

  requestAutoSave();
}

function openDistrictModal(id) {
  state.selectedDistrict = id;
  state.activeTab = "district";
  render();
}

// ---------------- GAME TICK (gerçek zamanlı ilerleme) ----------------
function gameTick() {
  if (state.speed === 0) return;
  const minutesPassed = GAME_CONSTANTS.minutesPerTick * state.speed;
  state.minutes += minutesPassed;
  if (state.minutes >= 24 * 60) { state.minutes -= 24 * 60; state.day++; }

  // İşe alım havuzu her 3 günde bir otomatik yenilenir (henüz işe alınmamış adaylar değişir)
  const poolAgeMinLimit = 3 * 24 * 60;
  if (!state.recruitPool || state.recruitPool.length === 0 ||
      state.recruitPoolGeneratedAtMin === undefined ||
      nowAbsoluteMin() - state.recruitPoolGeneratedAtMin >= poolAgeMinLimit) {
    generateRecruitPool();
  }

  // Pasif işletme geliri (saatlik oranı tick'e böl)
  let hourlyIncome = 0, hourlyHeat = 0;
  playerDistrictIds().forEach(id => {
    state.districts[id].businesses.forEach(b => {
      const t = BUSINESS_TYPES.find(x => x.id === b.typeId);
      hourlyIncome += t.baseIncomePerHour * (state.modifiers.businessIncomeMult || 1);
      hourlyHeat += t.heatPerHour * (state.modifiers.heatGainMult || 1);
    });
    if (state.districts[id].refinery) {
      const mat = RAW_MATERIALS[Math.floor(Math.random() * RAW_MATERIALS.length)];
      state.materialStock[mat.id] += Math.round(RAW_MATERIAL_PRODUCTION_PER_HOUR * (minutesPassed / 60));
    }
  });
  state.cash += hourlyIncome * (minutesPassed / 60);
  trackDailyIncome(hourlyIncome * (minutesPassed / 60), 0);
  const heatResistanceReduction = state.modifiers.heatResistanceMult ? (1 / state.modifiers.heatResistanceMult) : 1;
  state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + hourlyHeat * heatResistanceReduction * (minutesPassed / 60));

  // Satıcı / Dağıtım Amiri geliri
  processSalesIncome(minutesPassed);

  // Ekip maaşları (saatlik). Nakit yetmezse maaşlar ödenemez - bu durum sadakati
  // ciddi şekilde düşürür, üst üste ödenemezse (unpaidStreak eşiği aşılınca) ekip
  // üyesi küser ve kendiliğinden ayrılır.
  const totalWages = state.crew.reduce((s, c) => s + c.wage, 0) * (state.modifiers.wageMult || 1);
  const wageDue = totalWages * (minutesPassed / 60);
  if (wageDue > 0) {
    if (state.cash >= wageDue) {
      state.cash -= wageDue;
      trackDailyIncome(0, wageDue);
      state.crew.forEach(c => { c.unpaidStreak = 0; }); // maaş ödendi, seri sıfırlanır
    } else {
      // Nakit yetersiz: maaş ödenemiyor, ekip küskün ayrılır
      state.cash = 0;
      state.crew.forEach(c => {
        c.unpaidStreak = (c.unpaidStreak || 0) + 1;
        c.loyalty = Math.max(0, c.loyalty - 8); // ödenemeyen her tik'te ciddi sadakat kaybı
      });
      const quitters = state.crew.filter(c => c.unpaidStreak >= 3 || c.loyalty <= 0);
      if (quitters.length > 0) {
        state.crew = state.crew.filter(c => !quitters.includes(c));
        toast("Ekip Ayrıldı", `Maaş ödenemediği için ${quitters.map(c => c.name).join(", ")} ekibi terk etti.`, "negative");
      } else {
        toast("Maaş Ödenemedi", "Nakit yetersiz, ekibin sadakati düşüyor.", "negative");
      }
    }
  }

  // Ekip sadakati zamanla doğal düşer (modifier ile yavaşlatılabilir)
  const loyaltyDecay = 0.02 * (state.modifiers.loyaltyDecayMult || 1) * (minutesPassed / 60);
  state.crew.forEach(c => { c.loyalty = Math.max(0, c.loyalty - loyaltyDecay); });

  // Isı doğal düşüş
  state.heat = Math.max(0, state.heat - GAME_CONSTANTS.heatDecayPerHour * (minutesPassed / 60));

  // --- Araç durumlarını kontrolü (tüm taraflar) ---
  state.vehicles.forEach(v => {
    if (v.status !== "transit") return;

    // Kaçakçılık araçları için yol üstünde yakalanma riski (ısıya bağlı + araç plaka durumuna bağlı)
    if (v.faction === "player" && v.kind === "weapon_smuggle" && !v.riskChecked) {
      const midPoint = v.departedAtMin + (v.totalTravelMin / 2);
      if (state.minutes >= midPoint) {
        v.riskChecked = true;
        let catchChance = Math.min(35, state.heat * 0.4);
        // Mimlenmiş plakayla sürülen araç: yakalanma şansı çok ciddi artar (polis bu plakayı tanıyor)
        if (v.garageVehicleId) {
          const gv = state.garage.find(g => g.id === v.garageVehicleId);
          if (gv && gv.flagged) {
            catchChance = Math.min(90, catchChance + 45);
          } else if (gv && gv.replatedRecently) {
            // Yeni değiştirilmiş plaka: normalden biraz daha yüksek risk (henüz "temiz" güven oluşmadı)
            catchChance = Math.min(60, catchChance + 10);
          }
        }
        if (Math.random() * 100 < catchChance) {
          v.status = "caught";
          state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 15);
          const hasMechanic = state.crew.some(c => c.role === "tamirci" && !c.assignedTo);
          if (hasMechanic && Math.random() < 0.5) {
            const recovered = Math.max(1, Math.round(v.amount * 0.4));
            if (v.itemType === "consumables") {
              state.armory[v.itemType][v.itemId] = (state.armory[v.itemType][v.itemId] || 0) + recovered;
            } else {
              for (let i = 0; i < recovered; i++) state.armory[v.itemType][v.itemId].push({ id: uid(), durability: 100 });
            }
            toast("Sevkiyat Yakalandı — Kısmen Kurtarıldı", `Tamirci sayesinde ${recovered} adet ekipman kurtarıldı.`, "neutral");
          } else {
            toast("Sevkiyat Yakalandı!", `Kaçakçılık aracın polis tarafından durduruldu. Yük ve para kayıp.`, "negative");
          }
          logEvent("Kaçakçılık sevkiyatı polis tarafından yakalandı.");
          // Eğer filodan bir araç kullanılıyorduysa, kaçakçılıkta yakalanma aracı da ciddi hasar verir
          // ve polis tarafından tespit edildiği için plakası "mimlenir" (satış değeri düşer, gelecekte yakalanma riski artar).
          if (v.garageVehicleId) {
            const gv = state.garage.find(g => g.id === v.garageVehicleId);
            if (gv) {
              const def = VEHICLES.find(x => x.id === gv.vehicleTypeId);
              gv.durability = Math.max(0, gv.durability - Math.round(def.maxDurability * 0.5));
              gv.status = "available";
              gv.currentDistrictId = v.fromId;
              gv.flagged = true;
              gv.replatedRecently = false;
              if (gv.durability <= 0) toast("Araç Hasar Gördü", `${def.name} ağır hasar aldı, kullanılamaz durumda.`, "negative");
              toast("Araç Mimlendi", `${def.name} (${gv.plate}) polis kayıtlarına girdi. Bu araçla risk artık çok daha yüksek.`, "negative");
            }
          }
        }
      }
    }

    if (v.status !== "transit" || nowAbsoluteMin() < v.arrivesAtMin) return;
    v.status = "arrived";

    if (v.faction === "player" && v.kind === "shipment") {
      state.materialStock[v.material] += v.amount;
      logEvent(`Sevkiyat ulaştı: ${districtById(v.toId).name}'e ${v.amount} birim malzeme.`);
      if (v.garageVehicleId) {
        const gv = state.garage.find(g => g.id === v.garageVehicleId);
        if (gv) { gv.status = "available"; gv.currentDistrictId = v.toId; }
      }
    } else if (v.faction === "player" && v.kind === "weapon_smuggle") {
      if (v.itemType === "consumables") {
        state.armory[v.itemType][v.itemId] = (state.armory[v.itemType][v.itemId] || 0) + v.amount;
      } else {
        // weapons/armors: kaçak sevkiyat her biri kendi kimliği olan gerçek kopyalar ekler
        for (let i = 0; i < v.amount; i++) state.armory[v.itemType][v.itemId].push({ id: uid(), durability: 100 });
      }
      const item = findArmoryItem(v.itemType, v.itemId);
      logEvent(`Kaçak sevkiyat ulaştı: ${item.name} x${v.amount}.`);
      toast("Kaçakçılık Başarılı", `${item.name} envanterine eklendi.`, "positive");
      if (v.garageVehicleId) {
        const gv = state.garage.find(g => g.id === v.garageVehicleId);
        if (gv) { gv.status = "available"; gv.currentDistrictId = v.toId; }
      }
    } else if (v.faction !== "player" && v.kind === "shipment") {
      // Rakip çete nakliyesi hedefe ulaştı -> stoğuna ekle
      const econ = state.gangEconomy[v.faction];
      if (econ) econ.materialStock[v.material] = (econ.materialStock[v.material] || 0) + v.amount;
    } else if (v.faction !== "player" && v.kind === "heist_escape") {
      // Rakip çete soygundan kaçıp hideout'a ulaştı -> parayı gerçekten kazanır
      const econ = state.gangEconomy[v.faction];
      if (econ) econ.cash += v.payout || 0;
      const gang = RIVAL_GANGS.find(g => g.id === v.faction);
      if (gang) logEvent(`${gang.name} bir soygunu tamamladı.`);
    }
  });
  state.vehicles = state.vehicles.filter(v => v.status === "transit");

  // --- Rakip çete AI ekonomisi & operasyonları ---
  runRivalGangAI(minutesPassed);
  runPoliceAI(minutesPassed);
  runSpyIntelGeneration(minutesPassed);
  state.intelMarkers = state.intelMarkers.filter(m => nowAbsoluteMin() < m.expiresAtMin);

  // Yaralanma iyileşme kontrolü (Doktor mekaniği)
  processInjuryHealing();
  processCaptiveHealing(minutesPassed);

  // Karaborsa ilanları: yeni ilan üretimi ve süresi dolanların temizlenmesi
  maybeSpawnBlackMarketListing();
  state.blackMarketListings = state.blackMarketListings.filter(l => nowAbsoluteMin() < l.expiresAtMin);

  // Laboratuvar üretim kontrolü
  playerDistrictIds().forEach(id => {
    const lab = state.districts[id].lab;
    if (lab && lab.activeBatch && nowAbsoluteMin() >= lab.activeBatch.finishesAtMin) {
      state.drugStock[lab.activeBatch.productId] += lab.activeBatch.yieldAmount;
      logEvent(`${districtById(id).name} laboratuvarı üretimi tamamladı.`);
      lab.activeBatch = null;
    }
    // Üretici atanmış ve otomatik üretim modu ayarlanmış laboratuvarlar, batch
    // boşalır boşalmaz otomatik olarak yeni bir parti başlatır (oyuncu tıklamadan).
    if (lab) tryAutoStartProduction(id);
  });

  // Soygun kontrolü - aynı anda birden fazlası bitmişse bile sadece ilkini işleriz,
  // combat açıldığı an state.speed=0 olacağı için gameTick zaten duracak.
  const dueHeist = state.activeHeists.find(h => nowAbsoluteMin() >= h.finishesAtMin);
  if (dueHeist) {
    state.activeHeists = state.activeHeists.filter(h => h !== dueHeist);
    resolveHeist(dueHeist);
  }

  // Sokak satışı ilanları: süresi dolanları çöz (combat gerektirmez, anlık işlenebilir)
  const dueSales = state.activeStreetSales.filter(s => nowAbsoluteMin() >= s.finishesAtMin);
  if (dueSales.length > 0) {
    state.activeStreetSales = state.activeStreetSales.filter(s => !dueSales.includes(s));
    dueSales.forEach(resolveStreetSale);
  }

  // Karşı-operasyon kontrolü (rakip araçlarına pusu/soygun/kaçırma) - aynı anda
  // birden fazlası bitmişse sadece ilkini işleriz, combat açılınca zaman zaten duracak.
  const dueOp = state.activeCounterOps.find(op => nowAbsoluteMin() >= op.finishesAtMin);
  if (dueOp) {
    state.activeCounterOps = state.activeCounterOps.filter(op => op !== dueOp);
    resolveCounterOp(dueOp);
  }

  // Baskın riski (yüksek ısıda rastgele gelir kaybı)
  if (state.heat >= GAME_CONSTANTS.raidHeatThreshold && Math.random() < 0.02 * state.speed) {
    const loss = Math.round(state.cash * 0.1);
    state.cash -= loss;
    state.heat = Math.max(0, state.heat - 25);
    toast("Polis Baskını!", `Operasyonların hedef alındı. ${fmt(loss)} kaybettin.`, "negative");
    logEvent(`Polis baskını: ${fmt(loss)} kayıp.`);
  }

  // Rastgele olaylar
  if (Math.random() < GAME_CONSTANTS.randomEventChancePerTick * state.speed) {
    triggerRandomEvent();
  }

  if (state.cash < 0) state.cash = 0;
  render();
}

function logEvent(text) {
  state.log.push({ day: state.day, time: fmtTime(state.minutes), text });
}

// ---------------- RAKİP ÇETE AI ----------------
function rivalDistrictIds(gangId) {
  return Object.keys(state.districts).filter(id => state.districts[id].owner === `rival:${gangId}`);
}

function runRivalGangAI(minutesPassed) {
  RIVAL_GANGS.forEach(gang => {
    const territories = rivalDistrictIds(gang.id);
    if (territories.length === 0) return; // yenilmiş çete, artık aktif değil
    const econ = state.gangEconomy[gang.id];
    if (!econ) return;

    // Küçük ihtimalle yeni bir nakliye başlat (hammadde -> hideout'a doğru simüle)
    const activeVehiclesForGang = state.vehicles.filter(v => v.faction === gang.id).length;
    if (activeVehiclesForGang < 2 && Math.random() < 0.05 * (minutesPassed / 5)) {
      startRivalShipment(gang, territories);
    }

    // Küçük ihtimalle bir soygun başlat
    const gangHasActiveHeist = state.vehicles.some(v => v.faction === gang.id && v.kind === "heist_escape");
    if (!gangHasActiveHeist && Math.random() < 0.03 * (minutesPassed / 5)) {
      startRivalHeist(gang, territories);
    }
  });
}

function startRivalShipment(gang, territories) {
  if (territories.length < 1) return;
  const fromId = territories[Math.floor(Math.random() * territories.length)];
  const toId = gang.hideoutDistrict;
  if (!state.districts[toId] || state.districts[toId].owner !== `rival:${gang.id}`) return;
  const startNode = districtRoadNode(fromId);
  const endNode = districtRoadNode(toId);
  const route = findRoute(startNode, endNode);
  if (!route) return;

  const material = RAW_MATERIALS[Math.floor(Math.random() * RAW_MATERIALS.length)];
  const travelTime = routeTravelMinutes(route.totalDist, 1);

  state.vehicles.push({
    id: uid(), faction: gang.id, kind: "shipment", status: "transit",
    fromId, toId, material: material.id, amount: 15 + Math.floor(Math.random()*15),
    routeNodes: route.nodeIndices,
    departedAtMin: state.minutes,
    arrivesAtMin: nowAbsoluteMin() + travelTime, totalTravelMin: travelTime,
  });
}

function startRivalHeist(gang, territories) {
  const fromId = territories[Math.floor(Math.random() * territories.length)];
  const toId = gang.hideoutDistrict;
  if (!state.districts[toId] || state.districts[toId].owner !== `rival:${gang.id}`) return;
  const startNode = districtRoadNode(fromId);
  const endNode = districtRoadNode(toId);
  const route = findRoute(startNode, endNode);
  if (!route) return;

  const payout = 8000 + Math.floor(Math.random() * 25000);
  const travelTime = routeTravelMinutes(route.totalDist, 1);

  state.vehicles.push({
    id: uid(), faction: gang.id, kind: "heist_escape", status: "transit",
    fromId, toId, payout,
    routeNodes: route.nodeIndices,
    departedAtMin: state.minutes,
    arrivesAtMin: nowAbsoluteMin() + travelTime, totalTravelMin: travelTime,
  });
}

// ---------------- POLİS AI ----------------
function runPoliceAI(minutesPassed) {
  const activePatrols = state.vehicles.filter(v => v.faction === "polis").length;
  if (activePatrols >= 3) return;
  if (Math.random() < 0.04 * (minutesPassed / 5)) {
    startPolicePatrol();
  }
}

function startPolicePatrol() {
  const allDistrictIds = DISTRICTS.map(d => d.id);
  const fromId = POLICE_FACTION.hideoutDistrict;
  // Isı yüksekse oyuncunun bölgelerine yönelme eğilimi artsın
  let toId;
  if (state.heat > 50 && Math.random() < 0.6 && playerDistrictIds().length > 0) {
    const owned = playerDistrictIds();
    toId = owned[Math.floor(Math.random() * owned.length)];
  } else {
    toId = allDistrictIds[Math.floor(Math.random() * allDistrictIds.length)];
  }
  if (toId === fromId) return;

  const startNode = districtRoadNode(fromId);
  const endNode = districtRoadNode(toId);
  const route = findRoute(startNode, endNode);
  if (!route) return;
  const travelTime = routeTravelMinutes(route.totalDist, 1);

  state.vehicles.push({
    id: uid(), faction: "polis", kind: "patrol", status: "transit",
    fromId, toId,
    routeNodes: route.nodeIndices,
    departedAtMin: state.minutes,
    arrivesAtMin: nowAbsoluteMin() + travelTime, totalTravelMin: travelTime,
  });
}

function triggerRandomEvent() {
  const ev = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
  if (ev.type === "positive") {
    const bonus = 1500 + Math.floor(Math.random() * 4000);
    state.cash += bonus;
    toast(ev.name, ev.description + ` (+${fmt(bonus)})`, "positive");
  } else {
    // Ceza mevcut nakitle orantılı (max %8) + küçük sabit taban, erken oyunu yıkıcı olmaktan kurtarır
    const penalty = Math.round(Math.min(4000, 400 + state.cash * 0.08));
    state.cash = Math.max(0, state.cash - penalty);
    state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 4);
    toast(ev.name, ev.description + ` (-${fmt(penalty)})`, "negative");
  }
  logEvent(ev.name);
}

// ---------------- INIT & EVENT WIRING ----------------
function wireStaticEvents() {
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.addEventListener("click", () => {
      state.activeTab = b.dataset.tab;
      if (b.dataset.tab !== "district") state.selectedDistrict = state.selectedDistrict; // keep selection
      render();
    });
  });

  document.querySelectorAll(".speed-btn").forEach(b => {
    b.addEventListener("click", () => {
      state.speed = parseInt(b.dataset.speed, 10);
      document.querySelectorAll(".speed-btn").forEach(x => x.classList.toggle("active", x === b));
    });
  });

  document.getElementById("district-modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "district-modal-backdrop") closeModal();
  });
}

function startGame() {
  document.getElementById("intro-screen").classList.add("hidden");
  document.getElementById("setup-screen").style.display = "flex";
  runSetupWizard();
}

function launchGameProper() {
  document.getElementById("setup-screen").style.display = "none";
  document.getElementById("app").style.display = "grid";
  mountGameShell();
  initState();
  wireStaticEvents();
  render();
  setInterval(gameTick, GAME_CONSTANTS.tickIntervalMs);
}

// Kayıtlı bir oyunu localStorage'dan yükleyip doğrudan başlatır (initState çağırmaz,
// çünkü mevcut ilerlemenin üzerine yazmamalıyız).
function continueGameFromSave() {
  document.getElementById("intro-screen").classList.add("hidden");
  document.getElementById("app").style.display = "grid";
  mountGameShell();
  const loaded = loadGameFromLocalStorage();
  if (!loaded) {
    toast("Kayıt Bulunamadı", "Kayıtlı oyun yüklenemedi, yeni oyun başlatılıyor.", "negative");
    startGame();
    return;
  }
  wireStaticEvents();
  render();
  setInterval(gameTick, GAME_CONSTANTS.tickIntervalMs);
}

// Soygun modalı ve diğer paylaşılan DOM elementlerini bir kere ekler (hem yeni
// oyun hem kayıttan devam etme akışında ortak kullanılır).
function mountGameShell() {
  if (document.getElementById("district-modal-backdrop")) return; // zaten eklenmiş
  const backdrop = document.createElement("div");
  backdrop.id = "district-modal-backdrop";
  backdrop.innerHTML = `<div id="district-modal" style="position:relative;"></div>`;
  document.body.appendChild(backdrop);
}

document.getElementById("start-btn").addEventListener("click", startGame);

document.getElementById("continue-btn").addEventListener("click", continueGameFromSave);

if (hasSavedGame()) {
  document.getElementById("continue-btn").style.display = "block";
}

// ---------------- SETUP WIZARD ----------------
const setupWizard = {
  stepIndex: 0,
  steps: ["identity", "origin", "leadership", "orgname", "ideology", "difficulty", "summary"],
};

function runSetupWizard() {
  setupWizard.stepIndex = 0;
  renderSetupStep();
}

function renderSetupProgress() {
  const track = document.getElementById("setup-progress");
  track.innerHTML = setupWizard.steps.map((s, i) => {
    let cls = "setup-dot";
    if (i < setupWizard.stepIndex) cls += " done";
    if (i === setupWizard.stepIndex) cls += " current";
    return `<div class="${cls}"></div>`;
  }).join("");
}

function goToStep(delta) {
  setupWizard.stepIndex = Math.max(0, Math.min(setupWizard.steps.length - 1, setupWizard.stepIndex + delta));
  renderSetupStep();
}

function renderSetupStep() {
  renderSetupProgress();
  const step = setupWizard.steps[setupWizard.stepIndex];
  const content = document.getElementById("setup-step-content");

  if (step === "identity") {
    content.innerHTML = `
      <div class="setup-eyebrow">Adım 1 / 7</div>
      <div class="setup-title">Kimliğin</div>
      <div class="setup-desc">Bu şehirde herkesin bildiği bir isim, bir de kimsenin bilmediği bir kod adı olur.</div>
      <label class="setup-label">Gerçek İsim</label>
      <input type="text" class="setup-input" id="input-leader-name" placeholder="Örn. Kemal Aydın" value="${state.profile.leaderName}">
      <label class="setup-label">Kod Adı</label>
      <input type="text" class="setup-input" id="input-code-name" placeholder="Örn. Kurt" value="${state.profile.codeName}">
      <div class="setup-nav">
        <div></div>
        <button class="btn btn-gold" id="setup-next">Devam Et</button>
      </div>
    `;
    document.getElementById("setup-next").addEventListener("click", () => {
      const name = document.getElementById("input-leader-name").value.trim();
      const code = document.getElementById("input-code-name").value.trim();
      if (!name || !code) { toast("Eksik Bilgi", "İsim ve kod adı gerekli.", "negative"); return; }
      state.profile.leaderName = name;
      state.profile.codeName = code;
      goToStep(1);
    });
    return;
  }

  if (step === "origin") {
    content.innerHTML = `
      <div class="setup-eyebrow">Adım 2 / 7</div>
      <div class="setup-title">Geçmişin</div>
      <div class="setup-desc">Bu işe nasıl bulaştın? Geçmişin, bugün elinde ne olduğunu belirler.</div>
      <div id="origin-options"></div>
      <div class="setup-nav">
        <button class="btn btn-outline" id="setup-back">Geri</button>
        <button class="btn btn-gold" id="setup-next">Devam Et</button>
      </div>
    `;
    const optionsEl = document.getElementById("origin-options");
    ORIGINS.forEach(o => {
      const card = document.createElement("div");
      card.className = "option-card" + (state.profile.originId === o.id ? " selected" : "");
      card.innerHTML = `
        <div class="option-title">${o.name}<span class="check">✓</span></div>
        <div class="option-desc">${o.description}</div>
        <div class="option-buff">✦ ${o.buff}</div>
      `;
      card.addEventListener("click", () => {
        state.profile.originId = o.id;
        renderSetupStep();
      });
      optionsEl.appendChild(card);
    });
    document.getElementById("setup-back").addEventListener("click", () => goToStep(-1));
    document.getElementById("setup-next").addEventListener("click", () => {
      if (!state.profile.originId) { toast("Seçim Gerekli", "Bir geçmiş seç.", "negative"); return; }
      goToStep(1);
    });
    return;
  }

  if (step === "leadership") {
    content.innerHTML = `
      <div class="setup-eyebrow">Adım 3 / 7</div>
      <div class="setup-title">Liderlik Tarzın</div>
      <div class="setup-desc">Adamların seni nasıl tanıyacak? Bu, sokakta nasıl hareket ettiğini belirler.</div>
      <div id="leadership-options"></div>
      <div class="setup-nav">
        <button class="btn btn-outline" id="setup-back">Geri</button>
        <button class="btn btn-gold" id="setup-next">Devam Et</button>
      </div>
    `;
    const optionsEl = document.getElementById("leadership-options");
    LEADERSHIP_STYLES.forEach(l => {
      const card = document.createElement("div");
      card.className = "option-card" + (state.profile.leadershipId === l.id ? " selected" : "");
      card.innerHTML = `
        <div class="option-title">${l.name}<span class="check">✓</span></div>
        <div class="option-desc">${l.description}</div>
        <div class="option-buff">✦ ${l.buff}</div>
      `;
      card.addEventListener("click", () => {
        state.profile.leadershipId = l.id;
        renderSetupStep();
      });
      optionsEl.appendChild(card);
    });
    document.getElementById("setup-back").addEventListener("click", () => goToStep(-1));
    document.getElementById("setup-next").addEventListener("click", () => {
      if (!state.profile.leadershipId) { toast("Seçim Gerekli", "Bir liderlik tarzı seç.", "negative"); return; }
      goToStep(1);
    });
    return;
  }

  if (step === "orgname") {
    content.innerHTML = `
      <div class="setup-eyebrow">Adım 4 / 7</div>
      <div class="setup-title">Örgütünün Adı</div>
      <div class="setup-desc">Sokakta fısıldanacak, polis dosyalarında geçecek isim.</div>
      <label class="setup-label">Örgüt İsmi</label>
      <input type="text" class="setup-input" id="input-org-name" placeholder="Örn. Kara Kartallar" value="${state.profile.orgName}">
      <div class="setup-nav">
        <button class="btn btn-outline" id="setup-back">Geri</button>
        <button class="btn btn-gold" id="setup-next">Devam Et</button>
      </div>
    `;
    document.getElementById("setup-back").addEventListener("click", () => goToStep(-1));
    document.getElementById("setup-next").addEventListener("click", () => {
      const name = document.getElementById("input-org-name").value.trim();
      if (!name) { toast("Eksik Bilgi", "Örgüt ismi gerekli.", "negative"); return; }
      state.profile.orgName = name;
      goToStep(1);
    });
    return;
  }

  if (step === "ideology") {
    content.innerHTML = `
      <div class="setup-eyebrow">Adım 5 / 7</div>
      <div class="setup-title">İdeolojin</div>
      <div class="setup-desc">Örgütünün neye inandığı, nasıl büyüdüğünü belirler.</div>
      <div id="ideology-options"></div>
      <div class="setup-nav">
        <button class="btn btn-outline" id="setup-back">Geri</button>
        <button class="btn btn-gold" id="setup-next">Devam Et</button>
      </div>
    `;
    const optionsEl = document.getElementById("ideology-options");
    IDEOLOGIES.forEach(i => {
      const card = document.createElement("div");
      card.className = "option-card" + (state.profile.ideologyId === i.id ? " selected" : "");
      card.innerHTML = `
        <div class="option-title">${i.name}<span class="check">✓</span></div>
        <div class="option-desc">${i.description}</div>
        <div class="option-buff">✦ ${i.buff}</div>
        ${i.drawback ? `<div class="option-drawback">✕ ${i.drawback}</div>` : ""}
      `;
      card.addEventListener("click", () => {
        state.profile.ideologyId = i.id;
        renderSetupStep();
      });
      optionsEl.appendChild(card);
    });
    document.getElementById("setup-back").addEventListener("click", () => goToStep(-1));
    document.getElementById("setup-next").addEventListener("click", () => {
      if (!state.profile.ideologyId) { toast("Seçim Gerekli", "Bir ideoloji seç.", "negative"); return; }
      goToStep(1);
    });
    return;
  }

  if (step === "difficulty") {
    content.innerHTML = `
      <div class="setup-eyebrow">Adım 6 / 7</div>
      <div class="setup-title">Zorluk Seviyesi</div>
      <div class="setup-desc">Bu seçim ekonomini (gelir/gider) ve karşılaşacağın rakiplerin/operasyonların zorluğunu belirler.</div>
      <div id="difficulty-options"></div>
      <div class="setup-nav">
        <button class="btn btn-outline" id="setup-back">Geri</button>
        <button class="btn btn-gold" id="setup-next">Devam Et</button>
      </div>
    `;
    const optionsEl = document.getElementById("difficulty-options");
    DIFFICULTY_LEVELS.forEach(d => {
      const card = document.createElement("div");
      card.className = "option-card" + (state.profile.difficultyId === d.id ? " selected" : "");
      card.innerHTML = `
        <div class="option-title">${d.name}<span class="check">✓</span></div>
        <div class="option-desc">${d.description}</div>
        <div class="option-buff">✦ Gelir x${d.incomeMult} · Gider x${d.expenseMult}</div>
        <div class="option-buff">✦ Rakip Gücü x${d.rivalStrengthMult} · Operasyon Başarısı ${d.operationSuccessBonus >= 0 ? '+' : ''}${d.operationSuccessBonus}</div>
      `;
      card.addEventListener("click", () => {
        state.profile.difficultyId = d.id;
        renderSetupStep();
      });
      optionsEl.appendChild(card);
    });
    document.getElementById("setup-back").addEventListener("click", () => goToStep(-1));
    document.getElementById("setup-next").addEventListener("click", () => {
      if (!state.profile.difficultyId) { toast("Seçim Gerekli", "Bir zorluk seviyesi seç.", "negative"); return; }
      goToStep(1);
    });
    return;
  }

  if (step === "summary") {
    const origin = ORIGINS.find(o => o.id === state.profile.originId);
    const leadership = LEADERSHIP_STYLES.find(l => l.id === state.profile.leadershipId);
    const ideology = IDEOLOGIES.find(i => i.id === state.profile.ideologyId);
    const difficulty = DIFFICULTY_LEVELS.find(d => d.id === state.profile.difficultyId);
    content.innerHTML = `
      <div class="setup-eyebrow">Adım 7 / 7</div>
      <div class="setup-title">${state.profile.orgName}</div>
      <div class="setup-desc">${state.profile.codeName} olarak da bilinen ${state.profile.leaderName}, İstanbul'un gölgelerinde imparatorluğunu kurmaya hazır.</div>
      <div class="card">
        <div class="setup-summary-row"><span class="label">Geçmiş</span><span class="value">${origin.name}</span></div>
        <div class="setup-summary-row"><span class="label">Liderlik</span><span class="value">${leadership.name}</span></div>
        <div class="setup-summary-row"><span class="label">İdeoloji</span><span class="value">${ideology.name}</span></div>
        <div class="setup-summary-row"><span class="label">Zorluk</span><span class="value">${difficulty.name}</span></div>
      </div>
      <div class="setup-nav">
        <button class="btn btn-outline" id="setup-back">Geri</button>
        <button class="btn btn-gold" id="setup-launch">İmparatorluğu Kur</button>
      </div>
    `;
    document.getElementById("setup-back").addEventListener("click", () => goToStep(-1));
    document.getElementById("setup-launch").addEventListener("click", launchGameProper);
    return;
  }
}
