import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import toast from 'react-hot-toast';
import LoadingButton from './LoadingButton';

const CATEGORIES = ['Electronics', 'Fashion', 'Home', 'Sports', 'Books', 'Other'];
const PACKAGE_ID     = process.env.NEXT_PUBLIC_PACKAGE_ID!;
const MARKETPLACE_ID = process.env.NEXT_PUBLIC_MARKETPLACE_ID!;

// License type options
const LICENSE_TYPES = [
  { value: 0, label: 'No License',          desc: 'Regular download, no activation required' },
  { value: 1, label: 'Single Device',        desc: 'One activation per purchase' },
  { value: 2, label: 'Multi Device',         desc: 'Buyer can activate on N devices (you set the limit)' },
  { value: 3, label: 'Unlimited Devices',    desc: 'Buyer can activate on any number of devices' },
];

interface ProductFormProps { productId?: string; }

const lbl: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: 6,
  letterSpacing: '0.04em', textTransform: 'uppercase',
};

export default function ProductForm({ productId }: ProductFormProps) {
  const router  = useRouter();
  const account = useCurrentAccount();
  const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();
  const isEdit  = !!productId;

  const [form, setForm] = useState({
    title: '', description: '', price: '', imageUrl: '',
    category: 'Electronics', quantity: '1', resellable: false,
    // License fields
    licenseType:         0,
    licenseMaxDevices:   '2',
    licenseDurationType: 'lifetime' as 'lifetime' | 'days',
    licenseDurationDays: '365',
    licenseRenewalPrice: '',
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading]       = useState(false);
  const [loading,   setLoading]         = useState(false);
  const [fetching,  setFetching]        = useState(isEdit);
  const [focused,   setFocused]         = useState('');

  useEffect(() => { if (isEdit && productId) fetchProduct(); }, [productId]);

  const fetchProduct = async () => {
    try {
      const res  = await fetch(`http://localhost:4000/api/products/${productId}`);
      const data = await res.json();
      if (data.seller !== account?.address) {
        toast.error('Not your product'); router.push('/my-products'); return;
      }
      setForm({
        title: data.title, description: data.description,
        price: (Number(data.price) / 1e9).toString(),
        imageUrl: data.image_url, category: data.category,
        quantity: data.quantity?.toString() || '1',
        resellable: data.resellable || false,
        licenseType: data.license_type || 0,
        licenseMaxDevices: data.license_max_activations?.toString() || '2',
        licenseDurationType: data.license_duration_days === 0 ? 'lifetime' : 'days',
        licenseDurationDays: data.license_duration_days?.toString() || '365',
        licenseRenewalPrice: data.license_renewal_price
          ? (Number(data.license_renewal_price) / 1e9).toString() : '',
      });
    } catch { toast.error('Failed to load product'); }
    finally { setFetching(false); }
  };

  const uploadFile = async () => {
    if (!selectedFile) return null;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      fd.append('seller', account!.address);
      const res = await fetch('http://localhost:4000/api/upload', { method: 'POST', body: fd });
      if (!res.ok) { const e = await res.json(); throw new Error(e.details || e.error); }
      toast.success('File uploaded to IPFS ✅');
      return await res.json();
    } catch (e: any) { toast.error(`Upload failed: ${e.message}`); return null; }
    finally { setUploading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) { toast.error('Connect your wallet'); return; }
    setLoading(true);
    try { isEdit ? await handleUpdate() : await handleCreate(); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    let fileData = null;
    if (selectedFile) {
      fileData = await uploadFile();
      if (!fileData) { setLoading(false); return; }
    }

    const priceInMist   = Math.floor(Number(form.price) * 1_000_000_000);
    const quantity      = parseInt(form.quantity) || 1;
    const durationDays  = form.licenseDurationType === 'lifetime' ? 0 : parseInt(form.licenseDurationDays) || 0;
    const renewalMist   = form.licenseRenewalPrice
      ? Math.floor(Number(form.licenseRenewalPrice) * 1_000_000_000) : 0;
    // max activations: single=1, multi=user input, unlimited=0
    const maxActivations = form.licenseType === 1 ? 1
      : form.licenseType === 2 ? parseInt(form.licenseMaxDevices) || 2
      : 0;

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
        tx.pure(bcs.string().serialize(fileData?.cid || '').toBytes()),
        tx.pure(bcs.u8().serialize(form.licenseType).toBytes()),
        tx.pure(bcs.u64().serialize(maxActivations).toBytes()),
        tx.pure(bcs.u64().serialize(durationDays).toBytes()),
        tx.pure(bcs.u64().serialize(renewalMist).toBytes()),
        tx.object('0x6'),
      ],
    });

    signAndExecuteTransaction({ transaction: tx }, {
      onSuccess: async () => {
        toast.success('Product listed! 🎉');
        toast.loading('Waiting for blockchain confirmation…', { id: 'idx' });
        await new Promise(r => setTimeout(r, 3000));
        toast.dismiss('idx');
        setTimeout(() => router.push('/my-products'), 1000);
      },
      onError: (e: any) => { toast.error(e.message || 'Transaction failed'); setLoading(false); },
    });
  };

  const handleUpdate = async () => {
    const res = await fetch(`http://localhost:4000/api/products/${productId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title, description: form.description,
        price: Math.floor(Number(form.price) * 1e9),
        image_url: form.imageUrl, category: form.category,
        quantity: parseInt(form.quantity), resellable: form.resellable,
        seller: account!.address,
      }),
    });
    if (res.ok) { toast.success('Updated! 🎉'); setTimeout(() => router.push('/my-products'), 1000); }
    else { const e = await res.json(); throw new Error(e.error); }
  };

  const fs = (name: string): React.CSSProperties => ({
    width: '100%', padding: '11px 14px',
    background: 'var(--bg-elevated)', borderRadius: 10,
    color: 'var(--text-primary)', fontFamily: "'DM Sans', sans-serif",
    fontSize: 13, outline: 'none',
    border: `1px solid ${focused === name ? 'var(--gold-dim)' : 'var(--border-subtle)'}`,
    boxShadow: focused === name ? '0 0 0 3px rgba(201,168,76,.1)' : 'none',
    transition: 'border-color .2s, box-shadow .2s',
  });

  const hasLicense = form.licenseType !== 0;

  if (fetching) return (
    <div style={{ textAlign: 'center', padding: 48 }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid rgba(201,168,76,.15)', borderTopColor: 'var(--gold)', animation: 'spin .8s linear infinite', display: 'inline-block' }} />
      <p style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 32, maxWidth: 680, margin: '0 auto' }}>
      <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 26, color: 'var(--text-primary)', marginBottom: 4 }}>
        {isEdit ? 'Edit Product' : 'List New Product'}
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 28 }}>
        {isEdit ? 'Update your product details' : 'Fill in the details to list your digital product on-chain'}
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Title */}
        <div>
          <label style={lbl}>Product Title *</label>
          <input style={fs('title')} value={form.title} required
            onChange={e => setForm({ ...form, title: e.target.value })}
            onFocus={() => setFocused('title')} onBlur={() => setFocused('')}
            placeholder="e.g. Premium UI Design Kit" />
        </div>

        {/* Description */}
        <div>
          <label style={lbl}>Description *</label>
          <textarea style={{ ...fs('desc'), resize: 'none' }} value={form.description} rows={4} required
            onChange={e => setForm({ ...form, description: e.target.value })}
            onFocus={() => setFocused('desc')} onBlur={() => setFocused('')}
            placeholder="Describe your product…" />
        </div>

        {/* Price + Category */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={lbl}>Price (SUI) *</label>
            <div style={{ position: 'relative' }}>
              <input style={{ ...fs('price'), paddingRight: 44 }} value={form.price} type="number" step="0.01" min="0.01" required
                onChange={e => setForm({ ...form, price: e.target.value })}
                onFocus={() => setFocused('price')} onBlur={() => setFocused('')}
                placeholder="0.00" />
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}>SUI</span>
            </div>
          </div>
          <div>
            <label style={lbl}>Category *</label>
            <select style={{ ...fs('cat'), cursor: 'pointer' }} value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })}
              onFocus={() => setFocused('cat')} onBlur={() => setFocused('')}>
              {CATEGORIES.map(c => <option key={c} value={c} style={{ background: '#1a1a24' }}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Quantity */}
        <div>
          <label style={lbl}>Quantity *</label>
          <input style={fs('qty')} value={form.quantity} type="number" min="1" step="1" required
            onChange={e => setForm({ ...form, quantity: e.target.value })}
            onFocus={() => setFocused('qty')} onBlur={() => setFocused('')} />
          <p style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>For limited editions, set a specific number</p>
        </div>

        {/* Image URL */}
        <div>
          <label style={lbl}>Image URL *</label>
          <input style={fs('img')} value={form.imageUrl} type="url" required
            onChange={e => setForm({ ...form, imageUrl: e.target.value })}
            onFocus={() => setFocused('img')} onBlur={() => setFocused('')}
            placeholder="https://…" />
          {form.imageUrl && (
            <div style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-subtle)', height: 140 }}>
              <img src={form.imageUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { e.currentTarget.src = 'https://via.placeholder.com/400x140?text=Invalid'; }} />
            </div>
          )}
        </div>

        {/* ── LICENSE CONFIGURATION ── */}
        <div style={{ background: 'rgba(201,168,76,.04)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 18 }}>🔑</span>
            <div>
              <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>License Management</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                Control how buyers can use this product after purchase
              </p>
            </div>
          </div>

          {/* License type selector */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {LICENSE_TYPES.map(lt => {
              const active = form.licenseType === lt.value;
              return (
                <button key={lt.value} type="button"
                  onClick={() => setForm({ ...form, licenseType: lt.value })}
                  style={{
                    padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                    background: active ? 'rgba(201,168,76,.1)' : 'var(--bg-elevated)',
                    border: `1px solid ${active ? 'var(--gold)' : 'var(--border-subtle)'}`,
                    transition: 'all .2s',
                  }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--gold-light)' : 'var(--text-primary)', marginBottom: 2 }}>
                    {lt.label}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{lt.desc}</p>
                </button>
              );
            })}
          </div>

          {/* License options — only shown when license is enabled */}
          {hasLicense && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>

              {/* Max devices — only for multi-device */}
              {form.licenseType === 2 && (
                <div>
                  <label style={{ ...lbl, color: 'var(--gold-dim)' }}>Max Devices per License</label>
                  <input style={fs('maxdev')} value={form.licenseMaxDevices} type="number" min="2" step="1"
                    onChange={e => setForm({ ...form, licenseMaxDevices: e.target.value })}
                    onFocus={() => setFocused('maxdev')} onBlur={() => setFocused('')}
                    placeholder="e.g. 3" />
                  <p style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                    Buyer can activate on this many devices simultaneously
                  </p>
                </div>
              )}

              {/* Duration — lifetime vs days */}
              <div>
                <label style={{ ...lbl, color: 'var(--gold-dim)' }}>License Duration</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  {(['lifetime', 'days'] as const).map(t => {
                    const active = form.licenseDurationType === t;
                    return (
                      <button key={t} type="button"
                        onClick={() => setForm({ ...form, licenseDurationType: t })}
                        style={{
                          padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500,
                          background: active ? 'rgba(201,168,76,.1)' : 'var(--bg-elevated)',
                          border: `1px solid ${active ? 'var(--gold)' : 'var(--border-subtle)'}`,
                          color: active ? 'var(--gold-light)' : 'var(--text-secondary)',
                        }}>
                        {t === 'lifetime' ? '♾️ Lifetime' : '📅 Fixed Duration'}
                      </button>
                    );
                  })}
                </div>

                {form.licenseDurationType === 'days' && (
                  <div style={{ position: 'relative' }}>
                    <input style={{ ...fs('durdays'), paddingRight: 56 }}
                      value={form.licenseDurationDays} type="number" min="1"
                      onChange={e => setForm({ ...form, licenseDurationDays: e.target.value })}
                      onFocus={() => setFocused('durdays')} onBlur={() => setFocused('')}
                      placeholder="365" />
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }}>days</span>
                  </div>
                )}
              </div>

              {/* Renewal price — only for fixed duration */}
              {form.licenseDurationType === 'days' && (
                <div>
                  <label style={{ ...lbl, color: 'var(--gold-dim)' }}>Renewal Price (SUI)</label>
                  <div style={{ position: 'relative' }}>
                    <input style={{ ...fs('renew'), paddingRight: 44 }}
                      value={form.licenseRenewalPrice} type="number" step="0.01" min="0"
                      onChange={e => setForm({ ...form, licenseRenewalPrice: e.target.value })}
                      onFocus={() => setFocused('renew')} onBlur={() => setFocused('')}
                      placeholder="0.00 (leave empty = not renewable)" />
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}>SUI</span>
                  </div>
                  <p style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                    Leave empty to make this license non-renewable after expiry
                  </p>
                </div>
              )}

              {/* Summary of config */}
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border-subtle)' }}>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  <strong style={{ color: 'var(--gold-light)' }}>Buyers will receive:</strong> A {LICENSE_TYPES[form.licenseType].label} license
                  {form.licenseType === 2 ? ` for up to ${form.licenseMaxDevices} devices` : ''}
                  {form.licenseDurationType === 'lifetime' ? ', valid for life.' : `, valid for ${form.licenseDurationDays} days.`}
                  {form.licenseRenewalPrice && form.licenseDurationType === 'days'
                    ? ` Renewable for ${form.licenseRenewalPrice} SUI.`
                    : form.licenseDurationType === 'days' ? ' Not renewable.' : ''}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Resellable toggle */}
        <div style={{ background: 'rgba(139,92,246,.06)', border: '1px solid rgba(139,92,246,.2)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input id="resellable" type="checkbox" checked={form.resellable}
            onChange={e => setForm({ ...form, resellable: e.target.checked })}
            style={{ marginTop: 2, accentColor: '#7c3aed', width: 16, height: 16, flexShrink: 0 }} />
          <div>
            <label htmlFor="resellable" style={{ fontWeight: 600, fontSize: 13, color: '#a78bfa', cursor: 'pointer' }}>
              🔄 Resellable NFT Product
            </label>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Buyers can resell this product. You receive 2.5% royalty on every resale.
            </p>
          </div>
        </div>

        {/* File upload */}
        <div style={{ background: 'rgba(52,211,153,.04)', border: '1px solid rgba(52,211,153,.15)', borderRadius: 12, padding: '14px 16px' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#34d399', marginBottom: 8 }}>
            📎 Digital File (Optional)
          </label>
          <input type="file" onChange={e => setSelectedFile(e.target.files?.[0] || null)}
            style={{ width: '100%', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }} />
          {selectedFile && (
            <div style={{ marginTop: 8, background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 12px', border: '1px solid rgba(52,211,153,.2)' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>📎 {selectedFile.name}</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          )}
          <p style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>PDF, ZIP, etc. — Max 100MB</p>
        </div>

        {isEdit && (
          <div style={{ background: 'rgba(96,165,250,.06)', border: '1px solid rgba(96,165,250,.2)', borderRadius: 10, padding: '10px 14px' }}>
            <p style={{ fontSize: 12, color: '#93c5fd' }}>ℹ️ This updates the database only. Blockchain record remains unchanged.</p>
          </div>
        )}

        {/* Submit */}
        <div style={{ display: 'flex', gap: 12, paddingTop: 8 }}>
          <button type="submit" disabled={loading || uploading}
            style={{
              flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', cursor: loading || uploading ? 'not-allowed' : 'pointer',
              background: loading || uploading ? 'var(--bg-hover)' : 'linear-gradient(135deg,var(--gold),var(--gold-dim))',
              color: loading || uploading ? 'var(--text-muted)' : '#0c0c0f',
              fontWeight: 700, fontSize: 14, fontFamily: "'DM Sans',sans-serif",
              boxShadow: loading || uploading ? 'none' : '0 2px 12px rgba(201,168,76,.3)',
            }}>
            {uploading ? 'Uploading…' : loading ? (isEdit ? 'Updating…' : 'Listing…') : (isEdit ? '💾 Update Product' : '🚀 List Product')}
          </button>
          <button type="button" onClick={() => router.push('/my-products')}
            style={{ padding: '13px 24px', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontFamily: "'DM Sans',sans-serif" }}>
            Cancel
          </button>
        </div>
      </form>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
