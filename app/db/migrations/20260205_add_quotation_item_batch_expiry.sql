begin;

-- Add optional batch/expiry to quotation items (healthcare use-cases)
alter table quotation_items
  add column if not exists batch_no text,
  add column if not exists exp_date date;

-- Ensure sale_items has meta for batch/expiry annotations
alter table sale_items
  add column if not exists meta jsonb not null default '{}'::jsonb;

commit;
