-- =====================================================================
--  Nitte FPC Inventory & Barcode System - MySQL / MariaDB schema
--  Import via phpMyAdmin (Import tab) or:
--     mysql -u root < database.sql
-- =====================================================================

CREATE DATABASE IF NOT EXISTS nfpc_inventory
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE nfpc_inventory;

-- ---------------------------------------------------------------------
-- Product categories. `code` is used inside generated SKUs (NFPC-GRP-12345)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name             VARCHAR(100) NOT NULL,
  code             VARCHAR(10)  NOT NULL,
  color            VARCHAR(7)   NOT NULL DEFAULT '#6b7a8f',
  shelf_life_days  INT UNSIGNED NOT NULL DEFAULT 180,
  default_unit     VARCHAR(10)  NOT NULL DEFAULT 'pcs',
  sort_order       INT          NOT NULL DEFAULT 0,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_name (name),
  UNIQUE KEY uq_categories_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Products. Each row is one product batch with its own barcode (SKU).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  sku            VARCHAR(64)   NOT NULL,                 -- barcode value (Code 128)
  name           VARCHAR(150)  NOT NULL,
  category_id    INT UNSIGNED  NOT NULL,
  grade          VARCHAR(100)  NOT NULL DEFAULT '',
  pack_size      DECIMAL(10,3) NOT NULL DEFAULT 1,
  unit           ENUM('kg','g','L','ml','pcs','dozen','bunch') NOT NULL DEFAULT 'kg',
  qty            INT           NOT NULL DEFAULT 0,       -- packs in stock
  mrp            DECIMAL(10,2) NOT NULL DEFAULT 0,       -- MRP per pack (INR)
  location       VARCHAR(100)  NOT NULL DEFAULT '',
  batch_no       VARCHAR(50)   NOT NULL,
  sourced_from   VARCHAR(150)  NOT NULL DEFAULT '',
  packed_on      DATE          NOT NULL,
  best_before    DATE          NOT NULL,
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_sku (sku),
  KEY idx_products_category (category_id),
  KEY idx_products_best_before (best_before),
  KEY idx_products_batch (batch_no),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Stock movement log: every add / edit / import / delete is recorded here.
-- product_id becomes NULL if the product is deleted; sku/name are kept.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movements (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id   INT UNSIGNED NULL,
  sku          VARCHAR(64)  NOT NULL,
  product_name VARCHAR(150) NOT NULL,
  action       ENUM('create','update','import','delete') NOT NULL,
  username     VARCHAR(50)  NOT NULL DEFAULT '',           -- who made the change
  qty_before   INT          NOT NULL DEFAULT 0,
  qty_after    INT          NOT NULL DEFAULT 0,
  qty_change   INT          NOT NULL DEFAULT 0,
  note         VARCHAR(255) NOT NULL DEFAULT '',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_moves_product (product_id),
  KEY idx_moves_sku (sku),
  KEY idx_moves_created (created_at),
  CONSTRAINT fk_moves_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Login accounts. The first account (a Super Admin) is created on
-- login.php the first time the app is opened (no default password).
--
-- Roles, password resets and the activity log are created automatically
-- by schema.php the first time the app connects, so nothing else is
-- needed here. (Existing installs are upgraded the same way.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username       VARCHAR(50)  NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login     DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Label templates (brand name, logo, colours, which fields to print...).
-- `settings` holds the template as JSON; the logo is stored inside it as a
-- small PNG/JPEG data URI. Exactly one template should have is_default = 1.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS label_templates (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)  NOT NULL,
  settings    MEDIUMTEXT   NOT NULL,
  is_default  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_label_templates_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO label_templates (name, settings, is_default)
SELECT 'Standard', '{"brand":"NITTE FARMERS PRODUCER COMPANY LTD.","tagline":"","logoMode":"default","logo":"","logoAspect":1,"color":"#2f7d32","header":"band","mrpText":"MRP (incl. of all taxes)","address":"NMAMIT Campus, Nitte, Karkala Tq., Udupi Dist., Karnataka – 574110","cin":"U01110KA2021PTC149385","fssai":"","contact":"","note":"","perRow":3,"show":{"net":true,"batch":true,"packed":true,"best":true,"grade":true,"source":true,"mrp":true,"barcodeText":true,"footer":true}}', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM label_templates);

-- ---------------------------------------------------------------------
-- Default categories
-- ---------------------------------------------------------------------
INSERT IGNORE INTO categories (name, code, color, shelf_life_days, default_unit, sort_order) VALUES
  ('Grains & Pulses',     'GRP', '#c98a12', 180, 'kg',  1),
  ('Oils & Oilseeds',     'OIL', '#e0b400', 270, 'L',   2),
  ('Spices & Plantation', 'SPC', '#8b4a2b', 365, 'g',   3),
  ('Processed Products',  'PRC', '#b8456b', 120, 'g',   4),
  ('Fresh Produce',       'FRS', '#2f9d4a',   7, 'kg',  5),
  ('Others',              'OTH', '#6b7a8f', 180, 'pcs', 6);

-- ---------------------------------------------------------------------
-- Sample products (dates are relative to the day you import this file).
-- Delete this block if you want to start with an empty inventory.
-- ---------------------------------------------------------------------
INSERT IGNORE INTO products
  (sku, name, category_id, grade, pack_size, unit, qty, mrp, location, batch_no, sourced_from, packed_on, best_before)
SELECT s.sku, s.name, c.id, s.grade, s.pack_size, s.unit, s.qty, s.mrp, s.location, s.batch_no, s.sourced_from,
       DATE_SUB(CURDATE(), INTERVAL s.packed_ago DAY),
       DATE_ADD(DATE_SUB(CURDATE(), INTERVAL s.packed_ago DAY), INTERVAL COALESCE(s.life, c.shelf_life_days) DAY)
FROM (
  SELECT 'NFPC-GRP-48213' sku, 'Red Rice (Kajé Akki)' name, 'Grains & Pulses' cat, 'Boiled, Grade A' grade, 5 pack_size, 'kg' unit, 64 qty, 420 mrp, 'Godown 1' location, 'B2610-001' batch_no, 'Kedinje farmers group' sourced_from, 20 packed_ago, NULL life
  UNION ALL SELECT 'NFPC-GRP-51734','Ragi','Grains & Pulses','Cleaned',1,'kg',8,68,'Godown 1','B2610-002','Nitte village',35,NULL
  UNION ALL SELECT 'NFPC-GRP-60942','Toor Dal','Grains & Pulses','Unpolished',1,'kg',40,165,'Godown 1','B2610-003','Belman',12,NULL
  UNION ALL SELECT 'NFPC-OIL-27315','Cold-pressed Coconut Oil','Oils & Oilseeds','Wood-pressed',1,'L',52,330,'Oil room','B2610-004','FPC mill, Nitte',30,NULL
  UNION ALL SELECT 'NFPC-OIL-38806','Groundnut Oil','Oils & Oilseeds','Cold-pressed',1,'L',0,290,'Oil room','B2610-005','FPC mill, Nitte',60,NULL
  UNION ALL SELECT 'NFPC-SPC-14527','Black Pepper','Spices & Plantation','Bold, 550 GL',250,'g',30,260,'Spice store','B2610-006','Karkala growers',40,NULL
  UNION ALL SELECT 'NFPC-SPC-73391','Cashew Nuts W320','Spices & Plantation','Whole',500,'g',25,520,'Spice store','B2610-007','Local processing unit',25,180
  UNION ALL SELECT 'NFPC-PRC-22648','Banana Chips','Processed Products','Coconut-oil fried',200,'g',6,90,'Retail shelf','B2610-008','FPC kitchen',110,NULL
  UNION ALL SELECT 'NFPC-PRC-85120','Mango Pickle','Processed Products','Appe midi',300,'g',36,150,'Retail shelf','B2610-009','Women SHG, Kukkundoor',30,NULL
  UNION ALL SELECT 'NFPC-PRC-49075','Wild Honey','Processed Products','Raw',500,'g',18,380,'Retail shelf','B2610-010','Kudremukh fringe collectors',50,365
  UNION ALL SELECT 'NFPC-FRS-31864','Tender Coconut','Fresh Produce','Green',1,'pcs',120,35,'Cold room','B2610-011','Nitte village',2,NULL
  UNION ALL SELECT 'NFPC-FRS-66209','Arecanut (Chali)','Fresh Produce','New crop',1,'kg',45,480,'Godown 2','B2610-012','Kedinje farmers group',15,365
) s
JOIN categories c ON c.name = s.cat;

-- ---------------------------------------------------------------------
-- Handy views for reports
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_low_stock AS
  SELECT p.*, c.name AS category FROM products p JOIN categories c ON c.id = p.category_id
  WHERE p.qty < 10;

CREATE OR REPLACE VIEW v_expiring_soon AS
  SELECT p.*, c.name AS category, DATEDIFF(p.best_before, CURDATE()) AS days_left
  FROM products p JOIN categories c ON c.id = p.category_id
  WHERE p.best_before BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 15 DAY);
