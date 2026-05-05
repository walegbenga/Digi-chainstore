// ═══════════════════════════════════════════════════════════
// my-purchases.tsx
// ═══════════════════════════════════════════════════════════
import { useState, useEffect } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { API_URL } from '@/lib/api';
import ProductDetailModal from '@/components/ProductDetailModal';

interface Purchase {
  id: string; product_id: string; buyer: string; seller: string;
  price: string; platform_fee: string; tx_digest: string; created_at: string;
  product_title?: string; product_image?: string;
  product_category?: string; product_file_cid?: string;
}

export default function MyPurchases() {
  const account = useCurrentAccount();
  const [purchases, setPurchases]           = useState<Purchase[]>([]);
  const [loading, setLoading]               = useState(true);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen]       = useState(false);

  useEffect(() => {
    if (account?.address) fetchPurchases();
    else setLoading(false);
  }, [account?.address]);

  const fetchPurchases = async () => {
    if (!account?.address) return;
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/api/purchases/${account.address}`);
      const data = await res.json();
      const withProducts = await Promise.all(
        (data.purchases || []).map(async (p: Purchase) => {
          try {
            const pr = await fetch(`${API_URL}/api/products/${p.product_id}`);
            const pd = await pr.json();
            return { ...p, product_title: pd.title, product_image: pd.image_url, product_category: pd.category, product_file_cid: pd.file_cid };
          } catch { return p; }
        })
      );
      setPurchases(withProducts);
    } catch { toast.error('Failed to fetch purchases'); }
    finally { setLoading(false); }
  };

  const formatDate = (ts: string | number) => {
    const n = Number(ts);
    if (!n || isNaN(n)) return 'Unknown';
    return new Date(n).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const handleDownload = async (productId: string, fileTitle?: string) => {
    if (!account?.address) return;
    try {
      // Step 1: Get signed one-time token
      const tokenRes = await fetch(`${API_URL}/api/download/${productId}/${account.address}`);
      if (!tokenRes.ok) {
        const e = await tokenRes.json();
        toast.error(e.error || 'Download failed');
        return;
      }
      const { token } = await tokenRes.json();
      if (!token) { toast.error('Could not generate download link'); return; }

      // Step 2: Fetch file bytes as blob — URL never shown in browser
      const fileRes = await fetch(`${API_URL}/api/download/file/${token}`);
      if (!fileRes.ok) { toast.error('Download failed — please try again'); return; }

      const disposition = fileRes.headers.get('content-disposition') || '';
      const nameMatch   = disposition.match(/filename="?([^"]+)"?/);
      const fileName    = nameMatch?.[1] || fileTitle || 'download';

      const blob      = await fileRes.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a         = document.createElement('a');
      a.href          = objectUrl;
      a.download      = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(objectUrl); document.body.removeChild(a); }, 100);
      toast.success('Download started! 🎉');
    } catch (e: any) {
      toast.error('Download failed. Please try again.');
    }
  };

  if (!account) return (
    <div style={{ maxWidth: 480, margin: '80px auto', padding: '0 16px', textAlign: 'center' }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: 32 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: 'var(--text-primary)', marginBottom: 8 }}>Wallet Not Connected</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Connect your wallet to view your purchases.</p>
      </div>
    </div>
  );

  return (
    <div style={{ color: 'var(--text-primary)' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 28, marginBottom: 2 }}>My Purchases</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Your purchased digital products</p>
      </div>

      {loading ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 16, overflow: 'hidden' }}>
          {Array.from({length:4}).map((_,i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', gap: 14 }}>
              <div className="skeleton" style={{ width: 64, height: 64, borderRadius: 10, flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div className="skeleton" style={{ height: 13, width: '40%' }} />
                <div className="skeleton" style={{ height: 11, width: '60%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : purchases.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px 16px', background: 'var(--bg-surface)', border: '1px dashed var(--border)', borderRadius: 18 }}>
          <p style={{ fontSize: 36, marginBottom: 10 }}>🛒</p>
          <p style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>No purchases yet</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Browse the marketplace to find products</p>
          <Link href="/" style={{ background: 'linear-gradient(135deg,var(--gold),var(--gold-dim))', color: '#0c0c0f', padding: '10px 20px', borderRadius: 10, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            Browse Marketplace
          </Link>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 16, overflow: 'hidden' }}>
          {purchases.map((p, idx) => (
            <div key={p.id}
              style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: idx < purchases.length-1 ? '1px solid var(--border-subtle)' : 'none', transition: 'background .15s', gap: 14 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {p.product_image && p.product_image.trim() !== '' && (
                <img src={p.product_image} alt={p.product_title || 'Product'}
                  style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border-subtle)' }}
                  onError={e => { e.currentTarget.src = 'https://via.placeholder.com/64'; }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{p.product_title || 'Unknown Product'}</p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>Purchased {formatDate(p.created_at)}</p>
                  </div>
                  <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: 'var(--gold-light)', flexShrink: 0 }}>
                    {(Number(p.price)/1e9).toFixed(2)} <span style={{ fontSize: 11, fontFamily: "'DM Sans',sans-serif", color: 'var(--text-muted)' }}>SUI</span>
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {p.product_category && (
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'rgba(96,165,250,.1)', color: '#60a5fa', border: '1px solid rgba(96,165,250,.2)' }}>
                      {p.product_category}
                    </span>
                  )}
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                    TX: {p.tx_digest?.slice(0,8)}…
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    {p.product_file_cid && (
                      <button onClick={() => handleDownload(p.product_id, p.product_title)}
                        style={{ padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: 'rgba(52,211,153,.1)', color: '#34d399', border: '1px solid rgba(52,211,153,.2)', fontFamily: "'DM Sans',sans-serif" } as any}>
                        📥 Download
                      </button>
                    )}
                    <button onClick={() => { setSelectedProductId(p.product_id); setIsModalOpen(true); }}
                      style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12, fontWeight: 500, background: 'transparent', color: 'var(--text-secondary)', fontFamily: "'DM Sans',sans-serif" }}>
                      View
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ProductDetailModal productId={selectedProductId} isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setSelectedProductId(null); fetchPurchases(); }} />
    </div>
  );
}
