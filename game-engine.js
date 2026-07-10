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

  districts: {}, // id -> { owner: 'player'|'rival:<id>'|null, businesses: [...], refinery: null, lab: null }
  crew: [], // { id, name, role, wage, loyalty, assignedTo }
  vehicles: [], // { id, type, cargo: {material, amount}, status, route, arrivesAtMin }
  materialStock: {}, // material id -> amount (genel depo)
  drugStock: {}, // product id -> amount (genel depo)
  activeHeists: [], // { targetId, crewIds, equipmentIds, finishesAtMin, successChance }
  gangRelations: {}, // gangId -> { hostility: 0-100 }

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
  RIVAL_GANGS.forEach(g => { state.gangRelations[g.id] = { hostility: 20 }; });
  RAW_MATERIALS.forEach(m => { state.materialStock[m.id] = 0; });
  DRUG_PRODUCTS.forEach(p => { state.drugStock[p.id] = 0; });
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
  el.innerHTML = `<div class="toast-title">${title}</div><div class="toast-body">${body}</div>`;
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity 0.5s"; setTimeout(() => el.remove(), 500); }, 5000);
}
function randomName() {
  const f = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const l = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return f + " " + l;
}
function uid() { return Math.random().toString(36).slice(2, 10); }

// ---------------- TOPBAR RENDER ----------------
function renderTopbar() {
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

  // Su/arka plan dekoru (basit boğaz şeridi hissi)
  const water = document.createElementNS(ns, "path");
  water.setAttribute("d", "M 44 0 Q 50 20 46 40 Q 42 55 50 65 L 60 65 Q 52 50 56 35 Q 60 18 54 0 Z");
  water.setAttribute("class", "water");
  svg.appendChild(water);

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

    if (statusClass === "rival") {
      const pulse = document.createElementNS(ns, "circle");
      pulse.setAttribute("cx", d.x); pulse.setAttribute("cy", d.y);
      pulse.setAttribute("class", "district-pulse active");
      g.appendChild(pulse);
    }

    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", d.x); dot.setAttribute("cy", d.y);
    dot.setAttribute("class", "district-dot " + statusClass + (state.selectedDistrict === d.id ? " selected" : ""));
    g.appendChild(dot);

    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", d.x); label.setAttribute("y", d.y - 10);
    label.setAttribute("class", "district-label " + (statusClass === "owned" ? "owned" : ""));
    label.textContent = d.name;
    g.appendChild(label);

    svg.appendChild(g);
  });
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
      <span class="badge">Zenginlik ${"★".repeat(d.wealth)}</span>
      <span class="badge">Isı Direnci ${"★".repeat(d.heatResistance)}</span>
      ${isPlayer ? '<span class="badge gold">Senin Bölgen</span>' : ''}
      ${rivalGang ? `<span class="badge blood">${rivalGang.name}</span>` : ''}
    </div>
  `;

  if (!dObj.owner) {
    html += `
      <div class="card">
        <div class="card-title">Bölgeyi Ele Geçir</div>
        <div class="card-desc">Bu bölge kimsenin kontrolünde değil. Satın alarak imparatorluğuna kat.</div>
        <div class="card-row">
          <span class="card-stat gold">Maliyet: <span class="num">${fmt(d.basePrice)}</span></span>
          <button class="btn btn-gold" id="buy-district" ${state.cash < d.basePrice ? "disabled" : ""}>Satın Al</button>
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
    html += `<div class="section-label">İşletmeler</div>`;
    if (dObj.businesses.length === 0) {
      html += `<div class="empty-state">Bu bölgede henüz işletmen yok.</div>`;
    } else {
      dObj.businesses.forEach(b => {
        const type = BUSINESS_TYPES.find(t => t.id === b.typeId);
        html += `
          <div class="card">
            <div class="card-title">${type.icon} ${type.name}</div>
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
          <div class="card-title">${t.icon} ${t.name}</div>
          <div class="card-desc">${t.description}</div>
          <div class="card-row">
            <span class="card-stat gold">Maliyet: <span class="num">${fmt(t.baseCost)}</span></span>
            <button class="btn btn-gold btn-sm" data-build-biz="${t.id}" ${state.cash < t.baseCost ? "disabled" : ""}>Kur</button>
          </div>
        </div>
      `;
    });

    html += `<div class="section-label">Hammadde Üretim Tesisi</div>`;
    if (dObj.refinery) {
      html += `<div class="card"><div class="card-title">🏭 Üretim Tesisi Aktif</div><div class="card-desc">Saatte ${RAW_MATERIAL_PRODUCTION_PER_HOUR} birim rastgele hammadde üretiyor. Nakliye ile laboratuvara taşınmalı.</div></div>`;
    } else {
      html += `
        <div class="card">
          <div class="card-title">🏭 Tesis Kur</div>
          <div class="card-desc">Bu semtte hammadde üretimi başlat. Üretilen malzeme laboratuvara nakledilmelidir.</div>
          <div class="card-row">
            <span class="card-stat gold">Maliyet: <span class="num">${fmt(REFINERY_SITE_COST)}</span></span>
            <button class="btn btn-gold btn-sm" id="build-refinery" ${state.cash < REFINERY_SITE_COST ? "disabled" : ""}>Kur</button>
          </div>
        </div>
      `;
    }

    html += `<div class="section-label">Laboratuvar</div>`;
    if (dObj.lab) {
      const lvl = LAB_LEVELS.find(l => l.level === dObj.lab.level);
      const next = LAB_LEVELS.find(l => l.level === dObj.lab.level + 1);
      html += `
        <div class="card">
          <div class="card-title">⚗️ Laboratuvar — Seviye ${lvl.level}</div>
          <div class="card-desc">Parti süresi: ${lvl.batchTimeMin} dk · Kapasite: ${lvl.capacity} parti/döngü</div>
          ${next ? `<div class="card-row"><span class="card-stat gold">Yükselt: <span class="num">${fmt(next.cost)}</span></span><button class="btn btn-outline btn-sm" id="upgrade-lab" ${state.cash < next.cost ? "disabled" : ""}>Seviye ${next.level}</button></div>` : `<div class="card-stat">Maksimum seviye.</div>`}
        </div>
      `;
    } else {
      html += `
        <div class="card">
          <div class="card-title">⚗️ Laboratuvar Kur</div>
          <div class="card-desc">Hammaddeyi işlenmiş ürüne çevirir. Üretim sekmesinden yönetilir.</div>
          <div class="card-row">
            <span class="card-stat gold">Maliyet: <span class="num">${fmt(LAB_LEVELS[0].cost)}</span></span>
            <button class="btn btn-gold btn-sm" id="build-lab" ${state.cash < LAB_LEVELS[0].cost ? "disabled" : ""}>Kur</button>
          </div>
        </div>
      `;
    }
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
function buyDistrict(id) {
  const d = districtById(id);
  if (state.cash < d.basePrice) return;
  state.cash -= d.basePrice;
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
  const successChance = Math.min(85, Math.max(10, 50 + (myStrength - gang.strength) * 12));
  const success = Math.random() * 100 < successChance;

  if (success) {
    dObj.owner = "player";
    state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 12);
    toast("Saldırı Başarılı!", `${d.name} artık senin. ${gang.name} geri çekildi.`, "positive");
  } else {
    state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 20);
    state.gangRelations[gangId].hostility = Math.min(100, state.gangRelations[gangId].hostility + 20);
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
      ${RAW_MATERIALS.map(m => `<div class="card-row"><span class="card-stat">${m.icon} ${m.name}</span><span class="card-stat"><span class="num">${state.materialStock[m.id]}</span> birim</span></div>`).join("")}
    </div>
    <div class="card">
      ${DRUG_PRODUCTS.map(p => `<div class="card-row"><span class="card-stat">${p.icon} ${p.name}</span><span class="card-stat gold"><span class="num">${state.drugStock[p.id]}</span> birim</span></div>`).join("")}
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
  const activeShipments = state.vehicles.filter(v => v.status === "transit");
  if (activeShipments.length === 0) {
    html += `<div class="empty-state">Şu an yolda sevkiyat yok.</div>`;
  } else {
    activeShipments.forEach(v => {
      const remaining = Math.max(0, v.arrivesAtMin - state.minutes);
      const totalTime = v.totalTravelMin || 1;
      const pct = Math.min(100, 100 - (remaining / totalTime) * 100);
      html += `
        <div class="card">
          <div class="card-title">🚚 ${VEHICLES.find(x => x.id === v.type).name}</div>
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
      html += `<div class="card"><div class="card-title">⚗️ ${districtById(id).name} — Seviye ${lab.level}</div>`;
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
              ${DRUG_PRODUCTS.map(p => `<option value="${p.id}">${p.icon} ${p.name} (${p.requires.map(r => RAW_MATERIALS.find(m => m.id === r.material).name + " x" + r.amount).join(", ")})</option>`).join("")}
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
        <span class="card-stat">${p.icon} ${p.name} × <span class="num">${state.drugStock[p.id]}</span></span>
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

  state.cash -= vehicle.cost;
  const material = RAW_MATERIALS[Math.floor(Math.random() * RAW_MATERIALS.length)];
  const travelTime = districtById(fromId).neighbors.includes(toId) ? vehicle.speedMin : vehicle.speedMin * 2;

  state.vehicles.push({
    id: uid(), type: vehicleType, status: "transit",
    fromId, toId, material: material.id, amount: vehicle.capacity,
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
          <div class="card-title">${target.icon} ${target.name}</div>
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
        <div class="card-title">${t.icon} ${t.name}</div>
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
    <div class="panel-title">${target.icon} ${target.name}</div>
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
      div.innerHTML = `${role.icon} ${role.name}
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
    let successChance = target.baseSuccess;
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
            <span class="card-title">${role.icon} ${c.name}</span>
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
        <div class="card-title">${role.icon} ${r.name}</div>
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

  let html = `
    <div class="panel-title">İmparatorluk</div>
    <div class="panel-subtitle">Genel durum ve rakip çete istihbaratı.</div>

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
    html += `
      <div class="card">
        <div class="card-row">
          <span class="card-title">${g.name}</span>
          <span class="badge blood">Güç ${g.strength}</span>
        </div>
        <div class="card-desc">Kontrol: ${territories.length > 0 ? territories.map(id => districtById(id).name).join(", ") : "Bölgesi kalmadı"}</div>
        <div class="card-stat blood">Düşmanlık: <span class="num">${state.gangRelations[g.id].hostility}</span></div>
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
      hourlyIncome += t.baseIncomePerHour;
      hourlyHeat += t.heatPerHour;
    });
    if (state.districts[id].refinery) {
      const mat = RAW_MATERIALS[Math.floor(Math.random() * RAW_MATERIALS.length)];
      state.materialStock[mat.id] += Math.round(RAW_MATERIAL_PRODUCTION_PER_HOUR * (minutesPassed / 60));
    }
  });
  state.cash += hourlyIncome * (minutesPassed / 60);
  state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + hourlyHeat * (minutesPassed / 60));

  // Ekip maaşları (saatlik)
  const totalWages = state.crew.reduce((s, c) => s + c.wage, 0);
  state.cash -= totalWages * (minutesPassed / 60);

  // Isı doğal düşüş
  state.heat = Math.max(0, state.heat - GAME_CONSTANTS.heatDecayPerHour * (minutesPassed / 60));

  // Nakliye kontrolü
  state.vehicles.forEach(v => {
    if (v.status === "transit" && state.minutes >= v.arrivesAtMin) {
      v.status = "arrived";
      state.materialStock[v.material] += v.amount;
      logEvent(`Sevkiyat ulaştı: ${districtById(v.toId).name}'e ${v.amount} birim malzeme.`);
    }
  });
  state.vehicles = state.vehicles.filter(v => v.status === "transit");

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

function triggerRandomEvent() {
  const ev = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
  if (ev.type === "positive") {
    const bonus = 2000 + Math.floor(Math.random() * 5000);
    state.cash += bonus;
    toast(ev.name, ev.description + ` (+${fmt(bonus)})`, "positive");
  } else {
    const penalty = 1000 + Math.floor(Math.random() * 4000);
    state.cash = Math.max(0, state.cash - penalty);
    state.heat = Math.min(GAME_CONSTANTS.maxHeat, state.heat + 5);
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
  document.getElementById("app").style.display = "grid";

  // İlk soygun modalı için backdrop/modal elementlerini ekle
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
