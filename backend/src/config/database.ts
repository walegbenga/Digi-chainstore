import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

function createPool(): Pool {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("❌ DATABASE_URL is NOT set");
  }

  // FIX: detect local vs production by checking if URL points to localhost/127.0.0.1
  const isLocal =
    databaseUrl.includes('localhost') ||
    databaseUrl.includes('127.0.0.1');

  console.log(`DB URL USED: ${databaseUrl}`);
  console.log(`SSL: ${isLocal ? 'disabled (local)' : 'enabled (production)'}`);

  return new Pool({
    connectionString: databaseUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

export const pool = createPool();

export async function initializeDatabase() {
  try {
    console.log('🔄 Initializing database schemas...');
    console.log("ENV CHECK:", {
      DATABASE_URL: !!process.env.DATABASE_URL,
      NODE_ENV: process.env.NODE_ENV,
    });

    await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── products ─────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id                      VARCHAR(66) PRIMARY KEY,
        seller                  VARCHAR(66) NOT NULL,
        title                   VARCHAR(100) NOT NULL,
        description             TEXT NOT NULL,
        price                   BIGINT NOT NULL,
        image_url               TEXT NOT NULL DEFAULT '',
        category                VARCHAR(50) NOT NULL DEFAULT 'Other',
        is_available            BOOLEAN DEFAULT TRUE,
        total_sales             INTEGER DEFAULT 0,
        total_revenue           BIGINT DEFAULT 0,
        rating_sum              INTEGER DEFAULT 0,
        rating_count            INTEGER DEFAULT 0,
        quantity                INTEGER DEFAULT 1,
        available_quantity      INTEGER DEFAULT 1,
        resellable              BOOLEAN DEFAULT FALSE,
        file_cid                TEXT DEFAULT '',
        file_name               TEXT DEFAULT '',
        file_size               BIGINT DEFAULT 0,
        seller_is_verified      BOOLEAN DEFAULT false,
        license_type            SMALLINT DEFAULT 0,
        license_max_activations INTEGER DEFAULT 1,
        license_duration_days   INTEGER DEFAULT 0,
        license_renewal_price   BIGINT DEFAULT 0,
        created_at              BIGINT NOT NULL DEFAULT 0,
        updated_at              BIGINT NOT NULL DEFAULT 0,
        CONSTRAINT valid_price        CHECK (price >= 0),
        CONSTRAINT valid_rating_sum   CHECK (rating_sum >= 0),
        CONSTRAINT valid_rating_count CHECK (rating_count >= 0)
      )
    `);

    // ── sellers ──────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sellers (
        address            VARCHAR(66) PRIMARY KEY,
        display_name       VARCHAR(50) DEFAULT '',
        bio                TEXT DEFAULT '',
        avatar_url         TEXT DEFAULT '',
        twitter_handle     VARCHAR(50) DEFAULT '',
        website_url        TEXT DEFAULT '',
        email              TEXT DEFAULT '',
        total_sales        INTEGER DEFAULT 0,
        total_revenue      BIGINT DEFAULT 0,
        products_listed    INTEGER DEFAULT 0,
        follower_count     INTEGER DEFAULT 0,
        is_banned          BOOLEAN DEFAULT FALSE,
        verification_level INTEGER DEFAULT 0,
        verified_at        BIGINT,
        verified_by        TEXT,
        is_verified        BOOLEAN DEFAULT false,
        created_at         BIGINT NOT NULL DEFAULT 0,
        updated_at         BIGINT NOT NULL DEFAULT 0
      )
    `);

    // ── reviews ──────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id VARCHAR(66) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        reviewer   VARCHAR(66) NOT NULL,
        rating     INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment    TEXT NOT NULL,
        created_at BIGINT NOT NULL DEFAULT 0,
        UNIQUE(product_id, reviewer)
      )
    `);

    // ── purchases ────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id         VARCHAR(66),
        buyer              VARCHAR(66) NOT NULL,
        seller             VARCHAR(66) NOT NULL,
        price              BIGINT NOT NULL,
        platform_fee       BIGINT NOT NULL DEFAULT 0,
        tx_digest          VARCHAR(100) NOT NULL UNIQUE,
        buyer_was_verified BOOLEAN DEFAULT false,
        created_at         BIGINT NOT NULL DEFAULT 0,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
      )
    `);

    // ── followers ────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS followers (
        follower_address VARCHAR(66) NOT NULL,
        seller_address   VARCHAR(66) NOT NULL,
        created_at       BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (follower_address, seller_address)
      )
    `);

    // ── favorites ────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        user_address VARCHAR(66) NOT NULL,
        product_id   VARCHAR(66) NOT NULL,
        created_at   BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (user_address, product_id)
      )
    `);

    // ── ownership_tokens ─────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ownership_tokens (
        token_id             VARCHAR(66) PRIMARY KEY,
        original_product_id  VARCHAR(66) NOT NULL,
        current_owner        VARCHAR(66) NOT NULL,
        previous_owner       VARCHAR(66) DEFAULT '',
        original_seller      VARCHAR(66) NOT NULL,
        purchase_price       BIGINT NOT NULL DEFAULT 0,
        purchase_timestamp   BIGINT NOT NULL DEFAULT 0,
        is_listed_for_resale BOOLEAN DEFAULT FALSE,
        resale_price         BIGINT DEFAULT 0,
        file_cid             TEXT DEFAULT '',
        created_at           BIGINT NOT NULL DEFAULT 0,
        updated_at           BIGINT NOT NULL DEFAULT 0
      )
    `);

    // ── resale_listings ──────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS resale_listings (
        listing_id          VARCHAR(66) PRIMARY KEY,
        token_id            VARCHAR(66) NOT NULL,
        seller              VARCHAR(66) NOT NULL,
        price               BIGINT NOT NULL,
        original_product_id VARCHAR(66) NOT NULL,
        is_active           BOOLEAN DEFAULT TRUE,
        created_at          BIGINT NOT NULL DEFAULT 0,
        updated_at          BIGINT NOT NULL DEFAULT 0,
        CHECK (token_id IS NOT NULL)
      )
    `);

    // ── licenses ─────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id                  SERIAL PRIMARY KEY,
        license_id          VARCHAR(66) UNIQUE NOT NULL,
        product_id          VARCHAR(66) NOT NULL,
        buyer_address       VARCHAR(66) NOT NULL,
        seller_address      VARCHAR(66) NOT NULL,
        tx_digest           VARCHAR(100) NOT NULL,
        license_type        SMALLINT NOT NULL DEFAULT 1,
        max_activations     INTEGER NOT NULL DEFAULT 1,
        current_activations INTEGER NOT NULL DEFAULT 0,
        expiry_timestamp    BIGINT DEFAULT 0,
        renewal_price       BIGINT DEFAULT 0,
        status              VARCHAR(20) DEFAULT 'active',
        renewal_count       INTEGER DEFAULT 0,
        issue_timestamp     BIGINT NOT NULL,
        created_at          TIMESTAMP DEFAULT NOW(),
        updated_at          TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── license_activations ──────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS license_activations (
        id             SERIAL PRIMARY KEY,
        license_id     VARCHAR(66) NOT NULL REFERENCES licenses(license_id) ON DELETE CASCADE,
        device_id      TEXT NOT NULL,
        activated_at   BIGINT NOT NULL,
        deactivated_at BIGINT,
        is_active      BOOLEAN DEFAULT true,
        created_at     TIMESTAMP DEFAULT NOW(),
        UNIQUE(license_id, device_id)
      )
    `);

    // ── license_renewals ─────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS license_renewals (
        id             SERIAL PRIMARY KEY,
        license_id     VARCHAR(66) NOT NULL REFERENCES licenses(license_id) ON DELETE CASCADE,
        buyer_address  VARCHAR(66) NOT NULL,
        amount_paid    BIGINT NOT NULL,
        tx_digest      VARCHAR(100) NOT NULL,
        old_expiry     BIGINT,
        new_expiry     BIGINT,
        renewal_number INTEGER NOT NULL,
        created_at     BIGINT NOT NULL
      )
    `);

    // ── disputes ─────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS disputes (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tx_digest     VARCHAR(100) NOT NULL UNIQUE,
        buyer_address VARCHAR(66) NOT NULL,
        reason        VARCHAR(100) NOT NULL,
        description   TEXT NOT NULL,
        status        VARCHAR(20) NOT NULL DEFAULT 'open',
        resolution    TEXT,
        created_at    BIGINT NOT NULL DEFAULT 0,
        updated_at    BIGINT
      )
    `);

    // ── support_messages ─────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name           VARCHAR(100) NOT NULL DEFAULT 'Anonymous',
        email          TEXT NOT NULL,
        subject        VARCHAR(200) NOT NULL DEFAULT 'Support Request',
        message        TEXT NOT NULL,
        wallet_address VARCHAR(66),
        status         VARCHAR(20) NOT NULL DEFAULT 'open',
        created_at     BIGINT NOT NULL DEFAULT 0
      )
    `);

    // ── indexer_state ────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS indexer_state (
        id                INTEGER PRIMARY KEY DEFAULT 1,
        last_event_cursor TEXT,
        updated_at        BIGINT NOT NULL DEFAULT 0,
        CONSTRAINT single_row CHECK (id = 1)
      )
    `);

    await pool.query(`
      INSERT INTO indexer_state (id, updated_at) VALUES (1, 0)
      ON CONFLICT (id) DO NOTHING
    `);

    // ── verified_buyers ──────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS verified_buyers (
        address     VARCHAR(66) PRIMARY KEY,
        verified_at BIGINT NOT NULL DEFAULT 0,
        verified_by TEXT NOT NULL DEFAULT '',
        is_active   BOOLEAN DEFAULT TRUE,
        created_at  BIGINT NOT NULL DEFAULT 0
      )
    `);

    // ── Indexes ───────────────────────────────────────────────
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_products_seller               ON products(seller);
        CREATE INDEX IF NOT EXISTS idx_products_category             ON products(category);
        CREATE INDEX IF NOT EXISTS idx_products_available            ON products(is_available);
        CREATE INDEX IF NOT EXISTS idx_products_created_at           ON products(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_products_price                ON products(price);
        CREATE INDEX IF NOT EXISTS idx_products_seller_verified      ON products(seller_is_verified);
        CREATE INDEX IF NOT EXISTS idx_sellers_created_at            ON sellers(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sellers_total_sales           ON sellers(total_sales DESC);
        CREATE INDEX IF NOT EXISTS idx_sellers_verified              ON sellers(is_verified);
        CREATE INDEX IF NOT EXISTS idx_reviews_product               ON reviews(product_id);
        CREATE INDEX IF NOT EXISTS idx_reviews_reviewer              ON reviews(reviewer);
        CREATE INDEX IF NOT EXISTS idx_reviews_created_at            ON reviews(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_purchases_buyer               ON purchases(buyer);
        CREATE INDEX IF NOT EXISTS idx_purchases_seller              ON purchases(seller);
        CREATE INDEX IF NOT EXISTS idx_purchases_product             ON purchases(product_id);
        CREATE INDEX IF NOT EXISTS idx_purchases_created_at          ON purchases(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_followers_seller              ON followers(seller_address);
        CREATE INDEX IF NOT EXISTS idx_followers_follower            ON followers(follower_address);
        CREATE INDEX IF NOT EXISTS idx_favorites_user                ON favorites(user_address);
        CREATE INDEX IF NOT EXISTS idx_favorites_product             ON favorites(product_id);
        CREATE INDEX IF NOT EXISTS idx_ownership_tokens_owner        ON ownership_tokens(current_owner);
        CREATE INDEX IF NOT EXISTS idx_ownership_tokens_product      ON ownership_tokens(original_product_id);
        CREATE INDEX IF NOT EXISTS idx_resale_listings_seller        ON resale_listings(seller);
        CREATE INDEX IF NOT EXISTS idx_resale_listings_active        ON resale_listings(is_active);
        CREATE INDEX IF NOT EXISTS idx_resale_listings_product       ON resale_listings(original_product_id);
        CREATE INDEX IF NOT EXISTS idx_verified_buyers_address       ON verified_buyers(address);
        CREATE INDEX IF NOT EXISTS idx_licenses_buyer                ON licenses(buyer_address);
        CREATE INDEX IF NOT EXISTS idx_licenses_seller               ON licenses(seller_address);
        CREATE INDEX IF NOT EXISTS idx_licenses_product              ON licenses(product_id);
        CREATE INDEX IF NOT EXISTS idx_licenses_status               ON licenses(status);
        CREATE INDEX IF NOT EXISTS idx_licenses_object_id            ON licenses(license_id);
        CREATE INDEX IF NOT EXISTS idx_activations_license           ON license_activations(license_id);
        CREATE INDEX IF NOT EXISTS idx_activations_device            ON license_activations(device_id);
        CREATE INDEX IF NOT EXISTS idx_renewals_license              ON license_renewals(license_id);
      `);
    } catch (idxErr: any) {
      console.warn('Index warning (safe to ignore):', idxErr.message);
    }

    console.log('✅ Database schema initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
}

export async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful:', result.rows[0].now);
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}
