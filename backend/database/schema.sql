-- ============================================================
-- COMPLETE DROP AND RECREATE — ALL TABLES, INDEXES, VIEWS
-- Combines original schema.sql + all BIGINT timestamp fixes
-- Run in Railway: Postgres → Data tab → Query
-- WARNING: Deletes all existing data
-- ============================================================

-- Drop views first (depend on tables)
DROP VIEW IF EXISTS top_products CASCADE;
DROP VIEW IF EXISTS top_sellers CASCADE;

-- Drop tables in correct FK order
DROP TABLE IF EXISTS resale_listings CASCADE;
DROP TABLE IF EXISTS ownership_tokens CASCADE;
DROP TABLE IF EXISTS license_renewals CASCADE;
DROP TABLE IF EXISTS license_activations CASCADE;
DROP TABLE IF EXISTS licenses CASCADE;
DROP TABLE IF EXISTS verified_buyers CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS purchases CASCADE;
DROP TABLE IF EXISTS favorites CASCADE;
DROP TABLE IF EXISTS followers CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS sellers CASCADE;
DROP TABLE IF EXISTS indexer_state CASCADE;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── products ─────────────────────────────────────────────────
CREATE TABLE products (
  id                 VARCHAR(66) PRIMARY KEY,
  seller             VARCHAR(66) NOT NULL,
  title              VARCHAR(100) NOT NULL,
  description        TEXT NOT NULL,
  price              BIGINT NOT NULL,
  image_url          TEXT NOT NULL DEFAULT '',
  category           VARCHAR(50) NOT NULL DEFAULT 'Other',
  is_available       BOOLEAN DEFAULT TRUE,
  total_sales        INTEGER DEFAULT 0,
  total_revenue      BIGINT DEFAULT 0,
  rating_sum         INTEGER DEFAULT 0,
  rating_count       INTEGER DEFAULT 0,
  quantity           INTEGER DEFAULT 1,
  available_quantity INTEGER DEFAULT 1,
  resellable         BOOLEAN DEFAULT FALSE,
  file_cid           TEXT DEFAULT '',
  file_name          TEXT DEFAULT '',
  file_size          BIGINT DEFAULT 0,
  seller_is_verified BOOLEAN DEFAULT false,
  license_type       SMALLINT  DEFAULT 0,
  license_max_activations INTEGER   DEFAULT 1,
  license_duration_days  INTEGER   DEFAULT 0,
  license_renewal_price  BIGINT    DEFAULT 0,
  created_at         BIGINT NOT NULL DEFAULT 0,
  updated_at         BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT valid_price        CHECK (price >= 0),
  CONSTRAINT valid_rating_sum   CHECK (rating_sum >= 0),
  CONSTRAINT valid_rating_count CHECK (rating_count >= 0)
);

-- ── sellers ──────────────────────────────────────────────────
CREATE TABLE sellers (
  address            VARCHAR(66) PRIMARY KEY,
  display_name       VARCHAR(50) DEFAULT '',
  bio                TEXT DEFAULT '',
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
);

-- ── reviews ──────────────────────────────────────────────────
CREATE TABLE reviews (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id VARCHAR(66) NOT NULL,
  reviewer   VARCHAR(66) NOT NULL,
  rating     INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment    TEXT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE(product_id, reviewer)
);

-- ── purchases ────────────────────────────────────────────────
CREATE TABLE purchases (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id   VARCHAR(66),
  buyer        VARCHAR(66) NOT NULL,
  seller       VARCHAR(66) NOT NULL,
  price        BIGINT NOT NULL,
  platform_fee BIGINT NOT NULL DEFAULT 0,
  tx_digest    VARCHAR(100) NOT NULL UNIQUE,
  created_at   BIGINT NOT NULL DEFAULT 0,
  buyer_was_verified BOOLEAN DEFAULT false,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

-- ── followers ────────────────────────────────────────────────
CREATE TABLE followers (
  follower_address VARCHAR(66) NOT NULL,
  seller_address   VARCHAR(66) NOT NULL,
  created_at       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (follower_address, seller_address)
);

-- ── favorites ────────────────────────────────────────────────
CREATE TABLE favorites (
  user_address VARCHAR(66) NOT NULL,
  product_id   VARCHAR(66) NOT NULL,
  created_at   BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_address, product_id)
);

-- ── ownership_tokens ─────────────────────────────────────────
CREATE TABLE ownership_tokens (
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
);

-- ── resale_listings ──────────────────────────────────────────
CREATE TABLE resale_listings (
  listing_id          VARCHAR(66) PRIMARY KEY,
  token_id            VARCHAR(66) NOT NULL,
  seller              VARCHAR(66) NOT NULL,
  price               BIGINT NOT NULL,
  original_product_id VARCHAR(66) NOT NULL,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          BIGINT NOT NULL DEFAULT 0,
  updated_at          BIGINT NOT NULL DEFAULT 0,
  -- No FK on token_id: indexer events can arrive out of order
  -- ownership token is upserted in handleResaleListed if missing
  CHECK (token_id IS NOT NULL)
);

 --Main licenses table
--    One row per license issued.
CREATE TABLE IF NOT EXISTS licenses (
  id                  SERIAL PRIMARY KEY,
  license_id          VARCHAR(66) UNIQUE NOT NULL,  -- on-chain object ID
  license_key         VARCHAR(50) UNIQUE NOT NULL,  -- human-readable XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
  product_id          VARCHAR(66) NOT NULL,
  buyer_address       VARCHAR(66) NOT NULL,
  seller_address      VARCHAR(66) NOT NULL,
  tx_digest           VARCHAR(100) NOT NULL,
  license_type        SMALLINT NOT NULL DEFAULT 1,
  max_activations     INTEGER NOT NULL DEFAULT 1,   -- 0 = unlimited
  current_activations INTEGER NOT NULL DEFAULT 0,
  expiry_timestamp    BIGINT  DEFAULT 0,            -- 0 = lifetime
  renewal_price       BIGINT  DEFAULT 0,
  status              VARCHAR(20) DEFAULT 'active', -- active | revoked | expired
  renewal_count       INTEGER DEFAULT 0,
  issue_timestamp     BIGINT NOT NULL,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);
 
-- 3. License activations table
--    One row per device activation.
CREATE TABLE IF NOT EXISTS license_activations (
  id             SERIAL PRIMARY KEY,
  license_id     VARCHAR(66) NOT NULL REFERENCES licenses(license_id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL,
  activated_at   BIGINT NOT NULL,
  deactivated_at BIGINT,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMP DEFAULT NOW(),
  UNIQUE(license_id, device_id)
);
 
-- 4. License renewals table
--    Audit trail of every renewal payment
CREATE TABLE IF NOT EXISTS license_renewals (
  id              SERIAL PRIMARY KEY,
  license_id      VARCHAR(66) NOT NULL REFERENCES licenses(license_id) ON DELETE CASCADE,
  buyer_address   VARCHAR(66) NOT NULL,
  amount_paid     BIGINT NOT NULL,
  tx_digest       VARCHAR(100) NOT NULL,
  old_expiry      BIGINT,
  new_expiry      BIGINT,
  renewal_number  INTEGER NOT NULL,
  created_at      BIGINT NOT NULL
);

-- ── indexer_state ────────────────────────────────────────────
CREATE TABLE indexer_state (
  id                INTEGER PRIMARY KEY DEFAULT 1,
  last_event_cursor TEXT,
  updated_at        BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO indexer_state (id, updated_at) VALUES (1, 0);

-- ── verified_buyers ──────────────────────────────────────────
CREATE TABLE verified_buyers (
  address     VARCHAR(66) PRIMARY KEY,
  verified_at BIGINT NOT NULL DEFAULT 0,
  verified_by TEXT NOT NULL DEFAULT '',
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  BIGINT NOT NULL DEFAULT 0
);

-- ==================== Indexes ====================

-- Products
CREATE INDEX idx_products_seller     ON products(seller);
CREATE INDEX idx_products_category   ON products(category);
CREATE INDEX idx_products_available  ON products(is_available);
CREATE INDEX idx_products_created_at ON products(created_at DESC);
CREATE INDEX idx_products_price      ON products(price);

-- Full-text search on products
CREATE INDEX idx_products_title_search       ON products USING gin(to_tsvector('english', title));
CREATE INDEX idx_products_description_search ON products USING gin(to_tsvector('english', description));

-- Sellers
CREATE INDEX idx_sellers_created_at  ON sellers(created_at DESC);
CREATE INDEX idx_sellers_total_sales ON sellers(total_sales DESC);

-- Reviews
CREATE INDEX idx_reviews_product    ON reviews(product_id);
CREATE INDEX idx_reviews_reviewer   ON reviews(reviewer);
CREATE INDEX idx_reviews_created_at ON reviews(created_at DESC);

-- Purchases
CREATE INDEX idx_purchases_buyer      ON purchases(buyer);
CREATE INDEX idx_purchases_seller     ON purchases(seller);
CREATE INDEX idx_purchases_product    ON purchases(product_id);
CREATE INDEX idx_purchases_created_at ON purchases(created_at DESC);

-- Followers
CREATE INDEX idx_followers_seller   ON followers(seller_address);
CREATE INDEX idx_followers_follower ON followers(follower_address);

-- Favorites
CREATE INDEX idx_favorites_user    ON favorites(user_address);
CREATE INDEX idx_favorites_product ON favorites(product_id);

-- Ownership tokens
CREATE INDEX idx_ownership_tokens_owner   ON ownership_tokens(current_owner);
CREATE INDEX idx_ownership_tokens_product ON ownership_tokens(original_product_id);

-- Resale listings
CREATE INDEX idx_resale_listings_seller  ON resale_listings(seller);
CREATE INDEX idx_resale_listings_active  ON resale_listings(is_active);
CREATE INDEX idx_resale_listings_product ON resale_listings(original_product_id);

-- Index for fast verified seller product queries
CREATE INDEX IF NOT EXISTS idx_sellers_verified ON sellers(is_verified);
CREATE INDEX IF NOT EXISTS idx_products_seller_verified ON products(seller_is_verified);
CREATE INDEX IF NOT EXISTS idx_verified_buyers_address ON verified_buyers(address);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_licenses_buyer        ON licenses(buyer_address);
CREATE INDEX IF NOT EXISTS idx_licenses_seller       ON licenses(seller_address);
CREATE INDEX IF NOT EXISTS idx_licenses_product      ON licenses(product_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status       ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_key          ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_activations_license   ON license_activations(license_id);
CREATE INDEX IF NOT EXISTS idx_renewals_license      ON license_renewals(license_id);


ALTER TABLE products
  ADD COLUMN IF NOT EXISTS license_type             SMALLINT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS license_max_activations  INTEGER   DEFAULT 1,
  ADD COLUMN IF NOT EXISTS license_duration_days    INTEGER   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS license_renewal_price    BIGINT    DEFAULT 0;

-- ==================== Views ====================

CREATE VIEW top_products AS
SELECT
  p.*,
  CASE
    WHEN p.rating_count > 0 THEN p.rating_sum::FLOAT / p.rating_count
    ELSE 0
  END AS avg_rating
FROM products p
WHERE p.is_available = TRUE
ORDER BY p.total_sales DESC;

CREATE VIEW top_sellers AS
SELECT
  s.*,
  COUNT(DISTINCT p.id) AS active_products
FROM sellers s
LEFT JOIN products p ON s.address = p.seller AND p.is_available = TRUE
GROUP BY s.address
ORDER BY s.total_sales DESC;



-- View: products with seller verification status joined
CREATE OR REPLACE VIEW products_with_verification AS
SELECT
  p.*,
  COALESCE(s.is_verified, false) AS seller_verified
FROM products p
LEFT JOIN sellers s ON p.seller = s.address;

-- Helpful view — licenses with product info and activation count
CREATE OR REPLACE VIEW licenses_full AS
SELECT
  l.*,
  p.title          AS product_title,
  p.image_url      AS product_image,
  p.category       AS product_category,
  p.seller         AS product_seller,
  COUNT(la.id) FILTER (WHERE la.is_active = true) AS active_device_count
FROM licenses l
LEFT JOIN products p ON l.product_id = p.id
LEFT JOIN license_activations la ON l.license_id = la.license_id
GROUP BY l.id, p.title, p.image_url, p.category, p.seller;


-- ==================== Done ====================
SELECT 'All tables, indexes and views created successfully ✅' AS status;