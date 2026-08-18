import { useState, useEffect } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import toast from 'react-hot-toast';
import { API_URL } from '@/lib/api';
import ProductDetailModal from '@/components/ProductDetailModal';

interface Purchase {
  id: string;
  product_id: string;
  buyer: string;
  seller: string;
  price: string;
  platform_fee: string;
  tx_digest: string;
  created_at: string;
  product_title?: string;
  product_image?: string;
  product_category?: string;
  product_file_cid?: string;
}

export default function MyPurchases() {
  const account = useCurrentAccount();
  const [purchases,        setPurchases]        = useState<Purchase[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [isModalOpen,      setIsModalOpen]      = useState(false);
  const [downloading,      setDownloading]      = useState<string | null>(null);

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
      const raw  = data.purchases || [];

      // Enrich with product data
      const enriched = await Promise.all(raw.map(async (p: any) => {
        try {
          const pr = await fetch(`${API_URL}/api/products/${p.product_id}`);
          if (pr.ok) {
            const pd = await pr.json();
            return {
              ...p,
              product_title:    pd.title,
              product_image:    pd.image_url,
              product_category: pd.category,
              product_file_cid: pd.file_cid,
            };
          }
        } catch {}
        return p;
      }));

      setPurchases(enriched);
    } catch {
      setPurchases([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (productId: string, fileTitle?: string) => {
    if (!account?.address) return;
    setDownloading(productId);
    try {
      const tokenRes = await fetch(`${API_URL}/api/download/${productId}/${account.address}`);
      if (!tokenRes.ok) {
        const e = await tokenRes.json();
        toast.error(e.error || 'Download failed');
        return;
      }
      const { token } = await tokenRes.json();
      if (!token) { toast.error('Could not generate download link'); return; }

      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = `${API_URL}/api/download/file/${token}`;
      document.body.appendChild(iframe);
      setTimeout(() => document.body.removeChild(iframe), 60000);
      toast.success('Download starting...');
    } catch {
      toast.error('Download failed. Please try again.');
    } finally {
      setDownloading(null);
    }
  };

  if (!account) return (
    <div className="max-w-md mx-auto py-20 px-4 text-center">
      <div className="bg-white border border-gray-100 rounded-2xl p-8 shadow-sm">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Sign In Required</h2>
        <p className="text-gray-400 text-sm">Connect your wallet to view your purchases.</p>
      </div>
    </div>
  );

  if (loading) return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="space-y-4">
        {[1,2,3].map(i => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex gap-4">
            <div className="w-16 h-16 bg-gray-100 rounded-xl animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-100 rounded animate-pulse w-3/4" />
              <div className="h-3 bg-gray-100 rounded animate-pulse w-1/2" />
              <div className="h-3 bg-gray-100 rounded animate-pulse w-1/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-gray-900 mb-1">My Purchases</h1>
        <p className="text-gray-500 text-sm">{purchases.length} purchase{purchases.length !== 1 ? 's' : ''}</p>
      </div>

      {purchases.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center shadow-sm">
          <div className="text-5xl mb-3">📦</div>
          <h3 className="font-bold text-gray-900 mb-1">No purchases yet</h3>
          <p className="text-sm text-gray-400 mb-4">Your purchased products will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {purchases.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex gap-4 items-start">
              {/* Thumbnail */}
              <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden shrink-0">
                {p.product_image
                  ? <img src={p.product_image} alt={p.product_title} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>
                }
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-bold text-gray-900 text-sm truncate flex-1">
                    {p.product_title || 'Product'}
                  </h3>
                  <span className="text-sm font-black text-indigo-600 shrink-0">
                    {(Number(p.price) / 1e9).toFixed(3)} SUI
                  </span>
                </div>

                {p.product_category && (
                  <span className="inline-block text-xs font-semibold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full mb-2">
                    {p.product_category}
                  </span>
                )}

                <p className="text-xs text-gray-400 mb-3">
                  {new Date(Number(p.created_at)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>

                <div className="flex flex-wrap gap-2">
                  {/* Download */}
                  {p.product_file_cid && (
                    <button
                      onClick={() => handleDownload(p.product_id, p.product_title)}
                      disabled={downloading === p.product_id}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 border-none cursor-pointer transition-colors disabled:opacity-50">
                      {downloading === p.product_id ? 'Downloading...' : 'Download'}
                    </button>
                  )}

                  {/* View product */}
                  <button
                    onClick={() => { setSelectedProductId(p.product_id); setIsModalOpen(true); }}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 bg-white cursor-pointer transition-colors">
                    View Product
                  </button>

                  {/* Dispute */}
                  <a
                    href={`/support?tab=dispute&tx=${p.tx_digest}`}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-red-100 text-red-500 hover:bg-red-50 no-underline transition-colors">
                    Dispute
                  </a>

                  {/* Explorer */}
                  <a
                    href={`https://suiexplorer.com/txblock/${p.tx_digest}?network=testnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 text-gray-500 hover:bg-gray-50 no-underline transition-colors">
                    Explorer
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && selectedProductId && (
        <ProductDetailModal
          productId={selectedProductId}
          isOpen={isModalOpen}
          onClose={() => { setIsModalOpen(false); setSelectedProductId(null); }}
        />
      )}
    </div>
  );
}
