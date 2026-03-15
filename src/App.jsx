// ─────────────────────────────────────────────
// App.jsx  v2.0 – アカウント対応 + Firebase同期
// ─────────────────────────────────────────────
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, arrayUnion, arrayRemove, serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

// ── 定数 ──────────────────────────────────────
const CATEGORIES = {
  daily: { label: "日用品", icon: "🧴", color: "#5AA8E8" },
  food:  { label: "食品",   icon: "🥫", color: "#E8855A" },
  other: { label: "その他", icon: "📦", color: "#A85AE8" },
};
const STATUSES = [
  { key: "full",     label: "十分",    color: "#4CAF82", bg: "#E8F5EE" },
  { key: "ok",       label: "ある",    color: "#5AA8E8", bg: "#E8F4FF" },
  { key: "low",      label: "少ない",  color: "#E8923A", bg: "#FEF3E8" },
  { key: "critical", label: "切れそう",color: "#E84A4A", bg: "#FEEAEA" },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.key, s]));
const AVATAR_COLORS = ["#5AA8E8","#E8855A","#A85AE8","#4CAF82","#E8923A","#E84A4A"];
const LOCAL_ID_KEY = "hm-user-id-v2";

// ── ユーティリティ ─────────────────────────────
function genId(prefix = "HM") {
  return prefix + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}
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
function todayStr() { return new Date().toISOString().split("T")[0]; }

// ── サブコンポーネント ──────────────────────────
function Avatar({ name = "?", size = 28 }) {
  const color = AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: color,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.42, fontWeight: 700, color: "#fff", flexShrink: 0,
    }}>{name[0]}</div>
  );
}

function StockBoxes({ count, color }) {
  if (count === 0) return <span style={{ fontSize: 11, color: "#bbb", fontWeight: 600 }}>なし</span>;
  return (
    <div style={{ display: "flex", gap: 2.5, alignItems: "center" }}>
      {Array.from({ length: Math.min(count, 8) }).map((_, i) => (
        <div key={i} style={{ width: 8, height: 12, borderRadius: 2, background: color }} />
      ))}
      {count > 8 && <span style={{ fontSize: 11, color, fontWeight: 700 }}>+{count - 8}</span>}
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      width: 48, height: 28, borderRadius: 14,
      background: value ? "#4CAF82" : "#E0DADA",
      border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s",
    }}>
      <div style={{
        position: "absolute", top: 3, left: value ? 22 : 2,
        width: 22, height: 22, borderRadius: "50%", background: "#fff",
        transition: "left 0.2s", boxShadow: "0 1px 4px #00000020",
      }} />
    </button>
  );
}

function Modal({ children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000060", zIndex: 200, display: "flex", alignItems: "flex-end" }}
      onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: "24px 24px 0 0", padding: 24,
        width: "100%", maxWidth: 430, margin: "0 auto",
        animation: "slideUp 0.3s ease", maxHeight: "85vh", overflowY: "auto",
      }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Toast({ toast }) {
  return (
    <div style={{
      position: "fixed", bottom: 76, left: "50%", transform: "translateX(-50%)",
      background: toast.type === "warn" ? "#E84A4A" : "#1A1A2E",
      color: "#fff", padding: "12px 20px", borderRadius: 12,
      fontSize: 14, fontWeight: 600, zIndex: 300,
      boxShadow: "0 4px 20px #00000030", animation: "fadeIn 0.2s ease", whiteSpace: "nowrap",
    }}>{toast.msg}</div>
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
        { key: "shopping", icon: "🛒", label: "買い物",  badge: shopUnchecked },
        { key: "groups",   icon: "👥", label: "グループ" },
        { key: "account",  icon: "🪪", label: "アカウント" },
      ].map(tab => (
        <button key={tab.key} onClick={() => setPage(tab.key)} style={{
          flex: 1, background: "none", border: "none", padding: "10px 4px 8px",
          cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
          color: page === tab.key ? "#1A1A2E" : "#bbb",
          fontFamily: "'Hiragino Sans','Yu Gothic UI',sans-serif", position: "relative",
        }}>
          <span style={{ fontSize: 20 }}>{tab.icon}</span>
          <span style={{ fontSize: 9, fontWeight: 700 }}>{tab.label}</span>
          {tab.badge > 0 && (
            <div style={{
              position: "absolute", top: 6, right: "calc(50% - 20px)",
              background: "#E84A4A", color: "#fff", borderRadius: "50%",
              width: 15, height: 15, fontSize: 9, fontWeight: 800,
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

function GlobalStyle() {
  return (
    <style>{`
      @keyframes fadeIn  { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
      @keyframes slideUp { from{transform:translateY(100%)} to{transform:none} }
      *{-webkit-tap-highlight-color:transparent;box-sizing:border-box}
      ::-webkit-scrollbar{display:none}
    `}</style>
  );
}

const labelStyle = { fontSize: 12, fontWeight: 700, color: "#888", display: "block", marginBottom: 6 };
const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1.5px solid #E0DADA", fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };
const btnPrimary = { width: "100%", background: "#1A1A2E", color: "#fff", border: "none", borderRadius: 14, padding: "14px", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" };
const btnSmall   = { width: 36, height: 36, borderRadius: 10, border: "1.5px solid #E0DADA", background: "#fff", fontSize: 18, cursor: "pointer" };
const btnStepper = { width: 46, height: 46, borderRadius: 12, border: "1.5px solid #E0DADA", background: "#fff", fontSize: 24, cursor: "pointer", fontWeight: 700 };

// ══════════════════════════════════════════════
// ログイン画面
// ══════════════════════════════════════════════
function LoginScreen({ onLogin }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleNew = async () => {
    setLoading(true);
    const newId = genId("HM");
    await setDoc(doc(db, "users", newId), {
      id: newId,
      displayName: newId,
      createdAt: serverTimestamp(),
      groups: [],
    });
    localStorage.setItem(LOCAL_ID_KEY, newId);
    onLogin(newId);
  };

  const handleLogin = async () => {
    const id = input.trim().toUpperCase();
    if (!id) return;
    setLoading(true);
    setError("");
    const snap = await getDoc(doc(db, "users", id));
    if (!snap.exists()) {
      setError("IDが見つかりません。もう一度確認してください。");
      setLoading(false);
      return;
    }
    localStorage.setItem(LOCAL_ID_KEY, id);
    onLogin(id);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#1A1A2E", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Hiragino Sans','Yu Gothic UI',sans-serif" }}>
      <div style={{ fontSize: 56, marginBottom: 16 }}>🛒</div>
      <div style={{ color: "#A8B4FF", fontSize: 11, letterSpacing: 3, marginBottom: 4 }}>HOUSEHOLD</div>
      <div style={{ color: "#fff", fontSize: 26, fontWeight: 800, marginBottom: 6 }}>日用品マネージャー</div>
      <div style={{ color: "#ffffff60", fontSize: 13, marginBottom: 48, textAlign: "center" }}>家族・友達と在庫を共有しよう</div>

      <div style={{ width: "100%", maxWidth: 360, background: "#fff", borderRadius: 20, padding: 24 }}>
        {/* 新規 */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#1A1A2E", marginBottom: 8 }}>はじめて使う</div>
          <button onClick={handleNew} disabled={loading} style={{ ...btnPrimary, background: "linear-gradient(135deg,#1A1A2E,#2D2D5E)" }}>
            {loading ? "..." : "🆕 新しいIDを発行する"}
          </button>
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 6, textAlign: "center" }}>IDが自動で発行されます（例: HM-A3K9XZ）</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <div style={{ flex: 1, height: 1, background: "#F0EDED" }} />
          <span style={{ fontSize: 12, color: "#ccc" }}>または</span>
          <div style={{ flex: 1, height: 1, background: "#F0EDED" }} />
        </div>

        {/* 既存ID */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#1A1A2E", marginBottom: 8 }}>IDでログイン</div>
          <input
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            placeholder="例: HM-A3K9XZ"
            style={{ ...inputStyle, letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}
          />
          {error && <div style={{ color: "#E84A4A", fontSize: 12, marginBottom: 8 }}>{error}</div>}
          <button onClick={handleLogin} disabled={loading || !input.trim()} style={{
            ...btnPrimary,
            background: input.trim() ? "#1A1A2E" : "#E0DADA",
            color: input.trim() ? "#fff" : "#aaa",
          }}>
            {loading ? "確認中..." : "ログイン"}
          </button>
        </div>
      </div>
      <GlobalStyle />
    </div>
  );
}

// ══════════════════════════════════════════════
// メインアプリ
// ══════════════════════════════════════════════
export default function App() {
  // ── 認証状態 ──
  const [userId, setUserId] = useState(() => localStorage.getItem(LOCAL_ID_KEY) || null);
  const [userDoc, setUserDoc] = useState(null);

  // ── データ ──
  const [myItems,     setMyItems]     = useState([]);  // 自分のアイテム
  const [sharedItems, setSharedItems] = useState([]);  // 他人から共有されたアイテム
  const [myGroups,    setMyGroups]    = useState([]);  // 参加グループ
  const [shopList,    setShopListState] = useState([]);

  // ── UI状態 ──
  const [page,          setPage]          = useState("home");
  const [filterCat,     setFilterCat]     = useState("all");
  const [filterStatus,  setFilterStatus]  = useState("all");
  const [expandedId,    setExpandedId]    = useState(null);
  const [toast,         setToast]         = useState(null);
  const [showAdd,       setShowAdd]       = useState(false);
  const [showBuy,       setShowBuy]       = useState(null);
  const [buyCount,      setBuyCount]      = useState(1);
  const [showShareItem, setShowShareItem] = useState(null);
  const [manualInput,   setManualInput]   = useState("");
  const [newItem,       setNewItem]       = useState({ name: "", category: "daily", status: "ok", stockCount: 0 });
  // グループ
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showJoinGroup,   setShowJoinGroup]   = useState(false);
  const [newGroupName,    setNewGroupName]    = useState("");
  const [joinGroupId,     setJoinGroupId]     = useState("");
  const [groupItems,      setGroupItems]      = useState({}); // groupId -> items[]
  const [selectedGroup,   setSelectedGroup]   = useState(null);
  // 共有アイテム相手ID入力
  const [shareTargetId,   setShareTargetId]   = useState("");

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  // ── ログイン後のデータ購読 ──
  useEffect(() => {
    if (!userId) return;

    // ユーザードキュメント
    const unsubUser = onSnapshot(doc(db, "users", userId), snap => {
      if (snap.exists()) setUserDoc(snap.data());
    });

    // 自分のアイテム
    const unsubItems = onSnapshot(collection(db, "users", userId, "items"), snap => {
      setMyItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // 自分の買い物リスト
    const unsubShop = onSnapshot(collection(db, "users", userId, "shopList"), snap => {
      setShopListState(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // 自分に共有されたアイテム（sharedWith に自分のIDが含まれるもの）
    const unsubShared = onSnapshot(
      collection(db, "sharedItems"),
      snap => {
        setSharedItems(
          snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(item => (item.sharedWith || []).includes(userId))
        );
      }
    );

    return () => { unsubUser(); unsubItems(); unsubShop(); unsubShared(); };
  }, [userId]);

  // 参加グループのアイテム購読
  useEffect(() => {
    if (!userDoc?.groups?.length) return;
    const unsubs = userDoc.groups.map(gid =>
      onSnapshot(collection(db, "groups", gid, "items"), snap => {
        setGroupItems(prev => ({
          ...prev,
          [gid]: snap.docs.map(d => ({ id: d.id, ...d.data() })),
        }));
      })
    );
    // グループ情報
    const unsubGroups = userDoc.groups.map(gid =>
      onSnapshot(doc(db, "groups", gid), snap => {
        if (snap.exists()) {
          setMyGroups(prev => {
            const filtered = prev.filter(g => g.id !== gid);
            return [...filtered, { id: gid, ...snap.data() }];
          });
        }
      })
    );
    return () => { unsubs.forEach(u => u()); unsubGroups.forEach(u => u()); };
  }, [userDoc?.groups]);

  if (!userId) return <LoginScreen onLogin={setUserId} />;

  // ── アイテム操作（自分のアイテム） ──
  const addItem = async () => {
    if (!newItem.name.trim()) return;
    const id = genId("IT");
    await setDoc(doc(db, "users", userId, "items", id), {
      ...newItem, id,
      ownerId: userId,
      sharedWith: [],
      purchases: [],
      createdAt: serverTimestamp(),
    });
    setNewItem({ name: "", category: "daily", status: "ok", stockCount: 0 });
    setShowAdd(false);
    showToast("追加しました！");
  };

  const updateMyItem = async (itemId, patch) => {
    await updateDoc(doc(db, "users", userId, "items", itemId), patch);
    // sharedItemsにも反映（共有コレクション）
    const item = myItems.find(i => i.id === itemId);
    if (item?.sharedWith?.length) {
      await updateDoc(doc(db, "sharedItems", itemId), patch);
    }
  };

  const deleteMyItem = async (itemId) => {
    await deleteDoc(doc(db, "users", userId, "items", itemId));
    await deleteDoc(doc(db, "sharedItems", itemId)).catch(() => {});
    setExpandedId(null);
    showToast("削除しました", "warn");
  };

  const recordPurchase = async (item, count, isGroup = false, groupId = null) => {
    const today = todayStr();
    const patch = {
      stockCount: (item.stockCount ?? 0) + count,
      purchases:  [...(item.purchases || []), today].sort(),
    };
    if (isGroup && groupId) {
      await updateDoc(doc(db, "groups", groupId, "items", item.id), patch);
    } else {
      await updateMyItem(item.id, patch);
    }
    // 買い物リストのチェック
    const shopItem = shopList.find(s => s.itemId === item.id);
    if (shopItem) {
      await updateDoc(doc(db, "users", userId, "shopList", shopItem.id), { checked: true });
    }
    setShowBuy(null);
    showToast(`${count}個ストックに追加しました！`);
  };

  // ── 個別アイテム共有 ──
  const shareItemWithUser = async (item, targetId) => {
    if (!targetId.trim()) return;
    const targetSnap = await getDoc(doc(db, "users", targetId.trim().toUpperCase()));
    if (!targetSnap.exists()) { showToast("IDが見つかりません", "warn"); return; }
    const newSharedWith = [...new Set([...(item.sharedWith || []), targetId.trim().toUpperCase()])];
    await updateMyItem(item.id, { sharedWith: newSharedWith });
    // sharedItems コレクションにも保存（全ユーザーが読める）
    await setDoc(doc(db, "sharedItems", item.id), {
      ...item, sharedWith: newSharedWith, ownerId: userId,
    }, { merge: true });
    setShareTargetId("");
    showToast(`共有しました！`);
  };

  const unshareItem = async (item, targetId) => {
    const newSharedWith = (item.sharedWith || []).filter(id => id !== targetId);
    await updateMyItem(item.id, { sharedWith: newSharedWith });
    if (newSharedWith.length === 0) {
      await deleteDoc(doc(db, "sharedItems", item.id)).catch(() => {});
    } else {
      await updateDoc(doc(db, "sharedItems", item.id), { sharedWith: newSharedWith });
    }
    showToast("共有を解除しました", "warn");
  };

  // ── グループ操作 ──
  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    const gid = genId("GRP");
    await setDoc(doc(db, "groups", gid), {
      id: gid, name: newGroupName.trim(),
      members: [userId], createdBy: userId,
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "users", userId), { groups: arrayUnion(gid) });
    setNewGroupName(""); setShowCreateGroup(false);
    showToast(`「${newGroupName}」グループを作成しました！`);
  };

  const joinGroup = async () => {
    const gid = joinGroupId.trim().toUpperCase();
    if (!gid) return;
    const snap = await getDoc(doc(db, "groups", gid));
    if (!snap.exists()) { showToast("グループが見つかりません", "warn"); return; }
    await updateDoc(doc(db, "groups", gid), { members: arrayUnion(userId) });
    await updateDoc(doc(db, "users", userId), { groups: arrayUnion(gid) });
    setJoinGroupId(""); setShowJoinGroup(false);
    showToast(`グループに参加しました！`);
  };

  const leaveGroup = async (gid) => {
    await updateDoc(doc(db, "groups", gid), { members: arrayRemove(userId) });
    await updateDoc(doc(db, "users", userId), { groups: arrayRemove(gid) });
    setMyGroups(prev => prev.filter(g => g.id !== gid));
    showToast("グループを退出しました", "warn");
  };

  const addGroupItem = async (groupId) => {
    if (!newItem.name.trim()) return;
    const id = genId("IT");
    await setDoc(doc(db, "groups", groupId, "items", id), {
      ...newItem, id, ownerId: userId,
      sharedWith: [], purchases: [],
      createdAt: serverTimestamp(),
    });
    setNewItem({ name: "", category: "daily", status: "ok", stockCount: 0 });
    setShowAdd(false);
    showToast("追加しました！");
  };

  // ── 買い物リスト ──
  const autoAddToShopList = async () => {
    const allItems = [...myItems, ...sharedItems];
    const targets = allItems.filter(it => ["critical","low"].includes(it.status ?? "ok"));
    let added = 0;
    for (const it of targets) {
      if (!shopList.find(s => s.itemId === it.id && !s.checked)) {
        const sid = genId("SH");
        await setDoc(doc(db, "users", userId, "shopList", sid), {
          id: sid, itemId: it.id, name: it.name, category: it.category,
          checked: false, addedAt: new Date().toISOString(),
        });
        added++;
      }
    }
    showToast(added > 0 ? `${added}件追加しました！` : "新規追加はありませんでした");
  };

  const addManualShopItem = async (name) => {
    if (!name.trim()) return;
    const sid = genId("SH");
    await setDoc(doc(db, "users", userId, "shopList", sid), {
      id: sid, itemId: null, name, category: "other",
      checked: false, addedAt: new Date().toISOString(),
    });
  };

  const toggleShopCheck = async (sid) => {
    const item = shopList.find(s => s.id === sid);
    if (!item) return;
    await updateDoc(doc(db, "users", userId, "shopList", sid), { checked: !item.checked });
  };

  const removeShopItem = async (sid) => {
    await deleteDoc(doc(db, "users", userId, "shopList", sid));
  };

  const clearChecked = async () => {
    const checked = shopList.filter(s => s.checked);
    await Promise.all(checked.map(s => deleteDoc(doc(db, "users", userId, "shopList", s.id))));
  };

  // ── フィルタリング ──
  const allVisibleItems = [
    ...myItems.map(i => ({ ...i, _source: "mine" })),
    ...sharedItems.map(i => ({ ...i, _source: "shared" })),
  ];

  const filteredItems = allVisibleItems.filter(it => {
    if (filterCat !== "all" && it.category !== filterCat) return false;
    if (filterStatus === "critical") return it.status === "critical";
    if (filterStatus === "low")      return it.status === "low";
    if (filterStatus === "ok")       return ["ok","full"].includes(it.status ?? "ok");
    return true;
  });

  const counts = {
    all:      allVisibleItems.length,
    critical: allVisibleItems.filter(i => i.status === "critical").length,
    low:      allVisibleItems.filter(i => i.status === "low").length,
    ok:       allVisibleItems.filter(i => ["ok","full"].includes(i.status ?? "ok")).length,
  };
  const shopUnchecked = shopList.filter(s => !s.checked).length;

  // ── レンダリング ──────────────────────────────
  const wrap = (children) => (
    <div style={{ minHeight: "100vh", background: "#F7F4EF", fontFamily: "'Hiragino Sans','Yu Gothic UI',sans-serif", maxWidth: 430, margin: "0 auto" }}>
      {children}
      {toast && <Toast toast={toast} />}
      <BottomNav page={page} setPage={setPage} shopUnchecked={shopUnchecked} />
      <GlobalStyle />
    </div>
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // アカウントページ
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (page === "account") return wrap(
    <>
      <div style={{ background: "#1A1A2E", padding: "20px 20px 28px" }}>
        <div style={{ color: "#A8B4FF", fontSize: 11, letterSpacing: 2, marginBottom: 4 }}>ACCOUNT</div>
        <div style={{ color: "#fff", fontSize: 22, fontWeight: 800 }}>アカウント</div>
      </div>

      <div style={{ padding: "20px 16px 100px" }}>
        {/* IDカード */}
        <div style={{ background: "#1A1A2E", borderRadius: 20, padding: 24, marginBottom: 16 }}>
          <div style={{ color: "#A8B4FF", fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>YOUR ID</div>
          <div style={{ color: "#fff", fontSize: 32, fontWeight: 900, letterSpacing: 4, marginBottom: 8 }}>{userId}</div>
          <div style={{ color: "#ffffff60", fontSize: 12, lineHeight: 1.6 }}>
            このIDを他の端末で入力するとログインできます。<br />
            誰かと共有する際にも使います。
          </div>
          <button onClick={() => { navigator.clipboard?.writeText(userId); showToast("コピーしました！"); }} style={{
            marginTop: 14, background: "#ffffff15", border: "1px solid #ffffff25",
            borderRadius: 10, padding: "8px 16px", color: "#fff", fontSize: 13, cursor: "pointer",
          }}>📋 IDをコピー</button>
        </div>

        {/* ログアウト */}
        <button onClick={() => { localStorage.removeItem(LOCAL_ID_KEY); setUserId(null); }} style={{
          width: "100%", background: "#FEEAEA", color: "#E84A4A",
          border: "none", borderRadius: 14, padding: 14, fontSize: 14, fontWeight: 800, cursor: "pointer",
        }}>ログアウト</button>
      </div>
    </>
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // グループページ
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (page === "groups") return wrap(
    <>
      <div style={{ background: "#1A1A2E", padding: "20px 20px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ color: "#A8B4FF", fontSize: 11, letterSpacing: 2, marginBottom: 2 }}>GROUPS</div>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 800 }}>グループ</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowCreateGroup(true)} style={{ background: "#A8B4FF25", border: "1px solid #A8B4FF50", borderRadius: 10, padding: "8px 12px", color: "#A8B4FF", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>＋ 作成</button>
            <button onClick={() => setShowJoinGroup(true)} style={{ background: "#ffffff15", border: "1px solid #ffffff25", borderRadius: 10, padding: "8px 12px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>参加</button>
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 16px 100px" }}>
        {myGroups.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#aaa" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
            <div style={{ marginBottom: 8 }}>グループがありません</div>
            <div style={{ fontSize: 13 }}>家族や友達とグループを作って<br />アイテムを共有しよう</div>
          </div>
        ) : (
          myGroups.map(g => {
            const items = groupItems[g.id] || [];
            const isOpen = selectedGroup === g.id;
            return (
              <div key={g.id} style={{ background: "#fff", borderRadius: 16, marginBottom: 12, overflow: "hidden", border: "1.5px solid #F0EDED" }}>
                <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  onClick={() => setSelectedGroup(isOpen ? null : g.id)}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: "#1A1A2E" }}>{g.name}</div>
                    <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>
                      {g.id}　・　メンバー {(g.members || []).length}人　・　アイテム {items.length}件
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 18, color: "#aaa" }}>{isOpen ? "▲" : "▼"}</span>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ borderTop: "1px solid #F0EDED", padding: "12px 16px", background: "#FAFAF8" }}>
                    {/* グループのアイテム一覧 */}
                    {items.length === 0 ? (
                      <div style={{ color: "#bbb", fontSize: 13, textAlign: "center", padding: 12 }}>アイテムがありません</div>
                    ) : (
                      items.map(it => {
                        const st = STATUS_MAP[it.status ?? "ok"] ?? STATUS_MAP.ok;
                        const cat = CATEGORIES[it.category] ?? CATEGORIES.other;
                        return (
                          <div key={it.id} style={{ background: "#fff", borderRadius: 12, padding: "10px 12px", marginBottom: 8, border: "1px solid #F0EDED" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ fontSize: 18 }}>{cat.icon}</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 700, fontSize: 14, color: "#1A1A2E" }}>{it.name}</div>
                                <div style={{ fontSize: 11, color: "#aaa" }}>ストック {it.stockCount ?? 0}個</div>
                              </div>
                              <span style={{ background: st.bg, color: st.color, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{st.label}</span>
                              <button onClick={() => { setShowBuy({ ...it, _groupId: g.id }); setBuyCount(1); }} style={{
                                background: "#1A1A2E", color: "#fff", border: "none",
                                borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer",
                              }}>🛒</button>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button onClick={() => { setSelectedGroup(g.id); setShowAdd(true); }} style={{
                        flex: 1, background: "#1A1A2E", color: "#fff", border: "none",
                        borderRadius: 10, padding: "9px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                      }}>＋ アイテム追加</button>
                      <button onClick={() => leaveGroup(g.id)} style={{
                        background: "#FEEAEA", color: "#E84A4A", border: "none",
                        borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                      }}>退出</button>
                    </div>
                    <div style={{ marginTop: 10, padding: "10px 12px", background: "#F0F2FF", borderRadius: 10 }}>
                      <div style={{ fontSize: 11, color: "#6670E8", fontWeight: 700 }}>グループID（参加コード）</div>
                      <div style={{ fontFamily: "monospace", fontSize: 15, color: "#1A1A2E", letterSpacing: 2, marginTop: 2 }}>{g.id}</div>
                      <button onClick={() => { navigator.clipboard?.writeText(g.id); showToast("コピーしました！"); }} style={{
                        marginTop: 6, background: "#6670E820", border: "none", borderRadius: 8,
                        padding: "5px 12px", fontSize: 11, color: "#6670E8", fontWeight: 700, cursor: "pointer",
                      }}>📋 コピー</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* グループ作成モーダル */}
      {showCreateGroup && (
        <Modal onClose={() => setShowCreateGroup(false)}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 16, color: "#1A1A2E" }}>👥 グループを作成</div>
          <label style={labelStyle}>グループ名</label>
          <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="例：田中家、友達グループ" style={{ ...inputStyle, marginBottom: 16 }} />
          <button onClick={createGroup} style={btnPrimary}>作成する</button>
        </Modal>
      )}

      {/* グループ参加モーダル */}
      {showJoinGroup && (
        <Modal onClose={() => setShowJoinGroup(false)}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 16, color: "#1A1A2E" }}>🔑 グループに参加</div>
          <label style={labelStyle}>グループID（参加コード）</label>
          <input value={joinGroupId} onChange={e => setJoinGroupId(e.target.value.toUpperCase())} placeholder="例：GRP-A3K9XZ" style={{ ...inputStyle, letterSpacing: 2, marginBottom: 16 }} />
          <button onClick={joinGroup} style={btnPrimary}>参加する</button>
        </Modal>
      )}
    </>
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 買い物リストページ
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (page === "shopping") {
    const unchecked = shopList.filter(s => !s.checked);
    const checked   = shopList.filter(s =>  s.checked);
    return wrap(
      <>
        <div style={{ background: "#1A1A2E", padding: "20px 20px 16px", position: "sticky", top: 0, zIndex: 100 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ color: "#A8B4FF", fontSize: 11, letterSpacing: 2 }}>SHOPPING</div>
              <div style={{ color: "#fff", fontSize: 20, fontWeight: 800 }}>買い物リスト</div>
            </div>
            <button onClick={autoAddToShopList} style={{ background: "#A8B4FF25", border: "1px solid #A8B4FF50", borderRadius: 10, padding: "8px 12px", color: "#A8B4FF", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✨ 自動追加</button>
          </div>
        </div>

        <div style={{ padding: "12px 16px 100px" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input value={manualInput} onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { addManualShopItem(manualInput); setManualInput(""); } }}
              placeholder="アイテムを手動で追加..."
              style={{ flex: 1, padding: "10px 14px", borderRadius: 12, border: "1.5px solid #E0DADA", fontSize: 14, outline: "none", fontFamily: "inherit", background: "#fff" }} />
            <button onClick={() => { addManualShopItem(manualInput); setManualInput(""); }}
              style={{ background: "#1A1A2E", color: "#fff", border: "none", borderRadius: 12, padding: "0 16px", fontSize: 18, cursor: "pointer" }}>＋</button>
          </div>

          {shopList.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#aaa" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>
              <div style={{ marginBottom: 16 }}>リストが空です</div>
              <button onClick={autoAddToShopList} style={{ background: "#1A1A2E", color: "#fff", border: "none", borderRadius: 12, padding: "12px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✨ 切れそうなものを自動追加</button>
            </div>
          )}

          {unchecked.map(s => {
            const cat = CATEGORIES[s.category] ?? CATEGORIES.other;
            return (
              <div key={s.id} style={{ background: "#fff", borderRadius: 14, marginBottom: 8, border: "1.5px solid #F0EDED", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <button onClick={() => toggleShopCheck(s.id)} style={{ width: 26, height: 26, borderRadius: 8, border: "2px solid #E0DADA", background: "#fff", cursor: "pointer", flexShrink: 0 }} />
                <span style={{ fontSize: 18 }}>{cat.icon}</span>
                <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "#1A1A2E" }}>{s.name}</span>
                <button onClick={() => removeShopItem(s.id)} style={{ background: "none", border: "none", color: "#ddd", fontSize: 18, cursor: "pointer" }}>×</button>
              </div>
            );
          })}

          {checked.length > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 8px" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#bbb" }}>購入済み ({checked.length})</span>
                <button onClick={clearChecked} style={{ background: "none", border: "none", color: "#E84A4A", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>すべて削除</button>
              </div>
              {checked.map(s => {
                const cat = CATEGORIES[s.category] ?? CATEGORIES.other;
                return (
                  <div key={s.id} style={{ background: "#F5F5F5", borderRadius: 14, marginBottom: 8, border: "1.5px solid #EBEBEB", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, opacity: 0.6 }}>
                    <button onClick={() => toggleShopCheck(s.id)} style={{ width: 26, height: 26, borderRadius: 8, border: "2px solid #4CAF82", background: "#4CAF82", cursor: "pointer", flexShrink: 0, color: "#fff", fontSize: 14 }}>✓</button>
                    <span style={{ fontSize: 18 }}>{cat.icon}</span>
                    <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "#888", textDecoration: "line-through" }}>{s.name}</span>
                    <button onClick={() => removeShopItem(s.id)} style={{ background: "none", border: "none", color: "#ddd", fontSize: 18, cursor: "pointer" }}>×</button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ホームページ
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return wrap(
    <>
      {/* Header */}
      <div style={{ background: "#1A1A2E", padding: "20px 20px 16px", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: "#A8B4FF", fontSize: 11, letterSpacing: 2, marginBottom: 2 }}>HOUSEHOLD</div>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 800 }}>日用品マネージャー</div>
          </div>
          <button onClick={() => setPage("account")} style={{ background: "#ffffff15", border: "1px solid #ffffff25", borderRadius: 10, padding: "8px 12px", color: "#ffffff90", fontSize: 12, cursor: "pointer" }}>
            🪪 {userId}
          </button>
        </div>

        {/* ステータスフィルター */}
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

      {/* カテゴリフィルター */}
      <div style={{ padding: "12px 16px 4px", display: "flex", gap: 8, overflowX: "auto", background: "#F7F4EF" }}>
        {[["all","すべて",""], ...Object.entries(CATEGORIES).map(([k,v])=>[k,v.label,v.icon])].map(([key,label,icon]) => (
          <button key={key} onClick={() => setFilterCat(key)} style={{
            background: filterCat === key ? "#1A1A2E" : "#fff",
            color:      filterCat === key ? "#fff"    : "#666",
            border: "1px solid " + (filterCat === key ? "#1A1A2E" : "#E0DADA"),
            borderRadius: 20, padding: "6px 14px", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap", fontWeight: 600,
          }}>{icon} {label}</button>
        ))}
      </div>

      {/* アイテムリスト */}
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
          const isShared = item._source === "shared";

          return (
            <div key={item.id} style={{
              background: "#fff", borderRadius: 16, marginBottom: 8, overflow: "hidden",
              border: "1.5px solid " + (item.status === "critical" ? "#E84A4A30" : isShared ? "#A8B4FF30" : "#F0EDED"),
              boxShadow: item.status === "critical" ? "0 2px 12px #E84A4A14" : "0 1px 6px #00000007",
            }}>
              <div style={{ height: 3, background: `linear-gradient(90deg,${st.color},${st.color}25)` }} />
              <div style={{ padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: cat.color + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{cat.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: "#1A1A2E" }}>{item.name}</span>
                      {isShared && (
                        <span style={{ background: "#A8B4FF20", color: "#6670E8", borderRadius: 6, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>
                          📨 共有
                        </span>
                      )}
                      {!isShared && (item.sharedWith?.length > 0) && (
                        <span style={{ background: "#4CAF8220", color: "#4CAF82", borderRadius: 6, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>
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
                  {/* ステータスボタン（自分のアイテムのみ編集可） */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                    <div style={{ display: "flex", gap: 3 }}>
                      {STATUSES.map(s => (
                        <button key={s.key}
                          onClick={() => !isShared && updateMyItem(item.id, { status: s.key })}
                          disabled={isShared}
                          style={{
                            width: 28, height: 28, borderRadius: 8, border: "none",
                            cursor: isShared ? "default" : "pointer",
                            background: (item.status ?? "ok") === s.key ? s.color : s.bg,
                            color:      (item.status ?? "ok") === s.key ? "#fff"  : s.color,
                            fontSize: 9, fontWeight: 800, opacity: isShared ? 0.5 : 1,
                          }}>{s.label.slice(0,2)}</button>
                      ))}
                    </div>
                    <span style={{ background: st.bg, color: st.color, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{st.label}</span>
                  </div>
                </div>

                {/* 予測 + ボタン */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <div style={{ flex: 1, fontSize: 11, fontWeight: 600, color: pred ? (pred.daysLeft < 7 ? "#E8923A" : "#aaa") : "#ccc" }}>
                    {pred
                      ? pred.daysLeft <= 0
                        ? "🚨 もう切れている可能性"
                        : `📅 あと約${pred.daysLeft}日 (${pred.date.toLocaleDateString("ja-JP",{month:"short",day:"numeric"})}頃)`
                      : "購入記録を増やすと予測できます"}
                  </div>
                  {!isShared && (
                    <button onClick={() => setShowShareItem(item)} style={{
                      background: item.sharedWith?.length ? "#A8B4FF20" : "#F5F3F0",
                      color: item.sharedWith?.length ? "#6670E8" : "#999",
                      border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}>🔗</button>
                  )}
                  <button onClick={() => { setShowBuy(item); setBuyCount(1); }} style={{
                    background: "#1A1A2E", color: "#fff", border: "none",
                    borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>🛒 購入</button>
                  <button onClick={() => setExpandedId(isExp ? null : item.id)} style={{
                    background: "#F5F3F0", color: "#999", border: "none",
                    borderRadius: 8, padding: "6px 10px", fontSize: 13, cursor: "pointer",
                  }}>{isExp ? "▲" : "▼"}</button>
                </div>

                {/* 展開：履歴 */}
                {isExp && (
                  <div style={{ marginTop: 10, padding: "10px 12px", background: "#F9F7F4", borderRadius: 10 }}>
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
                    {!isShared && (
                      <button onClick={() => deleteMyItem(item.id)} style={{ marginTop: 10, width: "100%", background: "#FEEAEA", color: "#E84A4A", border: "none", borderRadius: 8, padding: "7px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🗑 削除する</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* FAB */}
      <button onClick={() => { setSelectedGroup(null); setShowAdd(true); }} style={{
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
          <button onClick={() => recordPurchase(showBuy, buyCount, !!showBuy._groupId, showBuy._groupId)} style={btnPrimary}>ストックに追加する</button>
        </Modal>
      )}

      {/* ── アイテム追加モーダル ── */}
      {showAdd && (
        <Modal onClose={() => setShowAdd(false)}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4, color: "#1A1A2E" }}>
            {selectedGroup ? `＋ グループにアイテムを追加` : "新しいアイテムを追加"}
          </div>
          {selectedGroup && (
            <div style={{ background: "#F0F2FF", borderRadius: 10, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#6670E8", fontWeight: 700 }}>
              👥 {myGroups.find(g => g.id === selectedGroup)?.name}
            </div>
          )}
          <label style={labelStyle}>アイテム名</label>
          <input value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))}
            placeholder="例：シャンプー、牛乳" style={{ ...inputStyle, marginBottom: 14 }} />
          <label style={labelStyle}>カテゴリ</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {Object.entries(CATEGORIES).map(([key,cat]) => (
              <button key={key} onClick={() => setNewItem(p => ({ ...p, category: key }))} style={{
                flex: 1, background: newItem.category === key ? "#1A1A2E" : "#F5F3F0",
                color: newItem.category === key ? "#fff" : "#555",
                border: "none", borderRadius: 10, padding: "8px 4px", fontSize: 13, cursor: "pointer", fontWeight: 600,
              }}>{cat.icon} {cat.label}</button>
            ))}
          </div>
          <label style={labelStyle}>今の状態</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {STATUSES.map(s => (
              <button key={s.key} onClick={() => setNewItem(p => ({ ...p, status: s.key }))} style={{
                flex: 1, background: newItem.status === s.key ? s.color : s.bg,
                color: newItem.status === s.key ? "#fff" : s.color,
                border: "none", borderRadius: 10, padding: "8px 4px", fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}>{s.label}</button>
            ))}
          </div>
          <label style={labelStyle}>ストック数</label>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
            <button onClick={() => setNewItem(p => ({ ...p, stockCount: Math.max(0,p.stockCount-1) }))} style={btnSmall}>−</button>
            <span style={{ fontSize: 22, fontWeight: 800, minWidth: 30, textAlign: "center" }}>{newItem.stockCount}</span>
            <button onClick={() => setNewItem(p => ({ ...p, stockCount: p.stockCount+1 }))} style={btnSmall}>＋</button>
            <span style={{ fontSize: 12, color: "#aaa" }}>個</span>
          </div>
          <button onClick={() => selectedGroup ? addGroupItem(selectedGroup) : addItem()} style={btnPrimary}>追加する</button>
        </Modal>
      )}

      {/* ── 個別アイテム共有モーダル ── */}
      {showShareItem && (
        <Modal onClose={() => { setShowShareItem(null); setShareTargetId(""); }}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4, color: "#1A1A2E" }}>🔗 共有設定</div>
          <div style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>{showShareItem.name}</div>

          {/* 共有相手を追加 */}
          <label style={labelStyle}>相手のIDで共有する</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              value={shareTargetId}
              onChange={e => setShareTargetId(e.target.value.toUpperCase())}
              placeholder="例: HM-A3K9XZ"
              style={{ ...inputStyle, flex: 1, letterSpacing: 2, marginBottom: 0 }}
            />
            <button onClick={() => shareItemWithUser(showShareItem, shareTargetId)} style={{
              background: "#1A1A2E", color: "#fff", border: "none",
              borderRadius: 12, padding: "0 16px", fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}>共有</button>
          </div>

          {/* 現在の共有相手 */}
          {showShareItem.sharedWith?.length > 0 && (
            <>
              <label style={labelStyle}>共有中の相手</label>
              {showShareItem.sharedWith.map(tid => (
                <div key={tid} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#E8F4FF", borderRadius: 12, marginBottom: 8, border: "1.5px solid #5AA8E840" }}>
                  <Avatar name={tid} size={28} />
                  <span style={{ flex: 1, fontFamily: "monospace", fontSize: 13, color: "#1A1A2E", letterSpacing: 1 }}>{tid}</span>
                  <button onClick={() => unshareItem(showShareItem, tid)} style={{
                    background: "#FEEAEA", color: "#E84A4A", border: "none",
                    borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer",
                  }}>解除</button>
                </div>
              ))}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
