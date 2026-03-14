import React, { useState, useEffect } from "react";

const STORAGE_KEY  = "hm-items-v4";
const MEMBERS_KEY  = "hm-members";
const MYCODE_KEY   = "hm-mycode";
const SHOPLIST_KEY = "hm-shoplist";

const CATEGORIES = {
  daily: { label: "日用品", icon: "🧴", color: "#5AA8E8" },
  food:  { label: "食品",   icon: "🥫", color: "#E8855A" },
  other: { label: "その他", icon: "📦", color: "#A85AE8" },
};

const STATUSES = [
  { key: "full",     label: "十分",   color: "#4CAF82", bg: "#E8F5EE" },
  { key: "ok",       label: "ある",   color: "#5AA8E8", bg: "#E8F4FF" },
  { key: "low",      label: "少ない", color: "#E8923A", bg: "#FEF3E8" },
  { key: "critical", label: "切れそう",color: "#E84A4A", bg: "#FEEAEA" },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.key, s]));

function getAvgDays(item) {
  if (!item.purchases || item.purchases.length < 2) return null;
  const sorted = [...item.purchases].sort();
  let total = 0;
  for (let i = 1; i < sorted.length; i++)
    total += (new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000;
  return total / (sorted.length - 1);
}

function getPrediction(item) {
  const avg = getAvgDays(item);
  if (!avg) return null;
  const ratioMap = { full: 1.0, ok: 0.6, low: 0.3, critical: 0.1 };
  const ratio = (ratioMap[item.status ?? "ok"] ?? 0.5) + (item.stockCount ?? 0);
  const daysLeft = Math.round(avg * ratio);
  return { date: new Date(Date.now() + daysLeft * 86400000), daysLeft };
}

const defaultItems = [
  { id: 1, name: "シャンプー",        category: "daily", status: "low",      stockCount: 1, shared: true,  sharedWith: [], purchases: ["2025-01-10","2025-02-14","2025-03-20"] },
  { id: 2, name: "トイレットペーパー", category: "daily", status: "full",     stockCount: 2, shared: true,  sharedWith: [], purchases: ["2025-01-05","2025-02-01","2025-03-01"] },
  { id: 3, name: "洗剤",              category: "daily", status: "ok",       stockCount: 0, shared: false, sharedWith: [], purchases: ["2025-01-20","2025-03-05"] },
  { id: 4, name: "歯磨き粉",          category: "daily", status: "critical", stockCount: 0, shared: false, sharedWith: [], purchases: ["2025-01-15","2025-02-28"] },
];

function genCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

function StockBoxes({ count, color }) {
  return (
    <div style={{ display: "flex", gap: 2.5, alignItems: "center" }}>
      {count === 0
        ? <span style={{ fontSize: 11, color: "#bbb", fontWeight: 600 }}>なし</span>
        : Array.from({ length: Math.min(count, 8) }).map((_, i) => (
            <div key={i} style={{ width: 8, height: 12, borderRadius: 2, background: color }} />
          ))}
      {count > 8 && <span style={{ fontSize: 11, color, fontWeight: 700 }}>+{count - 8}</span>}
    </div>
  );
}

// ── メンバーアバター ──
const AVATAR_COLORS = ["#5AA8E8","#E8855A","#A85AE8","#4CAF82","#E8923A","#E84A4A"];
function Avatar({ name, size = 24 }) {
  const idx = name.charCodeAt(0) % AVATAR_COLORS.length;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: AVATAR_COLORS[idx],
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.45, fontWeight: 700, color: "#fff", flexShrink: 0,
    }}>{name[0]}</div>
  );
}

export default function App() {
  const [page, setPage] = useState("home"); // "home" | "shopping"

  const [items, setItems] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : defaultItems; }
    catch { return defaultItems; }
  });
  // members: [{ code, name }]
  const [members, setMembers] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MEMBERS_KEY) || "[]"); } catch { return []; }
  });
  const [myCode] = useState(() => {
    let c = localStorage.getItem(MYCODE_KEY);
    if (!c) { c = genCode(); localStorage.setItem(MYCODE_KEY, c); }
    return c;
  });

  // 買い物リスト: [{ id, name, category, checked, addedAt }]
  const [shopList, setShopList] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SHOPLIST_KEY) || "[]"); } catch { return []; }
  });

  const [filterCat,    setFilterCat]    = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [expandedId,   setExpandedId]   = useState(null);
  const [showAdd,      setShowAdd]      = useState(false);
  const [showBuy,      setShowBuy]      = useState(null);
  const [buyCount,     setBuyCount]     = useState(1);
  const [showMembers,  setShowMembers]  = useState(false);
  const [showShareItem,setShowShareItem]= useState(null); // item
  const [joinInput,    setJoinInput]    = useState("");
  const [joinName,     setJoinName]     = useState("");
  const [toast,        setToast]        = useState(null);
  const [newItem,      setNewItem]      = useState({ name: "", category: "daily", status: "ok", stockCount: 0, shared: false });

  useEffect(() => { localStorage.setItem(STORAGE_KEY,  JSON.stringify(items));   }, [items]);
  useEffect(() => { localStorage.setItem(MEMBERS_KEY,  JSON.stringify(members)); }, [members]);
  useEffect(() => { localStorage.setItem(SHOPLIST_KEY, JSON.stringify(shopList));}, [shopList]);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const updateItem = (id, patch) =>
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));

  const recordPurchase = (item, count) => {
    const today = new Date().toISOString().split("T")[0];
    updateItem(item.id, {
      stockCount: (item.stockCount ?? 0) + count,
      purchases: [...(item.purchases || []), today].sort(),
    });
    // 買い物リストからチェック済みに
    setShopList(prev => prev.map(s => s.itemId === item.id ? { ...s, checked: true } : s));
    setShowBuy(null);
    showToast(`${count}個ストックに追加しました！`);
  };

  const addItem = () => {
    if (!newItem.name.trim()) return;
    setItems(prev => [...prev, { ...newItem, id: Date.now(), sharedWith: [], purchases: [] }]);
    setNewItem({ name: "", category: "daily", status: "ok", stockCount: 0, shared: false });
    setShowAdd(false);
    showToast("追加しました！");
  };

  const deleteItem = (id) => {
    setItems(prev => prev.filter(it => it.id !== id));
    setExpandedId(null);
    showToast("削除しました", "warn");
  };

  // メンバー追加
  const addMember = () => {
    if (joinInput.length !== 6 || !joinName.trim()) return;
    if (members.find(m => m.code === joinInput)) { showToast("既に追加済みです", "warn"); return; }
    setMembers(prev => [...prev, { code: joinInput, name: joinName.trim() }]);
    setJoinInput(""); setJoinName("");
    showToast(`${joinName} を追加しました！`);
  };

  const removeMember = (code) => {
    setMembers(prev => prev.filter(m => m.code !== code));
    // そのメンバーとの共有を解除
    setItems(prev => prev.map(it => ({
      ...it,
      sharedWith: (it.sharedWith || []).filter(c => c !== code),
    })));
  };

  // アイテムの共有メンバー切り替え
  const toggleShareWith = (itemId, memberCode) => {
    setItems(prev => prev.map(it => {
      if (it.id !== itemId) return it;
      const sw = it.sharedWith || [];
      return { ...it, sharedWith: sw.includes(memberCode) ? sw.filter(c => c !== memberCode) : [...sw, memberCode] };
    }));
  };

  // 買い物リスト：切れそうから自動追加
  const autoAddToShopList = () => {
    const targets = items.filter(it => ["critical","low"].includes(it.status ?? "ok"));
    let added = 0;
    setShopList(prev => {
      let next = [...prev];
      targets.forEach(it => {
        if (!next.find(s => s.itemId === it.id && !s.checked)) {
          next.push({ id: Date.now() + Math.random(), itemId: it.id, name: it.name, category: it.category, checked: false, addedAt: new Date().toISOString() });
          added++;
        }
      });
      return next;
    });
    showToast(added > 0 ? `${added}件を買い物リストに追加しました！` : "新規追加はありませんでした");
  };

  const toggleShopCheck = (id) =>
    setShopList(prev => prev.map(s => s.id === id ? { ...s, checked: !s.checked } : s));

  const removeShopItem = (id) =>
    setShopList(prev => prev.filter(s => s.id !== id));

  const clearChecked = () =>
    setShopList(prev => prev.filter(s => !s.checked));

  const addManualShopItem = (name) => {
    if (!name.trim()) return;
    setShopList(prev => [...prev, { id: Date.now(), itemId: null, name, category: "other", checked: false, addedAt: new Date().toISOString() }]);
  };

  const filteredItems = items.filter(it => {
    if (filterCat    !== "all" && it.category !== filterCat) return false;
    if (filterStatus !== "all" && (it.status ?? "ok") !== filterStatus) return false;
    return true;
  });

  const counts = {
    all:      items.length,
    critical: items.filter(i => (i.status ?? "ok") === "critical").length,
    low:      items.filter(i => (i.status ?? "ok") === "low").length,
    ok:       items.filter(i => ["ok","full"].includes(i.status ?? "ok")).length,
  };

  const shopUnchecked = shopList.filter(s => !s.checked).length;
  const [manualInput, setManualInput] = useState("");

  // ────────────────────────────────────────────
  // 買い物リストページ
  // ────────────────────────────────────────────
  if (page === "shopping") {
    const unchecked = shopList.filter(s => !s.checked);
    const checked   = shopList.filter(s =>  s.checked);

    return (
      <div style={{ minHeight: "100vh", background: "#F7F4EF", fontFamily: "'Hiragino Sans','Yu Gothic UI',sans-serif", maxWidth: 430, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ background: "#1A1A2E", padding: "20px 20px 16px", position: "sticky", top: 0, zIndex: 100 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => setPage("home")} style={{
              background: "#ffffff15", border: "none", borderRadius: 10,
              color: "#fff", fontSize: 18, cursor: "pointer", width: 36, height: 36,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>←</button>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#A8B4FF", fontSize: 11, letterSpacing: 2 }}>SHOPPING</div>
              <div style={{ color: "#fff", fontSize: 20, fontWeight: 800 }}>買い物リスト</div>
            </div>
            <button onClick={autoAddToShopList} style={{
              background: "#A8B4FF25", border: "1px solid #A8B4FF50",
              borderRadius: 10, padding: "8px 12px", color: "#A8B4FF",
              fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>✨ 自動追加</button>
          </div>
        </div>

        <div style={{ padding: "12px 16px 100px" }}>
          {/* 手動追加 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input value={manualInput} onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { addManualShopItem(manualInput); setManualInput(""); } }}
              placeholder="アイテムを手動で追加..."
              style={{ flex: 1, padding: "10px 14px", borderRadius: 12, border: "1.5px solid #E0DADA", fontSize: 14, outline: "none", fontFamily: "inherit", background: "#fff" }} />
            <button onClick={() => { addManualShopItem(manualInput); setManualInput(""); }} style={{
              background: "#1A1A2E", color: "#fff", border: "none",
              borderRadius: 12, padding: "0 16px", fontSize: 18, cursor: "pointer",
            }}>＋</button>
          </div>

          {shopList.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#aaa" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>
              <div style={{ marginBottom: 16 }}>リストが空です</div>
              <button onClick={autoAddToShopList} style={{
                background: "#1A1A2E", color: "#fff", border: "none",
                borderRadius: 12, padding: "12px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer",
              }}>✨ 切れそうなものを自動追加</button>
            </div>
          )}

          {/* 未チェック */}
          {unchecked.map(s => {
            const cat = CATEGORIES[s.category] ?? CATEGORIES.other;
            return (
              <div key={s.id} style={{
                background: "#fff", borderRadius: 14, marginBottom: 8,
                border: "1.5px solid #F0EDED", padding: "12px 14px",
                display: "flex", alignItems: "center", gap: 12,
                boxShadow: "0 1px 6px #00000007",
              }}>
                <button onClick={() => toggleShopCheck(s.id)} style={{
                  width: 26, height: 26, borderRadius: 8,
                  border: "2px solid #E0DADA", background: "#fff",
                  cursor: "pointer", flexShrink: 0,
                }} />
                <span style={{ fontSize: 18 }}>{cat.icon}</span>
                <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "#1A1A2E" }}>{s.name}</span>
                <button onClick={() => removeShopItem(s.id)} style={{
                  background: "none", border: "none", color: "#ddd", fontSize: 18, cursor: "pointer",
                }}>×</button>
              </div>
            );
          })}

          {/* チェック済み */}
          {checked.length > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 8px" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#bbb" }}>購入済み ({checked.length})</span>
                <button onClick={clearChecked} style={{
                  background: "none", border: "none", color: "#E84A4A",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}>すべて削除</button>
              </div>
              {checked.map(s => {
                const cat = CATEGORIES[s.category] ?? CATEGORIES.other;
                return (
                  <div key={s.id} style={{
                    background: "#F5F5F5", borderRadius: 14, marginBottom: 8,
                    border: "1.5px solid #EBEBEB", padding: "12px 14px",
                    display: "flex", alignItems: "center", gap: 12, opacity: 0.6,
                  }}>
                    <button onClick={() => toggleShopCheck(s.id)} style={{
                      width: 26, height: 26, borderRadius: 8,
                      border: "2px solid #4CAF82", background: "#4CAF82",
                      cursor: "pointer", flexShrink: 0, color: "#fff", fontSize: 14,
                    }}>✓</button>
                    <span style={{ fontSize: 18 }}>{cat.icon}</span>
                    <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "#888", textDecoration: "line-through" }}>{s.name}</span>
                    <button onClick={() => removeShopItem(s.id)} style={{
                      background: "none", border: "none", color: "#ddd", fontSize: 18, cursor: "pointer",
                    }}>×</button>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Bottom nav */}
        <BottomNav page={page} setPage={setPage} shopUnchecked={shopUnchecked} />

        {toast && <Toast toast={toast} />}
        <GlobalStyle />
      </div>
    );
  }

  // ────────────────────────────────────────────
  // ホームページ
  // ────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#F7F4EF", fontFamily: "'Hiragino Sans','Yu Gothic UI',sans-serif", maxWidth: 430, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ background: "#1A1A2E", padding: "20px 20px 16px", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: "#A8B4FF", fontSize: 11, letterSpacing: 2, marginBottom: 2 }}>HOUSEHOLD</div>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 800 }}>日用品マネージャー</div>
          </div>
          <button onClick={() => setShowMembers(true)} style={{
            background: "#ffffff15", border: "1px solid #ffffff25",
            borderRadius: 10, padding: "8px 12px",
            color: "#ffffff90", fontSize: 12, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span>👥</span>
            <span>{members.length > 0 ? `${members.length}人` : "メンバー"}</span>
          </button>
        </div>
        {/* Status filter */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {[
            { key: "all",      label: "全て",    color: "#A8B4FF" },
            { key: "critical", label: "切れそう", color: "#FF7070" },
            { key: "low",      label: "少ない",   color: "#FFB570" },
            { key: "ok",       label: "大丈夫",   color: "#70E0A0" },
          ].map(s => (
            <button key={s.key} onClick={() => setFilterStatus(s.key)} style={{
              flex: 1,
              background: filterStatus === s.key ? s.color + "25" : "#ffffff10",
              border: "1px solid " + (filterStatus === s.key ? s.color + "60" : "#ffffff15"),
              borderRadius: 10, padding: "8px 4px", cursor: "pointer",
            }}>
              <div style={{ color: s.color, fontSize: 18, fontWeight: 800 }}>{counts[s.key]}</div>
              <div style={{ color: "#ffffff80", fontSize: 10 }}>{s.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Category filter */}
      <div style={{ padding: "12px 16px 4px", display: "flex", gap: 8, overflowX: "auto" }}>
        {[["all","すべて",""], ...Object.entries(CATEGORIES).map(([k,v])=>[k,v.label,v.icon])].map(([key,label,icon]) => (
          <button key={key} onClick={() => setFilterCat(key)} style={{
            background: filterCat === key ? "#1A1A2E" : "#fff",
            color:      filterCat === key ? "#fff"    : "#666",
            border: "1px solid " + (filterCat === key ? "#1A1A2E" : "#E0DADA"),
            borderRadius: 20, padding: "6px 14px", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap", fontWeight: 600,
          }}>{icon} {label}</button>
        ))}
      </div>

      {/* Items */}
      <div style={{ padding: "8px 16px 110px" }}>
        {filteredItems.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#aaa" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div>アイテムがありません</div>
          </div>
        )}
        {filteredItems.map(item => {
          const st    = STATUS_MAP[item.status ?? "ok"] ?? STATUS_MAP.ok;
          const cat   = CATEGORIES[item.category] ?? CATEGORIES.other;
          const stock = item.stockCount ?? 0;
          const pred  = getPrediction(item);
          const avg   = getAvgDays(item);
          const isExp = expandedId === item.id;
          const sharedMembers = (item.sharedWith || []).map(c => members.find(m => m.code === c)).filter(Boolean);

          return (
            <div key={item.id} style={{
              background: "#fff", borderRadius: 16, marginBottom: 8, overflow: "hidden",
              border: "1.5px solid " + (item.status === "critical" ? "#E84A4A30" : "#F0EDED"),
              boxShadow: item.status === "critical" ? "0 2px 12px #E84A4A14" : "0 1px 6px #00000007",
            }}>
              <div style={{ height: 3, background: `linear-gradient(90deg,${st.color},${st.color}25)` }} />
              <div style={{ padding: "10px 14px" }}>
                {/* Main row */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 10, background: cat.color + "18",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0,
                  }}>{cat.icon}</div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: "#1A1A2E" }}>{item.name}</span>
                      {/* 共有バッジ */}
                      {item.shared && (
                        <span style={{ background: "#A8B4FF20", color: "#6670E8", borderRadius: 6, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>
                          🔗 共有中
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: "#aaa", fontWeight: 600 }}>ストック</span>
                      <StockBoxes count={stock} color={cat.color} />
                      <span style={{ fontSize: 12, fontWeight: 800, color: stock > 0 ? "#1A1A2E" : "#E84A4A" }}>{stock}個</span>
                    </div>
                  </div>

                  {/* Status buttons */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                    <div style={{ display: "flex", gap: 3 }}>
                      {STATUSES.map(s => (
                        <button key={s.key} onClick={() => updateItem(item.id, { status: s.key })} style={{
                          width: 28, height: 28, borderRadius: 8, border: "none", cursor: "pointer",
                          background: (item.status ?? "ok") === s.key ? s.color : s.bg,
                          color:      (item.status ?? "ok") === s.key ? "#fff"  : s.color,
                          fontSize: 9, fontWeight: 800,
                          boxShadow: (item.status ?? "ok") === s.key ? `0 2px 6px ${s.color}60` : "none",
                          transition: "all 0.15s",
                        }}>{s.label.slice(0,2)}</button>
                      ))}
                    </div>
                    <span style={{ background: st.bg, color: st.color, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
                      {st.label}
                    </span>
                  </div>
                </div>

                {/* 共有メンバーアバター */}
                {sharedMembers.length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginTop: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#aaa" }}>共有:</span>
                    {sharedMembers.map(m => <Avatar key={m.code} name={m.name} size={20} />)}
                    {sharedMembers.map(m => (
                      <span key={m.code + "n"} style={{ fontSize: 11, color: "#888" }}>{m.name}</span>
                    ))}
                  </div>
                )}

                {/* Prediction + buttons */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <div style={{ flex: 1, fontSize: 11, fontWeight: 600,
                    color: pred ? (pred.daysLeft < 7 ? "#E8923A" : "#aaa") : "#ccc" }}>
                    {pred
                      ? pred.daysLeft <= 0
                        ? "🚨 もう切れている可能性"
                        : `📅 あと約${pred.daysLeft}日 (${pred.date.toLocaleDateString("ja-JP",{month:"short",day:"numeric"})}頃)`
                      : "購入記録を増やすと予測できます"}
                  </div>
                  <button onClick={() => setShowShareItem(item)} style={{
                    background: item.shared ? "#A8B4FF20" : "#F5F3F0",
                    color: item.shared ? "#6670E8" : "#999",
                    border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>🔗</button>
                  <button onClick={() => { setShowBuy(item); setBuyCount(1); }} style={{
                    background: "#1A1A2E", color: "#fff", border: "none",
                    borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>🛒 購入</button>
                  <button onClick={() => setExpandedId(isExp ? null : item.id)} style={{
                    background: "#F5F3F0", color: "#999", border: "none",
                    borderRadius: 8, padding: "6px 10px", fontSize: 13, cursor: "pointer",
                  }}>{isExp ? "▲" : "▼"}</button>
                </div>

                {/* Expanded history */}
                {isExp && (
                  <div style={{ marginTop: 10, padding: "10px 12px", background: "#F9F7F4", borderRadius: 10, animation: "fadeIn 0.2s ease" }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: "#888", marginBottom: 8 }}>📋 購入履歴</div>
                    {!item.purchases?.length
                      ? <div style={{ color: "#ccc", fontSize: 13 }}>まだ記録がありません</div>
                      : [...item.purchases].reverse().slice(0, 6).map((d, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666", padding: "3px 0", borderBottom: "1px solid #EDEAE5" }}>
                          <span>{new Date(d).toLocaleDateString("ja-JP",{year:"numeric",month:"short",day:"numeric",weekday:"short"})}</span>
                          {i === 0 && <span style={{ color: "#4CAF82", fontSize: 11, fontWeight: 700 }}>最新</span>}
                        </div>
                      ))
                    }
                    {avg && <div style={{ marginTop: 6, fontSize: 11, color: "#aaa" }}>平均購入間隔: 約{Math.round(avg)}日</div>}
                    <button onClick={() => deleteItem(item.id)} style={{
                      marginTop: 10, width: "100%", background: "#FEEAEA", color: "#E84A4A",
                      border: "none", borderRadius: 8, padding: "7px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}>🗑 削除する</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* FAB */}
      <button onClick={() => setShowAdd(true)} style={{
        position: "fixed", bottom: 76, right: "50%", transform: "translateX(50%)",
        maxWidth: 380, width: "calc(100% - 64px)",
        background: "linear-gradient(135deg,#1A1A2E,#2D2D5E)", color: "#fff",
        border: "none", borderRadius: 14, padding: "13px", fontSize: 14, fontWeight: 800,
        cursor: "pointer", boxShadow: "0 4px 20px #1A1A2E40", zIndex: 89,
      }}>＋ アイテムを追加</button>

      {/* ── 購入モーダル ── */}
      {showBuy && (
        <Modal onClose={() => setShowBuy(null)}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4, color: "#1A1A2E" }}>🛒 購入記録</div>
          <div style={{ color: "#888", fontSize: 14, marginBottom: 20 }}>{showBuy.name} を何個買いましたか？</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, marginBottom: 20 }}>
            <button onClick={() => setBuyCount(c => Math.max(1,c-1))} style={btnStepper}>−</button>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 44, fontWeight: 900, color: "#1A1A2E", lineHeight: 1 }}>{buyCount}</div>
              <div style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>個</div>
            </div>
            <button onClick={() => setBuyCount(c => c+1)} style={btnStepper}>＋</button>
          </div>
          <div style={{ background: "#F9F7F4", borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#888", marginBottom: 4 }}>
              <span>現在のストック</span><span style={{ fontWeight: 700, color: "#1A1A2E" }}>{showBuy.stockCount ?? 0}個</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#4CAF82" }}>
              <span>追加後のストック</span><span style={{ fontWeight: 800 }}>{(showBuy.stockCount ?? 0) + buyCount}個 ✓</span>
            </div>
          </div>
          <button onClick={() => recordPurchase(showBuy, buyCount)} style={btnPrimary}>ストックに追加する</button>
        </Modal>
      )}

      {/* ── アイテム共有設定モーダル ── */}
      {showShareItem && (
        <Modal onClose={() => setShowShareItem(null)}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4, color: "#1A1A2E" }}>🔗 共有設定</div>
          <div style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>{showShareItem.name}</div>

          {/* 共有ON/OFF */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F9F7F4", borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1A2E" }}>このアイテムを共有する</span>
            <button onClick={() => updateItem(showShareItem.id, { shared: !showShareItem.shared })} style={{
              width: 48, height: 28, borderRadius: 14,
              background: showShareItem.shared ? "#4CAF82" : "#E0DADA",
              border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s",
            }}>
              <div style={{
                position: "absolute", top: 3, left: showShareItem.shared ? 22 : 2,
                width: 22, height: 22, borderRadius: "50%", background: "#fff",
                transition: "left 0.2s", boxShadow: "0 1px 4px #00000020",
              }} />
            </button>
          </div>

          {showShareItem.shared && (
            <>
              {members.length === 0 ? (
                <div style={{ textAlign: "center", padding: "20px", color: "#aaa", fontSize: 13 }}>
                  メンバーを追加してから共有できます
                  <br />
                  <button onClick={() => { setShowShareItem(null); setShowMembers(true); }} style={{
                    marginTop: 10, background: "#1A1A2E", color: "#fff", border: "none",
                    borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  }}>メンバーを追加する</button>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 10 }}>共有するメンバーを選択</div>
                  {members.map(m => {
                    const isShared = (showShareItem.sharedWith || []).includes(m.code);
                    return (
                      <div key={m.code} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px", borderRadius: 12,
                        background: isShared ? "#E8F4FF" : "#F9F7F4",
                        border: "1.5px solid " + (isShared ? "#5AA8E840" : "transparent"),
                        marginBottom: 8, cursor: "pointer",
                      }} onClick={() => {
                        toggleShareWith(showShareItem.id, m.code);
                        setShowShareItem(prev => ({
                          ...prev,
                          sharedWith: (prev.sharedWith || []).includes(m.code)
                            ? (prev.sharedWith).filter(c => c !== m.code)
                            : [...(prev.sharedWith || []), m.code],
                        }));
                      }}>
                        <Avatar name={m.name} size={32} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#1A1A2E" }}>{m.name}</div>
                          <div style={{ fontSize: 11, color: "#aaa" }}>{m.code}</div>
                        </div>
                        <div style={{
                          width: 22, height: 22, borderRadius: 6,
                          background: isShared ? "#5AA8E8" : "#E0DADA",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff", fontSize: 13, fontWeight: 800,
                        }}>{isShared ? "✓" : ""}</div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </Modal>
      )}

      {/* ── メンバー管理モーダル ── */}
      {showMembers && (
        <Modal onClose={() => setShowMembers(false)}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4, color: "#1A1A2E" }}>👥 メンバー管理</div>
          <div style={{ color: "#888", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
            あなたのコード: <strong style={{ color: "#1A1A2E", letterSpacing: 2 }}>{myCode}</strong>
            <br />このコードを相手に教えると、相手があなたを追加できます。
          </div>

          {/* 追加フォーム */}
          <div style={{ background: "#F9F7F4", borderRadius: 12, padding: "14px", marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 10 }}>メンバーを追加</div>
            <input value={joinName} onChange={e => setJoinName(e.target.value)}
              placeholder="名前"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #E0DADA", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit", marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <input value={joinInput} onChange={e => setJoinInput(e.target.value.toUpperCase())}
                placeholder="相手のコード (6文字)" maxLength={6}
                style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1.5px solid #E0DADA", fontSize: 14, outline: "none", letterSpacing: 2, fontWeight: 700, fontFamily: "inherit" }} />
              <button onClick={addMember} style={{
                background: "#1A1A2E", color: "#fff", border: "none",
                borderRadius: 10, padding: "0 16px", fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}>追加</button>
            </div>
          </div>

          {/* メンバー一覧 */}
          {members.length === 0 ? (
            <div style={{ textAlign: "center", color: "#bbb", fontSize: 13, padding: "16px" }}>まだメンバーがいません</div>
          ) : (
            members.map(m => (
              <div key={m.code} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 12, background: "#F9F7F4", marginBottom: 8,
              }}>
                <Avatar name={m.name} size={36} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#1A1A2E" }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: "#aaa", letterSpacing: 1 }}>{m.code}</div>
                </div>
                <button onClick={() => removeMember(m.code)} style={{
                  background: "#FEEAEA", color: "#E84A4A", border: "none",
                  borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}>削除</button>
              </div>
            ))
          )}
        </Modal>
      )}

      {/* ── 追加モーダル ── */}
      {showAdd && (
        <Modal onClose={() => setShowAdd(false)}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 20, color: "#1A1A2E" }}>新しいアイテムを追加</div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>アイテム名</label>
            <input value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))}
              placeholder="例：シャンプー、牛乳"
              style={inputStyle} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>カテゴリ</label>
            <div style={{ display: "flex", gap: 8 }}>
              {Object.entries(CATEGORIES).map(([key,cat]) => (
                <button key={key} onClick={() => setNewItem(p => ({ ...p, category: key }))} style={{
                  flex: 1, background: newItem.category === key ? "#1A1A2E" : "#F5F3F0",
                  color: newItem.category === key ? "#fff" : "#555",
                  border: "none", borderRadius: 10, padding: "8px 4px", fontSize: 13, cursor: "pointer", fontWeight: 600,
                }}>{cat.icon} {cat.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>今の状態</label>
            <div style={{ display: "flex", gap: 6 }}>
              {STATUSES.map(s => (
                <button key={s.key} onClick={() => setNewItem(p => ({ ...p, status: s.key }))} style={{
                  flex: 1, background: newItem.status === s.key ? s.color : s.bg,
                  color: newItem.status === s.key ? "#fff" : s.color,
                  border: "none", borderRadius: 10, padding: "8px 4px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  boxShadow: newItem.status === s.key ? `0 2px 8px ${s.color}50` : "none",
                  transition: "all 0.15s",
                }}>{s.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>ストック数</label>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button onClick={() => setNewItem(p => ({ ...p, stockCount: Math.max(0,p.stockCount-1) }))} style={btnSmall}>−</button>
              <span style={{ fontSize: 22, fontWeight: 800, minWidth: 30, textAlign: "center" }}>{newItem.stockCount}</span>
              <button onClick={() => setNewItem(p => ({ ...p, stockCount: p.stockCount+1 }))} style={btnSmall}>＋</button>
              <span style={{ fontSize: 12, color: "#aaa" }}>個</span>
            </div>
          </div>
          <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F9F7F4", borderRadius: 12, padding: "12px 16px" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1A2E" }}>共有する</span>
            <button onClick={() => setNewItem(p => ({ ...p, shared: !p.shared }))} style={{
              width: 48, height: 28, borderRadius: 14,
              background: newItem.shared ? "#4CAF82" : "#E0DADA",
              border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s",
            }}>
              <div style={{
                position: "absolute", top: 3, left: newItem.shared ? 22 : 2,
                width: 22, height: 22, borderRadius: "50%", background: "#fff",
                transition: "left 0.2s", boxShadow: "0 1px 4px #00000020",
              }} />
            </button>
          </div>
          <button onClick={addItem} style={btnPrimary}>追加する</button>
        </Modal>
      )}

      {toast && <Toast toast={toast} />}
      <BottomNav page={page} setPage={setPage} shopUnchecked={shopUnchecked} />
      <GlobalStyle />
    </div>
  );
}

// ── 共通コンポーネント ──
function Modal({ children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000060", zIndex: 200, display: "flex", alignItems: "flex-end" }}
      onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 430, margin: "0 auto", animation: "slideUp 0.3s ease", maxHeight: "85vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function BottomNav({ page, setPage, shopUnchecked }) {
  return (
    <div style={{
      position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
      width: "100%", maxWidth: 430, background: "#fff",
      borderTop: "1px solid #F0EDED", display: "flex", zIndex: 100,
      paddingBottom: "env(safe-area-inset-bottom)",
    }}>
      {[
        { key: "home",     icon: "🏠", label: "ホーム" },
        { key: "shopping", icon: "🛒", label: "買い物リスト", badge: shopUnchecked },
      ].map(tab => (
        <button key={tab.key} onClick={() => setPage(tab.key)} style={{
          flex: 1, background: "none", border: "none", padding: "12px 8px 10px",
          cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
          color: page === tab.key ? "#1A1A2E" : "#bbb",
          fontFamily: "'Hiragino Sans','Yu Gothic UI',sans-serif",
          position: "relative",
        }}>
          <span style={{ fontSize: 22 }}>{tab.icon}</span>
          <span style={{ fontSize: 10, fontWeight: 700 }}>{tab.label}</span>
          {tab.badge > 0 && (
            <div style={{
              position: "absolute", top: 8, right: "calc(50% - 18px)",
              background: "#E84A4A", color: "#fff", borderRadius: "50%",
              width: 16, height: 16, fontSize: 10, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{tab.badge}</div>
          )}
          {page === tab.key && (
            <div style={{ position: "absolute", top: 0, left: "20%", right: "20%", height: 2, background: "#1A1A2E", borderRadius: 2 }} />
          )}
        </button>
      ))}
    </div>
  );
}

function Toast({ toast }) {
  return (
    <div style={{
      position: "fixed", bottom: 70, left: "50%", transform: "translateX(-50%)",
      background: toast.type === "warn" ? "#E84A4A" : "#1A1A2E",
      color: "#fff", padding: "12px 20px", borderRadius: 12,
      fontSize: 14, fontWeight: 600, zIndex: 300,
      boxShadow: "0 4px 20px #00000030", animation: "fadeIn 0.2s ease", whiteSpace: "nowrap",
    }}>{toast.msg}</div>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      @keyframes fadeIn  { from { opacity:0; transform:translateY(4px); } to { opacity:1; } }
      @keyframes slideUp { from { transform:translateY(100%); } to { transform:translateY(0); } }
      * { -webkit-tap-highlight-color:transparent; box-sizing:border-box; }
      ::-webkit-scrollbar { display:none; }
    `}</style>
  );
}

const labelStyle = { fontSize: 12, fontWeight: 700, color: "#888", display: "block", marginBottom: 6 };
const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1.5px solid #E0DADA", fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };
const btnPrimary = { width: "100%", background: "#1A1A2E", color: "#fff", border: "none", borderRadius: 14, padding: "14px", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" };
const btnStepper = { width: 46, height: 46, borderRadius: 12, border: "1.5px solid #E0DADA", background: "#fff", fontSize: 24, cursor: "pointer", fontWeight: 700 };
const btnSmall   = { width: 36, height: 36, borderRadius: 10, border: "1.5px solid #E0DADA", background: "#fff", fontSize: 18, cursor: "pointer" };
