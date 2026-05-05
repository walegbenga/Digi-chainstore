import { useState, useEffect } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useWalletBalance } from '@/hooks/useWalletBalance';
import Link from 'next/link';
import { API_URL } from '@/lib/api';
import toast from 'react-hot-toast';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Purchase {
  id: string; product_id: string; price: string; tx_digest: string;
  created_at: string; title: string; image_url: string;
  category: string; file_cid: string; seller: string;
}
interface Favorite {
  product_id: string; created_at: string; title: string;
  image_url: string; price: string; category: string; is_available: boolean;
}
interface Following {
  address: string; display_name: string; avatar_url: string;
  total_sales: number; follower_count: number; followed_at: string;
}
interface SellerProfile {
  address: string; display_name: string; bio: string;
  avatar_url: string; twitter_handle: string; website_url: string; email: string;
  total_sales: number; total_revenue: string; follower_count: number;
  products_listed: number; created_at: string;
}
type Tab = 'overview' | 'purchases' | 'favorites' | 'following' | 'seller';

// ── Helpers ───────────────────────────────────────────────────────────────────
const sui      = (n: string | number) => (Number(n) / 1e9).toFixed(3);
const fmtDate  = (n: string | number) => new Date(Number(n)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const shortAddr = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

// ── Edit profile modal ────────────────────────────────────────────────────────
function EditProfileModal({ profile, onSave, onClose }: {
  profile: SellerProfile | null;
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const [name,    setName]    = useState(profile?.display_name || '');
  const [bio,     setBio]     = useState(profile?.bio || '');
  const [avatar,  setAvatar]  = useState(profile?.avatar_url || '');
  const [twitter, setTwitter] = useState(profile?.twitter_handle || '');
  const [website, setWebsite] = useState(profile?.website_url || '');
  const [email,   setEmail]   = useState((profile as any)?.email || '');
  const [saving,  setSaving]  = useState(false);

  const save = async () => {
    setSaving(true);
    await onSave({ display_name: name, bio, avatar_url: avatar, twitter_handle: twitter, website_url: website, email });
    setSaving(false);
  };

  const inputCls = "w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
          <h2 className="font-bold text-gray-900">Edit Profile</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl bg-transparent border-none cursor-pointer">×</button>
        </div>
        <div className="p-6 space-y-4">
          {/* Avatar preview */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center overflow-hidden shrink-0">
              {avatar
                ? <img src={avatar} alt="avatar" className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
                : <span className="text-white text-2xl font-black">{name ? name[0].toUpperCase() : '?'}</span>
              }
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-600 block mb-1">Avatar URL</label>
              <input value={avatar} onChange={e => setAvatar(e.target.value)} placeholder="https://..." className={inputCls} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Display Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name or store name" maxLength={50} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Bio</label>
            <textarea value={bio} onChange={e => setBio(e.target.value)} placeholder="Tell buyers about yourself..." rows={3} maxLength={200} className={`${inputCls} resize-none`} />
            <p className="text-xs text-gray-300 text-right mt-1">{bio.length}/200</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">
              Notification Email
              <span className="text-gray-400 font-normal ml-1">(for sale & dispute alerts)</span>
            </label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" maxLength={200} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Twitter / X</label>
              <input value={twitter} onChange={e => setTwitter(e.target.value)} placeholder="@handle" maxLength={50} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Website</label>
              <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." maxLength={200} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">
              Notification Email
              <span className="ml-1 text-gray-400 font-normal">(for sale alerts)</span>
            </label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" maxLength={200} className={inputCls} />
            <p className="text-xs text-gray-400 mt-1">
              We'll email you when someone buys your product. Never shared publicly.
            </p>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 bg-white cursor-pointer">Cancel</button>
          <button onClick={save} disabled={saving}
            className={`flex-1 py-3 rounded-xl text-sm font-bold text-white border-none cursor-pointer transition-colors ${saving ? 'bg-gray-300' : 'bg-indigo-600 hover:bg-indigo-500'}`}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Profile() {
  const account                        = useCurrentAccount();
  const { suiFormatted, usdValue }     = useWalletBalance();

  const [tab,           setTab]        = useState<Tab>('overview');
  const [profile,       setProfile]    = useState<SellerProfile | null>(null);
  const [purchases,     setPurchases]  = useState<Purchase[]>([]);
  const [favorites,     setFavorites]  = useState<Favorite[]>([]);
  const [following,     setFollowing]  = useState<Following[]>([]);
  const [loading,       setLoading]    = useState(true);
  const [showEdit,      setShowEdit]   = useState(false);
  const [downloading,   setDownloading]= useState<string | null>(null);

  // Stats derived from data
  const totalSpent  = purchases.reduce((s, p) => s + Number(p.price), 0);
  const isSeller    = profile && Number(profile.total_sales) > 0;

  useEffect(() => {
    if (account?.address) loadAll();
  }, [account?.address]);

  const loadAll = async () => {
    if (!account?.address) return;
    setLoading(true);
    try {
      await Promise.all([fetchProfile(), fetchPurchases(), fetchFavorites(), fetchFollowing()]);
    } finally {
      setLoading(false);
    }
  };

  const fetchProfile = async () => {
    try {
      const r = await fetch(`${API_URL}/api/sellers/${account!.address}`);
      if (r.ok) { const d = await r.json(); setProfile(d); }
    } catch {}
  };

  const fetchPurchases = async () => {
    try {
      const r = await fetch(`${API_URL}/api/purchases/${account!.address}`);
      if (r.ok) {
        const d = await r.json();
        const raw = d.purchases || [];
        // Enrich with product data
        const enriched = await Promise.all(raw.map(async (p: any) => {
          try {
            const pr = await fetch(`${API_URL}/api/products/${p.product_id}`);
            if (pr.ok) {
              const pd = await pr.json();
              return { ...p, title: pd.title, image_url: pd.image_url, category: pd.category, file_cid: pd.file_cid, seller: pd.seller };
            }
          } catch {}
          return { ...p, title: 'Product', image_url: '', category: '', file_cid: '', seller: '' };
        }));
        setPurchases(enriched);
      }
    } catch {}
  };

  const fetchFavorites = async () => {
    try {
      const r = await fetch(`${API_URL}/api/users/${account!.address}/favorites`);
      if (r.ok) { const d = await r.json(); setFavorites(d.favorites || []); }
    } catch {}
  };

  const fetchFollowing = async () => {
    try {
      const r = await fetch(`${API_URL}/api/users/${account!.address}/following`);
      if (r.ok) { const d = await r.json(); setFollowing(d.following || []); }
    } catch {}
  };

  const handleDownload = async (purchase: Purchase) => {
    if (!purchase.file_cid) return toast.error('No file available for this product');
    setDownloading(purchase.product_id);
    try {
      // Step 1: Get one-time signed token
      const tokenRes = await fetch(
        `${API_URL}/api/download/${purchase.product_id}/${account!.address}`
      );
      if (!tokenRes.ok) {
        const e = await tokenRes.json();
        toast.error(e.error || 'Download failed');
        return;
      }
      const { token } = await tokenRes.json();
      if (!token) { toast.error('Could not generate download link'); return; }

      // Step 2: Fetch the actual file as a blob using the token
      // The file bytes come back through our server — Pinata URL is never exposed
      const fileRes = await fetch(`${API_URL}/api/download/file/${token}`, {
        method: 'GET',
      });
      if (!fileRes.ok) {
        toast.error('Download failed — link may have expired, please try again');
        return;
      }

      // Get filename from Content-Disposition header if available
      const disposition = fileRes.headers.get('content-disposition') || '';
      const nameMatch   = disposition.match(/filename="?([^"]+)"?/);
      const fileName    = nameMatch?.[1] || purchase.title || 'download';

      // Convert to blob and trigger browser download — no URL ever shown
      const blob      = await fileRes.blob();
      const objectUrl = URL.createObjectURL(blob);

      const a    = document.createElement('a');
      a.href     = objectUrl;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      // Clean up immediately
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
        document.body.removeChild(a);
      }, 100);

      toast.success('Download started! 🎉');
    } catch (e: any) {
      toast.error('Download failed. Please try again.');
      console.error('Download error:', e?.message);
    } finally {
      setDownloading(null);
    }
  };

  const unfavorite = async (productId: string) => {
    try {
      await fetch(`${API_URL}/api/users/${account!.address}/favorites/${productId}`, { method: 'DELETE' });
      setFavorites(f => f.filter(x => x.product_id !== productId));
      toast.success('Removed from favorites');
    } catch {}
  };

  const unfollow = async (sellerAddress: string) => {
    try {
      await fetch(`${API_URL}/api/sellers/${sellerAddress}/follow`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followerAddress: account!.address }),
      });
      setFollowing(f => f.filter(x => x.address !== sellerAddress));
      toast.success('Unfollowed');
    } catch {}
  };

  const saveProfile = async (data: any) => {
    if (!account?.address) return;
    try {
      const r = await fetch(`${API_URL}/api/sellers/${account.address}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (r.ok) {
        toast.success('Profile updated!');
        await fetchProfile();
        setShowEdit(false);
      } else {
        toast.error('Failed to save profile');
      }
    } catch { toast.error('Failed to save profile'); }
  };

  // ── Not connected ─────────────────────────────────────────────────────────
  if (!account) return (
    <div className="max-w-md mx-auto py-20 px-4 text-center">
      <div className="bg-white border border-gray-100 rounded-2xl p-8 shadow-sm">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Sign In Required</h2>
        <p className="text-gray-400 text-sm">Connect your wallet to view your profile.</p>
      </div>
    </div>
  );

  // ── Avatar component ──────────────────────────────────────────────────────
  const avatarSrc = profile?.avatar_url;
  const avatarInitial = (profile?.display_name || account.address).slice(0,2).toUpperCase();

  const TABS: { id: Tab; icon: string; label: string; count?: number }[] = [
    { id: 'overview',  icon: '🏠', label: 'Overview' },
    { id: 'purchases', icon: '📦', label: 'Purchases', count: purchases.length },
    { id: 'favorites', icon: '❤️',  label: 'Favorites', count: favorites.length },
    { id: 'following', icon: '👥', label: 'Following',  count: following.length },
    ...(isSeller ? [{ id: 'seller' as Tab, icon: '🛍️', label: 'Selling' }] : []),
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">

      {/* ── Profile header ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
        {/* Banner */}
        <div className="h-24 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

        <div className="px-6 pb-6">
          <div className="flex items-end justify-between -mt-10 mb-4">
            {/* Avatar */}
            <div className="w-20 h-20 rounded-2xl border-4 border-white bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center overflow-hidden shadow-lg">
              {avatarSrc
                ? <img src={avatarSrc} alt="avatar" className="w-full h-full object-cover"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                : <span className="text-white text-2xl font-black">{avatarInitial}</span>
              }
            </div>
            <button onClick={() => setShowEdit(true)}
              className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 bg-white cursor-pointer transition-colors">
              ✏️ Edit Profile
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-black text-gray-900">
                {profile?.display_name || shortAddr(account.address)}
              </h1>
              <p className="font-mono text-xs text-gray-400 mt-0.5">{shortAddr(account.address)}</p>
              {profile?.bio && (
                <p className="text-sm text-gray-600 mt-2 leading-relaxed">{profile.bio}</p>
              )}
              {/* Social links */}
              <div className="flex items-center gap-3 mt-2">
                {profile?.twitter_handle && (
                  <a href={`https://twitter.com/${profile.twitter_handle}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-indigo-600 font-semibold hover:underline">
                    𝕏 @{profile.twitter_handle}
                  </a>
                )}
                {profile?.website_url && (
                  <a href={profile.website_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-indigo-600 font-semibold hover:underline truncate max-w-[150px]">
                    🔗 {profile.website_url.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </div>
            </div>

            {/* Wallet balance */}
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-4 text-white text-center shrink-0 min-w-[140px]">
              <p className="text-xs opacity-80 mb-1 font-medium">Wallet Balance</p>
              <p className="text-xl font-black">${usdValue}</p>
              <p className="text-xs opacity-70">{suiFormatted} SUI</p>
              <div className="flex gap-1 mt-2">
                <Link href="/wallet/deposit"
                  className="flex-1 text-center text-xs py-1.5 bg-white/20 rounded-lg font-semibold hover:bg-white/30 transition-colors no-underline text-white">
                  + Add
                </Link>
                <Link href="/wallet/withdraw"
                  className="flex-1 text-center text-xs py-1.5 bg-white/20 rounded-lg font-semibold hover:bg-white/30 transition-colors no-underline text-white">
                  ↑ Out
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-gray-100 rounded-2xl p-1.5 mb-6 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap cursor-pointer border-none flex-1 justify-center ${
              tab === t.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700 bg-transparent'
            }`}>
            {t.icon} {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === t.id ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-200 text-gray-500'}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* ── Overview ── */}
          {tab === 'overview' && (
            <div className="space-y-6">
              {/* Quick stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { icon: '📦', label: 'Purchases',   value: purchases.length,               color: 'from-blue-500 to-blue-600' },
                  { icon: '💸', label: 'Total Spent',  value: `${sui(totalSpent)} SUI`,       color: 'from-purple-500 to-purple-600' },
                  { icon: '❤️',  label: 'Favorites',   value: favorites.length,               color: 'from-pink-500 to-rose-500' },
                  { icon: '👥', label: 'Following',    value: following.length,               color: 'from-emerald-500 to-green-600' },
                ].map(s => (
                  <div key={s.label} className={`bg-gradient-to-br ${s.color} rounded-2xl p-4 text-white`}>
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-xs opacity-80 font-medium">{s.label}</p>
                      <span className="text-lg">{s.icon}</span>
                    </div>
                    <p className="text-2xl font-black">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Seller stats if applicable */}
              {isSeller && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <h2 className="font-bold text-gray-900 mb-4">🛍️ Seller Summary</h2>
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: 'Total Sales',   value: profile!.total_sales || 0 },
                      { label: 'Revenue',       value: `${sui(profile!.total_revenue)} SUI` },
                      { label: 'Followers',     value: profile!.follower_count || 0 },
                    ].map(s => (
                      <div key={s.label} className="bg-gray-50 rounded-xl p-3 text-center">
                        <p className="text-lg font-black text-gray-900">{s.value}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Link href="/my-products" className="flex-1 text-center py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-500 transition-colors no-underline">
                      My Products
                    </Link>
                    <Link href="/analytics" className="flex-1 text-center py-2.5 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors no-underline">
                      Analytics
                    </Link>
                  </div>
                </div>
              )}

              {/* Recent purchases */}
              {purchases.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="font-bold text-gray-900">🕒 Recent Purchases</h2>
                    <button onClick={() => setTab('purchases')} className="text-xs text-indigo-600 font-semibold hover:underline bg-transparent border-none cursor-pointer">
                      View all →
                    </button>
                  </div>
                  <div className="space-y-3">
                    {purchases.slice(0, 3).map(p => (
                      <div key={p.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <div className="w-10 h-10 rounded-xl bg-gray-200 overflow-hidden shrink-0">
                          {p.image_url
                            ? <img src={p.image_url} alt={p.title} className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-lg">📦</div>
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{p.title || 'Product'}</p>
                          <p className="text-xs text-gray-400">{fmtDate(p.created_at)}</p>
                        </div>
                        <span className="text-sm font-bold text-indigo-600 shrink-0">{sui(p.price)} SUI</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state for new users */}
              {purchases.length === 0 && favorites.length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
                  <div className="text-5xl mb-4">🛍️</div>
                  <h3 className="font-bold text-gray-900 mb-2">Your profile is ready!</h3>
                  <p className="text-sm text-gray-400 mb-6">Browse the marketplace to make your first purchase.</p>
                  <Link href="/" className="inline-block px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-500 transition-colors no-underline">
                    Explore Marketplace
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* ── Purchases ── */}
          {tab === 'purchases' && (
            <div className="space-y-4">
              {purchases.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center shadow-sm">
                  <div className="text-5xl mb-3">📦</div>
                  <h3 className="font-bold text-gray-900 mb-1">No purchases yet</h3>
                  <p className="text-sm text-gray-400 mb-4">Your purchased products will appear here.</p>
                  <Link href="/" className="inline-block px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold no-underline hover:bg-indigo-500 transition-colors">
                    Browse Products
                  </Link>
                </div>
              ) : purchases.map(p => (
                <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex gap-4 items-start">
                  {/* Thumbnail */}
                  <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden shrink-0">
                    {p.image_url
                      ? <img src={p.image_url} alt={p.title} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>
                    }
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-bold text-gray-900 text-sm truncate flex-1">{p.title || 'Product'}</h3>
                      <span className="text-sm font-black text-indigo-600 shrink-0">{sui(p.price)} SUI</span>
                    </div>
                    {p.category && (
                      <span className="inline-block text-xs font-semibold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full mb-2">
                        {p.category}
                      </span>
                    )}
                    <p className="text-xs text-gray-400 mb-3">
                      Purchased {fmtDate(p.created_at)}
                      {p.seller && <> · <span className="font-mono">{shortAddr(p.seller)}</span></>}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {/* Download */}
                      <button
                        onClick={() => handleDownload(p)}
                        disabled={!!downloading || !p.file_cid}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border-none cursor-pointer transition-colors ${
                          p.file_cid
                            ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}>
                        {downloading === p.product_id ? '⏳ Downloading…' : '⬇️ Download'}
                      </button>

                      {/* View product */}
                      <Link href={`/seller/${p.seller}`}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 no-underline transition-colors">
                        👤 Seller
                      </Link>

                      {/* Dispute */}
                      <Link
                        href={`/support?tab=dispute&tx=${p.tx_digest}`}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-red-100 text-red-500 hover:bg-red-50 no-underline transition-colors">
                        ⚖️ Dispute
                      </Link>

                      {/* TX link */}
                      <a
                        href={`https://suiexplorer.com/txblock/${p.tx_digest}?network=testnet`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 text-gray-500 hover:bg-gray-50 no-underline transition-colors">
                        🔗 Explorer
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Favorites ── */}
          {tab === 'favorites' && (
            <div>
              {favorites.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center shadow-sm">
                  <div className="text-5xl mb-3">❤️</div>
                  <h3 className="font-bold text-gray-900 mb-1">No favorites yet</h3>
                  <p className="text-sm text-gray-400 mb-4">Save products you like by clicking the heart icon.</p>
                  <Link href="/" className="inline-block px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold no-underline hover:bg-indigo-500 transition-colors">
                    Browse Products
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {favorites.map(f => (
                    <div key={f.product_id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden group">
                      <div className="relative h-36 bg-gray-50">
                        {f.image_url
                          ? <img src={f.image_url} alt={f.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                          : <div className="w-full h-full flex items-center justify-center text-4xl">🛍️</div>
                        }
                        <button onClick={() => unfavorite(f.product_id)}
                          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-colors cursor-pointer border-none shadow-sm">
                          ♥
                        </button>
                        {!f.is_available && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                            <span className="text-white text-sm font-bold bg-black/60 px-3 py-1 rounded-full">Unavailable</span>
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <p className="text-xs font-semibold text-indigo-500 mb-1">{f.category}</p>
                        <h3 className="font-bold text-gray-900 text-sm mb-2 line-clamp-2">{f.title}</h3>
                        <div className="flex items-center justify-between">
                          <span className="text-base font-black text-indigo-600">{sui(f.price)} SUI</span>
                          <span className="text-xs text-gray-400">Saved {fmtDate(f.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Following ── */}
          {tab === 'following' && (
            <div className="space-y-3">
              {following.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center shadow-sm">
                  <div className="text-5xl mb-3">👥</div>
                  <h3 className="font-bold text-gray-900 mb-1">Not following anyone yet</h3>
                  <p className="text-sm text-gray-400">Follow sellers to get notified when they list new products.</p>
                </div>
              ) : following.map(s => (
                <div key={s.address} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4">
                  <Link href={`/seller/${s.address}`} className="flex items-center gap-3 flex-1 min-w-0 no-underline">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center overflow-hidden shrink-0">
                      {s.avatar_url
                        ? <img src={s.avatar_url} alt={s.display_name} className="w-full h-full object-cover" />
                        : <span className="text-white font-black text-sm">{(s.display_name || s.address).slice(0,2).toUpperCase()}</span>
                      }
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900 text-sm truncate">{s.display_name || shortAddr(s.address)}</p>
                      <p className="text-xs text-gray-400">{s.total_sales || 0} sales · {s.follower_count || 0} followers</p>
                    </div>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-400">Since {fmtDate(s.followed_at)}</span>
                    <button onClick={() => unfollow(s.address)}
                      className="px-3 py-1.5 text-xs font-semibold text-red-500 border border-red-100 rounded-xl hover:bg-red-50 bg-transparent cursor-pointer transition-colors">
                      Unfollow
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Seller tab ── */}
          {tab === 'seller' && isSeller && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { icon: '💰', label: 'Total Revenue', value: `${sui(profile!.total_revenue)} SUI`, color: 'from-green-500 to-emerald-600' },
                  { icon: '🛒', label: 'Total Sales',   value: profile!.total_sales || 0,            color: 'from-blue-500 to-indigo-600' },
                  { icon: '👥', label: 'Followers',     value: profile!.follower_count || 0,         color: 'from-purple-500 to-pink-600' },
                ].map(s => (
                  <div key={s.label} className={`bg-gradient-to-br ${s.color} rounded-2xl p-5 text-white`}>
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-xs opacity-80 font-medium">{s.label}</p>
                      <span className="text-xl">{s.icon}</span>
                    </div>
                    <p className="text-2xl font-black">{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <Link href="/my-products" className="flex-1 text-center py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-500 no-underline transition-colors">
                  📦 My Products
                </Link>
                <Link href="/list-product" className="flex-1 text-center py-3 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 no-underline transition-colors">
                  + List New Product
                </Link>
                <Link href="/analytics" className="flex-1 text-center py-3 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 no-underline transition-colors">
                  📊 Analytics
                </Link>
              </div>
            </div>
          )}
        </>
      )}

      {/* Edit profile modal */}
      {showEdit && (
        <EditProfileModal
          profile={profile}
          onSave={saveProfile}
          onClose={() => setShowEdit(false)}
        />
      )}
    </div>
  );
}
