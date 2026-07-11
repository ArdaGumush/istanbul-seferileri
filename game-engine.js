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
  gangRelations: {}, // gangId -> { hostility: 0-100 }
  gangEconomy: {}, // gangId -> { cash, materialStock, drugStock }
  activeCounterOps: [], // { type, targetVehicleId, crewIds, finishesAtMin, successChance }

  armory: { weapons: {}, armors: {}, consumables: {} }, // id -> adet
  blackMarketListings: [], // { id, itemType, itemId, price, sourceLabel, expiresAtMin, amount }

  log: [],
};

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
  // Oyuncuya başlangıç bölgesi ver
  state.districts["tarlabasi"].owner = "player";
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

  if (state.modifiers.startingCashBonus) state.cash += state.modifiers.startingCashBonus;
  if (state.modifiers.freeCrewOnStart) {
    const roleId = "sokak_lideri";
    state.crew.push({
      id: uid(), name: randomName(), role: roleId,
      wage: Math.round(CREW_ROLES[roleId].baseWage * 0.6),
      loyalty: 75, assignedTo: null,
    });
  }

  WEAPONS.forEach(w => { state.armory.weapons[w.id] = 0; });
  ARMORS.forEach(a => { state.armory.armors[a.id] = 0; });
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
  document.getElementById("stat-cash").textContent = fmt(state.cash);
  document.getElementById("stat-districts").textContent = playerDistrictIds().length;
  document.getElementById("stat-crew").textContent = state.crew.length;
  document.getElementById("heat-value").textContent = Math.round(state.heat);
  document.getElementById("heat-bar-fill").style.width = state.heat + "%";
  document.getElementById("clock-day").textContent = state.day;
  document.getElementById("clock-time").textContent = fmtTime(state.minutes);
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
      if (rivalGang) pulse.setAttribute("stroke", rivalGang.color);
      g.appendChild(pulse);
    }

    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", d.x); dot.setAttribute("cy", d.y);
    dot.setAttribute("class", "district-dot " + statusClass + (state.selectedDistrict === d.id ? " selected" : ""));
    if (rivalGang) {
      dot.setAttribute("fill", rivalGang.color);
      dot.setAttribute("stroke", rivalGang.color);
    }
    g.appendChild(dot);

    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", d.x); label.setAttribute("y", d.y - 3.6);
    label.setAttribute("class", "district-label " + (statusClass === "owned" ? "owned" : ""));
    if (rivalGang) label.setAttribute("fill", rivalGang.color);
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
      <div class="card-stat">Temel Başarı: <span class="num">%${op.baseSuccess}</span></div>
    </div>
    <button class="btn btn-blood btn-full" id="launch-counter-op" style="margin-top:10px;">Operasyonu Başlat</button>
  `;
  modal.innerHTML = html;

  const slotsEl = document.getElementById("op-role-slots");
  let slotIndex = 0;
  Object.keys(roleCounts).forEach(roleId => {
    for (let i=0; i<roleCounts[roleId]; i++) {
      const role = CREW_ROLES[roleId];
      const available = state.crew.filter(c => c.role === roleId && !c.assignedTo);
      const div = document.createElement("div");
      div.className = "role-slot";
      div.innerHTML = `${role.name}
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
    let successChance = op.baseSuccess;
    crewIds.forEach(cid => {
      const c = state.crew.find(x => x.id === cid);
      c.assignedTo = "counterop:" + vehicleId;
      successChance += Math.round(c.loyalty / 20);
    });
    successChance = Math.min(92, successChance);

    state.activeCounterOps.push({
      type: opKey, targetVehicleId: vehicleId, crewIds,
      finishesAtMin: state.minutes + 6,
      successChance,
    });
    toast("Operasyon Başladı", `${op.name} için ekip yola çıktı.`, "neutral");
    closeModal();
    render();
  });

  backdrop.classList.add("open");
}

function resolveCounterOp(op) {
  const v = state.vehicles.find(x => x.id === op.targetVehicleId);
  op.crewIds.forEach(cid => {
    const c = state.crew.find(x => x.id === cid);
    if (c) c.assignedTo = null;
  });

  const opDef = COUNTER_OPS[op.type];
  // Hedef araç hâlâ yolda değilse (zaten vardıysa) operasyon boşa gider
  if (!v || v.status !== "transit") {
    toast("Hedef Kayboldu", `${opDef.name} için hedef zaten hedefine ulaşmış.`, "negative");
    return;
  }

  const success = Math.random() * 100 < op.successChance;
  const gang = RIVAL_GANGS.find(g => g.id === v.faction);

  if (success) {
    v.status = "intercepted";
    if (op.type === "ambush" && v.kind === "heist_escape") {
      const stolen = Math.round((v.payout || 0) * (0.7 + Math.random()*0.3));
      state.cash += stolen;
      toast("Kaçış Aracı Durduruldu!", `${gang.name}'ın soygun parasından ${fmt(stolen)} çaldın.`, "positive");
    } else if (op.type === "hijack" && v.kind === "shipment") {
      state.materialStock[v.material] = (state.materialStock[v.material]||0) + v.amount;
      toast("Nakliye Soyuldu!", `${gang.name}'dan ${v.amount} birim malzeme çaldın.`, "positive");
    } else if (op.type === "kidnap") {
      state.gangRelations[v.faction].hostility = Math.min(100, state.gangRelations[v.faction].hostility + 15);
      const econ = state.gangEconomy[v.faction];
      if (econ) econ.cash = Math.max(0, econ.cash - 5000);
      toast("Operasyon Başarılı", `${gang.name}'ın adamları etkisiz hale getirildi.`, "positive");
    }
    state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 10 * (state.modifiers.heatGainMult||1));
  } else {
    state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 15 * (state.modifiers.heatGainMult||1));
    state.gangRelations[v.faction].hostility = Math.min(100, state.gangRelations[v.faction].hostility + 10);
    if (Math.random() < 0.3 && op.crewIds.length > 0) {
      const lostId = op.crewIds[Math.floor(Math.random()*op.crewIds.length)];
      state.crew = state.crew.filter(c => c.id !== lostId);
      toast("Operasyon Başarısız", `${opDef.name} çöktü. Bir adamını kaybettin.`, "negative");
    } else {
      toast("Operasyon Başarısız", `${opDef.name} çöktü.`, "negative");
    }
  }
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

function attackDistrict(id) {
  const d = districtById(id);
  const dObj = state.districts[id];
  const gangId = dObj.owner.split(":")[1];
  const gang = RIVAL_GANGS.find(g => g.id === gangId);
  const myStrength = state.crew.filter(c => c.role === "silahsor" || c.role === "enforcer").length + 1;
  let successChance = Math.min(85, Math.max(10, 50 + (myStrength - gang.strength) * 12));
  successChance += (state.modifiers.attackSuccessBonus || 0);
  successChance = Math.min(95, successChance);
  const success = Math.random() * 100 < successChance;

  if (success) {
    dObj.owner = "player";
    state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 12 * (state.modifiers.heatGainMult || 1));
    toast("Saldırı Başarılı!", `${d.name} artık senin. ${gang.name} geri çekildi.`, "positive");
  } else {
    state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 20 * (state.modifiers.heatGainMult || 1));
    state.gangRelations[gangId].hostility = Math.min(100, state.gangRelations[gangId].hostility + 20 * (state.modifiers.hostilityGainMult || 1));
    toast("Saldırı Başarısız", `${d.name} alınamadı. ${gang.name} misilleme yapabilir.`, "negative");
  }
  render();
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
      const remaining = Math.max(0, v.arrivesAtMin - state.minutes);
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
      if (activeBatch) {
        const remaining = Math.max(0, activeBatch.finishesAtMin - state.minutes);
        const pct = Math.min(100, 100 - (remaining / activeBatch.totalMin) * 100);
        html += `
          <div class="card-desc">${DRUG_PRODUCTS.find(p => p.id === activeBatch.productId).name} üretiliyor...</div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="card-stat">Kalan: <span class="num">${remaining} dk</span></div>
        `;
      } else {
        html += `
          <div style="margin-bottom:8px;">
            <select id="produce-select-${id}">
              ${DRUG_PRODUCTS.map(p => `<option value="${p.id}">${p.name} (${p.requires.map(r => RAW_MATERIALS.find(m => m.id === r.material).name + " x" + r.amount).join(", ")})</option>`).join("")}
            </select>
          </div>
          <button class="btn btn-gold btn-sm btn-full" data-produce="${id}">Üretimi Başlat</button>
        `;
      }
      html += `</div>`;
    });
  }

  html += `<div class="section-label">Sokak Satışı</div>`;
  html += `<div class="card">`;
  DRUG_PRODUCTS.forEach(p => {
    html += `
      <div class="card-row">
        <span class="card-stat">${p.name} × <span class="num">${state.drugStock[p.id]}</span></span>
        <button class="btn btn-outline btn-sm" data-sell="${p.id}" ${state.drugStock[p.id] === 0 ? "disabled" : ""}>Sat (${fmt(p.streetPrice)}/birim)</button>
      </div>
    `;
  });
  html += `</div>`;

  el.innerHTML = html;

  const dispatchBtn = document.getElementById("dispatch-shipment");
  if (dispatchBtn) dispatchBtn.addEventListener("click", dispatchShipment);

  el.querySelectorAll("[data-produce]").forEach(b => b.addEventListener("click", () => {
    const select = document.getElementById("produce-select-" + b.dataset.produce);
    startProduction(b.dataset.produce, select.value);
  }));

  el.querySelectorAll("[data-sell]").forEach(b => b.addEventListener("click", () => sellDrug(b.dataset.sell)));
}

function dispatchShipment() {
  const fromId = document.getElementById("ship-from").value;
  const toId = document.getElementById("ship-to").value;
  const vehicleType = document.getElementById("ship-vehicle").value;
  const vehicle = VEHICLES.find(v => v.id === vehicleType);
  if (state.cash < vehicle.cost) { toast("Yetersiz Bakiye", "Bu aracı almak için yeterli paran yok.", "negative"); return; }

  const startNode = districtRoadNode(fromId);
  const endNode = districtRoadNode(toId);
  const route = findRoute(startNode, endNode);
  if (!route) { toast("Rota Bulunamadı", "Bu iki bölge arasında yol tespit edilemedi.", "negative"); return; }

  state.cash -= vehicle.cost;
  const material = RAW_MATERIALS[Math.floor(Math.random() * RAW_MATERIALS.length)];
  const speedFactor = 1 / vehicle.riskModifier; // düşük risk modifier = daha hızlı araç varsayımı tersine çevrilir
  const travelTime = routeTravelMinutes(route.totalDist, 1) * vehicle.riskModifier;

  state.vehicles.push({
    id: uid(), type: vehicleType, status: "transit", faction: "player", kind: "shipment",
    fromId, toId, material: material.id, amount: vehicle.capacity,
    routeNodes: route.nodeIndices,
    departedAtMin: state.minutes,
    arrivesAtMin: state.minutes + travelTime, totalTravelMin: travelTime,
  });
  toast("Sevkiyat Yola Çıktı", `${vehicle.name} ${districtById(fromId).name}'den ${districtById(toId).name}'e hareket etti.`, "neutral");
  render();
}

function startProduction(districtId, productId) {
  const lab = state.districts[districtId].lab;
  const product = DRUG_PRODUCTS.find(p => p.id === productId);
  const lvl = LAB_LEVELS.find(l => l.level === lab.level);

  for (const req of product.requires) {
    if (state.materialStock[req.material] < req.amount * lvl.capacity) {
      toast("Yetersiz Hammadde", `${RAW_MATERIALS.find(m => m.id === req.material).name} stoğun yeterli değil.`, "negative");
      return;
    }
  }
  product.requires.forEach(req => { state.materialStock[req.material] -= req.amount * lvl.capacity; });

  lab.activeBatch = {
    productId, totalMin: lvl.batchTimeMin,
    finishesAtMin: state.minutes + lvl.batchTimeMin,
    yieldAmount: product.yieldPerBatch * lvl.capacity,
  };
  toast("Üretim Başladı", `${product.name} üretimi başlatıldı.`, "neutral");
  render();
}

function sellDrug(productId) {
  const product = DRUG_PRODUCTS.find(p => p.id === productId);
  const amount = state.drugStock[productId];
  if (amount === 0) return;
  const revenue = amount * product.streetPrice;
  state.cash += revenue;
  state.drugStock[productId] = 0;
  state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + product.riskPerBatch * 2);
  toast("Satış Tamamlandı", `${amount} birim ${product.name} satıldı: ${fmt(revenue)}`, "positive");
  render();
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
      const remaining = Math.max(0, h.finishesAtMin - state.minutes);
      const pct = Math.min(100, 100 - (remaining / h.totalPrepMin) * 100);
      html += `
        <div class="card">
          <div class="card-title">${target.name}</div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="card-stat">Kalan: <span class="num">${remaining} dk</span> · Başarı İhtimali: <span class="num">%${h.successChance}</span></div>
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
        ${eq.name} — ${fmt(eq.cost)} (+%${eq.successBonus} başarı)
      </label>
    `).join("")}
    <div class="section-label">Özet</div>
    <div class="card">
      <div class="card-stat">Temel Başarı: <span class="num" id="heist-base-success">%${target.baseSuccess}</span></div>
      <div class="card-stat gold">Hazırlık Süresi: <span class="num">${target.prepTimeMin} dk</span></div>
    </div>
    <button class="btn btn-blood btn-full" id="launch-heist" style="margin-top:10px;">Operasyonu Başlat</button>
  `;
  modal.innerHTML = html;

  const slotsEl = document.getElementById("heist-role-slots");
  let slotIndex = 0;
  Object.keys(roleCounts).forEach(roleId => {
    for (let i = 0; i < roleCounts[roleId]; i++) {
      const role = CREW_ROLES[roleId];
      const available = state.crew.filter(c => c.role === roleId && !c.assignedTo);
      const div = document.createElement("div");
      div.className = "role-slot";
      div.innerHTML = `${role.name}
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
    const equipmentIds = Array.from(modal.querySelectorAll("[data-eq]:checked")).map(c => c.dataset.eq);
    const equipmentCost = equipmentIds.reduce((sum, id) => sum + target.equipmentOptions.find(e => e.id === id).cost, 0);
    if (state.cash < equipmentCost) {
      toast("Yetersiz Bakiye", "Ekipman için yeterli paran yok.", "negative");
      return;
    }
    state.cash -= equipmentCost;
    let successChance = target.baseSuccess + (state.modifiers.heistSuccessBonus || 0);
    equipmentIds.forEach(id => { successChance += target.equipmentOptions.find(e => e.id === id).successBonus; });
    crewIds.forEach(cid => {
      const crewMember = state.crew.find(c => c.id === cid);
      crewMember.assignedTo = "heist:" + target.id;
      successChance += Math.round(crewMember.loyalty / 20);
    });
    successChance = Math.min(95, successChance);

    state.activeHeists.push({
      targetId: target.id, crewIds, equipmentIds,
      finishesAtMin: state.minutes + target.prepTimeMin,
      totalPrepMin: target.prepTimeMin,
      successChance,
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
  const success = Math.random() * 100 < heist.successChance;

  heist.crewIds.forEach(cid => {
    const c = state.crew.find(x => x.id === cid);
    if (c) c.assignedTo = null;
  });

  if (success) {
    const payout = Math.round(target.payout[0] + Math.random() * (target.payout[1] - target.payout[0]));
    state.cash += payout;
    state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + target.heatOnSuccess);
    toast("Soygun Başarılı!", `${target.name}: ${fmt(payout)} kazandın.`, "positive");
  } else {
    state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + target.heatOnFail);
    // %25 ihtimalle bir ekip üyesi kaybedilir
    if (Math.random() < 0.25 && heist.crewIds.length > 0) {
      const lostId = heist.crewIds[Math.floor(Math.random() * heist.crewIds.length)];
      state.crew = state.crew.filter(c => c.id !== lostId);
      toast("Soygun Başarısız!", `${target.name} çöktü. Bir adamını kaybettin.`, "negative");
    } else {
      toast("Soygun Başarısız!", `${target.name} çöktü. Isı ciddi arttı.`, "negative");
    }
  }
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
  const ownedWeapons = WEAPONS.filter(w => state.armory.weapons[w.id] > 0);
  const ownedArmors = ARMORS.filter(a => state.armory.armors[a.id] > 0);
  const ownedConsumables = CONSUMABLES.filter(c => state.armory.consumables[c.id] > 0);
  if (ownedWeapons.length === 0 && ownedArmors.length === 0 && ownedConsumables.length === 0) {
    html += `<div class="card-desc" style="margin-bottom:0;">Henüz hiç silah/zırh/malzemen yok.</div>`;
  } else {
    ownedWeapons.forEach(w => { html += `<div class="card-row"><span class="card-stat">${w.name}</span><span class="card-stat gold"><span class="num">${state.armory.weapons[w.id]}</span> adet</span></div>`; });
    ownedArmors.forEach(a => { html += `<div class="card-row"><span class="card-stat">${a.name}</span><span class="card-stat gold"><span class="num">${state.armory.armors[a.id]}</span> adet</span></div>`; });
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
      const remaining = Math.max(0, listing.expiresAtMin - state.minutes);
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
  el.querySelectorAll("[data-smuggle]").forEach(b => b.addEventListener("click", () => smuggleListing(b.dataset.smuggle)));
}

function renderShopCategory(title, items, category) {
  let html = `<div class="card"><div class="card-title" style="margin-bottom:8px;">${title}</div>`;
  items.forEach(item => {
    html += `
      <div class="card-row">
        <span class="card-stat">${item.name}</span>
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

function findArmoryItem(itemType, itemId) {
  if (itemType === "weapons") return WEAPONS.find(w => w.id === itemId);
  if (itemType === "armors") return ARMORS.find(a => a.id === itemId);
  if (itemType === "consumables") return CONSUMABLES.find(c => c.id === itemId);
  return null;
}

function buyFromShop(category, itemId) {
  const item = findArmoryItem(category, itemId);
  if (!item || state.cash < item.priceShop) return;
  state.cash -= item.priceShop;
  state.armory[category][itemId] = (state.armory[category][itemId] || 0) + 1;
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

  state.vehicles.push({
    id: uid(), faction: "player", kind: "weapon_smuggle", status: "transit",
    fromId, toId,
    itemType: listing.itemType, itemId: listing.itemId, amount: listing.amount,
    routeNodes: route.nodeIndices,
    departedAtMin: state.minutes,
    arrivesAtMin: state.minutes + travelTime, totalTravelMin: travelTime,
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
    expiresAtMin: state.minutes + 45 + Math.floor(Math.random() * 60),
    amount,
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
      html += `
        <div class="card">
          <div class="card-row">
            <span class="card-title">${c.name}</span>
            ${c.assignedTo ? '<span class="badge blood">Görevde</span>' : '<span class="badge gold">Hazır</span>'}
          </div>
          <div class="card-stat">${role.name} · Sadakat: <span class="num">${c.loyalty}</span> · Maaş: <span class="num">${fmt(c.wage)}/sa</span></div>
          <button class="btn btn-outline btn-sm" style="margin-top:8px;" data-fire="${c.id}">İşten Çıkar</button>
        </div>
      `;
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
  el.querySelectorAll("[data-recruit]").forEach(b => b.addEventListener("click", () => recruitCrew(b.dataset.recruit)));
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
    };
  });
}

function recruitCrew(recruitId) {
  const r = state.recruitPool.find(x => x.id === recruitId);
  const signingCost = r.wage * 10;
  if (state.cash < signingCost) { toast("Yetersiz Bakiye", "İşe alım maliyetini karşılayamıyorsun.", "negative"); return; }
  state.cash -= signingCost;
  state.crew.push({ id: r.id, name: r.name, role: r.role, wage: r.wage, loyalty: r.loyalty, assignedTo: null });
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

  el.innerHTML = html;
  el.querySelectorAll("[data-hideout-raid]").forEach(b => b.addEventListener("click", () => openHideoutRaidPlanner(b.dataset.hideoutRaid)));
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
      <div class="card-stat">Temel Başarı: <span class="num">%${op.baseSuccess}</span></div>
      <div class="card-stat gold">Tahmini Ganimet: <span class="num">${fmt(state.gangEconomy[gangId] ? state.gangEconomy[gangId].cash : 0)}</span></div>
    </div>
    <button class="btn btn-blood btn-full" id="launch-raid" style="margin-top:10px;">Baskını Başlat</button>
  `;
  modal.innerHTML = html;

  const slotsEl = document.getElementById("raid-role-slots");
  let slotIndex = 0;
  Object.keys(roleCounts).forEach(roleId => {
    for (let i=0; i<roleCounts[roleId]; i++) {
      const role = CREW_ROLES[roleId];
      const available = state.crew.filter(c => c.role === roleId && !c.assignedTo);
      const div = document.createElement("div");
      div.className = "role-slot";
      div.innerHTML = `${role.name}
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
    let successChance = op.baseSuccess + (state.modifiers.heistSuccessBonus || 0);
    crewIds.forEach(cid => {
      const c = state.crew.find(x => x.id === cid);
      c.assignedTo = "hideoutraid:" + gangId;
      successChance += Math.round(c.loyalty / 20);
    });
    successChance = Math.min(85, successChance);

    const success = Math.random() * 100 < successChance;
    crewIds.forEach(cid => {
      const c = state.crew.find(x => x.id === cid);
      if (c) c.assignedTo = null;
    });

    if (success) {
      const econ = state.gangEconomy[gangId];
      const stolen = econ ? econ.cash : 0;
      state.cash += stolen;
      if (econ) econ.cash = 0;
      state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 30 * (state.modifiers.heatGainMult||1));
      state.gangRelations[gangId].hostility = Math.min(100, state.gangRelations[gangId].hostility + 35);
      toast("Baskın Başarılı!", `${gang.name}'ın hideout'undan ${fmt(stolen)} ele geçirdin.`, "positive");
    } else {
      state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 40 * (state.modifiers.heatGainMult||1));
      if (Math.random() < 0.4 && crewIds.length > 0) {
        const lostId = crewIds[Math.floor(Math.random()*crewIds.length)];
        state.crew = state.crew.filter(c => c.id !== lostId);
        toast("Baskın Başarısız!", `${gang.name} seni geri püskürttü. Bir adamını kaybettin.`, "negative");
      } else {
        toast("Baskın Başarısız!", `${gang.name} seni geri püskürttü.`, "negative");
      }
    }
    closeModal();
    render();
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
    case "crew": renderCrewTab(); break;
    case "empire": renderEmpireTab(); break;
  }
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
  const heatResistanceReduction = state.modifiers.heatResistanceMult ? (1 / state.modifiers.heatResistanceMult) : 1;
  state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + hourlyHeat * heatResistanceReduction * (minutesPassed / 60));

  // Ekip maaşları (saatlik)
  const totalWages = state.crew.reduce((s, c) => s + c.wage, 0) * (state.modifiers.wageMult || 1);
  state.cash -= totalWages * (minutesPassed / 60);

  // Ekip sadakati zamanla doğal düşer (modifier ile yavaşlatılabilir)
  const loyaltyDecay = 0.02 * (state.modifiers.loyaltyDecayMult || 1) * (minutesPassed / 60);
  state.crew.forEach(c => { c.loyalty = Math.max(0, c.loyalty - loyaltyDecay); });

  // Isı doğal düşüş
  state.heat = Math.max(0, state.heat - GAME_CONSTANTS.heatDecayPerHour * (minutesPassed / 60));

  // --- Araç durumlarını kontrolü (tüm taraflar) ---
  state.vehicles.forEach(v => {
    if (v.status !== "transit") return;

    // Kaçakçılık araçları için yol üstünde yakalanma riski (ısıya bağlı)
    if (v.faction === "player" && v.kind === "weapon_smuggle" && !v.riskChecked) {
      const midPoint = v.departedAtMin + (v.totalTravelMin / 2);
      if (state.minutes >= midPoint) {
        v.riskChecked = true;
        const catchChance = Math.min(35, state.heat * 0.4);
        if (Math.random() * 100 < catchChance) {
          v.status = "caught";
          state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 15);
          toast("Sevkiyat Yakalandı!", `Kaçakçılık aracın polis tarafından durduruldu. Yük ve para kayıp.`, "negative");
          logEvent("Kaçakçılık sevkiyatı polis tarafından yakalandı.");
        }
      }
    }

    if (v.status !== "transit" || state.minutes < v.arrivesAtMin) return;
    v.status = "arrived";

    if (v.faction === "player" && v.kind === "shipment") {
      state.materialStock[v.material] += v.amount;
      logEvent(`Sevkiyat ulaştı: ${districtById(v.toId).name}'e ${v.amount} birim malzeme.`);
    } else if (v.faction === "player" && v.kind === "weapon_smuggle") {
      state.armory[v.itemType][v.itemId] = (state.armory[v.itemType][v.itemId] || 0) + v.amount;
      const item = findArmoryItem(v.itemType, v.itemId);
      logEvent(`Kaçak sevkiyat ulaştı: ${item.name} x${v.amount}.`);
      toast("Kaçakçılık Başarılı", `${item.name} envanterine eklendi.`, "positive");
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

  // Karaborsa ilanları: yeni ilan üretimi ve süresi dolanların temizlenmesi
  maybeSpawnBlackMarketListing();
  state.blackMarketListings = state.blackMarketListings.filter(l => state.minutes < l.expiresAtMin);

  // Laboratuvar üretim kontrolü
  playerDistrictIds().forEach(id => {
    const lab = state.districts[id].lab;
    if (lab && lab.activeBatch && state.minutes >= lab.activeBatch.finishesAtMin) {
      state.drugStock[lab.activeBatch.productId] += lab.activeBatch.yieldAmount;
      logEvent(`${districtById(id).name} laboratuvarı üretimi tamamladı.`);
      lab.activeBatch = null;
    }
  });

  // Soygun kontrolü
  state.activeHeists.forEach(h => {
    if (state.minutes >= h.finishesAtMin) resolveHeist(h);
  });
  state.activeHeists = state.activeHeists.filter(h => state.minutes < h.finishesAtMin);

  // Karşı-operasyon kontrolü (rakip araçlarına pusu/soygun/kaçırma)
  state.activeCounterOps.forEach(op => {
    if (state.minutes >= op.finishesAtMin) resolveCounterOp(op);
  });
  state.activeCounterOps = state.activeCounterOps.filter(op => state.minutes < op.finishesAtMin);

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
    arrivesAtMin: state.minutes + travelTime, totalTravelMin: travelTime,
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
    arrivesAtMin: state.minutes + travelTime, totalTravelMin: travelTime,
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
    arrivesAtMin: state.minutes + travelTime, totalTravelMin: travelTime,
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

  // Soygun modalı için backdrop/modal elementlerini ekle
  const backdrop = document.createElement("div");
  backdrop.id = "district-modal-backdrop";
  backdrop.innerHTML = `<div id="district-modal" style="position:relative;"></div>`;
  document.body.appendChild(backdrop);

  initState();
  wireStaticEvents();
  render();
  setInterval(gameTick, GAME_CONSTANTS.tickIntervalMs);
}

document.getElementById("start-btn").addEventListener("click", startGame);

// ---------------- SETUP WIZARD ----------------
const setupWizard = {
  stepIndex: 0,
  steps: ["identity", "origin", "leadership", "orgname", "ideology", "summary"],
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
      <div class="setup-eyebrow">Adım 1 / 6</div>
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
      <div class="setup-eyebrow">Adım 2 / 6</div>
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
      <div class="setup-eyebrow">Adım 3 / 6</div>
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
      <div class="setup-eyebrow">Adım 4 / 6</div>
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
      <div class="setup-eyebrow">Adım 5 / 6</div>
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

  if (step === "summary") {
    const origin = ORIGINS.find(o => o.id === state.profile.originId);
    const leadership = LEADERSHIP_STYLES.find(l => l.id === state.profile.leadershipId);
    const ideology = IDEOLOGIES.find(i => i.id === state.profile.ideologyId);
    content.innerHTML = `
      <div class="setup-eyebrow">Adım 6 / 6</div>
      <div class="setup-title">${state.profile.orgName}</div>
      <div class="setup-desc">${state.profile.codeName} olarak da bilinen ${state.profile.leaderName}, İstanbul'un gölgelerinde imparatorluğunu kurmaya hazır.</div>
      <div class="card">
        <div class="setup-summary-row"><span class="label">Geçmiş</span><span class="value">${origin.name}</span></div>
        <div class="setup-summary-row"><span class="label">Liderlik</span><span class="value">${leadership.name}</span></div>
        <div class="setup-summary-row"><span class="label">İdeoloji</span><span class="value">${ideology.name}</span></div>
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
