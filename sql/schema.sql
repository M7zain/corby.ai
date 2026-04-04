-- corby.ai question logging (admin dashboard)
-- Run via: npm run db:migrate

CREATE TABLE IF NOT EXISTS question_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id VARCHAR(128) NOT NULL,
  model VARCHAR(64) NOT NULL,
  question TEXT NOT NULL,
  has_image TINYINT(1) NOT NULL DEFAULT 0,
  images_base64_json LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_question_events_client (client_id),
  KEY idx_question_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
