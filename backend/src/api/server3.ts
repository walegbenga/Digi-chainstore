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
// Support both PINATA_JWT and PINATA_API_KEY env var names
const PINATA_JWT = process.env.PINATA_JWT || process.env.PINATA_API_KEY || '';
if (!PINATA_JWT) {
  console.error('⚠️  WARNING: No Pinata JWT found. Set PINATA_JWT in environment variables.');
} else {
  // Validate it looks like a JWT (3 segments separated by dots)
  const segments = PINATA_JWT.split('.').length;
  if (segments !== 3) {
    console.error(`⚠️  WARNING: PINATA_JWT looks malformed (${segments} segments, expected 3). Check your Railway env vars.`);
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
  // Sui addresses are 66 characters starting with 0x
  if (!/^0x[a-fA-F0-9]{64}$/.test(address)) {
    throw new Error('Invalid address format');
  }
  return address.toLowerCase();
};

const sanitizeString = (str: string, maxLength: number = 1000): string => {
  if (typeof str !== 'string') {
    throw new Error('Input must be a string');
  }
  // Remove any HTML/script tags
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
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit uploads to 10 per hour
  message: 'Too many uploads, please try again later.',
});

const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit reviews to 5 per hour
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

    // Build WHERE clause
    let whereConditions = [];
    let queryParams: any[] = [];
    let paramIndex = 1;

    // Category filter
    if (category) {
      whereConditions.push(`category = $${paramIndex}`);
      queryParams.push(category);
      paramIndex++;
    }

    // Always exclude products from banned sellers
    whereConditions.push(`seller NOT IN (SELECT address FROM sellers WHERE is_banned = true)`);

    // Available filter
    if (available !== undefined) {
      whereConditions.push(`is_available = $${paramIndex}`);
      queryParams.push(available === 'true');
      paramIndex++;
    }

    // Price range filter (expects values in MIST)
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

    // Search filter
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

    // Validate sort column
    const validSortColumns = ['created_at', 'price', 'total_sales', 'title'];
    const sortColumn = validSortColumns.includes(sortBy as string) ? sortBy : 'created_at';
    const order = sortOrder === 'ASC' ? 'ASC' : 'DESC';

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM products ${whereClause}`,
      queryParams
    );
    const totalCount = parseInt(countResult.rows[0].total);

    // Get products
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
        totalCount: totalCount,
        totalPages: Math.ceil(totalCount / Number(limit)),
      },
    });
  } catch (error: any) {
    console.error('Error fetching products::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch products', detail: error.message });
  }
});

// Get single product by ID
app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, price, image_url, category, seller, quantity, resellable } = req.body;

    // Verify ownership
    const product = await pool.query('SELECT seller FROM products WHERE id = $1', [id]);
    if (product.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    if (product.rows[0].seller !== seller) {
      return res.status(403).json({ error: 'Not authorized to edit this product' });
    }

    // Update product
    await pool.query(
      `UPDATE products 
       SET title = $1, description = $2, price = $3, image_url = $4, category = $5, 
           quantity = $6, resellable = $7, available_quantity = $6
       WHERE id = $8`,
      [title, description, price, image_url, category, quantity, resellable, id]
    );

    res.json({ message: 'Product updated successfully' });
  } catch (error: any) {
    console.error('Error updating product::', error.message || error);
    res.status(500).json({ error: 'Failed to update product', detail: error.message });
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

// Get single product by ID
/*app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM products WHERE id = $1`,
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
});*/

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

// Get seller profile
// Get top sellers
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
    if (result.rows[0]?.is_banned) {
      return res.status(403).json({ error: 'This seller account has been suspended.' });
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error fetching seller::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch seller', detail: error.message });
  }
});



// ==================== Review Endpoints ====================

// Get reviews for a product
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

// ==================== Analytics Endpoints ====================

// Get marketplace stats
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

// Get trending products (most sales in last 7 days)
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

// ==================== Categories ====================

// Get all categories
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

// Get purchases by buyer
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

// Follow a seller
app.post('/api/sellers/:address/follow', async (req, res) => {
  try {
    const { address } = req.params;
    const { followerAddress } = req.body;

    if (!followerAddress) {
      return res.status(400).json({ error: 'Follower address required' });
    }

    // Insert follower relationship
    await pool.query(
      `INSERT INTO followers (follower_address, seller_address, created_at)
       VALUES ($1, $2, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
       ON CONFLICT (follower_address, seller_address) DO NOTHING`,
      [followerAddress, address]
    );

    // Update seller follower count
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

// Unfollow a seller
app.delete('/api/sellers/:address/follow', async (req, res) => {
  try {
    const { address } = req.params;
    const { followerAddress } = req.body;

    if (!followerAddress) {
      return res.status(400).json({ error: 'Follower address required' });
    }

    // Remove follower relationship
    await pool.query(
      `DELETE FROM followers 
       WHERE follower_address = $1 AND seller_address = $2`,
      [followerAddress, address]
    );

    // Update seller follower count
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

// Check if user is following a seller
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

// Get user's followed sellers
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

// Add product to favorites
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

// Remove product from favorites
app.delete('/api/favorites', async (req, res) => {
  try {
    console.log('DELETE /api/favorites body:', req.body); // ← ADD THIS

    const { userAddress, productId } = req.body;

    if (!userAddress || !productId) {
      console.log('Missing fields:', { userAddress, productId }); // ← ADD THIS
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

// Get user's favorite products
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

// Check if product is favorited
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

// ==================== Review Endpoints ====================

// Submit a review
/*app.post('/api/reviews', async (req, res) => {
  try {
    const { productId, buyerAddress, rating, comment } = req.body;

    console.log('Review submission:', { productId, buyerAddress, rating, comment });

    if (!productId || !buyerAddress || !rating) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user has purchased this product
    const purchaseCheck = await pool.query(
      'SELECT * FROM purchases WHERE product_id = $1 AND buyer = $2',
      [productId, buyerAddress]
    );

    if (purchaseCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must purchase this product before reviewing' });
    }

    // Check if user already reviewed
    const reviewCheck = await pool.query(
      'SELECT * FROM reviews WHERE product_id = $1 AND reviewer = $2',
      [productId, buyerAddress]
    );

    if (reviewCheck.rows.length > 0) {
      return res.status(400).json({ error: 'You have already reviewed this product' });
    }

    // Insert review
    await pool.query(
      `INSERT INTO reviews (product_id, reviewer, rating, comment, created_at)
       VALUES ($1, $2, $3, $4, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)`,
      [productId, buyerAddress, rating, comment || '']
    );

    // Update product rating
    await pool.query(
      `UPDATE products 
       SET rating_sum = rating_sum + $1,
           rating_count = rating_count + 1
       WHERE id = $2`,
      [rating, productId]
    );

    res.json({ success: true, message: 'Review submitted successfully' });
  } catch (error: any) {
    console.error('Error submitting review::', error.message || error);
    res.status(500).json({ error: 'Failed to submit review', detail: error.message });
  }
});
*/

// Submit a review - WITH SECURITY
app.post('/api/reviews', reviewLimiter, async (req, res) => {
  try {
    const { product_id, reviewer, rating, comment } = req.body;

    console.log('Review submission:', { product_id, reviewer, rating, comment });

    // ✅ VALIDATE & SANITIZE
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

    // Check if user has purchased this product
    const purchaseCheck = await pool.query(
      'SELECT * FROM purchases WHERE product_id = $1 AND buyer = $2',
      [cleanProductId, cleanReviewer]
    );

    if (purchaseCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must purchase this product before reviewing' });
    }

    // Check if user already reviewed
    const reviewCheck = await pool.query(
      'SELECT * FROM reviews WHERE product_id = $1 AND reviewer = $2',
      [cleanProductId, cleanReviewer]
    );

    if (reviewCheck.rows.length > 0) {
      return res.status(400).json({ error: 'You have already reviewed this product' });
    }

    // Insert review with sanitized data
    await pool.query(
      `INSERT INTO reviews (product_id, reviewer, rating, comment, created_at)
       VALUES ($1, $2, $3, $4, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)`,
      [cleanProductId, cleanReviewer, cleanRating, cleanComment]
    );

    // Update product rating
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
// Get reviews for a product
/*app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM reviews 
       WHERE product_id = $1 
       ORDER BY created_at DESC`,
      [id]
    );

    res.json({ reviews: result.rows });
  } catch (error: any) {
    console.error('Error fetching reviews::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch reviews', detail: error.message });
  }
});*/

// ==================== Product Management Endpoints ====================

// Update product (off-chain only - for price, description, image updates)
app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, price, image_url, category, seller } = req.body;

    // Verify seller owns the product
    const productCheck = await pool.query(
      'SELECT seller FROM products WHERE id = $1',
      [id]
    );

    if (productCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (productCheck.rows[0].seller !== seller) {
      return res.status(403).json({ error: 'Not authorized to edit this product' });
    }

    // Update product
    await pool.query(
      `UPDATE products 
       SET title = $1, description = $2, price = $3, image_url = $4, category = $5, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
       WHERE id = $6`,
      [title, description, price, image_url, category, id]
    );

    res.json({ success: true, message: 'Product updated successfully' });
  } catch (error: any) {
    console.error('Error updating product::', error.message || error);
    res.status(500).json({ error: 'Failed to update product', detail: error.message });
  }
});

// Delete product (soft delete - mark as unavailable)
app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { seller } = req.body;

    // Verify seller owns the product
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

    // Soft delete - mark as unavailable
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

// Get seller analytics
app.get('/api/sellers/:address/analytics', async (req, res) => {
  try {
    const { address } = req.params;

    // Get product stats
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

    // Get revenue by time period
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

    // Get top products
    const topProducts = await pool.query(
      `SELECT id, title, total_sales, price, rating_sum, rating_count
       FROM products 
       WHERE seller = $1
       ORDER BY total_sales DESC
       LIMIT 5`,
      [address]
    );

    // Get recent sales
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

// Get followers of a seller (who follows this seller)
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


// Download file (only for buyers)
// ✅ CONSISTENT NAMING: Use buyerAddress everywhere

// ✅ SINGLE DOWNLOAD ROUTE - With Security & Hidden URL
// ── Download endpoint with signed token (prevents URL sharing) ──────────────
// Step 1: GET /api/download/:productId/:buyerAddress  → returns a signed token
// Step 2: GET /api/download/file/:token               → validates token, returns IPFS url

const crypto = require('crypto');

// In-memory token store (token → { file_cid, file_name, expires })
// For production with multiple instances use Redis; fine for single-instance Railway
const downloadTokens = new Map<string, { file_cid: string; file_name: string; expires: number }>();

// Clean expired tokens every 10 minutes
setInterval(() => {
  const now = Date.now();
  downloadTokens.forEach((val, key) => { if (val.expires < now) downloadTokens.delete(key); });
}, 10 * 60 * 1000);

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

    // Verify purchase
    const purchase = await pool.query(
      'SELECT id FROM purchases WHERE product_id = $1 AND buyer = $2',
      [cleanProductId, cleanBuyerAddress]
    );
    if (purchase.rows.length === 0) {
      return res.status(403).json({ error: 'You must purchase this product to download' });
    }

    // Get file info
    const product = await pool.query(
      'SELECT file_cid, file_name FROM products WHERE id = $1',
      [cleanProductId]
    );
    if (product.rows.length === 0 || !product.rows[0].file_cid) {
      return res.status(404).json({ error: 'File not found' });
    }

    const { file_cid, file_name } = product.rows[0];

    // Generate a one-time signed token valid for 60 seconds
    const token   = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 60_000; // 60 seconds
    downloadTokens.set(token, { file_cid, file_name, expires });

    // Return the token URL — frontend opens this to download
    res.json({
      token,
      url: `/api/download/file/${token}`,
      expires_in: 60,
    });
  } catch (error: any) {
    console.error('Download token error:', error.message);
    res.status(500).json({ error: 'Failed to generate download link', detail: error.message });
  }
});

// Step 2: Redeem token → proxy file from Pinata (IPFS URL never exposed to client)
app.get('/api/download/file/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const entry = downloadTokens.get(token);

    if (!entry) {
      return res.status(403).json({ error: 'Invalid or expired download link. Please request a new one.' });
    }
    if (entry.expires < Date.now()) {
      downloadTokens.delete(token);
      return res.status(403).json({ error: 'Download link has expired. Please request a new one.' });
    }

    // Consume token — one-time use
    downloadTokens.delete(token);

    const { file_cid, file_name } = entry;

    // Proxy the file through our server — client never sees the Pinata/IPFS URL
    // Node 18+ native fetch — buffer the response and send it
    const fileRes = await fetch(`https://gateway.pinata.cloud/ipfs/${file_cid}`);

    if (!fileRes.ok) {
      return res.status(502).json({ error: 'Could not fetch file from storage' });
    }

    const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
    const contentLength = fileRes.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file_name || 'download'}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    // Read as ArrayBuffer → Buffer → send (Web API fetch has no .pipe())
    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.end(buffer);
  } catch (error: any) {
    console.error('Download file error:', error.message);
    res.status(500).json({ error: 'Download failed', detail: error.message });
  }
});
// Upload file to IPFS
/*app.post('/api/upload', upload.single('file'), async (req: Request, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { seller } = req.body;
    if (!seller) {
      return res.status(400).json({ error: 'Seller address required' });
    }

    console.log(`📤 Uploading file: ${req.file.originalname}`);
    console.log(`   Type: ${req.file.mimetype}`);
    console.log(`   Size: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

    // Fix TypeScript Buffer type error by explicitly converting to Uint8Array
    const uint8Array = new Uint8Array(req.file.buffer.buffer, req.file.buffer.byteOffset, req.file.buffer.byteLength);

    const blob = new Blob([uint8Array.buffer as ArrayBuffer], {
  type: req.file.mimetype || 'application/octet-stream',
});

    const file = new File([blob], req.file.originalname, {
      type: req.file.mimetype || 'application/octet-stream',
      lastModified: Date.now(),
    });

    console.log(`📦 File object created, size: ${file.size} bytes`);

    // Upload to Pinata
    const result = await pinata.upload.file(file);

    console.log(`✅ File uploaded to IPFS: ${result.IpfsHash}`);

    res.json({
      cid: result.IpfsHash,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      url: `https://gateway.pinata.cloud/ipfs/${result.IpfsHash}`,
    });

  } catch (error: any) {
    console.error('❌ Upload error:', error.message);
    console.error('Stack:', error.stack);

    // Surface Pinata-specific errors clearly
    if (error.response) {
      console.error('Pinata response error:', {
        status: error.response.status,
        data: error.response.data,
      });
      return res.status(500).json({
        error: 'Pinata upload failed',
        details: error.response.data,
        status: error.response.status,
      });
    }

    res.status(500).json({
      error: 'Failed to upload file',
      details: error.message,
      type: error.constructor.name,
    });
  }
});*/

// Upload file to IPFS - WITH SECURITY
app.post('/api/upload', uploadLimiter, upload.single('file'), async (req: Request, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { seller } = req.body;
    
    // ✅ VALIDATE SELLER ADDRESS
    let cleanSeller: string;
    try {
      cleanSeller = sanitizeAddress(seller);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }

    // ✅ VALIDATE FILE TYPE
    const allowedTypes = [
      // Documents
      'application/pdf',
      // Archives
      'application/zip',
      'application/x-zip-compressed',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      // Images
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/svg+xml',
      // Video
      'video/mp4',
      'video/avi',
      'video/x-msvideo',
      'video/quicktime',
      'video/x-matroska',
      'video/webm',
      'video/x-ms-wmv',
      'video/mpeg',
      // Audio
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/ogg',
      'audio/flac',
      'audio/x-flac',
      // Text / Code
      'text/plain',
      'text/html',
      'text/css',
      'application/json',
      'application/javascript',
    ];

    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ 
        error: 'File type not allowed',
        allowedTypes: 'PDF, ZIP, RAR, 7Z, JPG, PNG, WEBP, GIF, SVG, MP4, AVI, MOV, MKV, WEBM, WMV, MP3, WAV, OGG, FLAC, TXT, HTML, CSS, JSON, JS',
        received: req.file.mimetype,
      });
    }

    // ✅ VALIDATE FILE SIZE — 500MB for video, 100MB for everything else
    const isVideo = req.file.mimetype.startsWith('video/');
    const MAX_SIZE = isVideo ? 500 * 1024 * 1024 : 100 * 1024 * 1024;
    if (req.file.size > MAX_SIZE) {
      return res.status(400).json({ 
        error: `File size exceeds limit. Max: ${isVideo ? '500MB for video' : '100MB'}`,
      });
    }

    console.log(`📤 Uploading file: ${req.file.originalname}`);
    console.log(`   Type: ${req.file.mimetype}`);
    console.log(`   Size: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

    // Upload to Pinata - use base64 upload since Node.js lacks browser File API
    const base64Content = req.file.buffer.toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${base64Content}`;

    // Convert buffer to a File-compatible object using a polyfill approach
    const { Blob: NodeBlob } = require('buffer');
    const fileBlob = new NodeBlob([req.file.buffer], { type: req.file.mimetype });
    
    // Pinata SDK needs a File-like object - create one from the blob
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
    res.status(500).json({
      error: 'Failed to upload file',
      details: error.message,
    });
  }
});

// Get ownership token for a user's purchase of a resellable product
/*
app.get('/api/ownership-token/:productId/:userAddress', async (req, res) => {
  try {
    const { productId, userAddress } = req.params;

    // Look up the ownership token from the Sui blockchain directly
    const { SuiClient } = await import('@mysten/sui/client');
    const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

    // Query objects owned by the user of type OwnershipToken
    const objects = await suiClient.getOwnedObjects({
      owner: userAddress,
      filter: {
        StructType: `${process.env.PACKAGE_ID}::marketplace::OwnershipToken`,
      },
      options: { showContent: true },
    });

    // Find the token for this specific product
    const token = objects.data.find((obj) => {
      const content = obj.data?.content as any;
      return content?.fields?.original_product_id === productId;
    });

    if (!token?.data?.objectId) {
      return res.status(404).json({ error: 'Ownership token not found' });
    }

    res.json({ tokenId: token.data.objectId });
  } catch (error: any) {
    console.error('Error fetching ownership token::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch ownership token', detail: error.message });
  }
});
*/

// Get all resale listings
/*app.get('/api/resale-listings', async (req, res) => {
  try {
    // Query resale listings from database
    const result = await pool.query(`
      SELECT 
        rl.*,
        p.title as product_title,
        p.image_url as product_image,
        p.category as product_category,
        p.description as product_description
      FROM resale_listings rl
      LEFT JOIN products p ON rl.original_product_id = p.id
      WHERE rl.is_active = true
      ORDER BY rl.created_at DESC
    `);

    res.json({ listings: result.rows });
  } catch (error: any) {
    console.error('Error fetching resale listings::', error.message || error);
    res.status(500).json({ error: 'Failed to fetch resale listings', detail: error.message });
  }
});
*/

// ✅ SPECIFIC route FIRST
app.get('/api/resale-listings/user/:userAddress/:productId', async (req, res) => {
  try {
    const { userAddress, productId } = req.params;
    console.log('Checking resale listing:', { userAddress, productId });

    const result = await pool.query(
      `SELECT * FROM resale_listings 
       WHERE seller = $1 
         AND original_product_id = $2 
         AND is_active = true
       LIMIT 1`,
      [userAddress, productId]
    );

    console.log('Resale listing result:', result.rows);

    if (result.rows.length === 0) {
      return res.status(404).json({ listing: null });
    }

    res.json({ listing: result.rows[0] });
  } catch (error: any) {
    console.error('Error checking user listing::', error.message || error);
    res.status(500).json({ error: 'Failed to check user listing', detail: error.message });
  }
});


// Get all active resale listings with product info joined
app.get('/api/resale-listings', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        rl.listing_id,
        rl.token_id,
        rl.seller,
        rl.price,
        rl.original_product_id,
        rl.is_active,
        rl.created_at,
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


// Get ownership token for a user and product
app.get('/api/ownership-token/:productId/:userAddress', async (req, res) => {
  try {
    const { productId, userAddress } = req.params;
    console.log('resale request:', { productId, userAddress });
    // Query the ownership_tokens table
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

// ==================== Start Server ====================




// ── Seller profile update (public — authenticated by wallet address match)
app.put('/api/sellers/:address/profile', async (req: any, res: any) => {
  try {
    const { address } = req.params;
    const { display_name, bio, avatar_url, twitter_handle, website_url, email } = req.body;

    // Upsert seller row
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

// GET /api/sellers/:address/reviews — all reviews for a seller's products
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

// ==================== Admin Endpoints ====================
// All protected by x-admin-key header matching ADMIN_KEY env var

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

// GET /api/admin/overview — platform-wide stats
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

// GET /api/admin/sellers — list all sellers with details
app.get('/api/admin/sellers', requireAdmin, async (req: any, res: any) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const whereClause = search
      ? `WHERE s.address ILIKE $3 OR s.display_name ILIKE $3`
      : '';
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

// PATCH /api/admin/sellers/:address — ban/unban seller
app.patch('/api/admin/sellers/:address', requireAdmin, async (req: any, res: any) => {
  try {
    const { is_banned } = req.body;
    await pool.query(
      `UPDATE sellers SET is_banned = $1 WHERE address = $2`,
      [is_banned, req.params.address]
    );
    // Also hide their products if banned
    if (is_banned) {
      await pool.query(
        `UPDATE products SET is_available = false WHERE seller = $1`,
        [req.params.address]
      );
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update seller', detail: error.message });
  }
});

// GET /api/admin/products — list all products with details
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
      pool.query(
        `SELECT COUNT(*) FROM products p ${whereClause}`,
        search ? [`%${search}%`] : []
      ),
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

// PATCH /api/admin/products/:id — hide/show product
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

// GET /api/admin/disputes — all disputes
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

// PATCH /api/admin/disputes/:id — resolve dispute
app.patch('/api/admin/disputes/:id', requireAdmin, async (req: any, res: any) => {
  try {
    const { status, resolution } = req.body;
    await pool.query(
      `UPDATE disputes SET status=$1, resolution=$2, updated_at=$3 WHERE id=$4`,
      [status, resolution || null, Date.now(), req.params.id]
    );

    // Email buyer about resolution
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
          const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid #e5e7eb;">
  <div style="background:${won ? 'linear-gradient(135deg,#059669,#047857)' : 'linear-gradient(135deg,#6b7280,#4b5563)'};padding:28px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">${won ? '✅ Dispute Resolved' : '❌ Dispute Closed'}</h1>
  </div>
  <div style="padding:24px;">
    <div style="background:#f9fafb;border-radius:12px;padding:16px;margin:16px 0;">
      <p style="margin:0;font-size:13px;color:#374151;"><strong>Resolution:</strong> ${resolution || 'No notes provided.'}</p>
    </div>
    <a href="${siteUrl}/profile" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;">View My Purchases</a>
  </div></div>`;
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

// GET /api/admin/messages — support messages
app.get('/api/admin/messages', requireAdmin, async (req: any, res: any) => {
  try {
    const result = await pool.query(
      `SELECT * FROM support_messages ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ messages: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch messages', detail: error.message });
  }
});

// PATCH /api/admin/messages/:id
app.patch('/api/admin/messages/:id', requireAdmin, async (req: any, res: any) => {
  try {
    const { status } = req.body;
    await pool.query(
      `UPDATE support_messages SET status=$1 WHERE id=$2`,
      [status, req.params.id]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update message', detail: error.message });
  }
});

// ==================== Support Endpoints ====================

// POST /api/support/contact — stores message and emails admin
app.post('/api/support/contact', async (req, res) => {
  try {
    const { name, email, subject, message, wallet } = req.body;
    if (!email || !message) return res.status(400).json({ error: 'Email and message required' });

    await pool.query(
      `INSERT INTO support_messages (name, email, subject, message, wallet_address, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [name || 'Anonymous', email, subject || 'Support Request', message,
       wallet || null, Date.now()]
    );

    console.log(`📧 Support message from ${email}: ${subject}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Support contact error:', error.message);
    res.status(500).json({ error: 'Failed to send message', detail: error.message });
  }
});

// POST /api/support/dispute
app.post('/api/support/dispute', async (req, res) => {
  try {
    const { tx_digest, reason, description, wallet } = req.body;
    if (!tx_digest || !reason || !description || !wallet)
      return res.status(400).json({ error: 'All fields required' });

    // Verify purchase exists
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

    console.log(`⚖️  Dispute filed by ${wallet} for tx ${tx_digest}`);

    // Notify seller about the dispute
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
          // Inline template to avoid import issues in server.ts
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

// GET /api/support/disputes — admin only (basic key check)
app.get('/api/support/disputes', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

    const result = await pool.query(
      'SELECT * FROM disputes ORDER BY created_at DESC LIMIT 100'
    );
    res.json({ disputes: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch disputes', detail: error.message });
  }
});

// PATCH /api/support/disputes/:id — update dispute status (admin)
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

// Bind to 0.0.0.0 so Railway (and any cloud host) can route traffic to the container
// localhost/127.0.0.1 only accepts connections from inside the container — Railway needs 0.0.0.0
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 API Server running on 0.0.0.0:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🛍️  Products API: http://localhost:${PORT}/api/products`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down API server...');
  await pool.end();
  process.exit(0);
});