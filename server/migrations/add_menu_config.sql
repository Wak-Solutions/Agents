-- Migration: add menu_config column to chatbot_config
-- menu_config stores an array of main menu items, each with a label and subItems array.
-- Example: [{ "label": "Robotics", "subItems": ["TrolleyGo", "NaviBot"] }]

ALTER TABLE chatbot_config
  ADD COLUMN IF NOT EXISTS menu_config JSONB DEFAULT '[]'::jsonb;
