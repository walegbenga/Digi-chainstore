import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import toast from 'react-hot-toast';
import { API_URL } from '@/lib/api';

const CATEGORIES    = ['Ebook', 'Evideo', 'Stickers', 'Software Plugin', 'Music', 'Other'];
const PACKAGE_ID     = process.env.NEXT_PUBLIC_PACKAGE_ID!;
const MARKETPLACE_ID = process.env.NEXT_PUBLIC_MARKETPLACE_ID!;

interface ProductFormProps { productId?: string; }

export default function ProductForm({ productId }: ProductFormProps) {
  const router  = useRouter();
  const account = useCurrentAccount();
  const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();
  const isEdit  = !!productId;

  const [form, setForm] = useState({
    title: '', description: '', price: '', imageUrl: '',
    category: 'Ebook', quantity: '1', resellable: false,
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading,    setUploading]    = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [fetching,     setFetching]     = useState(isEdit);
  const [dragOver,     setDragOver]     = useState(false);

  useEffect(() => { if (isEdit && productId) fetchProduct(); }, [productId]);

  const fetchProduct = async () => {
    try {
      const res  = await fetch(`${API_URL}/api/products/${productId}`);
      const data = await res.json();
      if (data.seller !== account?.address) {
        toast.error('Not your product');
        router.push('/my-products');
        return;
      }
      setForm({
        title:       data.title,
        description: data.description,
        price:       (Number(data.price) / 1e9).toString(),
        imageUrl:    data.image_url,
        category:    data.category,
        quantity:    data.quantity?.toString() || '1',
        resellable:  data.resellable || false,
      });
    } catch { toast.error('Failed to load product'); }
    finally { setFetching(false); }
  };

  const uploadFile = async (): Promise<{ cid: string } | null> => {
    if (!selectedFile) return null;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      fd.append('seller', account!.address);
      const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: fd });
      if (!res.ok) { const e = await res.json(); throw new Error(e.details || e.error); }
      toast.success('File uploaded ✅');
      return await res.json();
    } catch (e: any) {
      toast.error(`Upload failed: ${e.message}`);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) { toast.error('Connect your wallet first'); return; }
    setLoading(true);
    try {
      isEdit ? await handleUpdate() : await handleCreate();
    } catch (e: any) {
      toast.error(e.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    let fileCid = '';
    if (selectedFile) {
      const fileData = await uploadFile();
      if (!fileData) { setLoading(false); return; }
      fileCid = fileData.cid;
    }

    const priceInMist = Math.floor(Number(form.price) * 1_000_000_000);
    const quantity    = Math.max(1, parseInt(form.quantity) || 1);

    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::marketplace::list_product`,
      arguments: [
        tx.object(MARKETPLACE_ID),
        tx.pure(bcs.string().serialize(form.title).toBytes()),
        tx.pure(bcs.string().serialize(form.description).toBytes()),
        tx.pure(bcs.u64().serialize(priceInMist).toBytes()),
        tx.pure(bcs.u64().serialize(quantity).toBytes()),
        tx.pure(bcs.string().serialize(form.category).toBytes()),
        tx.pure(bcs.bool().serialize(form.resellable).toBytes()),
        tx.pure(bcs.string().serialize(fileCid).toBytes()),
        tx.object('0x6'),
      ],
    });

    signAndExecuteTransaction({ transaction: tx }, {
      onSuccess: async () => {
        toast.success('Product listed! 🎉');
        toast.loading('Waiting for confirmation…', { id: 'idx' });
        await new Promise(r => setTimeout(r, 3000));
        toast.dismiss('idx');
        setTimeout(() => router.push('/my-products'), 800);
      },
      onError: (e: any) => {
        toast.error(e.message || 'Transaction failed');
        setLoading(false);
      },
    });
  };

  const handleUpdate = async () => {
    const res = await fetch(`${API_URL}/api/products/${productId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:       form.title,
        description: form.description,
        price:       Math.floor(Number(form.price) * 1e9),
        image_url:   form.imageUrl,
        category:    form.category,
        quantity:    parseInt(form.quantity),
        resellable:  form.resellable,
        seller:      account!.address,
      }),
    });
    if (res.ok) {
      toast.success('Updated! 🎉');
      setTimeout(() => router.push('/my-products'), 800);
    } else {
      const e = await res.json();
      throw new Error(e.error || 'Update failed');
    }
  };

  const input = "w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-colors";

  if (fetching) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Product Title <span className="text-red-400">*</span>
          </label>
          <input value={form.title} required onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Premium UI Kit, Notion Template, Beat Pack…"
            className={input} />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Description <span className="text-red-400">*</span>
          </label>
          <textarea value={form.description} required rows={4}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Describe what buyers get, what format it's in, how they can use it…"
            className={`${input} resize-none`} />
          <p className="text-xs text-gray-400 mt-1 text-right">{form.description.length}/1000</p>
        </div>

        {/* Price + Category */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Price (SUI) <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input value={form.price} type="number" step="0.001" min="0.001" required
                onChange={e => setForm({ ...form, price: e.target.value })}
                placeholder="0.00"
                className={`${input} pr-12`} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-semibold">SUI</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Category <span className="text-red-400">*</span>
            </label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
              className={`${input} cursor-pointer`}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Quantity */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Quantity <span className="text-red-400">*</span>
          </label>
          <input value={form.quantity} type="number" min="1" step="1" required
            onChange={e => setForm({ ...form, quantity: e.target.value })}
            className={input} />
          <p className="text-xs text-gray-400 mt-1">
            For limited editions set a specific number. For unlimited digital goods use a large number like 9999.
          </p>
        </div>

        {/* Image URL */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Cover Image URL <span className="text-red-400">*</span>
          </label>
          <input value={form.imageUrl} type="url" required
            onChange={e => setForm({ ...form, imageUrl: e.target.value })}
            placeholder="https://…"
            className={input} />
          {form.imageUrl && (
            <div className="mt-2 h-32 rounded-xl overflow-hidden border border-gray-100 bg-gray-50">
              <img src={form.imageUrl} alt="Preview"
                className="w-full h-full object-cover"
                onError={e => { (e.currentTarget as HTMLImageElement).src = 'https://via.placeholder.com/400x128?text=Invalid+URL'; }}
              />
            </div>
          )}
        </div>

        {/* File upload */}
        <div
          className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors ${
            dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-indigo-200 hover:bg-gray-50'
          }`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) setSelectedFile(f);
          }}
        >
          <div className="text-3xl mb-2">📎</div>
          <p className="text-sm font-semibold text-gray-700 mb-1">
            {selectedFile ? selectedFile.name : 'Upload your digital file'}
          </p>
          <p className="text-xs text-gray-400 mb-3">
            {selectedFile
              ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
              : 'PDF, ZIP, MP3, MP4, PNG, SVG… max 100MB (500MB for video)'}
          </p>
          <label className="inline-block px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl cursor-pointer hover:bg-indigo-500 transition-colors">
            {selectedFile ? 'Change File' : 'Choose File'}
            <input type="file" className="hidden"
              onChange={e => setSelectedFile(e.target.files?.[0] || null)} />
          </label>
          {selectedFile && (
            <button type="button" onClick={() => setSelectedFile(null)}
              className="ml-2 text-xs text-red-400 hover:text-red-600 bg-transparent border-none cursor-pointer">
              Remove
            </button>
          )}
        </div>

        {/* Resellable */}
        <div className="flex items-start gap-3 p-4 bg-purple-50 rounded-xl border border-purple-100">
          <input id="resellable" type="checkbox" checked={form.resellable}
            onChange={e => setForm({ ...form, resellable: e.target.checked })}
            className="mt-0.5 w-4 h-4 cursor-pointer shrink-0" style={{ accentColor: '#7c3aed' }} />
          <div>
            <label htmlFor="resellable" className="text-sm font-semibold text-purple-700 cursor-pointer">
              🔄 Resellable Product
            </label>
            <p className="text-xs text-purple-500 mt-0.5 leading-relaxed">
              Allow buyers to resell this product as an NFT. You automatically earn 2.5% royalty on every resale.
            </p>
          </div>
        </div>

        {isEdit && (
          <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
            <p className="text-xs text-blue-600">
              ℹ️ Editing updates our database only. The on-chain price/quantity can only be changed via a new transaction.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading || uploading}
            className={`flex-1 py-3 rounded-xl text-sm font-bold text-white border-none transition-colors ${
              loading || uploading
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 cursor-pointer'
            }`}>
            {uploading ? '⏳ Uploading…'
              : loading ? (isEdit ? 'Updating…' : 'Listing…')
              : isEdit ? '💾 Update Product'
              : '🚀 List Product'}
          </button>
          <button type="button" onClick={() => router.push('/my-products')}
            className="px-5 py-3 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 bg-white cursor-pointer transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
