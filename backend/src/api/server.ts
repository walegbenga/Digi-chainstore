/**
 * Express REST API Server
 * Serves blockchain data from PostgreSQL
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PinataSDK } from 'pinata-web3';
import multer from 'multer';
import { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
const rateLimit = require('express-rate-limit');
import { pool } from '../config/database';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Trust Railway/Vercel proxy so rate limiter and IP detection work correctly
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    process.env.FRONTEND_URL || '',
    /\.vercel\.app$/,
  ].filter(Boolean),
  credentials: true,
}));
app.use(express.json());

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit (for video uploads)
});

// Initialize Pinata
const PINATA_JWT = process.env.PINATA_JWT || process.env.PINATA_API_KEY || '';
if (!PINATA_JWT) {
  console.error('⚠️  WARNING: No Pinata JWT found. Set PINATA_JWT in environment variables.');
} else {
  const segments = PINATA_JWT.split('.').length;
  if (segments !== 3) {
    console.error(`⚠️  WARNING: PINATA_JWT looks malformed (${segments} segments, expected 3).`);
  } else {
    console.log('✅ Pinata JWT loaded successfully');
  }
}

const pinata = new PinataSDK({
  pinataJwt: PINATA_JWT,
  pinataGateway: 'gateway.pinata.cloud'
});

// ✅ INPUT VALIDATION HELPERS
const sanitizeAddress = (address: string): string => {
  // FIX: allow up to 66 hex chars (some Sui object IDs can be 63-64 hex chars)
  if (!/^0x[a-fA-F0-9]{1,66}$/.test(address)) {
    console.error('sanitizeAddress failed for:', address, 'length:', address.length);
    throw new Error('Invalid address format');
  }
  return address.toLowerCase();
};

const sanitizeString = (str: string, maxLength: number = 1000): string => {
  if (typeof str !== 'string') {
    throw new Error('Input must be a string');
  }
  const cleaned = str.replace(/<[^>]*>/g, '').trim();
  return cleaned.substring(0, maxLength);
};

const sanitizeNumber = (num: any, min: number = 0, max: number = Number.MAX_SAFE_INTEGER): number => {
  const parsed = Number(num);
  if (isNaN(parsed) || parsed < min || parsed > max) {
    throw new Error(`Number must be between ${min} and ${max}`);
  }
  return parsed;
};

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many uploads, please try again later.',
});

const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many reviews, please try again later.',
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== Product Endpoints ====================

// Get all products with filters
app.get('/api/products', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      category, 
      available, 
      minPrice, 
      maxPrice, 
      search,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    let whereConditions = [];
    let queryParams: any[] = [];
    let paramIndex = 1;

    if (category) {
      whereConditions.push(`category = $${paramIndex}`);
      queryParams.push(category);
      paramIndex++;
    }

    whereConditions.push(`seller NOT IN (SELECT address FROM sellers WHERE is_banned = true)`);

    if (available !== undefined) {
      whereConditions.push(`is_available = $${paramIndex}`);
      queryParams.push(available === 'true');
      paramIndex++;
    }

    if (minPrice !== undefined && minPrice !== null && minPrice !== '') {
      const minPriceNum = Number(minPrice);
      if (!isNaN(minPriceNum)) {
        whereConditions.push(`price >= $${paramIndex}`);
        queryParams.push(minPriceNum);
        paramIndex++;
      }
    }

    if (maxPrice !== undefined && maxPrice !== null && maxPrice !== '') {
      const maxPriceNum = Number(maxPrice);
      if (!isNaN(maxPriceNum)) {
        whereConditions.push(`price <= $${paramIndex}`);
        queryParams.push(maxPriceNum);
        paramIndex++;
      }
    }

    if (search) {
      whereConditions.push(`(
        title ILIKE $${paramIndex} OR 
        description ILIKE $${paramIndex} OR 
        category ILIKE $${paramIndex}
      )`);
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    const validSortColumns = ['created_at', 'price', 'total_sales', 'title'];
    const sortColumn = validSortColumns.includes(sortBy as string) ? sortBy : 'created_at';
    const order = sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM products ${whereClause}`,
      queryParams
    );
    const totalCount = parseInt(countResult.rows[0].total);

    const result = await pool.query(
      `SELECT * FROM products 
       ${whereClause}
       ORDER BY ${sortColumn} ${order}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...queryParams, Number(limit), offset]
    );

    res.json({
      products: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / Number(limit)),
      },
    });
  } catch (error: any) {
    console.error('Error fetching products::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch products', detail: error.message });
  }
});

// ==================== FIX: Specific named routes BEFORE /:id ====================

// Search products
app.get('/api/products/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const result = await pool.query(
      `SELECT * FROM products 
       WHERE to_tsvector('english', title || ' ' || description) @@ plainto_tsquery('english', $1)
       AND is_available = true
       AND seller NOT IN (SELECT address FROM sellers WHERE is_banned = true)
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [query, Number(limit), offset]
    );

    res.json({ products: result.rows });
  } catch (error: any) {
    console.error('Error searching products::', error.message || error);
    res.status(500).json({ error: 'Failed to search products', detail: error.message });
  }
});

// FIX: Trending moved ABOVE /:id so Express matches it correctly
app.get('/api/products/trending', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const result = await pool.query(
      `SELECT p.*, COUNT(pu.id) as recent_sales
       FROM products p
       LEFT JOIN purchases pu ON p.id = pu.product_id 
         AND pu.created_at > (EXTRACT(EPOCH FROM NOW()) - 604800) * 1000
       WHERE p.is_available = true
       GROUP BY p.id
       ORDER BY recent_sales DESC, p.total_sales DESC
       LIMIT $1`,
      [Number(limit)]
    );

    res.json({ products: result.rows });
  } catch (error: any) {
    console.error('Error fetching trending products::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch trending products', detail: error.message });
  }
});

// Get single product by ID
app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        id, seller, title, description, price, image_url, category,
        is_available, total_sales, rating_sum, rating_count,
        quantity, available_quantity, resellable, file_cid, created_at
       FROM products 
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error fetching product::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch product', detail: error.message });
  }
});

// Update product
app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, price, image_url, category, seller, quantity, resellable } = req.body;

    const product = await pool.query('SELECT seller FROM products WHERE id = $1', [id]);
    if (product.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    if (product.rows[0].seller !== seller) {
      return res.status(403).json({ error: 'Not authorized to edit this product' });
    }

    await pool.query(
      `UPDATE products 
       SET title = $1, description = $2, price = $3, image_url = $4, category = $5, 
           quantity = $6, resellable = $7, available_quantity = $6,
           updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
       WHERE id = $8`,
      [title, description, price, image_url, category, quantity, resellable, id]
    );

    res.json({ message: 'Product updated successfully' });
  } catch (error: any) {
    console.error('Error updating product::', error.message || error);
    res.status(500).json({ error: 'Failed to update product', detail: error.message });
  }
});

// Delete product (soft delete)
app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { seller } = req.body;

    const productCheck = await pool.query(
      'SELECT seller FROM products WHERE id = $1',
      [id]
    );

    if (productCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (productCheck.rows[0].seller !== seller) {
      return res.status(403).json({ error: 'Not authorized to delete this product' });
    }

    await pool.query(
      `UPDATE products 
       SET is_available = false, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
       WHERE id = $1`,
      [id]
    );

    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting product::', error.message || error);
    res.status(500).json({ error: 'Failed to delete product', detail: error.message });
  }
});

// Get products by seller
app.get('/api/sellers/:address/products', async (req, res) => {
  try {
    const { address } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const result = await pool.query(
      `SELECT * FROM products 
       WHERE seller = $1 
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [address, Number(limit), offset]
    );

    res.json({ products: result.rows });
  } catch (error: any) {
    console.error('Error fetching seller products:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch seller products', detail: error.message });
  }
});

// ==================== Seller Endpoints ====================

app.get('/api/sellers/top', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const result = await pool.query(
      `SELECT * FROM sellers 
       WHERE is_banned = false
       ORDER BY total_sales DESC, total_revenue DESC
       LIMIT $1`,
      [Number(limit)]
    );

    res.json({ sellers: result.rows });
  } catch (error: any) {
    console.error('Error fetching top sellers::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch top sellers', detail: error.message });
  }
});

app.get('/api/sellers/:address', async (req, res) => {
  try {
    const { address } = req.params;

    const result = await pool.query(
      'SELECT * FROM sellers WHERE address = $1',
      [address]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    if (result.rows[0]?.is_banned) {
      return res.status(403).json({ error: 'This seller account has been suspended.' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error fetching seller::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch seller', detail: error.message });
  }
});

// Seller profile update
app.put('/api/sellers/:address/profile', async (req: any, res: any) => {
  try {
    const { address } = req.params;
    const { display_name, bio, avatar_url, twitter_handle, website_url, email } = req.body;

    await pool.query(
      `INSERT INTO sellers (address, display_name, bio, avatar_url, twitter_handle, website_url, email, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       ON CONFLICT (address) DO UPDATE SET
         display_name   = EXCLUDED.display_name,
         bio            = EXCLUDED.bio,
         avatar_url     = EXCLUDED.avatar_url,
         twitter_handle = EXCLUDED.twitter_handle,
         website_url    = EXCLUDED.website_url,
         email          = EXCLUDED.email,
         updated_at     = EXCLUDED.updated_at`,
      [address,
       (display_name || '').trim().slice(0, 50),
       (bio || '').trim().slice(0, 500),
       (avatar_url || '').trim(),
       (twitter_handle || '').replace('@','').trim().slice(0, 50),
       (website_url || '').trim().slice(0, 200),
       (email || '').trim().toLowerCase().slice(0, 200),
       Date.now()]
    );

    const result = await pool.query(
      'SELECT * FROM sellers WHERE address = $1',
      [address]
    );
    if (result.rows[0]?.is_banned) {
      return res.status(403).json({ error: 'This seller account has been suspended.' });
    }
    res.json({ seller: result.rows[0] });
  } catch (error: any) {
    console.error('Seller profile update error:', error.message);
    res.status(500).json({ error: 'Failed to update profile', detail: error.message });
  }
});

// GET reviews for a seller's products
app.get('/api/sellers/:address/reviews', async (req: any, res: any) => {
  try {
    const { address } = req.params;
    const result = await pool.query(
      `SELECT r.*, p.title AS product_title, p.id AS product_id
       FROM reviews r
       JOIN products p ON p.id = r.product_id
       WHERE p.seller = $1
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [address]
    );
    res.json({ reviews: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch reviews', detail: error.message });
  }
});

// Get seller analytics
app.get('/api/sellers/:address/analytics', async (req, res) => {
  try {
    const { address } = req.params;

    const productStats = await pool.query(
      `SELECT 
        COUNT(*) as total_products,
        COUNT(*) FILTER (WHERE is_available = true) as available_products,
        COUNT(*) FILTER (WHERE is_available = false) as sold_products,
        AVG(price) as avg_price,
        SUM(total_sales) as total_sales_count
       FROM products 
       WHERE seller = $1`,
      [address]
    );

    const revenueByMonth = await pool.query(
      `SELECT 
        TO_CHAR(TO_TIMESTAMP(created_at / 1000), 'YYYY-MM') as month,
        COUNT(*) as sales,
        SUM(price) as revenue
       FROM purchases 
       WHERE seller = $1
       GROUP BY month
       ORDER BY month DESC
       LIMIT 12`,
      [address]
    );

    const topProducts = await pool.query(
      `SELECT id, title, total_sales, price, rating_sum, rating_count
       FROM products 
       WHERE seller = $1
       ORDER BY total_sales DESC
       LIMIT 5`,
      [address]
    );

    const recentSales = await pool.query(
      `SELECT p.id, p.title, p.price, pur.created_at, pur.buyer
       FROM purchases pur
       JOIN products p ON pur.product_id = p.id
       WHERE pur.seller = $1
       ORDER BY pur.created_at DESC
       LIMIT 10`,
      [address]
    );

    res.json({
      stats: productStats.rows[0],
      revenueByMonth: revenueByMonth.rows,
      topProducts: topProducts.rows,
      recentSales: recentSales.rows,
    });
  } catch (error: any) {
    console.error('Error fetching analytics::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch analytics', detail: error.message });
  }
});

// Get followers of a seller
app.get('/api/sellers/:address/followers', async (req, res) => {
  try {
    const { address } = req.params;

    const result = await pool.query(
      `SELECT follower_address, created_at
       FROM followers
       WHERE seller_address = $1
       ORDER BY created_at DESC`,
      [address]
    );

    res.json({ followers: result.rows });
  } catch (error: any) {
    console.error('Error fetching followers::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch followers', detail: error.message });
  }
});

// ==================== Review Endpoints ====================

app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const result = await pool.query(
      `SELECT * FROM reviews 
       WHERE product_id = $1 
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, Number(limit), offset]
    );

    res.json({ reviews: result.rows });
  } catch (error: any) {
    console.error('Error fetching reviews::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch reviews', detail: error.message });
  }
});

// Submit a review
app.post('/api/reviews', reviewLimiter, async (req, res) => {
  try {
    const { product_id, reviewer, rating, comment } = req.body;

    if (!product_id || !reviewer || !rating) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let cleanProductId: string;
    let cleanReviewer: string;
    let cleanRating: number;
    let cleanComment: string;

    try {
      cleanProductId = sanitizeAddress(product_id);
      cleanReviewer = sanitizeAddress(reviewer);
      cleanRating = sanitizeNumber(rating, 1, 5);
      cleanComment = sanitizeString(comment || '', 1000);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }

    const purchaseCheck = await pool.query(
      'SELECT * FROM purchases WHERE product_id = $1 AND buyer = $2',
      [cleanProductId, cleanReviewer]
    );

    if (purchaseCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must purchase this product before reviewing' });
    }

    const reviewCheck = await pool.query(
      'SELECT * FROM reviews WHERE product_id = $1 AND reviewer = $2',
      [cleanProductId, cleanReviewer]
    );

    if (reviewCheck.rows.length > 0) {
      return res.status(400).json({ error: 'You have already reviewed this product' });
    }

    await pool.query(
      `INSERT INTO reviews (product_id, reviewer, rating, comment, created_at)
       VALUES ($1, $2, $3, $4, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)`,
      [cleanProductId, cleanReviewer, cleanRating, cleanComment]
    );

    await pool.query(
      `UPDATE products 
       SET rating_sum = rating_sum + $1,
           rating_count = rating_count + 1
       WHERE id = $2`,
      [cleanRating, cleanProductId]
    );

    res.json({ success: true, message: 'Review submitted successfully' });
  } catch (error: any) {
    console.error('Error submitting review::', error.message || error);
    res.status(500).json({ error: 'Failed to submit review', detail: error.message });
  }
});

// ==================== Analytics Endpoints ====================

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM products) as total_products,
        (SELECT COUNT(*) FROM products WHERE is_available = true) as available_products,
        (SELECT COUNT(*) FROM sellers) as total_sellers,
        (SELECT COUNT(*) FROM purchases) as total_purchases,
        (SELECT COALESCE(SUM(price), 0) FROM purchases) as total_volume,
        (SELECT COUNT(*) FROM reviews) as total_reviews
    `);

    res.json(stats.rows[0]);
  } catch (error: any) {
    console.error('Error fetching stats::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch stats', detail: error.message });
  }
});

// ==================== Categories ====================

app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT category, COUNT(*) as count 
       FROM products 
       WHERE is_available = true
       GROUP BY category 
       ORDER BY count DESC`
    );

    res.json({ categories: result.rows });
  } catch (error: any) {
    console.error('Error fetching categories::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch categories', detail: error.message });
  }
});

// ==================== Purchase Endpoints ====================

app.get('/api/purchases/:address', async (req, res) => {
  try {
    const { address } = req.params;

    const result = await pool.query(
      `SELECT pu.*, p.title, p.image_url, p.category, p.file_cid, p.seller
       FROM purchases pu
       LEFT JOIN products p ON p.id = pu.product_id
       WHERE pu.buyer = $1
       ORDER BY pu.created_at DESC`,
      [address]
    );

    res.json({ purchases: result.rows });
  } catch (error: any) {
    console.error('Error fetching purchases::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch purchases', detail: error.message });
  }
});

// ==================== Social Features Endpoints ====================

app.post('/api/sellers/:address/follow', async (req, res) => {
  try {
    const { address } = req.params;
    const { followerAddress } = req.body;

    if (!followerAddress) {
      return res.status(400).json({ error: 'Follower address required' });
    }

    await pool.query(
      `INSERT INTO followers (follower_address, seller_address, created_at)
       VALUES ($1, $2, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
       ON CONFLICT (follower_address, seller_address) DO NOTHING`,
      [followerAddress, address]
    );

    await pool.query(
      `UPDATE sellers 
       SET follower_count = (SELECT COUNT(*) FROM followers WHERE seller_address = $1)
       WHERE address = $1`,
      [address]
    );

    res.json({ success: true, message: 'Followed successfully' });
  } catch (error: any) {
    console.error('Error following seller::', error.message || error);
    res.status(500).json({ error: 'Failed to follow seller', detail: error.message });
  }
});

app.delete('/api/sellers/:address/follow', async (req, res) => {
  try {
    const { address } = req.params;
    const { followerAddress } = req.body;

    if (!followerAddress) {
      return res.status(400).json({ error: 'Follower address required' });
    }

    await pool.query(
      `DELETE FROM followers 
       WHERE follower_address = $1 AND seller_address = $2`,
      [followerAddress, address]
    );

    await pool.query(
      `UPDATE sellers 
       SET follower_count = (SELECT COUNT(*) FROM followers WHERE seller_address = $1)
       WHERE address = $1`,
      [address]
    );

    res.json({ success: true, message: 'Unfollowed successfully' });
  } catch (error: any) {
    console.error('Error unfollowing seller::', error.message || error);
    res.status(500).json({ error: 'Failed to unfollow seller', detail: error.message });
  }
});

app.get('/api/sellers/:address/following/:userAddress', async (req, res) => {
  try {
    const { address, userAddress } = req.params;

    const result = await pool.query(
      `SELECT EXISTS(
        SELECT 1 FROM followers 
        WHERE follower_address = $1 AND seller_address = $2
      ) as is_following`,
      [userAddress, address]
    );

    res.json({ isFollowing: result.rows[0].is_following });
  } catch (error: any) {
    console.error('Error checking follow status::', error.message || error);
    res.status(500).json({ error: 'Failed to check follow status', detail: error.message });
  }
});

app.get('/api/users/:address/following', async (req, res) => {
  try {
    const { address } = req.params;

    const result = await pool.query(
      `SELECT s.*, f.created_at as followed_at
       FROM sellers s
       JOIN followers f ON s.address = f.seller_address
       WHERE f.follower_address = $1
       ORDER BY f.created_at DESC`,
      [address]
    );

    res.json({ following: result.rows });
  } catch (error: any) {
    console.error('Error fetching following::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch following', detail: error.message });
  }
});

// ==================== Favorites/Wishlist Endpoints ====================

app.post('/api/favorites', async (req, res) => {
  try {
    const { userAddress, productId } = req.body;

    if (!userAddress || !productId) {
      return res.status(400).json({ error: 'User address and product ID required' });
    }

    await pool.query(
      `INSERT INTO favorites (user_address, product_id, created_at)
       VALUES ($1, $2, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
       ON CONFLICT (user_address, product_id) DO NOTHING`,
      [userAddress, productId]
    );

    res.json({ success: true, message: 'Added to favorites' });
  } catch (error: any) {
    console.error('Error adding to favorites::', error.message || error);
    res.status(500).json({ error: 'Failed to add to favorites', detail: error.message });
  }
});

app.delete('/api/favorites', async (req, res) => {
  try {
    const { userAddress, productId } = req.body;

    if (!userAddress || !productId) {
      return res.status(400).json({ error: 'User address and product ID required' });
    }

    await pool.query(
      `DELETE FROM favorites 
       WHERE user_address = $1 AND product_id = $2`,
      [userAddress, productId]
    );

    res.json({ success: true, message: 'Removed from favorites' });
  } catch (error: any) {
    console.error('Error removing from favorites::', error.message || error);
    res.status(500).json({ error: 'Failed to remove from favorites', detail: error.message });
  }
});

app.get('/api/users/:address/favorites', async (req, res) => {
  try {
    const { address } = req.params;

    const result = await pool.query(
      `SELECT 
        p.id as product_id,
        p.title,
        p.price,
        p.image_url,
        p.category,
        p.seller,
        p.is_available,
        p.total_sales,
        p.rating_sum,
        p.rating_count,
        p.resellable,
        p.file_cid,
        f.created_at as favorited_at
       FROM products p
       JOIN favorites f ON p.id = f.product_id
       WHERE f.user_address = $1
       ORDER BY f.created_at DESC`,
      [address]
    );

    res.json({ favorites: result.rows });
  } catch (error: any) {
    console.error('Error fetching favorites::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch favorites', detail: error.message });
  }
});

app.get('/api/favorites/check/:userAddress/:productId', async (req, res) => {
  try {
    const { userAddress, productId } = req.params;

    const result = await pool.query(
      `SELECT EXISTS(
        SELECT 1 FROM favorites 
        WHERE user_address = $1 AND product_id = $2
      ) as is_favorited`,
      [userAddress, productId]
    );

    res.json({ isFavorited: result.rows[0].is_favorited });
  } catch (error: any) {
    console.error('Error checking favorite status::', error.message || error);
    res.status(500).json({ error: 'Failed to check favorite status', detail: error.message });
  }
});

// ==================== Download Endpoints ====================

const crypto = require('crypto');

const downloadTokens = new Map<string, { file_cid: string; file_name: string; expires: number }>();

setInterval(() => {
  const now = Date.now();
  downloadTokens.forEach((val, key) => { if (val.expires < now) downloadTokens.delete(key); });
}, 10 * 60 * 1000);

// Step 1: Get signed download token
app.get('/api/download/:productId/:buyerAddress', async (req, res) => {
  try {
    const { productId, buyerAddress } = req.params;

    let cleanProductId: string;
    let cleanBuyerAddress: string;
    try {
      cleanProductId    = sanitizeAddress(productId);
      cleanBuyerAddress = sanitizeAddress(buyerAddress);
    } catch (error: any) {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    const purchase = await pool.query(
      'SELECT id FROM purchases WHERE product_id = $1 AND buyer = $2',
      [cleanProductId, cleanBuyerAddress]
    );
    if (purchase.rows.length === 0) {
      return res.status(403).json({ error: 'You must purchase this product to download' });
    }

    const product = await pool.query(
      'SELECT file_cid, file_name FROM products WHERE id = $1',
      [cleanProductId]
    );
    if (product.rows.length === 0 || !product.rows[0].file_cid) {
      return res.status(404).json({ error: 'File not found' });
    }

    const { file_cid, file_name } = product.rows[0];

    const token   = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 300_000; // 5 minutes
    downloadTokens.set(token, { file_cid, file_name, expires });

    res.json({
      token,
      url: `/api/download/file/${token}`,
      expires_in: 300,
    });
  } catch (error: any) {
    console.error('Download token error:', error.message);
    res.status(500).json({ error: 'Failed to generate download link', detail: error.message });
  }
});

// Step 2: Serve file bytes using token
app.get('/api/download/file/:token', async (req: any, res: any) => {
  try {
    const { token } = req.params;

    const entry = downloadTokens.get(token);
    if (!entry) {
      return res.status(400).json({ error: 'Invalid or expired download link. Click Download again.' });
    }
    if (entry.expires < Date.now()) {
      downloadTokens.delete(token);
      return res.status(400).json({ error: 'Download link expired. Click Download again.' });
    }

    // Consume token
    downloadTokens.delete(token);

    const { file_cid, file_name } = entry;

    const fileRes = await fetch(
      `https://gateway.pinata.cloud/ipfs/${file_cid}`,
      { headers: { 'Authorization': `Bearer ${process.env.PINATA_JWT}` } }
    );

    if (!fileRes.ok) {
      return res.status(502).json({ error: 'Could not retrieve file from storage' });
    }

    const contentType   = fileRes.headers.get('content-type')   || 'application/octet-stream';
    const contentLength = fileRes.headers.get('content-length');
    const safeName      = (file_name || 'download').replace(/[^a-zA-Z0-9._-]/g, '_');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const arrayBuffer = await fileRes.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (error: any) {
    console.error('Download GET error:', error.message);
    res.status(500).json({ error: 'Download failed', detail: error.message });
  }
});

// ==================== Upload Endpoint ====================

app.post('/api/upload', uploadLimiter, upload.single('file'), async (req: Request, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { seller } = req.body;
    
    let cleanSeller: string;
    try {
      cleanSeller = sanitizeAddress(seller);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }

    const allowedTypes = [
      'application/pdf',
      'application/zip', 'application/x-zip-compressed',
      'application/x-rar-compressed', 'application/x-7z-compressed',
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
      'video/mp4', 'video/avi', 'video/x-msvideo', 'video/quicktime',
      'video/x-matroska', 'video/webm', 'video/x-ms-wmv', 'video/mpeg',
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg',
      'audio/flac', 'audio/x-flac',
      'text/plain', 'text/html', 'text/css',
      'application/json', 'application/javascript',
    ];

    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ 
        error: 'File type not allowed',
        received: req.file.mimetype,
      });
    }

    const isVideo = req.file.mimetype.startsWith('video/');
    const MAX_SIZE = isVideo ? 500 * 1024 * 1024 : 100 * 1024 * 1024;
    if (req.file.size > MAX_SIZE) {
      return res.status(400).json({ 
        error: `File size exceeds limit. Max: ${isVideo ? '500MB for video' : '100MB'}`,
      });
    }

    console.log(`📤 Uploading file: ${req.file.originalname} (${req.file.mimetype}, ${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

    const { Blob: NodeBlob } = require('buffer');
    const fileBlob = new NodeBlob([req.file.buffer], { type: req.file.mimetype });
    const fileForUpload = Object.assign(fileBlob, {
      name: req.file.originalname,
      lastModified: Date.now(),
    });

    const result = await pinata.upload.file(fileForUpload as any);

    console.log(`✅ File uploaded to IPFS: ${result.IpfsHash}`);

    res.json({
      cid: result.IpfsHash,
      fileName: req.file.originalname,
      fileSize: req.file.size,
    });

  } catch (error: any) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ error: 'Failed to upload file', details: error.message });
  }
});

// ==================== Resale Listings ====================

// FIX: Specific route BEFORE generic one
app.get('/api/resale-listings/user/:userAddress/:productId', async (req, res) => {
  try {
    const { userAddress, productId } = req.params;

    const result = await pool.query(
      `SELECT * FROM resale_listings 
       WHERE seller = $1 
         AND original_product_id = $2 
         AND is_active = true
       LIMIT 1`,
      [userAddress, productId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ listing: null });
    }

    res.json({ listing: result.rows[0] });
  } catch (error: any) {
    console.error('Error checking user listing::', error.message || error);
    res.status(500).json({ error: 'Failed to check user listing', detail: error.message });
  }
});

app.get('/api/resale-listings', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        rl.listing_id, rl.token_id, rl.seller, rl.price,
        rl.original_product_id, rl.is_active, rl.created_at,
        p.title        AS product_title,
        p.image_url    AS product_image,
        p.category     AS product_category,
        p.description  AS product_description,
        p.seller       AS original_seller
       FROM resale_listings rl
       LEFT JOIN products p ON p.id = rl.original_product_id
       WHERE rl.is_active = true
       ORDER BY rl.created_at DESC`
    );

    res.json({ listings: result.rows });
  } catch (error: any) {
    console.error('Error fetching resale listings::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch resale listings', detail: error.message });
  }
});

app.get('/api/ownership-token/:productId/:userAddress', async (req, res) => {
  try {
    const { productId, userAddress } = req.params;

    const result = await pool.query(
      'SELECT token_id FROM ownership_tokens WHERE original_product_id = $1 AND current_owner = $2 AND is_listed_for_resale = false',
      [productId, userAddress]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ownership token not found' });
    }

    res.json({ tokenId: result.rows[0].token_id });
  } catch (error: any) {
    console.error('Error fetching ownership token::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch ownership token', detail: error.message });
  }
});

// ==================== Admin Endpoints ====================

function disputeEmailHtml(productTitle: string, reason: string, buyerAddress: string): string {
  const siteUrl = process.env.FRONTEND_URL || 'https://digi-chainstore.vercel.app';
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid #e5e7eb;">
  <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:28px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">⚖️ Dispute Raised</h1>
  </div>
  <div style="padding:24px;">
    <p style="color:#374151;font-size:14px;">A buyer raised a dispute. Please respond within 48 hours.</p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;margin:16px 0;">
      <p style="margin:4px 0;font-size:13px;color:#6b7280;">Product: <strong>${productTitle}</strong></p>
      <p style="margin:4px 0;font-size:13px;color:#dc2626;font-weight:600;">Reason: ${reason.replace(/_/g,' ')}</p>
      <p style="margin:4px 0;font-size:12px;color:#9ca3af;font-family:monospace;">Buyer: ${buyerAddress.slice(0,16)}...${buyerAddress.slice(-6)}</p>
    </div>
    <a href="${siteUrl}/analytics" style="display:inline-block;background:#dc2626;color:#fff;padding:10px 20px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;">View Dashboard</a>
  </div></div>`;
}

const requireAdmin = (req: any, res: any, next: any) => {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.get('/api/admin/overview', requireAdmin, async (req: any, res: any) => {
  try {
    const [stats, revenueRow, recentRow, topSellers] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM products)                          AS total_products,
          (SELECT COUNT(*) FROM products WHERE is_available=true)  AS active_products,
          (SELECT COUNT(*) FROM sellers)                           AS total_sellers,
          (SELECT COUNT(*) FROM purchases)                         AS total_purchases,
          (SELECT COALESCE(SUM(price),0) FROM purchases)           AS total_volume,
          (SELECT COUNT(*) FROM disputes)                          AS total_disputes,
          (SELECT COUNT(*) FROM disputes WHERE status='open')      AS open_disputes,
          (SELECT COUNT(*) FROM support_messages)                  AS total_messages,
          (SELECT COUNT(*) FROM support_messages WHERE status='open') AS open_messages,
          (SELECT COUNT(*) FROM reviews)                           AS total_reviews
      `),
      pool.query(`
        SELECT
          TO_CHAR(TO_TIMESTAMP(created_at/1000),'YYYY-MM') AS month,
          COUNT(*)                                           AS sales,
          COALESCE(SUM(price),0)                            AS revenue
        FROM purchases
        GROUP BY month ORDER BY month DESC LIMIT 6
      `),
      pool.query(`
        SELECT p.id, p.title, p.price, pu.buyer, pu.created_at
        FROM purchases pu
        JOIN products p ON p.id = pu.product_id
        ORDER BY pu.created_at DESC LIMIT 10
      `),
      pool.query(`
        SELECT s.address, s.display_name, s.total_sales, s.total_revenue, s.is_banned,
               COUNT(p.id) AS product_count
        FROM sellers s
        LEFT JOIN products p ON p.seller = s.address
        GROUP BY s.address ORDER BY s.total_revenue DESC LIMIT 10
      `),
    ]);

    res.json({
      stats:       stats.rows[0],
      revenue:     revenueRow.rows,
      recentSales: recentRow.rows,
      topSellers:  topSellers.rows,
    });
  } catch (error: any) {
    console.error('Admin overview error:', error.message);
    res.status(500).json({ error: 'Failed to fetch admin overview', detail: error.message });
  }
});

app.get('/api/admin/sellers', requireAdmin, async (req: any, res: any) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const whereClause = search ? `WHERE s.address ILIKE $3 OR s.display_name ILIKE $3` : '';
    const params: any[] = [Number(limit), offset];
    if (search) params.push(`%${search}%`);

    const [sellers, countRow] = await Promise.all([
      pool.query(
        `SELECT s.*, COUNT(p.id) AS product_count
         FROM sellers s
         LEFT JOIN products p ON p.seller = s.address
         ${whereClause}
         GROUP BY s.address
         ORDER BY s.created_at DESC
         LIMIT $1 OFFSET $2`,
        params
      ),
      pool.query(
        `SELECT COUNT(DISTINCT s.address) FROM sellers s ${whereClause}`,
        search ? [`%${search}%`] : []
      ),
    ]);

    res.json({
      sellers: sellers.rows,
      total:   Number(countRow.rows[0].count),
      pages:   Math.ceil(Number(countRow.rows[0].count) / Number(limit)),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch sellers', detail: error.message });
  }
});

app.patch('/api/admin/sellers/:address', requireAdmin, async (req: any, res: any) => {
  try {
    const { is_banned } = req.body;
    await pool.query(`UPDATE sellers SET is_banned = $1 WHERE address = $2`, [is_banned, req.params.address]);
    if (is_banned) {
      await pool.query(`UPDATE products SET is_available = false WHERE seller = $1`, [req.params.address]);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update seller', detail: error.message });
  }
});

app.get('/api/admin/products', requireAdmin, async (req: any, res: any) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params: any[] = [Number(limit), offset];
    const whereClause = search ? `WHERE p.title ILIKE $3 OR p.seller ILIKE $3` : '';
    if (search) params.push(`%${search}%`);

    const [products, countRow] = await Promise.all([
      pool.query(
        `SELECT p.*, s.display_name AS seller_name
         FROM products p
         LEFT JOIN sellers s ON s.address = p.seller
         ${whereClause}
         ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM products p ${whereClause}`, search ? [`%${search}%`] : []),
    ]);

    res.json({
      products: products.rows,
      total:    Number(countRow.rows[0].count),
      pages:    Math.ceil(Number(countRow.rows[0].count) / Number(limit)),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch products', detail: error.message });
  }
});

app.patch('/api/admin/products/:id', requireAdmin, async (req: any, res: any) => {
  try {
    const { is_available } = req.body;
    await pool.query(
      `UPDATE products SET is_available = $1, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000 WHERE id = $2`,
      [is_available, req.params.id]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update product', detail: error.message });
  }
});

app.get('/api/admin/disputes', requireAdmin, async (req: any, res: any) => {
  try {
    const { status = '' } = req.query;
    const where = status ? `WHERE d.status = $1` : '';
    const result = await pool.query(
      `SELECT d.*, p.title AS product_title, p.price AS product_price
       FROM disputes d
       LEFT JOIN purchases pu ON pu.tx_digest = d.tx_digest
       LEFT JOIN products p  ON p.id = pu.product_id
       ${where}
       ORDER BY d.created_at DESC LIMIT 100`,
      status ? [status] : []
    );
    res.json({ disputes: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch disputes', detail: error.message });
  }
});

app.patch('/api/admin/disputes/:id', requireAdmin, async (req: any, res: any) => {
  try {
    const { status, resolution } = req.body;
    await pool.query(
      `UPDATE disputes SET status=$1, resolution=$2, updated_at=$3 WHERE id=$4`,
      [status, resolution || null, Date.now(), req.params.id]
    );

    try {
      const disputeRow = await pool.query('SELECT buyer_address FROM disputes WHERE id = $1', [req.params.id]);
      if (disputeRow.rows[0]) {
        const buyerAddr = disputeRow.rows[0].buyer_address;
        const buyerRow  = await pool.query('SELECT email FROM sellers WHERE address = $1', [buyerAddr]);
        if (buyerRow.rows[0]?.email) {
          const won = status === 'resolved';
          const RESEND_KEY = process.env.RESEND_API_KEY;
          const FROM = process.env.FROM_EMAIL || 'noreply@digichainstore.com';
          const siteUrl = process.env.FRONTEND_URL || 'https://digi-chainstore.vercel.app';
          const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;">
            <h1>${won ? '✅ Dispute Resolved' : '❌ Dispute Closed'}</h1>
            <p><strong>Resolution:</strong> ${resolution || 'No notes provided.'}</p>
            <a href="${siteUrl}/profile">View My Purchases</a>
          </div>`;
          if (RESEND_KEY) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ from: FROM, to: buyerRow.rows[0].email, subject: won ? '✅ Your dispute has been resolved' : '❌ Your dispute has been closed', html }),
            });
          }
        }
      }
    } catch (emailErr: any) { console.error('Resolve email error:', emailErr?.message); }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update dispute', detail: error.message });
  }
});

app.get('/api/admin/messages', requireAdmin, async (req: any, res: any) => {
  try {
    const result = await pool.query(`SELECT * FROM support_messages ORDER BY created_at DESC LIMIT 100`);
    res.json({ messages: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch messages', detail: error.message });
  }
});

app.patch('/api/admin/messages/:id', requireAdmin, async (req: any, res: any) => {
  try {
    const { status } = req.body;
    await pool.query(`UPDATE support_messages SET status=$1 WHERE id=$2`, [status, req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update message', detail: error.message });
  }
});

// ==================== Support Endpoints ====================

app.post('/api/support/contact', async (req, res) => {
  try {
    const { name, email, subject, message, wallet } = req.body;
    if (!email || !message) return res.status(400).json({ error: 'Email and message required' });

    await pool.query(
      `INSERT INTO support_messages (name, email, subject, message, wallet_address, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [name || 'Anonymous', email, subject || 'Support Request', message, wallet || null, Date.now()]
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Support contact error:', error.message);
    res.status(500).json({ error: 'Failed to send message', detail: error.message });
  }
});

app.post('/api/support/dispute', async (req, res) => {
  try {
    const { tx_digest, reason, description, wallet } = req.body;
    if (!tx_digest || !reason || !description || !wallet)
      return res.status(400).json({ error: 'All fields required' });

    const purchase = await pool.query(
      'SELECT * FROM purchases WHERE tx_digest = $1 AND buyer = $2',
      [tx_digest, wallet]
    );

    await pool.query(
      `INSERT INTO disputes (tx_digest, buyer_address, reason, description, status, created_at)
       VALUES ($1,$2,$3,$4,'open',$5)
       ON CONFLICT (tx_digest) DO UPDATE SET
         reason      = EXCLUDED.reason,
         description = EXCLUDED.description,
         updated_at  = $5`,
      [tx_digest, wallet, reason, description, Date.now()]
    );

    try {
      const purchaseRow = await pool.query(
        'SELECT product_id, seller FROM purchases WHERE tx_digest = $1',
        [tx_digest]
      );
      if (purchaseRow.rows[0]) {
        const { product_id, seller: sellerAddr } = purchaseRow.rows[0];
        const [sellerRow, productRow] = await Promise.all([
          pool.query('SELECT email FROM sellers WHERE address = $1', [sellerAddr]),
          pool.query('SELECT title FROM products WHERE id = $1', [product_id]),
        ]);
        if (sellerRow.rows[0]?.email && productRow.rows[0]) {
          const emailHtml = disputeEmailHtml(productRow.rows[0].title, reason, wallet);
          const RESEND_KEY = process.env.RESEND_API_KEY;
          const FROM = process.env.FROM_EMAIL || 'noreply@digichainstore.com';
          if (RESEND_KEY) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ from: FROM, to: sellerRow.rows[0].email, subject: '⚖️ A dispute was raised on your product', html: emailHtml }),
            });
          }
        }
      }
    } catch (emailErr: any) { console.error('Dispute email error:', emailErr?.message); }

    res.json({ success: true, purchase_found: purchase.rows.length > 0 });
  } catch (error: any) {
    console.error('Dispute error:', error.message);
    res.status(500).json({ error: 'Failed to submit dispute', detail: error.message });
  }
});

app.get('/api/support/disputes', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

    const result = await pool.query('SELECT * FROM disputes ORDER BY created_at DESC LIMIT 100');
    res.json({ disputes: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch disputes', detail: error.message });
  }
});

app.patch('/api/support/disputes/:id', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

    const { status, resolution } = req.body;
    await pool.query(
      `UPDATE disputes SET status = $1, resolution = $2, updated_at = $3 WHERE id = $4`,
      [status, resolution || null, Date.now(), req.params.id]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update dispute', detail: error.message });
  }
});

// ==================== Start Server ====================

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 API Server running on 0.0.0.0:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🛍️  Products API: http://localhost:${PORT}/api/products`);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down API server...');
  await pool.end();
  process.exit(0);
});