import { SuiClient } from '@mysten/sui/client';
import { pool, initializeDatabase } from '../config/database';
import * as dotenv from 'dotenv';

dotenv.config();

import { Resend } from 'resend';
import crypto from 'crypto';

// ── Email client ───────────────────────────────────────────────────────────
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@digichainstore.com';
const SITE_URL   = process.env.FRONTEND_URL || 'https://digi-chainstore.vercel.app';

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!resend) { console.log(`[Email skipped] To: ${to} | ${subject}`); return; }
  try {
    await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
    console.log(`📧 Sent to ${to}: ${subject}`);
  } catch (err: any) { console.error(`📧 Email failed:`, err?.message); }
}

// ── Email templates ────────────────────────────────────────────────────────
function tplSale(productTitle: string, buyerAddress: string, priceSUI: string, txDigest: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid #e5e7eb;">
  <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:28px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">💰 You made a sale!</h1>
  </div>
  <div style="padding:24px;">
    <p style="color:#374151;font-size:14px;">Payment has been sent directly to your wallet.</p>
    <div style="background:#f9fafb;border-radius:12px;padding:16px;margin:16px 0;">
      <p style="margin:4px 0;font-size:13px;color:#6b7280;">Product: <strong style="color:#111;">${productTitle}</strong></p>
      <p style="margin:4px 0;font-size:16px;color:#4f46e5;font-weight:800;">+${priceSUI} SUI</p>
      <p style="margin:4px 0;font-size:12px;color:#9ca3af;font-family:monospace;">Buyer: ${buyerAddress.slice(0,16)}...${buyerAddress.slice(-6)}</p>
    </div>
    <a href="${SITE_URL}/analytics" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;">View Analytics →</a>
    <p style="font-size:11px;color:#d1d5db;margin-top:12px;">TX: ${txDigest.slice(0,30)}...</p>
  </div></div>`;
}

function tplWelcome(address: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid #e5e7eb;">
  <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 28px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;font-weight:800;">Welcome to Digi ChainStore 🎉</h1>
    <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">The Digital ChainStore of the People</p>
  </div>
  <div style="padding:28px;">
    <p style="color:#374151;font-size:14px;line-height:1.6;">Your blockchain wallet is ready. Buy and sell digital products — no crypto experience needed.</p>
    <div style="background:#f9fafb;border-radius:12px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;font-weight:600;">YOUR WALLET</p>
      <p style="margin:0;font-size:11px;font-family:monospace;color:#374151;word-break:break-all;">${address}</p>
    </div>
    <a href="${SITE_URL}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 28px;border-radius:10px;font-weight:800;font-size:14px;text-decoration:none;">Start Shopping →</a>
  </div>
  <div style="background:#f9fafb;padding:14px;text-align:center;border-top:1px solid #e5e7eb;">
    <p style="margin:0;font-size:11px;color:#9ca3af;">Digi ChainStore &nbsp;·&nbsp; <a href="${SITE_URL}/privacy" style="color:#9ca3af;">Privacy</a> &nbsp;·&nbsp; <a href="${SITE_URL}/terms" style="color:#9ca3af;">Terms</a></p>
  </div></div>`;
}

function tplDispute(productTitle: string, reason: string, buyerAddress: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid #e5e7eb;">
  <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:28px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">⚖️ Dispute Raised</h1>
  </div>
  <div style="padding:24px;">
    <p style="color:#374151;font-size:14px;">A buyer raised a dispute. Please respond within 48 hours.</p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;margin:16px 0;">
      <p style="margin:4px 0;font-size:13px;color:#6b7280;">Product: <strong style="color:#111;">${productTitle}</strong></p>
      <p style="margin:4px 0;font-size:13px;color:#dc2626;font-weight:600;">Reason: ${reason.replace(/_/g,' ')}</p>
      <p style="margin:4px 0;font-size:12px;color:#9ca3af;font-family:monospace;">Buyer: ${buyerAddress.slice(0,16)}...${buyerAddress.slice(-6)}</p>
    </div>
    <a href="${SITE_URL}/analytics" style="display:inline-block;background:#dc2626;color:#fff;padding:10px 20px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;">View Dashboard →</a>
  </div></div>`;
}

function tplDisputeResolved(resolution: string, status: string): string {
  const won = status === 'resolved';
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid #e5e7eb;">
  <div style="background:${won ? 'linear-gradient(135deg,#059669,#047857)' : 'linear-gradient(135deg,#6b7280,#4b5563)'};padding:28px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">${won ? '✅ Dispute Resolved' : '❌ Dispute Closed'}</h1>
  </div>
  <div style="padding:24px;">
    <p style="color:#374151;font-size:14px;">Your dispute has been reviewed by our team.</p>
    <div style="background:#f9fafb;border-radius:12px;padding:16px;margin:16px 0;">
      <p style="margin:0;font-size:13px;color:#374151;"><strong>Resolution:</strong> ${resolution || 'No additional notes.'}</p>
    </div>
    <a href="${SITE_URL}/profile" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;">View My Purchases →</a>
  </div></div>`;
}

function tplLicenseKey(
  productTitle: string,
  licenseKey: string,
  licenseId: string,
  expiresAt: number,
  maxActivations: number
): string {
  const expiry = expiresAt === 0 ? 'Lifetime (never expires)' : new Date(expiresAt).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const maxAct  = maxActivations === 0 ? 'Unlimited' : String(maxActivations);

  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:28px;text-align:center;">
    <div style="font-size:36px;margin-bottom:6px;">🔑</div>
    <h1 style="color:#fff;margin:0;font-size:20px;font-weight:800;">Your License Key</h1>
    <p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:13px;">${productTitle}</p>
  </div>
  <div style="padding:24px;">
    <p style="color:#374151;font-size:13px;margin:0 0 16px;">Thank you for your purchase! Keep this key safe — you will need it to activate the software.</p>
    <div style="background:#f9fafb;border:2px dashed #d1d5db;border-radius:12px;padding:18px;text-align:center;margin-bottom:18px;">
      <p style="margin:0 0 4px;font-size:10px;color:#9ca3af;font-weight:600;letter-spacing:1px;text-transform:uppercase;">License Key</p>
      <p style="margin:0;font-size:18px;font-weight:900;font-family:monospace;color:#111;letter-spacing:2px;">${licenseKey}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
      <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:6px 0;color:#6b7280;font-size:12px;">Activations allowed</td><td style="padding:6px 0;color:#111;font-size:12px;font-weight:600;text-align:right;">${maxAct}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:12px;">Valid until</td><td style="padding:6px 0;color:#111;font-size:12px;font-weight:600;text-align:right;">${expiry}</td></tr>
    </table>
    <a href="${SITE_URL}/my-licenses" style="display:block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px;border-radius:10px;font-weight:700;font-size:13px;text-align:center;">View All My Licenses →</a>
  </div></div>`;
}

// Try env var first, then fallback options
// If one RPC fails, try switching to another in your .env
const NETWORK_URL = process.env.SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443';

const RPC_FALLBACKS = [
  'https://fullnode.testnet.sui.io:443',
  'https://testnet.suiet.app',
  'https://rpc-testnet.suiscan.xyz:443',
  'https://sui-testnet-endpoint.blockvision.org',
];
const PACKAGE_ID = process.env.PACKAGE_ID!;
const MARKETPLACE_ID = process.env.MARKETPLACE_ID!;
const POLL_INTERVAL = 5000;

const suiClient = new SuiClient({ url: NETWORK_URL });

console.log('✅ Sui Client connected to testnet');
console.log(`📦 Package ID: ${PACKAGE_ID}`);
console.log(`🏪 Marketplace ID: ${MARKETPLACE_ID}`);

// ── Cursor helpers ────────────────────────────────────────────────────────────

async function getSavedCursor(): Promise<any | null> {
  const result = await pool.query(
    'SELECT last_event_cursor FROM indexer_state WHERE id = 1'
  );
  const raw = result.rows[0]?.last_event_cursor;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function saveCursor(cursor: any) {
  await pool.query(
    `UPDATE indexer_state SET last_event_cursor = $1, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000 WHERE id = 1`,
    [JSON.stringify(cursor)]
  );
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function handleProductListed(event: any) {
  const parsedJson = event.parsedJson as any;
  const productId  = parsedJson.product_id;
  const seller     = parsedJson.seller;
  const price      = parsedJson.price;
  const timestamp  = parsedJson.timestamp;

  console.log(`📦 ProductListed: ${productId}`);

  try {
    const productObject = await suiClient.getObject({
      id: productId,
      options: { showContent: true },
    });

    if (!productObject.data?.content) {
      console.warn(`⚠️  No content for product ${productId}`);
      return;
    }

    const fields = (productObject.data.content as any).fields;

    const title             = fields.name             || '';
    const description       = fields.description      || '';
    const imageUrl          = fields.image_url        || '';
    const category          = fields.category         || 'Other';
    const quantityAvailable = Number(fields.quantity_available) || 1;
    const isActive          = fields.is_active        !== false;
    const resellable        = fields.resellable       || false;
    const fileCid           = fields.file_cid         || '';

    console.log(`   Title: ${title} | Resellable: ${resellable} | File: ${fileCid}`);

    await pool.query(
      `INSERT INTO products (
         id, seller, title, description, price, image_url, category,
         is_available, total_sales, rating_sum, rating_count,
         quantity, available_quantity, resellable, file_cid,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
       ON CONFLICT (id) DO UPDATE SET
         title              = EXCLUDED.title,
         description        = EXCLUDED.description,
         price              = EXCLUDED.price,
         image_url          = EXCLUDED.image_url,
         category           = EXCLUDED.category,
         is_available       = EXCLUDED.is_available,
         quantity           = EXCLUDED.quantity,
         available_quantity = EXCLUDED.available_quantity,
         resellable         = EXCLUDED.resellable,
         file_cid           = EXCLUDED.file_cid,
         updated_at         = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000`,
      [
        productId, seller, title, description, price, imageUrl, category,
        isActive, 0, 0, 0, quantityAvailable, quantityAvailable,
        resellable, fileCid, Number(timestamp),
      ]
    );

    await pool.query(
      `INSERT INTO sellers (address, display_name, total_sales, total_revenue, follower_count, is_banned, created_at)
       VALUES ($1, '', 0, 0, 0, FALSE, $2) ON CONFLICT (address) DO NOTHING`,
      [seller, Number(timestamp)]
    );

    console.log(`✅ Product stored: ${title}`);
  } catch (error) {
    console.error(`❌ Error handling ProductListed for ${productId}:`, error);
  }
}

async function handleProductPurchased(event: any) {
  const parsedJson  = event.parsedJson as any;
  const productId   = parsedJson.product_id;
  const buyer       = parsedJson.buyer;
  const seller      = parsedJson.seller;
  const price       = parsedJson.price;
  const platformFee = parsedJson.platform_fee;
  const timestamp   = parsedJson.timestamp;
  const quantity    = Number(parsedJson.quantity) || 1;
  const purchaseId  = `${event.id.txDigest}-${event.id.eventSeq}`;

  console.log(`💰 ProductPurchased: ${productId} by ${buyer}`);

  // Update product quantity
  await pool.query(
    `UPDATE products
     SET available_quantity = GREATEST(available_quantity - $1, 0),
         is_available = CASE WHEN (available_quantity - $1) <= 0 THEN FALSE ELSE is_available END,
         total_sales = total_sales + $1,
         updated_at  = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
     WHERE id = $2`,
    [quantity, productId]
  );

  // Record purchase
  await pool.query(
    `INSERT INTO purchases (product_id, buyer, seller, price, platform_fee, tx_digest, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tx_digest) DO NOTHING`,
    [productId, buyer, seller, price, platformFee, event.id.txDigest, Number(timestamp)]
  );

  // Update seller stats
  await pool.query(
    `UPDATE sellers SET total_sales = total_sales + 1, total_revenue = total_revenue + $1, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000 WHERE address = $2`,
    [price, seller]
  );

  // ── Email seller about sale ────────────────────────────────────────────
  try {
    const sellerRow = await pool.query(
      'SELECT email, display_name FROM sellers WHERE address = $1',
      [seller]
    );
    const productRow = await pool.query('SELECT title FROM products WHERE id = $1', [productId]);
    if (sellerRow.rows[0]?.email && productRow.rows[0]) {
      const priceSUI = (Number(price) / 1e9).toFixed(3);
      await sendEmail(
        sellerRow.rows[0].email,
        `💰 You sold "${productRow.rows[0].title}" for ${priceSUI} SUI`,
        tplSale(productRow.rows[0].title, buyer, priceSUI, event.id.txDigest)
      );
    }
  } catch (emailErr: any) { console.error('Sale email error:', emailErr?.message); }

  // ── Create ownership token for resellable products ──────────────────────
  const productCheck = await pool.query(
    'SELECT resellable, file_cid FROM products WHERE id = $1',
    [productId]
  );

  if (productCheck.rows.length > 0 && productCheck.rows[0].resellable) {
    console.log(`🎫 Creating ownership token for resellable product: ${productId}`);

    // Query the buyer's owned OwnershipToken objects to get the real on-chain token ID
    let tokenId: string | null = null;

    try {
      const ownedObjects = await suiClient.getOwnedObjects({
        owner: buyer,
        filter: {
          StructType: `${PACKAGE_ID}::marketplace::OwnershipToken`,
        },
        options: { showContent: true },
      });

      // Find the token for this specific product
      const matchingToken = ownedObjects.data.find((obj) => {
        const content = obj.data?.content as any;
        return content?.fields?.original_product_id === productId;
      });

      if (matchingToken?.data?.objectId) {
        tokenId = matchingToken.data.objectId;
        console.log(`   Found on-chain token: ${tokenId}`);
      }
    } catch (err) {
      console.warn(`   Could not fetch on-chain token, generating synthetic ID`);
    }

    // Fallback: generate a deterministic token ID if on-chain query fails
    if (!tokenId) {
      tokenId = `${event.id.txDigest}_${productId}_${buyer}`.slice(0, 66);
      console.log(`   Using synthetic token ID: ${tokenId}`);
    }

    await pool.query(
      `INSERT INTO ownership_tokens (
         token_id, original_product_id, current_owner,
         previous_owner, original_seller, purchase_price,
         purchase_timestamp, is_listed_for_resale, resale_price, file_cid
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,false,0,$8)
       ON CONFLICT (token_id) DO NOTHING`,
      [
        tokenId,
        productId,
        buyer,
        seller,    // previous_owner = original seller
        seller,    // original_seller
        price,
        Number(timestamp),
        productCheck.rows[0].file_cid || '',
      ]
    );

    console.log(`✅ Ownership token created: ${tokenId}`);
  }

  console.log(`✅ Purchase recorded: ${purchaseId}`);
}

async function handleProductReviewed(event: any) {
  const parsedJson = event.parsedJson as any;
  const productId  = parsedJson.product_id;
  const reviewer   = parsedJson.reviewer;
  const rating     = parsedJson.rating;
  const comment    = parsedJson.comment || '';
  const timestamp  = parsedJson.timestamp;

  console.log(`⭐ ProductReviewed: ${productId} by ${reviewer}`);

  await pool.query(
    `INSERT INTO reviews (product_id, reviewer, rating, comment, created_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (product_id, reviewer) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment`,
    [productId, reviewer, rating, comment, Number(timestamp)]
  );

  await pool.query(
    `UPDATE products
     SET rating_sum   = (SELECT COALESCE(SUM(rating), 0) FROM reviews WHERE product_id = $1),
         rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = $1),
         updated_at   = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
     WHERE id = $1`,
    [productId]
  );

  console.log(`✅ Review recorded`);
}

async function handleSellerProfileCreated(event: any) {
  const parsedJson = event.parsedJson as any;
  console.log(`👤 SellerProfileCreated: ${parsedJson.seller}`);

  await pool.query(
    `INSERT INTO sellers (address, display_name, total_sales, total_revenue, follower_count, is_banned, created_at)
     VALUES ($1, '', 0, 0, 0, FALSE, $2) ON CONFLICT (address) DO NOTHING`,
    [parsedJson.seller, Number(parsedJson.timestamp) || Date.now()]
  );

  console.log(`✅ Seller profile created`);
}

async function handleResaleListed(event: any) {
  const fields = event.parsedJson as any;
  console.log(`📋 ResaleListed: ${fields.listing_id}`);

  // Ensure ownership token exists before inserting resale listing
  // (may be missing if ProductPurchased event failed earlier)
  await pool.query(
    `INSERT INTO ownership_tokens (
       token_id, original_product_id, current_owner,
       previous_owner, original_seller, purchase_price,
       purchase_timestamp, is_listed_for_resale, resale_price,
       file_cid, created_at, updated_at
     ) VALUES ($1,$2,$3,$3,$3,0,0,true,$4,'',$5,$5)
     ON CONFLICT (token_id) DO UPDATE SET
       is_listed_for_resale = true,
       resale_price = EXCLUDED.resale_price,
       updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000`,
    [
      fields.token_id,              // $1 token_id
      fields.original_product_id || '', // $2 original_product_id
      fields.seller,                // $3 current_owner, previous_owner, original_seller
      Number(fields.price),         // $4 resale_price
      Number(fields.timestamp),     // $5 created_at, updated_at
    ]
  );

  // Now safe to insert resale listing — FK will be satisfied
  await pool.query(
    `INSERT INTO resale_listings (listing_id, token_id, seller, price, original_product_id, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,true,$6,0)
     ON CONFLICT (listing_id) DO UPDATE SET price = EXCLUDED.price, is_active = true`,
    [fields.listing_id, fields.token_id, fields.seller, fields.price, fields.original_product_id || '', Number(fields.timestamp)]
  );

  console.log(`✅ Resale listing stored`);
}

async function handleResalePurchased(event: any) {
  const fields    = event.parsedJson as any;
  const purchaseId = `${event.id.txDigest}-${event.id.eventSeq}`;
  console.log(`💰 ResalePurchased: token ${fields.token_id}`);

  await pool.query(
    `UPDATE resale_listings SET is_active = false WHERE listing_id = $1`,
    [fields.listing_id]
  );

  await pool.query(
    `UPDATE ownership_tokens
     SET current_owner = $1, previous_owner = $2,
         is_listed_for_resale = false, resale_price = 0,
         purchase_price = $3, purchase_timestamp = $4
     WHERE token_id = $5`,
    [fields.buyer, fields.seller, fields.price, Number(fields.timestamp), fields.token_id]
  );

  // New buyer gets a purchase record so they can download
  await pool.query(
    `INSERT INTO purchases (product_id, buyer, seller, price, platform_fee, tx_digest, created_at)
     VALUES ($1,$2,$3,$4,0,$5,$6) ON CONFLICT (tx_digest) DO NOTHING`,
    [fields.original_product_id, fields.buyer, fields.seller, fields.price, event.id.txDigest, Number(fields.timestamp)]
  );

  console.log(`✅ Resale purchase recorded`);
}

async function handleResaleDelisted(event: any) {
  const fields = event.parsedJson as any;
  console.log(`🗑️ ResaleDelisted: ${fields.listing_id}`);

  await pool.query(
    `UPDATE resale_listings SET is_active = false WHERE listing_id = $1`,
    [fields.listing_id]
  );

  // ✅ Mark token as no longer listed so it can be found again
  await pool.query(
    `UPDATE ownership_tokens 
     SET is_listed_for_resale = false, resale_price = 0 
     WHERE token_id = $1`,
    [fields.token_id]
  );

  console.log(`✅ Resale delisted, token available again`);
}


// ── License key generation ─────────────────────────────────────────────────
const KEY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 32 chars, no ambiguous (0,O,I,1,L)

function generateLicenseKey(licenseId: string, txDigest: string, buyerAddress: string): string {
  const seed = `${licenseId}:${txDigest}:${buyerAddress}`;
  const hash = crypto.createHash('sha256').update(seed).digest();

  const chars: string[] = [];
  for (let i = 0; i < 25; i++) {
    chars.push(KEY_CHARS[hash[i % hash.length] % 32]);
  }

  return [
    chars.slice(0,  5).join(''),
    chars.slice(5,  10).join(''),
    chars.slice(10, 15).join(''),
    chars.slice(15, 20).join(''),
    chars.slice(20, 25).join(''),
  ].join('-');
}

async function generateUniqueLicenseKey(licenseId: string, txDigest: string, buyerAddress: string): Promise<string> {
  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? '' : `:attempt${attempt}`;
    const key = generateLicenseKey(licenseId, txDigest + suffix, buyerAddress);

    const existing = await pool.query('SELECT id FROM licenses WHERE license_key = $1', [key]);
    if (existing.rows.length === 0) return key;

    attempt++;
    if (attempt > 10) throw new Error('Could not generate unique license key after 10 attempts');
  }
}

// ── handleLicenseIssued ────────────────────────────────────────────────────
async function handleLicenseIssued(event: any) {
  const f = event.parsedJson as any;

  const licenseId   = f.license_id as string;
  const productId   = f.product_id as string;
  const owner       = f.owner as string;
  const licenseType = Number(f.license_type);
  const expiresAt   = Number(f.expires_at);
  const timestamp   = Number(f.timestamp);
  const txDigest    = event.id.txDigest as string;

  console.log(`🔑 LicenseIssued: ${licenseId} → owner ${owner}`);

  try {
    const productRow = await pool.query(
      `SELECT seller, title, license_max_activations, license_renewal_price FROM products WHERE id = $1`,
      [productId]
    );

    const seller         = productRow.rows[0]?.seller                  || '';
    const productTitle   = productRow.rows[0]?.title                   || 'your product';
    const maxActivations = productRow.rows[0]?.license_max_activations || 1;
    const renewalPrice   = productRow.rows[0]?.license_renewal_price   || 0;

    const licenseKey = await generateUniqueLicenseKey(licenseId, txDigest, owner);

    await pool.query(
      `INSERT INTO licenses (
         license_id, license_key, product_id, buyer_address, seller_address,
         tx_digest, license_type, max_activations, current_activations,
         expiry_timestamp, renewal_price, status, renewal_count, issue_timestamp
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,'active',0,$11)
       ON CONFLICT (license_id) DO NOTHING`,
      [licenseId, licenseKey, productId, owner, seller, txDigest,
       licenseType, maxActivations, expiresAt, renewalPrice, timestamp]
    );

    // Email buyer their license key
    try {
      const buyerEmailRow = await pool.query('SELECT email FROM sellers WHERE address = $1', [owner]);
      if (buyerEmailRow.rows[0]?.email) {
        await sendEmail(
          buyerEmailRow.rows[0].email,
          `🔑 Your license key for "${productTitle}"`,
          tplLicenseKey(productTitle, licenseKey, licenseId, expiresAt, maxActivations)
        );
      }
    } catch (emailErr: any) {
      console.error('License email error:', emailErr?.message);
    }

    console.log(`✅ License key generated: ${licenseKey}`);
  } catch (error: any) {
    console.error(`❌ Error handling LicenseIssued ${licenseId}:`, error?.message);
  }
}

// ── handleLicenseActivated ─────────────────────────────────────────────────
async function handleLicenseActivated(event: any) {
  const f = event.parsedJson as any;

  const licenseId       = f.license_id as string;
  const deviceId        = f.device_id as string;
  const activationsUsed = Number(f.activations_used);
  const timestamp       = Number(f.timestamp);

  console.log(`🔑 LicenseActivated: ${licenseId} device=${deviceId}`);

  try {
    await pool.query(
      `UPDATE licenses SET current_activations = $1, updated_at = NOW() WHERE license_id = $2`,
      [activationsUsed, licenseId]
    );

    await pool.query(
      `INSERT INTO license_activations (license_id, device_id, activated_at, is_active)
       VALUES ($1,$2,$3,true)
       ON CONFLICT (license_id, device_id)
       DO UPDATE SET activated_at = $3, deactivated_at = NULL, is_active = true`,
      [licenseId, deviceId, timestamp]
    );

    console.log(`✅ Activation recorded (total: ${activationsUsed})`);
  } catch (error: any) {
    console.error(`❌ Error handling LicenseActivated ${licenseId}:`, error?.message);
  }
}

// ── handleLicenseRenewed ───────────────────────────────────────────────────
async function handleLicenseRenewed(event: any) {
  const f = event.parsedJson as any;

  const licenseId = f.license_id as string;
  const newExpiry = Number(f.new_expires_at);
  const timestamp = Number(f.timestamp);

  console.log(`♻️  LicenseRenewed: ${licenseId} → expires ${new Date(newExpiry).toLocaleDateString()}`);

  try {
    const current = await pool.query(
      'SELECT expiry_timestamp, renewal_count, buyer_address, renewal_price FROM licenses WHERE license_id = $1',
      [licenseId]
    );

    if (current.rows.length === 0) {
      console.error(`❌ License not found for renewal: ${licenseId}`);
      return;
    }

    const { expiry_timestamp: oldExpiry, renewal_count, buyer_address, renewal_price } = current.rows[0];
    const newRenewalCount = (renewal_count || 0) + 1;

    await pool.query(
      `UPDATE licenses SET expiry_timestamp = $1, status = 'active', renewal_count = $2, updated_at = NOW() WHERE license_id = $3`,
      [newExpiry, newRenewalCount, licenseId]
    );

    await pool.query(
      `INSERT INTO license_renewals (license_id, buyer_address, amount_paid, tx_digest, old_expiry, new_expiry, renewal_number, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [licenseId, buyer_address, renewal_price || 0, event.id.txDigest, oldExpiry || 0, newExpiry, newRenewalCount, timestamp]
    );

    console.log(`✅ Renewal recorded (count: ${newRenewalCount})`);
  } catch (error: any) {
    console.error(`❌ Error handling LicenseRenewed ${licenseId}:`, error?.message);
  }
}

// ── handleLicenseRevoked ───────────────────────────────────────────────────
async function handleLicenseRevoked(event: any) {
  const licenseId = event.parsedJson?.license_id as string;

  console.log(`🚫 LicenseRevoked: ${licenseId}`);

  try {
    await pool.query(`UPDATE licenses SET status = 'revoked', updated_at = NOW() WHERE license_id = $1`, [licenseId]);
    await pool.query(
      `UPDATE license_activations SET is_active = false, deactivated_at = $1 WHERE license_id = $2 AND is_active = true`,
      [Date.now(), licenseId]
    );
    console.log(`✅ License revoked`);
  } catch (error: any) {
    console.error(`❌ Error handling LicenseRevoked ${licenseId}:`, error?.message);
  }
}

// ── Main polling loop ─────────────────────────────────────────────────────────

async function processEvents() {
  try {
    let cursor: any    = await getSavedCursor();
    let hasNextPage    = true;
    let totalProcessed = 0;

    while (hasNextPage) {
      const events = await suiClient.queryEvents({
        query: { MoveEventModule: { package: PACKAGE_ID, module: 'marketplace' } },
        cursor,
        order: 'ascending',
        limit: 50,
      });

      if (!events.data || events.data.length === 0) break;

      console.log(`\n📊 Fetched ${events.data.length} events`);

      for (const suiEvent of events.data) {
        const eventType = suiEvent.type.split('::').pop();

        switch (eventType) {
          case 'ProductListed':        await handleProductListed(suiEvent);        break;
          case 'ProductPurchased':     await handleProductPurchased(suiEvent);     break;
          case 'ProductReviewed':      await handleProductReviewed(suiEvent);      break;
          case 'SellerProfileCreated': await handleSellerProfileCreated(suiEvent); break;
          case 'ResaleListed':         await handleResaleListed(suiEvent);         break;
          case 'ResalePurchased':      await handleResalePurchased(suiEvent);      break;
          case 'ResaleDelisted':       await handleResaleDelisted(suiEvent);       break;
          case 'LicenseIssued':        await handleLicenseIssued(suiEvent);        break;
          case 'LicenseActivated':     await handleLicenseActivated(suiEvent);     break;
          case 'LicenseRenewed':       await handleLicenseRenewed(suiEvent);       break;
          case 'LicenseRevoked':       await handleLicenseRevoked(suiEvent);       break;
          default: console.log(`ℹ️  Unknown event: ${eventType}`);
        }

        totalProcessed++;
      }

      if (events.nextCursor) {
        cursor = events.nextCursor;
        await saveCursor(cursor);
      }

      hasNextPage = events.hasNextPage;
    }

    if (totalProcessed > 0) console.log(`\n✅ Processed ${totalProcessed} events total`);
  } catch (error: any) {
    if (error.status === 504 || error.status === 503) {
      console.log('⚠️  RPC timeout, retrying...');
      return;
    }
    console.error('❌ Error processing events:', error);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function startIndexer() {
  console.log('\n🚀 Starting Sui Blockchain Indexer...\n');

  await initializeDatabase();

  // Ensure last_event_cursor column exists (safe to run on existing DBs)
  await pool.query(`ALTER TABLE indexer_state ADD COLUMN IF NOT EXISTS last_event_cursor TEXT`);

  // Seed the single indexer_state row if it doesn't exist yet
  await pool.query(`
    INSERT INTO indexer_state (id, updated_at)
    VALUES (1, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000) ON CONFLICT (id) DO NOTHING
  `);

  // Ensure resale tables exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resale_listings (
      listing_id TEXT PRIMARY KEY,
      token_id TEXT NOT NULL,
      seller TEXT NOT NULL,
      price BIGINT NOT NULL,
      original_product_id TEXT NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at BIGINT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ownership_tokens (
      token_id TEXT PRIMARY KEY,
      original_product_id TEXT NOT NULL,
      current_owner TEXT NOT NULL,
      previous_owner TEXT,
      original_seller TEXT NOT NULL,
      purchase_price BIGINT,
      purchase_timestamp BIGINT,
      is_listed_for_resale BOOLEAN DEFAULT false,
      resale_price BIGINT DEFAULT 0,
      file_cid TEXT,
      created_at BIGINT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log('🔄 Running initial event sync...');
  await processEvents();

  console.log(`\n⏱  Polling every ${POLL_INTERVAL / 1000}s for new events...\n`);
  setInterval(async () => {
    console.log('🔄 Polling...');
    await processEvents();
  }, POLL_INTERVAL);
}

startIndexer().catch(console.error);