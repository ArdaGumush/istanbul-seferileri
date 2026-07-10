// ============================================================
// İSTANBUL İMPARATORLUĞU - OYUN VERİSİ
// ============================================================

// ---- SEMTLER ----
const DISTRICTS = [
  {
    id: "tarlabasi", name: "Tarlabaşı", x: 32, y: 40,
    wealth: 1, heatResistance: 4, difficulty: 1, basePrice: 12000,
    description: "Şehrin arka sokakları. Polis pek uğramaz, para da az.",
    neighbors: ["kasimpasa", "beyoglu"],
  },
  {
    id: "kasimpasa", name: "Kasımpaşa", x: 40, y: 33,
    wealth: 1, heatResistance: 4, difficulty: 1, basePrice: 14000,
    description: "Liman kenarı, dar sokaklar. Başlangıç için ideal.",
    neighbors: ["tarlabasi", "beyoglu", "halic"],
  },
  {
    id: "beyoglu", name: "Beyoğlu", x: 35, y: 31,
    wealth: 3, heatResistance: 2, difficulty: 3, basePrice: 42000,
    description: "Gece hayatının kalbi. Barlar, kulüpler, kumarhane potansiyeli.",
    neighbors: ["tarlabasi", "kasimpasa", "besiktas", "sisli"],
  },
  {
    id: "besiktas", name: "Beşiktaş", x: 29, y: 23,
    wealth: 4, heatResistance: 2, difficulty: 4, basePrice: 58000,
    description: "Sahil şeridi, yüksek yaşam standardı. Polis burada tetikte.",
    neighbors: ["beyoglu", "sisli", "sariyer"],
  },
  {
    id: "nisantasi", name: "Nişantaşı", x: 40, y: 25,
    wealth: 5, heatResistance: 1, difficulty: 5, basePrice: 85000,
    description: "Lüks mağazalar, zengin müşteri kitlesi, ağır güvenlik.",
    neighbors: ["sisli", "besiktas"],
  },
  {
    id: "sisli", name: "Şişli", x: 38, y: 28,
    wealth: 4, heatResistance: 3, difficulty: 3, basePrice: 50000,
    description: "İş merkezleri ve ofis blokları. Dolandırıcılık için verimli.",
    neighbors: ["beyoglu", "besiktas", "nisantasi", "sariyer"],
  },
  {
    id: "sariyer", name: "Sarıyer", x: 32, y: 11,
    wealth: 5, heatResistance: 3, difficulty: 4, basePrice: 70000,
    description: "Villa bölgesi, boğaz manzaralı. Uzak ama kazançlı.",
    neighbors: ["besiktas", "sisli"],
  },
  {
    id: "fatih", name: "Fatih", x: 45, y: 41,
    wealth: 2, heatResistance: 5, difficulty: 2, basePrice: 22000,
    description: "Tarihi yarımada, muhafazakâr doku. Düşük ısı, düşük tavan.",
    neighbors: ["halic", "zeytinburnu"],
  },
  {
    id: "halic", name: "Haliç", x: 42, y: 36,
    wealth: 2, heatResistance: 4, difficulty: 2, basePrice: 24000,
    description: "Sanayi kalıntıları, depo bölgeleri. Nakliye için elverişli.",
    neighbors: ["kasimpasa", "fatih", "zeytinburnu"],
  },
  {
    id: "zeytinburnu", name: "Zeytinburnu", x: 48, y: 49,
    wealth: 2, heatResistance: 4, difficulty: 2, basePrice: 20000,
    description: "Sanayi ve liman erişimi. Hammadde üretimi için elverişli.",
    neighbors: ["fatih", "halic", "bakirkoy"],
  },
  {
    id: "bakirkoy", name: "Bakırköy", x: 52, y: 56,
    wealth: 3, heatResistance: 3, difficulty: 3, basePrice: 34000,
    description: "Liman şehri. Deniz yoluyla mal giriş çıkışı kolay.",
    neighbors: ["zeytinburnu"],
  },
  {
    id: "uskudar", name: "Üsküdar", x: 56, y: 31,
    wealth: 2, heatResistance: 4, difficulty: 2, basePrice: 26000,
    description: "Boğazın Anadolu yakası, sakin ama gözden ırak değil.",
    neighbors: ["kadikoy"],
  },
  {
    id: "kadikoy", name: "Kadıköy", x: 61, y: 39,
    wealth: 3, heatResistance: 3, difficulty: 3, basePrice: 38000,
    description: "Genç nüfus, canlı gece hayatı, kumarhane potansiyeli yüksek.",
    neighbors: ["uskudar"],
  },
];

// ---- İŞLETME TÜRLERİ (semtlere kurulabilir, pasif gelir üretir) ----
const BUSINESS_TYPES = [
  {
    id: "koruma", name: "Koruma Rüşveti", icon: "🛡️",
    baseCost: 5000, baseIncomePerHour: 900, heatPerHour: 0.5,
    description: "Yerel esnaftan düzenli haraç toplama ağı.",
  },
  {
    id: "kumarhane", name: "Yeraltı Kumarhanesi", icon: "🎰",
    baseCost: 18000, baseIncomePerHour: 2800, heatPerHour: 1.5,
    description: "Yüksek kazanç, yüksek görünürlük.",
  },
  {
    id: "gasp", name: "Gasp Şebekesi", icon: "💰",
    baseCost: 3000, baseIncomePerHour: 550, heatPerHour: 1.2,
    description: "Sokakta hızlı ve kirli para.",
  },
  {
    id: "dolandiricilik", name: "Dolandırıcılık Ofisi", icon: "📞",
    baseCost: 9000, baseIncomePerHour: 1500, heatPerHour: 0.9,
    description: "Sahte yatırım ve sigorta dolandırıcılığı operasyonu.",
  },
];

// ---- UYUŞTURUCU ZİNCİRİ: Hammadde -> Nakliye -> Laboratuvar -> Dağıtım ----
const RAW_MATERIALS = [
  { id: "kimyasal_a", name: "Kimyasal A", icon: "🧪", baseCost: 40 },
  { id: "kimyasal_b", name: "Kimyasal B", icon: "⚗️", baseCost: 60 },
  { id: "bitkisel_ozut", name: "Bitkisel Özüt", icon: "🌿", baseCost: 35 },
];

const REFINERY_SITE_COST = 16000; // hammadde üretim tesisi kurma maliyeti (semt başına)
const RAW_MATERIAL_PRODUCTION_PER_HOUR = 24; // tesis başına saatlik üretim

const DRUG_PRODUCTS = [
  {
    id: "esrar", name: "Esrar", icon: "🌱",
    requires: [{ material: "bitkisel_ozut", amount: 2 }],
    yieldPerBatch: 12, streetPrice: 140, riskPerBatch: 1,
  },
  {
    id: "meth", name: "Meth", icon: "💊",
    requires: [{ material: "kimyasal_a", amount: 2 }, { material: "kimyasal_b", amount: 1 }],
    yieldPerBatch: 10, streetPrice: 220, riskPerBatch: 3,
  },
  {
    id: "kokain", name: "Kokain", icon: "❄️",
    requires: [{ material: "bitkisel_ozut", amount: 3 }, { material: "kimyasal_a", amount: 1 }],
    yieldPerBatch: 8, streetPrice: 380, riskPerBatch: 4,
  },
  {
    id: "eroin", name: "Eroin", icon: "🩸",
    requires: [{ material: "bitkisel_ozut", amount: 2 }, { material: "kimyasal_b", amount: 2 }],
    yieldPerBatch: 6, streetPrice: 450, riskPerBatch: 5,
  },
];

const LAB_LEVELS = [
  { level: 1, cost: 20000, batchTimeMin: 30, capacity: 2 },
  { level: 2, cost: 45000, batchTimeMin: 22, capacity: 4 },
  { level: 3, cost: 90000, batchTimeMin: 15, capacity: 7 },
];

// Araçlar: hammaddeyi üretim tesisinden laboratuvara taşımak için
const VEHICLES = [
  { id: "panelvan", name: "Panelvan", cost: 8000, capacity: 30, speedMin: 8, riskModifier: 1.0 },
  { id: "kamyon", name: "Kamyon", cost: 20000, capacity: 80, speedMin: 14, riskModifier: 1.3 },
  { id: "spor_araba", name: "Spor Araba", cost: 35000, capacity: 10, speedMin: 4, riskModifier: 0.6 },
];

// ---- SOYGUN HEDEFLERİ ----
const HEIST_TARGETS = [
  {
    id: "kuyumcu", name: "Kapalıçarşı Kuyumcusu", icon: "💍", difficulty: 1,
    requiredRoles: ["silahsor", "sokak_lideri"],
    equipmentOptions: [
      { id: "maske", name: "Maskeler", cost: 500, successBonus: 5 },
      { id: "kesici", name: "Kasa Kesici", cost: 2000, successBonus: 15 },
    ],
    baseSuccess: 55, payout: [8000, 18000],
    heatOnSuccess: 8, heatOnFail: 20, prepTimeMin: 15,
    description: "Küçük ama tıklım tıklım dolu bir kuyumcu. Hızlı iş, orta risk.",
  },
  {
    id: "banka_subesi", name: "Banka Şubesi", icon: "🏦", difficulty: 2,
    requiredRoles: ["silahsor", "muhasebeci", "sokak_lideri"],
    equipmentOptions: [
      { id: "sinyal_kesici", name: "Sinyal Kesici", cost: 4000, successBonus: 12 },
      { id: "agir_silah", name: "Ağır Silah Seti", cost: 6000, successBonus: 10 },
    ],
    baseSuccess: 40, payout: [25000, 60000],
    heatOnSuccess: 18, heatOnFail: 35, prepTimeMin: 35,
    description: "Orta ölçekli şube. Tam ekip ve doğru zamanlama gerektirir.",
  },
  {
    id: "nakit_kamyonu", name: "Zırhlı Nakit Kamyonu", icon: "🚚", difficulty: 3,
    requiredRoles: ["silahsor", "silahsor", "surucu"],
    equipmentOptions: [
      { id: "patlayici", name: "Kapı Patlayıcısı", cost: 7000, successBonus: 18 },
      { id: "takip_cihazi", name: "Takip Cihazı", cost: 3000, successBonus: 8 },
    ],
    baseSuccess: 35, payout: [40000, 90000],
    heatOnSuccess: 25, heatOnFail: 45, prepTimeMin: 45,
    description: "Hareket halindeki hedef. Zamanlama her şeydir.",
  },
  {
    id: "ozel_sergi", name: "Özel Koleksiyon Sergisi", icon: "🏛️", difficulty: 4,
    requiredRoles: ["silahsor", "muhasebeci", "casus", "surucu"],
    equipmentOptions: [
      { id: "sahte_kimlik", name: "Sahte Kimlikler", cost: 5000, successBonus: 14 },
      { id: "lazer_kesici", name: "Lazer Kesici", cost: 12000, successBonus: 20 },
    ],
    baseSuccess: 25, payout: [80000, 160000],
    heatOnSuccess: 30, heatOnFail: 55, prepTimeMin: 60,
    description: "İmparatorluğun en büyük vurgunlarından biri. Ağır risk, ağır ödül.",
  },
];

// ---- EKİP ROLLERİ ----
const CREW_ROLES = {
  silahsor: { name: "Silahşor", icon: "🔫", baseWage: 300 },
  muhasebeci: { name: "Muhasebeci", icon: "📊", baseWage: 250 },
  enforcer: { name: "Enforcer", icon: "👊", baseWage: 280 },
  casus: { name: "Casus", icon: "🕵️", baseWage: 320 },
  surucu: { name: "Sürücü", icon: "🚗", baseWage: 240 },
  sokak_lideri: { name: "Sokak Lideri", icon: "🎯", baseWage: 260 },
};

const FIRST_NAMES = ["Kemal", "Hakan", "Serkan", "Murat", "Emre", "Tolga", "Barış", "Cem", "Deniz", "Onur", "Selim", "Volkan", "Ayşe", "Elif", "Zeynep", "Derya", "Pınar", "Sibel", "Kaan", "Burak"];
const LAST_NAMES = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Aydın", "Öztürk", "Arslan", "Doğan", "Kılıç", "Aslan", "Koç", "Polat", "Özkan", "Bulut", "Ateş"];

// ---- RAKİP ÇETELER ----
const RIVAL_GANGS = [
  {
    id: "kartal_cete", name: "Kartallar", color: "#c0392b", strength: 3,
    controlledStart: ["nisantasi", "sariyer"], personality: "agresif",
  },
  {
    id: "golge_cete", name: "Gölge Örgütü", color: "#8e44ad", strength: 2,
    controlledStart: ["kadikoy", "uskudar"], personality: "sinsi",
  },
  {
    id: "demir_cete", name: "Demir Yumruk", color: "#16a085", strength: 2,
    controlledStart: ["bakirkoy"], personality: "savunmaci",
  },
];

// ---- RASTGELE OLAYLAR ----
const RANDOM_EVENTS = [
  { id: "polis_baskini", name: "Polis Baskını", type: "negative", description: "Bir tesisiniz polis baskınına uğradı, gelir kaybı yaşandı." },
  { id: "ihbarci", name: "İhbarcı", type: "negative", description: "Ekibinizden biri polise bilgi sızdırdı, ısı arttı." },
  { id: "sansli_yuk", name: "Şanslı Sevkiyat", type: "positive", description: "Beklenenden büyük bir yük ele geçirdiniz." },
  { id: "rakip_saldiri", name: "Rakip Çete Saldırısı", type: "negative", description: "Bir rakip çete bölgenize saldırdı." },
  { id: "yeni_baglanti", name: "Yeni Bağlantı", type: "positive", description: "Şehirde yeni bir tedarik bağlantısı buldunuz, maliyetler düştü." },
  { id: "medya_ilgisi", name: "Medya İlgisi", type: "negative", description: "Faaliyetleriniz basına sızdı, ısı ciddi arttı." },
];

// ---- OYUN DENGE SABİTLERİ ----
const GAME_CONSTANTS = {
  startingCash: 30000,
  startingHeat: 0,
  maxHeat: 100,
  heatDecayPerHour: 1.0,
  raidHeatThreshold: 80,
  tickIntervalMs: 3000,
  minutesPerTick: 5,
  randomEventChancePerTick: 0.04,
};

if (typeof module !== "undefined") {
  module.exports = {
    DISTRICTS, BUSINESS_TYPES, RAW_MATERIALS, REFINERY_SITE_COST,
    RAW_MATERIAL_PRODUCTION_PER_HOUR, DRUG_PRODUCTS, LAB_LEVELS, VEHICLES,
    HEIST_TARGETS, CREW_ROLES, FIRST_NAMES, LAST_NAMES, RIVAL_GANGS,
    RANDOM_EVENTS, GAME_CONSTANTS,
  };
}
