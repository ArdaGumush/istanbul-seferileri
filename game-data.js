// ============================================================
// İSTANBUL İMPARATORLUĞU - OYUN VERİSİ
// ============================================================

// ---- SEMTLER ----
const DISTRICTS = [
  {
    id: "tarlabasi", name: "Tarlabaşı", x: 43, y: 22,
    wealth: 1, heatResistance: 4, difficulty: 1, basePrice: 12000,
    description: "Şehrin arka sokakları. Polis pek uğramaz, para da az.",
    neighbors: ["kasimpasa", "beyoglu"],
  },
  {
    id: "kasimpasa", name: "Kasımpaşa", x: 60, y: 21,
    wealth: 1, heatResistance: 4, difficulty: 1, basePrice: 14000,
    description: "Liman kenarı, dar sokaklar. Başlangıç için ideal.",
    neighbors: ["tarlabasi", "beyoglu", "halic"],
  },
  {
    id: "beyoglu", name: "Beyoğlu", x: 51, y: 34,
    wealth: 3, heatResistance: 2, difficulty: 3, basePrice: 42000,
    description: "Gece hayatının kalbi. Barlar, kulüpler, kumarhane potansiyeli.",
    neighbors: ["tarlabasi", "kasimpasa", "besiktas", "sisli"],
  },
  {
    id: "besiktas", name: "Beşiktaş", x: 66, y: 10,
    wealth: 4, heatResistance: 2, difficulty: 4, basePrice: 58000,
    description: "Sahil şeridi, yüksek yaşam standardı. Polis burada tetikte.",
    neighbors: ["beyoglu", "sisli", "sariyer"],
  },
  {
    id: "nisantasi", name: "Nişantaşı", x: 76, y: 20,
    wealth: 5, heatResistance: 1, difficulty: 5, basePrice: 85000,
    description: "Lüks mağazalar, zengin müşteri kitlesi, ağır güvenlik.",
    neighbors: ["sisli", "besiktas"],
  },
  {
    id: "sisli", name: "Şişli", x: 68, y: 24,
    wealth: 4, heatResistance: 3, difficulty: 3, basePrice: 50000,
    description: "İş merkezleri ve ofis blokları. Dolandırıcılık için verimli.",
    neighbors: ["beyoglu", "besiktas", "nisantasi", "sariyer"],
  },
  {
    id: "sariyer", name: "Sarıyer", x: 85, y: 4,
    wealth: 5, heatResistance: 3, difficulty: 4, basePrice: 70000,
    description: "Villa bölgesi, boğaz manzaralı. Uzak ama kazançlı.",
    neighbors: ["besiktas", "sisli"],
  },
  {
    id: "fatih", name: "Fatih", x: 40, y: 49,
    wealth: 2, heatResistance: 5, difficulty: 2, basePrice: 22000,
    description: "Tarihi yarımada, muhafazakâr doku. Düşük ısı, düşük tavan.",
    neighbors: ["halic", "zeytinburnu"],
  },
  {
    id: "halic", name: "Haliç", x: 55, y: 44,
    wealth: 2, heatResistance: 4, difficulty: 2, basePrice: 24000,
    description: "Sanayi kalıntıları, depo bölgeleri. Nakliye için elverişli.",
    neighbors: ["kasimpasa", "fatih", "zeytinburnu"],
  },
  {
    id: "zeytinburnu", name: "Zeytinburnu", x: 25, y: 58,
    wealth: 2, heatResistance: 4, difficulty: 2, basePrice: 20000,
    description: "Sanayi ve liman erişimi. Hammadde üretimi için elverişli.",
    neighbors: ["fatih", "halic", "bakirkoy"],
  },
  {
    id: "bakirkoy", name: "Bakırköy", x: 10, y: 65,
    wealth: 3, heatResistance: 3, difficulty: 3, basePrice: 34000,
    description: "Liman şehri. Deniz yoluyla mal giriş çıkışı kolay.",
    neighbors: ["zeytinburnu"],
  },
  {
    id: "uskudar", name: "Üsküdar", x: 89, y: 31,
    wealth: 2, heatResistance: 4, difficulty: 2, basePrice: 26000,
    description: "Boğazın Anadolu yakası, sakin ama gözden ırak değil.",
    neighbors: ["kadikoy"],
  },
  {
    id: "kadikoy", name: "Kadıköy", x: 100, y: 44,
    wealth: 3, heatResistance: 3, difficulty: 3, basePrice: 38000,
    description: "Genç nüfus, canlı gece hayatı, kumarhane potansiyeli yüksek.",
    neighbors: ["uskudar"],
  },
];

// ---- İŞLETME TÜRLERİ (semtlere kurulabilir, pasif gelir üretir) ----
const BUSINESS_TYPES = [
  {
    id: "koruma", name: "Koruma Rüşveti", icon: "",
    baseCost: 5000, baseIncomePerHour: 180, heatPerHour: 0.5,
    description: "Yerel esnaftan düzenli haraç toplama ağı.",
  },
  {
    id: "kumarhane", name: "Yeraltı Kumarhanesi", icon: "",
    baseCost: 18000, baseIncomePerHour: 520, heatPerHour: 1.5,
    description: "Yüksek kazanç, yüksek görünürlük.",
  },
  {
    id: "gasp", name: "Gasp Şebekesi", icon: "",
    baseCost: 3000, baseIncomePerHour: 110, heatPerHour: 1.2,
    description: "Sokakta hızlı ve kirli para.",
  },
  {
    id: "dolandiricilik", name: "Dolandırıcılık Ofisi", icon: "",
    baseCost: 9000, baseIncomePerHour: 280, heatPerHour: 0.9,
    description: "Sahte yatırım ve sigorta dolandırıcılığı operasyonu.",
  },
];

// ---- UYUŞTURUCU ZİNCİRİ: Hammadde -> Nakliye -> Laboratuvar -> Dağıtım ----
const RAW_MATERIALS = [
  { id: "kimyasal_a", name: "Zestrayn-9", icon: "", baseCost: 40 },
  { id: "kimyasal_b", name: "Voltrik Asit", icon: "", baseCost: 60 },
  { id: "bitkisel_ozut", name: "Karadal Özütü", icon: "", baseCost: 35 },
];

const REFINERY_SITE_COST = 16000; // hammadde üretim tesisi kurma maliyeti (semt başına)
const RAW_MATERIAL_PRODUCTION_PER_HOUR = 24; // tesis başına saatlik üretim

const DRUG_PRODUCTS = [
  {
    id: "esrar", name: "Esrar", icon: "",
    requires: [{ material: "bitkisel_ozut", amount: 2 }],
    yieldPerBatch: 12, streetPrice: 140, riskPerBatch: 1,
    minigame: {
      steps: [
        { type: "add_material", label: "Karadal Özütünü tepsiye yay", targetValue: null },
        { type: "temperature", label: "Fırını 60°C'de tut", targetMin: 55, targetMax: 65, durationSec: 20 },
        { type: "wait", label: "Kurumaya bırak", durationSec: 15 },
        { type: "pack", label: "Dozları paketle", targetValue: null },
      ],
    },
  },
  {
    id: "meth", name: "Meth", icon: "",
    requires: [{ material: "kimyasal_a", amount: 2 }, { material: "kimyasal_b", amount: 1 }],
    yieldPerBatch: 10, streetPrice: 220, riskPerBatch: 3,
    minigame: {
      steps: [
        { type: "add_material", label: "Zestrayn-9'u reaksiyon kabına ekle", targetValue: null },
        { type: "temperature", label: "Sıcaklığı 130°C'de sabitle", targetMin: 122, targetMax: 138, durationSec: 25 },
        { type: "add_material", label: "Voltrik Asit ekle", targetValue: null },
        { type: "temperature", label: "Soğutma — 20°C altına indir", targetMin: 0, targetMax: 20, durationSec: 15 },
      ],
    },
  },
  {
    id: "kokain", name: "Kokain", icon: "",
    requires: [{ material: "bitkisel_ozut", amount: 3 }, { material: "kimyasal_a", amount: 1 }],
    yieldPerBatch: 8, streetPrice: 380, riskPerBatch: 4,
    minigame: {
      steps: [
        { type: "add_material", label: "Karadal Özütünü ezip süzgeçten geçir", targetValue: null },
        { type: "temperature", label: "Sıcaklığı 90°C'de tut", targetMin: 84, targetMax: 96, durationSec: 20 },
        { type: "add_material", label: "Zestrayn-9 ile işle", targetValue: null },
        { type: "wait", label: "Kristalleşmeyi bekle", durationSec: 20 },
      ],
    },
  },
  {
    id: "eroin", name: "Eroin", icon: "",
    requires: [{ material: "bitkisel_ozut", amount: 2 }, { material: "kimyasal_b", amount: 2 }],
    yieldPerBatch: 6, streetPrice: 450, riskPerBatch: 5,
    minigame: {
      steps: [
        { type: "add_material", label: "Karadal Özütünü kaynatma kabına koy", targetValue: null },
        { type: "temperature", label: "Sıcaklığı 110°C'de tut", targetMin: 103, targetMax: 117, durationSec: 25 },
        { type: "add_material", label: "Voltrik Asit ile nötrleştir", targetValue: null },
        { type: "temperature", label: "Soğutma — 15°C altına indir", targetMin: 0, targetMax: 15, durationSec: 20 },
        { type: "pack", label: "Dozları paketle", targetValue: null },
      ],
    },
  },
];

const LAB_LEVELS = [
  { level: 1, cost: 20000, batchTimeMin: 30, capacity: 2 },
  { level: 2, cost: 45000, batchTimeMin: 22, capacity: 4 },
  { level: 3, cost: 90000, batchTimeMin: 15, capacity: 7 },
];

// Araçlar: hammaddeyi üretim tesisinden laboratuvara taşımak için
// ---- PLAKA ÜRETİMİ (TR format: İl Kodu + Harf(ler) + Rakam) ----
const PLATE_LETTERS = "ABCDEFGHIJKLMNOPRSTUVYZ"; // TR plakalarında kullanılmayan Q,W,X hariç
const PLATE_PROVINCE_CODES = [34, 6, 35, 16, 7, 1, 42, 27, 55, 61, 41, 21, 26, 38]; // yaygın büyük şehir kodları

function generatePlate() {
  const province = PLATE_PROVINCE_CODES[Math.floor(Math.random() * PLATE_PROVINCE_CODES.length)];
  const format = Math.floor(Math.random() * 3);
  const randLetter = () => PLATE_LETTERS[Math.floor(Math.random() * PLATE_LETTERS.length)];
  const randDigits = (n) => String(Math.floor(Math.random() * Math.pow(10, n))).padStart(n, "0");

  if (format === 0) return `${province} ${randLetter()} ${randDigits(4)}`;
  if (format === 1) return `${province} ${randLetter()}${randLetter()} ${randDigits(3)}`;
  return `${province} ${randLetter()}${randLetter()}${randLetter()} ${randDigits(2)}`;
}

const VEHICLES = [
  { id: "panelvan", name: "Panelvan", cost: 8000, capacity: 30, passengerCapacity: 4, speedMin: 8, riskModifier: 1.0, maxDurability: 100 },
  { id: "kamyon", name: "Kamyon", cost: 20000, capacity: 80, passengerCapacity: 2, speedMin: 14, riskModifier: 1.3, maxDurability: 150 },
  { id: "spor_araba", name: "Spor Araba", cost: 35000, capacity: 10, passengerCapacity: 2, speedMin: 4, riskModifier: 0.6, maxDurability: 60 },
];

// ---- SOYGUN HEDEFLERİ ----
const HEIST_TARGETS = [
  {
    id: "kuyumcu", name: "Kapalıçarşı Kuyumcusu", icon: "", difficulty: 1,
    requiredRoles: ["asker_devriye", "asker_devriye"],
    equipmentOptions: [
      { id: "maske", name: "Maskeler", cost: 500, successBonus: 5 },
      { id: "kesici", name: "Kasa Kesici", cost: 2000, successBonus: 15 },
    ],
    baseSuccess: 55, payout: [8000, 18000],
    heatOnSuccess: 8, heatOnFail: 20, prepTimeMin: 15,
    description: "Küçük ama tıklım tıklım dolu bir kuyumcu. Hızlı iş, orta risk.",
  },
  {
    id: "banka_subesi", name: "Banka Şubesi", icon: "", difficulty: 2,
    requiredRoles: ["asker_devriye", "muhasebeci", "asker_devriye"],
    equipmentOptions: [
      { id: "sinyal_kesici", name: "Sinyal Kesici", cost: 4000, successBonus: 12 },
      { id: "agir_silah", name: "Ağır Silah Seti", cost: 6000, successBonus: 10 },
    ],
    baseSuccess: 40, payout: [25000, 60000],
    heatOnSuccess: 18, heatOnFail: 35, prepTimeMin: 35,
    description: "Orta ölçekli şube. Tam ekip ve doğru zamanlama gerektirir.",
  },
  {
    id: "nakit_kamyonu", name: "Zırhlı Nakit Kamyonu", icon: "", difficulty: 3,
    requiredRoles: ["asker_devriye", "asker_devriye", "surucu"],
    equipmentOptions: [
      { id: "patlayici", name: "Kapı Patlayıcısı", cost: 7000, successBonus: 18 },
      { id: "takip_cihazi", name: "Takip Cihazı", cost: 3000, successBonus: 8 },
    ],
    baseSuccess: 35, payout: [40000, 90000],
    heatOnSuccess: 25, heatOnFail: 45, prepTimeMin: 45,
    description: "Hareket halindeki hedef. Zamanlama her şeydir.",
  },
  {
    id: "ozel_sergi", name: "Özel Koleksiyon Sergisi", icon: "", difficulty: 4,
    requiredRoles: ["asker_devriye", "muhasebeci", "casus", "surucu"],
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
// ---- EKİP ROLLERİ (Specialty Sistemi) ----
// Asker rolünün silah türüne göre alt-sınıfları var (subclass alanı).
// combatRole: soygun/karşı-operasyon gibi mevcut sistemlerde "silahlı eleman"
// gereksinimini karşılayan roller (asker alt-sınıfları).
const CREW_ROLES = {
  asker_nisanci: { name: "Asker (Nişancı)", icon: "", baseWage: 340, category: "asker", weaponAffinity: "tufek", combatRole: true },
  asker_agir_silahli: { name: "Asker (Ağır Silahlı)", icon: "", baseWage: 340, category: "asker", weaponAffinity: "makineli", combatRole: true },
  asker_devriye: { name: "Asker (Devriye)", icon: "", baseWage: 300, category: "asker", weaponAffinity: "tabanca", combatRole: true },
  satici: { name: "Satıcı", icon: "", baseWage: 220, category: "ekonomi" },
  bas_satici: { name: "Dağıtım Amiri", icon: "", baseWage: 380, category: "ekonomi" },
  uretici: { name: "Uyuşturucu Üreticisi", icon: "", baseWage: 300, category: "ekonomi" },
  surucu: { name: "Sürücü", icon: "", baseWage: 240, category: "destek", combatRole: true },
  casus: { name: "Casus", icon: "", baseWage: 320, category: "istihbarat" },
  doktor: { name: "Doktor", icon: "", baseWage: 350, category: "destek" },
  muhasebeci: { name: "Muhasebeci", icon: "", baseWage: 250, category: "destek" },
  tamirci: { name: "Tamirci", icon: "", baseWage: 260, category: "destek" },
};

// Soygun/karşı-operasyon gibi sistemlerin "silahlı eleman" ihtiyacını
// karşılayan rollerin listesi (eski 'silahsor'/'enforcer' yerine geçti)
const COMBAT_CAPABLE_ROLES = Object.keys(CREW_ROLES).filter(r => CREW_ROLES[r].combatRole);

// ---- ATTRIBUTE SİSTEMİ (20 üzerinden, her karakterde 15 attribute) ----
const ATTRIBUTES = {
  uyusturucu_uretme: { name: "Uyuşturucu Üretme" },
  makineli_kabiliyeti: { name: "Makineli Tüfek Kabiliyeti" },
  pompali_kabiliyeti: { name: "Pompalı Tüfek Kabiliyeti" },
  tabanca_kabiliyeti: { name: "Tabanca Kabiliyeti" },
  nisan_kabiliyeti: { name: "Nişan Almalı Silah Kabiliyeti" },
  surculuk: { name: "Sürücülük Kabiliyeti" },
  liderlik: { name: "Liderlik Kabiliyeti" },
  ikna: { name: "İkna Kabiliyeti" },
  dayaniklilik: { name: "Dayanıklılık" },
  zeka: { name: "Zeka" },
  karizma: { name: "Karizma" },
  medikal: { name: "Medikal Yetenek" },
  sadakat_direnci: { name: "Sadakat Direnci" },
  gizlilik: { name: "Gizlilik" },
  pazarlik: { name: "Pazarlık Yeteneği" },
};

// Her rolün "yüksek eğilimli" (10-20 aralığından çekilen) attribute'ları.
// Listelenmeyen tüm attribute'lar normal aralıktan (4-12) çekilir - hiçbiri asla eksik olmaz.
const ROLE_ATTRIBUTE_FOCUS = {
  asker_nisanci: ["nisan_kabiliyeti", "dayaniklilik"],
  asker_agir_silahli: ["makineli_kabiliyeti", "dayaniklilik"],
  asker_devriye: ["tabanca_kabiliyeti", "pompali_kabiliyeti"],
  satici: ["ikna", "karizma"],
  bas_satici: ["liderlik", "pazarlik"],
  uretici: ["uyusturucu_uretme", "zeka"],
  surucu: ["surculuk", "dayaniklilik"],
  casus: ["zeka", "gizlilik"],
  doktor: ["medikal", "zeka"],
  muhasebeci: ["zeka", "pazarlik"],
  tamirci: ["zeka", "dayaniklilik"],
};

const ATTRIBUTE_NORMAL_MIN = 4, ATTRIBUTE_NORMAL_MAX = 12;
const ATTRIBUTE_FOCUS_MIN = 10, ATTRIBUTE_FOCUS_MAX = 20;

// Bir rol için tam 15 attribute'luk bir set üretir. Odaklı attribute'lar yüksek
// aralıktan, geri kalanı normal aralıktan çekilir - hiçbir attribute asla eksik kalmaz.
function generateAttributesForRole(roleId) {
  const focusKeys = ROLE_ATTRIBUTE_FOCUS[roleId] || [];
  const attrs = {};
  Object.keys(ATTRIBUTES).forEach(key => {
    const isFocus = focusKeys.includes(key);
    const min = isFocus ? ATTRIBUTE_FOCUS_MIN : ATTRIBUTE_NORMAL_MIN;
    const max = isFocus ? ATTRIBUTE_FOCUS_MAX : ATTRIBUTE_NORMAL_MAX;
    attrs[key] = min + Math.floor(Math.random() * (max - min + 1));
  });
  return attrs;
}

const FIRST_NAMES = ["Kemal", "Hakan", "Serkan", "Murat", "Emre", "Tolga", "Barış", "Cem", "Deniz", "Onur", "Selim", "Volkan", "Ayşe", "Elif", "Zeynep", "Derya", "Pınar", "Sibel", "Kaan", "Burak"];
const LAST_NAMES = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Aydın", "Öztürk", "Arslan", "Doğan", "Kılıç", "Aslan", "Koç", "Polat", "Özkan", "Bulut", "Ateş"];

// ---- MAHALLELER (her semtin alt katmanı) ----
const NEIGHBORHOODS = {
  tarlabasi: ["Kardeş Sokağı", "Çınar Meydanı", "Demirci Geçidi"],
  kasimpasa: ["Liman Sırtı", "Tersane Arkası", "Kaptan Sokağı"],
  beyoglu: ["Balo Sokağı", "Asmalı Geçit", "Nardis Köşesi", "Perşembe Pazarı"],
  besiktas: ["İskele Meydanı", "Barbaros Sırtı", "Akaretler Arkası"],
  nisantasi: ["Vitrin Caddesi", "Maçka Yamacı"],
  sisli: ["Ofis Bloğu", "Cevahir Arkası", "Bomonti Yokuşu"],
  sariyer: ["Yalı Sırtı", "Koru Kenarı"],
  fatih: ["At Meydanı", "Sur Dibi", "Çarşamba Pazarı"],
  halic: ["Tersane Yolu", "Dökümhane Sokağı"],
  zeytinburnu: ["Sanayi Bloğu", "Demiryolu Kenarı"],
  bakirkoy: ["Rıhtım Sokağı", "İskele Arkası"],
  uskudar: ["Çarşı İçi", "Tekke Yokuşu"],
  kadikoy: ["Bahariye Sırtı", "Moda Kıyısı", "Çarşı Arkası"],
};

// ---- RAKİP ÇETELER ----
const RIVAL_GANGS = [
  {
    id: "kartal_cete", name: "Kartallar", color: "#c0392b", strength: 3,
    controlledStart: ["nisantasi", "sariyer"], personality: "agresif",
    hideoutDistrict: "nisantasi",
  },
  {
    id: "golge_cete", name: "Gölge Örgütü", color: "#8e44ad", strength: 2,
    controlledStart: ["kadikoy", "uskudar"], personality: "sinsi",
    hideoutDistrict: "kadikoy",
  },
  {
    id: "demir_cete", name: "Demir Yumruk", color: "#16a085", strength: 2,
    controlledStart: ["bakirkoy"], personality: "savunmaci",
    hideoutDistrict: "bakirkoy",
  },
];

// ---- POLİS ----
const POLICE_FACTION = {
  id: "polis", name: "Polis", color: "#2980b9",
  hideoutDistrict: "fatih", // karakol merkezi
};

// ---- KARŞI-OPERASYON TÜRLERİ (oyuncunun rakiplere karşı yapabileceği) ----
const COUNTER_OPS = {
  ambush: {
    name: "Kaçış Aracını Sıkıştır", icon: "",
    description: "Rakip bir soygundan dönerken yolunu kes. Kazanırsan ganimeti alırsın.",
    requiredRoles: ["asker_devriye", "surucu"],
    baseSuccess: 45,
  },
  hijack: {
    name: "Nakliyeyi Soy", icon: "",
    description: "Rakibin hammadde/ürün taşıyan aracını pusuya düşür, yükü çal.",
    requiredRoles: ["asker_devriye"],
    baseSuccess: 55,
  },
  hideout_raid: {
    name: "Hideout Baskını", icon: "",
    description: "Rakibin ana üssüne baskın düzenle. Yüksek risk, yüksek ödül.",
    requiredRoles: ["asker_devriye", "asker_devriye", "asker_agir_silahli", "asker_nisanci"],
    baseSuccess: 25,
  },
  kidnap: {
    name: "Adam Kaçır / İnfaz Et", icon: "",
    description: "Rakibin bir aracını durdurup adamlarını etkisiz hale getir. Çeteyi geçici zayıflatır.",
    requiredRoles: ["asker_devriye", "asker_agir_silahli"],
    baseSuccess: 40,
  },
};

// ---- RASTGELE OLAYLAR ----
const RANDOM_EVENTS = [
  { id: "polis_baskini", name: "Polis Baskını", type: "negative", description: "Bir tesisiniz polis baskınına uğradı, gelir kaybı yaşandı." },
  { id: "ihbarci", name: "İhbarcı", type: "negative", description: "Ekibinizden biri polise bilgi sızdırdı, ısı arttı." },
  { id: "sansli_yuk", name: "Şanslı Sevkiyat", type: "positive", description: "Beklenenden büyük bir yük ele geçirdiniz." },
  { id: "rakip_saldiri", name: "Rakip Çete Saldırısı", type: "negative", description: "Bir rakip çete bölgenize saldırdı." },
  { id: "yeni_baglanti", name: "Yeni Bağlantı", type: "positive", description: "Şehirde yeni bir tedarik bağlantısı buldunuz, maliyetler düştü." },
  { id: "sakin_hafta", name: "Sakin Bir Hafta", type: "positive", description: "Sokaklar sakin, operasyonlarınız fark edilmeden ilerledi." },
];

// ============================================================
// SİLAH / ZIRH / SARF MALZEMESİ SİSTEMİ (Grid Combat için)
// ============================================================

// ---- SİLAHLAR: 4 tür x 3 segment ----
const WEAPONS = [
  // TABANCA
  { id: "tabanca_low", name: "Tabanca (Standart)", type: "tabanca", segment: "low", icon: "",
    damage: 12, range: 5, apCost: 1, shots: 1, armorPierce: 0.0,
    aoe: "none", canMoveAndFire: true,
    priceShop: 1200, priceSmuggle: 700 },
  { id: "tabanca_mid", name: "Tabanca (Uzatmalı Şarjör)", type: "tabanca", segment: "mid", icon: "",
    damage: 16, range: 6, apCost: 1, shots: 1, armorPierce: 0.1,
    aoe: "none", canMoveAndFire: true,
    priceShop: 2800, priceSmuggle: 1700 },
  { id: "tabanca_high", name: "Tabanca (Çift Atış)", type: "tabanca", segment: "high", icon: "",
    damage: 18, range: 6, apCost: 1, shots: 2, armorPierce: 0.15,
    aoe: "none", canMoveAndFire: true,
    priceShop: 5200, priceSmuggle: 3200 },

  // POMPALI
  { id: "pompali_low", name: "Pompalı (Kesme Namlu)", type: "pompali", segment: "low", icon: "",
    damage: 26, range: 2, apCost: 2, shots: 1, armorPierce: 0.05,
    aoe: "cone_small", canMoveAndFire: false,
    priceShop: 2200, priceSmuggle: 1300 },
  { id: "pompali_mid", name: "Pompalı (Çift Namlu)", type: "pompali", segment: "mid", icon: "",
    damage: 34, range: 3, apCost: 2, shots: 1, armorPierce: 0.1,
    aoe: "cone_medium", canMoveAndFire: false,
    priceShop: 4600, priceSmuggle: 2900 },
  { id: "pompali_high", name: "Pompalı (Otomatik)", type: "pompali", segment: "high", icon: "",
    damage: 42, range: 3, apCost: 2, shots: 2, armorPierce: 0.15,
    aoe: "cone_large", canMoveAndFire: false,
    priceShop: 8400, priceSmuggle: 5300 },

  // MAKİNELİ
  { id: "makineli_low", name: "Makineli (Hafif)", type: "makineli", segment: "low", icon: "",
    damage: 8, range: 6, apCost: 2, shots: 3, armorPierce: 0.05,
    aoe: "line_narrow", canMoveAndFire: false, suppressive: true,
    priceShop: 3500, priceSmuggle: 2100 },
  { id: "makineli_mid", name: "Makineli (Ağır Şarjör)", type: "makineli", segment: "mid", icon: "",
    damage: 10, range: 7, apCost: 2, shots: 4, armorPierce: 0.1,
    aoe: "line_medium", canMoveAndFire: false, suppressive: true,
    priceShop: 6800, priceSmuggle: 4200 },
  { id: "makineli_high", name: "Makineli (Tam Otomatik)", type: "makineli", segment: "high", icon: "",
    damage: 12, range: 8, apCost: 2, shots: 5, armorPierce: 0.15,
    aoe: "line_wide", canMoveAndFire: false, suppressive: true,
    priceShop: 11500, priceSmuggle: 7200 },

  // TÜFEK (Sniper)
  { id: "tufek_low", name: "Tüfek (Av Tüfeği Modifiyeli)", type: "tufek", segment: "low", icon: "",
    damage: 30, range: 9, apCost: 2, shots: 1, armorPierce: 0.2,
    aoe: "none", canMoveAndFire: false, requiresStationary: true,
    priceShop: 4200, priceSmuggle: 2600 },
  { id: "tufek_mid", name: "Tüfek (Yarı Otomatik)", type: "tufek", segment: "mid", icon: "",
    damage: 40, range: 11, apCost: 2, shots: 1, armorPierce: 0.35,
    aoe: "none", canMoveAndFire: false, requiresStationary: true,
    priceShop: 8800, priceSmuggle: 5500 },
  { id: "tufek_high", name: "Tüfek (Keskin Nişancı)", type: "tufek", segment: "high", icon: "",
    damage: 55, range: 14, apCost: 2, shots: 1, armorPierce: 0.6,
    aoe: "none", canMoveAndFire: false, requiresStationary: true,
    priceShop: 15000, priceSmuggle: 9500 },
];

// ---- ZIRHLAR ----
const ARMORS = [
  { id: "yelek_hafif", name: "Hafif Yelek", icon: "",
    damageReduction: 0.15, durability: 2, apPenalty: 0,
    priceShop: 1800, priceSmuggle: 1100 },
  { id: "yelek_orta", name: "Orta Zırh", icon: "",
    damageReduction: 0.30, durability: 4, apPenalty: 1,
    priceShop: 4200, priceSmuggle: 2700 },
  { id: "yelek_agir", name: "Ağır Zırh (Çelik Plaka)", icon: "",
    damageReduction: 0.50, durability: 7, apPenalty: 2,
    priceShop: 9000, priceSmuggle: 5800 },
];

// ---- SARF MALZEMELERİ (Consumables) ----
const CONSUMABLES = [
  {
    id: "molotof", name: "Molotof", icon: "",
    description: "Küçük alana atılır, birkaç tur boyunca o kareyi yakmaya devam eder.",
    aoeRadius: 1, damage: 14, burnTurns: 3, stunTurns: 0,
    coverPierce: 0, priceShop: 600, priceSmuggle: 350,
  },
  {
    id: "el_bombasi", name: "El Bombası", icon: "",
    description: "Orta alana anlık yüksek hasar verir, siperi kısmen deler.",
    aoeRadius: 2, damage: 35, burnTurns: 0, stunTurns: 0,
    coverPierce: 0.4, priceShop: 900, priceSmuggle: 550,
  },
  {
    id: "sersemletici", name: "Sersemletici (Flashbang)", icon: "",
    description: "Hasar vermez, alandaki düşmanları 1 tur sersemletir (ateş edemez).",
    aoeRadius: 2, damage: 0, burnTurns: 0, stunTurns: 1,
    coverPierce: 0, priceShop: 500, priceSmuggle: 300,
  },
  {
    id: "kirilma_sarji", name: "Kırılma Şarjı", icon: "",
    description: "Duvarı/kapıyı yıkar, yeni bir geçiş açar. Sabit haritalarda alternatif giriş sağlar.",
    aoeRadius: 1, damage: 20, burnTurns: 0, stunTurns: 0,
    coverPierce: 1.0, breachesWalls: true, priceShop: 1400, priceSmuggle: 900,
  },
];

// AOE tipi -> grid etki paterni (savaş motoru bunu kullanacak)
const AOE_PATTERNS = {
  none: { cells: [[0,0]] },
  cone_small: { cells: [[1,0],[1,-1],[1,1]] },       // 3 hücre koni
  cone_medium: { cells: [[1,0],[1,-1],[1,1],[2,0]] },
  cone_large: { cells: [[1,0],[1,-1],[1,1],[2,0],[2,-1],[2,1]] },
  line_narrow: { cells: [[1,0],[2,0],[3,0]] },
  line_medium: { cells: [[1,0],[2,0],[3,0],[4,0]] },
  line_wide: { cells: [[1,0],[2,0],[3,0],[4,0],[5,0]] },
};
const GAME_CONSTANTS = {
  startingCash: 30000,
  startingHeat: 0,
  maxHeat: 100,
  heatDecayPerHour: 1.0,
  raidHeatThreshold: 80,
  tickIntervalMs: 3000,
  minutesPerTick: 5,
  randomEventChancePerTick: 0.012,
};

// ---- KÖKEN HİKAYELERİ (karakter kuruluşu) ----
const ORIGINS = [
  {
    id: "eski_polis", name: "Eski Polis",
    description: "Yıllarca rozet taşıdın, sonra sistemin çürüklüğünü gördün. Artık kuralları sen koyuyorsun.",
    buff: "Isı direnci +%20 (polis usullerini biliyorsun)",
    apply: (s) => { s.modifiers.heatResistanceMult = (s.modifiers.heatResistanceMult || 1) * 1.2; },
  },
  {
    id: "eski_asker", name: "Eski Asker",
    description: "Ordudan sonra sokakta buldun kendini. Disiplin ve soğukkanlılık sende fazlasıyla var.",
    buff: "Soygun başarı şansı +%10",
    apply: (s) => { s.modifiers.heistSuccessBonus = (s.modifiers.heistSuccessBonus || 0) + 10; },
  },
  {
    id: "sokak_cocugu", name: "Sokak Çocuğu",
    description: "Bu şehrin arka sokaklarında büyüdün. Kimse seni senin kadar tanımıyor.",
    buff: "Başlangıçta 1 ücretsiz sadık adam",
    apply: (s) => { s.modifiers.freeCrewOnStart = true; },
  },
  {
    id: "is_insani", name: "İş İnsanı",
    description: "Legal dünyada başladın, ama gerçek para gölgede. Sermayenle bu işe giriyorsun.",
    buff: "Başlangıç nakiti +₺15.000",
    apply: (s) => { s.modifiers.startingCashBonus = (s.modifiers.startingCashBonus || 0) + 15000; },
  },
];

// ---- LİDERLİK TARZI ----
const LEADERSHIP_STYLES = [
  {
    id: "acimasiz", name: "Acımasız",
    description: "Korku en güçlü silahındır. Karşındakiler seni tanıdıkça geri çekilir.",
    buff: "Bölge saldırı başarı şansı +%15",
    apply: (s) => { s.modifiers.attackSuccessBonus = (s.modifiers.attackSuccessBonus || 0) + 15; },
  },
  {
    id: "sadik", name: "Sadık",
    description: "Adamların sana bir patrondan çok aileleri gibi bağlı. Bu bağ kolay kopmaz.",
    buff: "Ekip sadakati zamanla çok daha yavaş düşer",
    apply: (s) => { s.modifiers.loyaltyDecayMult = (s.modifiers.loyaltyDecayMult || 1) * 0.5; },
  },
  {
    id: "kurnaz", name: "Kurnaz",
    description: "Kaba kuvvetten önce plan gelir. Her operasyonun bir B planı vardır.",
    buff: "Soygun başarı şansı +%10",
    apply: (s) => { s.modifiers.heistSuccessBonus = (s.modifiers.heistSuccessBonus || 0) + 10; },
  },
];

// ---- İDEOLOJİLER ----
const IDEOLOGIES = [
  {
    id: "aile_sadakati", name: "Aile Sadakati",
    description: "Örgüt bir ailedir. Kimse geride bırakılmaz, kimse satılmaz.",
    buff: "Ekip maaş maliyeti -%15",
    drawback: "Bölge ele geçirme maliyeti +%10",
    apply: (s) => {
      s.modifiers.wageMult = (s.modifiers.wageMult || 1) * 0.85;
      s.modifiers.districtCostMult = (s.modifiers.districtCostMult || 1) * 1.1;
    },
  },
  {
    id: "kar_maksimizasyonu", name: "Kar Maksimizasyonu",
    description: "Duygular işi batırır. Tek gerçek sadakat kardır.",
    buff: "Tüm pasif işletme geliri +%20",
    drawback: "Ekip sadakati zamanla daha hızlı düşer",
    apply: (s) => {
      s.modifiers.businessIncomeMult = (s.modifiers.businessIncomeMult || 1) * 1.2;
      s.modifiers.loyaltyDecayMult = (s.modifiers.loyaltyDecayMult || 1) * 1.3;
    },
  },
  {
    id: "sokak_adaleti", name: "Sokak Adaleti",
    description: "Mahalle seni korur çünkü sen mahalleyi koruyorsun. Halk polise konuşmaz.",
    buff: "Isı birikimi -%20",
    drawback: "Tüm pasif işletme geliri -%10",
    apply: (s) => {
      s.modifiers.heatGainMult = (s.modifiers.heatGainMult || 1) * 0.8;
      s.modifiers.businessIncomeMult = (s.modifiers.businessIncomeMult || 1) * 0.9;
    },
  },
  {
    id: "golge_diplomasisi", name: "Gölge Diplomasisi",
    description: "Her çatışma bir başarısızlıktır. Masada çözülen sorun sokakta kan dökmez.",
    buff: "Rakip çete düşmanlığı %30 daha yavaş artar",
    drawback: "Saldırı/savunma başarı şansı -%10",
    apply: (s) => {
      s.modifiers.hostilityGainMult = (s.modifiers.hostilityGainMult || 1) * 0.7;
      s.modifiers.attackSuccessBonus = (s.modifiers.attackSuccessBonus || 0) - 10;
    },
  },
  {
    id: "komunist", name: "Komünist",
    description: "Bölge halkın malıdır, el konulmaz, kolektifleştirilir. Kâr değil, kontrol önceliğin.",
    buff: "Bölge ele geçirme maliyeti -%25",
    drawback: "İşletme geliri -%10",
    apply: (s) => {
      s.modifiers.districtCostMult = (s.modifiers.districtCostMult || 1) * 0.75;
      s.modifiers.businessIncomeMult = (s.modifiers.businessIncomeMult || 1) * 0.9;
    },
  },
  {
    id: "milliyetcilik", name: "Milliyetçilik",
    description: "Bu şehir sana ait olacak, açıkça ve gururla. Gizlenmek zayıflıktır.",
    buff: "Saldırı/savunma başarı şansı +%15",
    drawback: "Isı birikimi +%15",
    apply: (s) => {
      s.modifiers.attackSuccessBonus = (s.modifiers.attackSuccessBonus || 0) + 15;
      s.modifiers.heatGainMult = (s.modifiers.heatGainMult || 1) * 1.15;
    },
  },
];

// ---- ZORLUK SEVİYELERİ ----
// Ekonomi (gelir/gider) + rakip/operasyon zorluğunu birlikte etkiler.
const DIFFICULTY_LEVELS = [
  {
    id: "kolay", name: "Kolay",
    description: "İlk kez oynayanlar için. Daha bol gelir, daha kolay rakipler.",
    incomeMult: 1.35, expenseMult: 0.8,
    rivalStrengthMult: 0.75, operationSuccessBonus: 15,
  },
  {
    id: "orta", name: "Orta",
    description: "Dengeli bir deneyim. Ne çok kolay ne çok zor.",
    incomeMult: 1.0, expenseMult: 1.0,
    rivalStrengthMult: 1.0, operationSuccessBonus: 0,
  },
  {
    id: "zor", name: "Zor",
    description: "Gerçek bir mücadele. Az gelir, güçlü rakipler, hiçbir şey bedavaya gelmez.",
    incomeMult: 0.75, expenseMult: 1.25,
    rivalStrengthMult: 1.3, operationSuccessBonus: -15,
  },
];

// ---- SORGU / İŞKENCE SEVİYELERİ ----
// Her seviye, mahkumun canından RASTGELE bir aralıkta can götürür (sabit değil).
// Can, mevcut değerin 1/3'ünün altına düşünce mahkum konuşur (bilgi verir, tek seferlik).
const INTERROGATION_LEVELS = [
  {
    id: "hafif", name: "Hafif Baskı",
    description: "Tehdit ve psikolojik baskı. Düşük risk, yavaş sonuç.",
    damageMin: 2, damageMax: 5,
  },
  {
    id: "orta", name: "Orta Şiddet",
    description: "Fiziksel zorlama. Orta risk, orta hız.",
    damageMin: 5, damageMax: 10,
  },
  {
    id: "agir", name: "Ağır İşkence",
    description: "Acımasız yöntemler. Yüksek risk, hızlı sonuç — ama ölüm ihtimali ciddi.",
    damageMin: 10, damageMax: 20,
  },
];

const INTERROGATION_HEAL_MIN_MINUTES = 5;
const INTERROGATION_HEAL_MAX_MINUTES = 10;

if (typeof module !== "undefined") {
  module.exports = {
    DISTRICTS, BUSINESS_TYPES, RAW_MATERIALS, REFINERY_SITE_COST,
    RAW_MATERIAL_PRODUCTION_PER_HOUR, DRUG_PRODUCTS, LAB_LEVELS, VEHICLES,
    HEIST_TARGETS, CREW_ROLES, FIRST_NAMES, LAST_NAMES, RIVAL_GANGS,
    RANDOM_EVENTS, GAME_CONSTANTS, ORIGINS, LEADERSHIP_STYLES, IDEOLOGIES,
    POLICE_FACTION, COUNTER_OPS,
    WEAPONS, ARMORS, CONSUMABLES, AOE_PATTERNS,
    generatePlate, DIFFICULTY_LEVELS,
    INTERROGATION_LEVELS, INTERROGATION_HEAL_MIN_MINUTES, INTERROGATION_HEAL_MAX_MINUTES,
    ATTRIBUTES, ROLE_ATTRIBUTE_FOCUS, generateAttributesForRole,
  };
}
