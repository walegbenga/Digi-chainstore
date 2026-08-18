import { useState, useEffect } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { API_URL } from '@/lib/api';
import toast from 'react-hot-toast';

// ── Types ─────────────────────────────────────────────────────────────────────
interface License {
  id: number;                    // SERIAL primary key
  license_id: string;            // on-chain object ID
  product_id: string;
  product_title: string;
  product_image: string;
  product_category: string;
  product_seller: string;
  buyer_address: string;
  seller_address: string;
  license_key: string;
  license_type: number;
  max_activations: number;
  current_activations: number;
  expiry_timestamp: string;      // 0 = lifetime
  renewal_price: string;
  status: string;                // active | revoked | expired
  renewal_count: number;
  issue_timestamp: string;
  active_devices: Array<{ device_id: string; activated_at: number; is_active: boolean }>;
}

const LICENSE_TYPE_LABELS: Record<number, { label: string; icon: string; color: string }> = {
  1: { label: 'Single Device',   icon: '💻', color: 'bg-blue-100 text-blue-700'   },
  2: { label: 'Multi Device',    icon: '🖥️', color: 'bg-purple-100 text-purple-700' },
  3: { label: 'Subscription',    icon: '🔄', color: 'bg-green-100 text-green-700'  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate  = (n: string | number) =>
  Number(n) === 0 ? 'Lifetime' : new Date(Number(n)).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });

const isExpired = (expiry_timestamp: string) =>
  Number(expiry_timestamp) !== 0 && Number(expiry_timestamp) < Date.now();

const sui = (n: string | number) => (Number(n) / 1e9).toFixed(3);

// ── License Key Modal ─────────────────────────────────────────────────────────
function LicenseKeyModal({ license, onClose }: { license: License; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyKey = () => {
    navigator.clipboard.writeText(license.license_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-5">
          <h2 className="text-white font-black text-lg">🔑 Your License Key</h2>
          <p className="text-white/80 text-sm mt-1">{license.product_title}</p>
          <p className="text-white/50 text-xs font-mono mt-0.5">{license.license_id.slice(0,20)}…</p>
        </div>

        <div className="p-6">
          {/* Key display */}
          <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-5 text-center mb-4">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-widest mb-2">License Key</p>
            <p className="font-mono text-xl font-black text-gray-900 tracking-widest">
              {license.license_key}
            </p>
          </div>

          <button onClick={copyKey}
            className={`w-full py-3 rounded-xl text-sm font-bold transition-colors border-none cursor-pointer mb-4 ${
              copied ? 'bg-green-500 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}>
            {copied ? '✅ Copied to clipboard!' : '📋 Copy License Key'}
          </button>

          {/* Details */}
          <div className="space-y-2 text-sm">
            {[
              { label: 'Type',         value: license.license_type === 1 ? 'Single Device' : license.license_type === 2 ? 'Multi Device' : 'Subscription' },
              { label: 'Activations',  value: `${license.current_activations} / ${license.max_activations === 0 ? '∞' : license.max_activations}` },
              { label: 'Valid until',  value: Number(license.expiry_timestamp) === 0 ? 'Lifetime' : new Date(Number(license.expiry_timestamp)).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) },
              { label: 'Status',       value: license.status.charAt(0).toUpperCase() + license.status.slice(1) },
            ].map(row => (
              <div key={row.label} className="flex justify-between py-2 border-b border-gray-50 last:border-0">
                <span className="text-gray-400">{row.label}</span>
                <span className="font-semibold text-gray-900">{row.value}</span>
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs text-gray-400 text-center">
            Keep this key safe. You will need it to activate the software.
          </p>
        </div>

        <div className="px-6 pb-6">
          <button onClick={onClose}
            className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 bg-white cursor-pointer transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MyLicenses() {
  const account                       = useCurrentAccount();
  const [licenses, setLicenses]       = useState<License[]>([]);
  const [loading,  setLoading]        = useState(true);
  const [selected, setSelected]       = useState<License | null>(null);
  const [filter,   setFilter]         = useState<'all' | 'active' | 'expired'>('all');

  useEffect(() => {
    if (account?.address) fetchLicenses();
    else setLoading(false);
  }, [account?.address]);

  const fetchLicenses = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/api/licenses/${account!.address}`);
      const data = await res.json();
      setLicenses(data.licenses || []);
    } catch { setLicenses([]); }
    finally { setLoading(false); }
  };

  if (!account) return (
    <div className="max-w-md mx-auto py-20 px-4 text-center">
      <div className="bg-white border border-gray-100 rounded-2xl p-8 shadow-sm">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Sign In Required</h2>
        <p className="text-gray-400 text-sm">Connect your wallet to view your licenses.</p>
      </div>
    </div>
  );

  const filtered = licenses.filter(l => {
    if (filter === 'active')  return l.status === 'active' && !isExpired(l.expiry_timestamp);
    if (filter === 'expired') return l.is_revoked  ||  isExpired(l.expires_at);
    return true;
  });

  const activeCount  = licenses.filter(l => l.status === 'active' && !isExpired(l.expiry_timestamp)).length;
  const expiredCount = licenses.filter(l =>  l.status === 'revoked' || isExpired(l.expiry_timestamp)).length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-gray-900 mb-1">🔑 My Licenses</h1>
        <p className="text-gray-500 text-sm">Manage your software licenses and activation keys</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total',   value: licenses.length, color: 'from-indigo-500 to-indigo-600' },
          { label: 'Active',  value: activeCount,     color: 'from-green-500 to-emerald-600' },
          { label: 'Expired', value: expiredCount,    color: 'from-gray-400 to-gray-500'     },
        ].map(s => (
          <div key={s.label} className={`bg-gradient-to-br ${s.color} rounded-2xl p-4 text-white text-center`}>
            <p className="text-2xl font-black">{s.value}</p>
            <p className="text-xs opacity-80 font-medium">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-1.5 bg-gray-100 rounded-2xl p-1.5 mb-6">
        {[
          { id: 'all',     label: `All (${licenses.length})` },
          { id: 'active',  label: `Active (${activeCount})` },
          { id: 'expired', label: `Expired (${expiredCount})` },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id as any)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all border-none cursor-pointer ${
              filter === f.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 bg-transparent hover:text-gray-700'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* License list */}
      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="text-5xl mb-3">🔑</div>
          <h3 className="font-bold text-gray-900 mb-1">No licenses found</h3>
          <p className="text-sm text-gray-400">
            {filter === 'all'
              ? 'Purchase software products to receive license keys'
              : `No ${filter} licenses`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(license => {
            const typeInfo = LICENSE_TYPE_LABELS[license.license_type];
            const expired  = isExpired(license.expiry_timestamp);
            const isActive = license.status === 'active' && !expired;

            return (
              <div key={license.id}
                className={`bg-white rounded-2xl border shadow-sm p-5 ${
                  license.status === 'revoked' ? 'border-red-200 opacity-75' :
                  expired ? 'border-orange-200' : 'border-gray-100'
                }`}>
                <div className="flex gap-4 items-start">
                  {/* Product image */}
                  <div className="w-14 h-14 rounded-xl bg-gray-100 overflow-hidden shrink-0">
                    {license.product_image
                      ? <img src={license.product_image} alt={license.product_title} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>
                    }
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-bold text-gray-900 text-sm truncate">{license.product_title}</h3>
                      <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                        license.status === 'revoked' ? 'bg-red-100 text-red-600' :
                        expired ? 'bg-orange-100 text-orange-600' :
                        'bg-green-100 text-green-600'
                      }`}>
                        {license.status === 'revoked' ? 'Revoked' : expired ? 'Expired' : '✓ Active'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      {typeInfo && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeInfo.color}`}>
                          {typeInfo.icon} {typeInfo.label}
                        </span>
                      )}
                      <span className="text-xs text-gray-400">
                        {license.current_activations} activation{license.current_activations !== 1 ? 's' : ''} used
                      </span>
                      <span className="text-xs text-gray-400">
                        Expires: <span className={expired ? 'text-orange-500 font-semibold' : 'text-gray-600'}>
                          {fmtDate(license.expiry_timestamp)}
                        </span>
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {/* View key */}
                      <button onClick={() => setSelected(license)}
                        disabled={license.status === 'revoked'}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border-none cursor-pointer transition-colors ${
                          license.status === 'revoked'
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-indigo-600 text-white hover:bg-indigo-500'
                        }`}>
                        🔑 View Key
                      </button>

                      {/* Renew if subscription and expired */}
                      {license.license_type === 3 && (expired || !isActive) && !license.status === 'revoked' && (
                        <button
                          onClick={() => toast.error('Renewal requires a wallet transaction — coming soon')}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-green-100 text-green-700 hover:bg-green-200 border-none cursor-pointer transition-colors">
                          🔄 Renew ({sui(license.renewal_price)} SUI)
                        </button>
                      )}

                      {/* Copy license ID */}
                      <button
                        onClick={() => { navigator.clipboard.writeText(license.id); toast.success('License ID copied'); }}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 text-gray-500 hover:bg-gray-50 bg-white cursor-pointer transition-colors">
                        📋 Copy ID
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* License key modal */}
      {selected && (
        <LicenseKeyModal
          license={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
